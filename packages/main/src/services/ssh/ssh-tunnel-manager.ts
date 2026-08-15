/**
 * SSH Tunnel Manager
 * Manages SSH tunnels keyed by connection profile ID.
 * Each tunnel forwards a random local port through an SSH bastion to the target database.
 */

import { Client } from 'ssh2';
import * as net from 'net';
import * as fs from 'fs';
import type { SshTunnelConfig } from '@joinery/shared';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';
import { CredentialStore } from '../keychain/credential-store';

const log = createLogger('SshTunnel');

export interface TunnelEndpoint {
  localHost: string;
  localPort: number;
}

export interface SshCredentials {
  sshPassword?: string;
  sshPassphrase?: string;
}

interface ActiveTunnel {
  sshClient: Client;
  localServer: net.Server;
  localPort: number;
}

export class SshTunnelManager extends BaseSingleton {
  private tunnels: Map<string, ActiveTunnel> = new Map();
  private credentialStore: CredentialStore;

  constructor() {
    super();
    this.credentialStore = CredentialStore.getInstance();
  }

  /**
   * Open an SSH tunnel for a profile.
   * Returns the local endpoint to connect database clients to.
   * Pass `credentials` directly for test connections that haven't been saved yet.
   */
  async openTunnel(
    profileId: string,
    sshConfig: SshTunnelConfig,
    targetHost: string,
    targetPort: number,
    credentials?: SshCredentials
  ): Promise<TunnelEndpoint> {
    // Reuse existing tunnel
    const existing = this.tunnels.get(profileId);
    if (existing) {
      log.debug(`Reusing existing tunnel for ${profileId} on port ${existing.localPort}`);
      return { localHost: '127.0.0.1', localPort: existing.localPort };
    }

    log.info(`Opening SSH tunnel for ${profileId} via ${sshConfig.host}:${sshConfig.port}`);

    const sshClient = new Client();

    // Build auth config.
    // keepaliveInterval/keepaliveCountMax send SSH-level keepalives so ssh2 detects
    // a silently-dropped TCP socket (NAT/firewall idle timeout, network change, laptop
    // sleep) within ~90s instead of hanging forever on a dead session.
    const connectConfig: Parameters<Client['connect']>[0] = {
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.username,
      readyTimeout: 15000,
      keepaliveInterval: 30000,
      keepaliveCountMax: 3,
    };

    if (sshConfig.authType === 'privateKey') {
      const keyPath = sshConfig.privateKeyPath!.replace(/^~/, process.env.HOME || '');
      try {
        connectConfig.privateKey = fs.readFileSync(keyPath);
      } catch (err) {
        throw new Error(
          `Failed to read SSH private key at "${keyPath}": ${(err as Error).message}`
        );
      }
      // Use directly-provided passphrase, or fall back to credential store
      const passphrase =
        credentials?.sshPassphrase ??
        (await this.credentialStore.get(`${profileId}:ssh-passphrase`));
      if (passphrase) {
        connectConfig.passphrase = passphrase;
      }
    } else {
      // Use directly-provided password, or fall back to credential store
      const sshPassword =
        credentials?.sshPassword ?? (await this.credentialStore.get(`${profileId}:ssh-password`));
      if (!sshPassword) {
        throw new Error('SSH password not found in Keychain');
      }
      connectConfig.password = sshPassword;
    }

    // Connect SSH and create local forwarding server
    return new Promise<TunnelEndpoint>((resolve, reject) => {
      let settled = false;

      // Identity-check eviction: only call closeTunnel if the map entry is
      // STILL this sshClient. A dying ssh2 client can emit several events as
      // it tears down ('end' + 'close', plus deferred events from our own
      // sshClient.end() inside closeTunnel). If a fresh tunnel for the same
      // profile has been established between events from the old client,
      // those deferred events would otherwise tear down the new tunnel.
      const evictIfStillOurs = (reason: string) => {
        const current = this.tunnels.get(profileId);
        if (!current || current.sshClient !== sshClient) return;
        log.warn(`SSH tunnel for ${profileId} ${reason} — evicting`);
        // closeTunnel never rejects (each step is wrapped in try/catch
        // internally), so fire-and-forget is safe here.
        void this.closeTunnel(profileId);
      };

      sshClient.on('error', err => {
        const message = this.friendlyError(err);
        log.error(`SSH error for ${profileId}: ${message}`);
        if (!settled) {
          settled = true;
          reject(new Error(message));
          // Pre-settle: no map entry exists yet for this client, so this is
          // a no-op against the map. Skip identity check.
          void this.closeTunnel(profileId);
          return;
        }
        evictIfStillOurs('errored');
      });

      // 'close'/'end' fire when the SSH session terminates — either by us calling
      // closeTunnel or because the bastion dropped us / keepalives failed.
      //
      // Pre-settle: ssh2 normally emits 'error' before 'close' during connection
      // setup, but we defensively reject here too in case it doesn't — otherwise
      // the openTunnel promise would hang forever.
      // Post-settle: evict the dead tunnel so the next openTunnel call builds a
      // fresh one instead of handing back the stale local port. Identity-checked
      // so a deferred event doesn't clobber a freshly-reconnected tunnel.
      const handleUnexpectedClose = (reason: 'close' | 'end') => {
        if (!settled) {
          settled = true;
          reject(new Error(`SSH connection ${reason}d before ready`));
          void this.closeTunnel(profileId);
          return;
        }
        evictIfStillOurs(`${reason}d unexpectedly`);
      };
      sshClient.on('close', () => handleUnexpectedClose('close'));
      sshClient.on('end', () => handleUnexpectedClose('end'));

      sshClient.on('ready', () => {
        log.info(`SSH connection established for ${profileId}`);

        // Create a local TCP server that forwards connections through the SSH tunnel
        const localServer = net.createServer(socket => {
          sshClient.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, stream) => {
            if (err) {
              log.error(`SSH forwardOut error: ${err.message}`);
              socket.destroy();
              return;
            }
            socket.pipe(stream).pipe(socket);
            stream.on('error', () => socket.destroy());
            socket.on('error', () => stream.destroy());
          });
        });

        localServer.on('error', err => {
          log.error(`Local tunnel server error: ${err.message}`);
          if (!settled) {
            settled = true;
            reject(new Error(`Failed to start local tunnel server: ${err.message}`));
          }
        });

        // Listen on a random port
        localServer.listen(0, '127.0.0.1', () => {
          // Race guard: if close/end/error fired between 'ready' and the
          // listen callback running, settled is already true and the promise
          // is already rejected. Adding the entry to the map now would orphan
          // a dead tunnel that can never be auto-evicted (those events won't
          // fire again on this client). Tear down the local server and bail.
          if (settled) {
            try {
              localServer.close();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              log.warn(`Failed to close orphaned local server for ${profileId}: ${msg}`);
            }
            return;
          }

          const addr = localServer.address() as net.AddressInfo;
          const localPort = addr.port;

          this.tunnels.set(profileId, { sshClient, localServer, localPort });
          log.info(
            `Tunnel active for ${profileId}: 127.0.0.1:${localPort} → ${targetHost}:${targetPort}`
          );

          settled = true;
          resolve({ localHost: '127.0.0.1', localPort });
        });
      });

      sshClient.connect(connectConfig);
    });
  }

  /**
   * Close a tunnel for a specific profile
   */
  async closeTunnel(profileId: string): Promise<void> {
    const tunnel = this.tunnels.get(profileId);
    if (!tunnel) return;

    log.info(`Closing SSH tunnel for ${profileId}`);
    this.tunnels.delete(profileId);

    // Both calls are synchronous and don't normally throw, but we still wrap
    // them so closeTunnel never rejects — callers (closePool, the void call
    // sites in our own event handlers) rely on this to avoid unhandled
    // rejection crashes under Node's default behaviour.
    try {
      tunnel.localServer.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to close local server for ${profileId}: ${msg}`);
    }

    try {
      tunnel.sshClient.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to end ssh client for ${profileId}: ${msg}`);
    }
  }

  /**
   * Close all tunnels (for app shutdown)
   */
  async closeAll(): Promise<void> {
    log.info(`Closing all SSH tunnels (${this.tunnels.size} active)`);
    const closes = Array.from(this.tunnels.keys()).map(id => this.closeTunnel(id));
    await Promise.all(closes);
  }

  /**
   * Check if a tunnel is active for a profile
   */
  hasTunnel(profileId: string): boolean {
    return this.tunnels.has(profileId);
  }

  private friendlyError(err: Error & { level?: string }): string {
    const msg = err.message || String(err);

    if (msg.includes('All configured authentication methods failed')) {
      return 'SSH authentication failed — check your username, password, or private key';
    }
    if (msg.includes('getaddrinfo') || msg.includes('ENOTFOUND')) {
      return `SSH host not found — check the hostname "${msg.match(/getaddrinfo.*\s(\S+)/)?.[1] || ''}"`;
    }
    if (msg.includes('ECONNREFUSED')) {
      return 'SSH connection refused — check that the SSH server is running and the port is correct';
    }
    if (msg.includes('ETIMEDOUT') || msg.includes('Timed out')) {
      return 'SSH connection timed out — check network connectivity and firewall rules';
    }
    if (msg.includes('Cannot parse privateKey') || msg.includes('Encrypted private key')) {
      return 'Failed to parse SSH private key — check the key file format or passphrase';
    }

    return `SSH error: ${msg}`;
  }
}
