/**
 * Tests for SshTunnelManager.
 *
 * `ssh2` is aliased to a mock in vitest.config.ts so the SSH client lifecycle
 * can be exercised without a real bastion. We're verifying:
 *
 *   - keepalive params are passed through to ssh2 (proactive death detection)
 *   - 'close' / 'end' on the SSH client evict the tunnel from the manager's
 *     map (so a dead tunnel can't be handed back to the next caller)
 *   - openTunnel after eviction creates a fresh tunnel rather than reusing
 *     the dead one
 *   - closeTunnel is idempotent
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Reach into the mock module directly for type-safe access to the test
// helpers — the vitest alias redirects runtime `ssh2` imports inside the
// manager, while this import resolves at compile time to the same file.
import { __mockSshClients, __mockSshState, __resetMockSsh } from '../../__mocks__/ssh2';
import { SshTunnelManager } from './ssh-tunnel-manager';
import type { SshTunnelConfig } from '@forgedb/shared';

const sshConfig: SshTunnelConfig = {
  enabled: true,
  host: 'bastion.example.com',
  port: 22,
  username: 'tunneluser',
  authType: 'password',
};

describe('SshTunnelManager', () => {
  let mgr: SshTunnelManager;

  beforeEach(() => {
    SshTunnelManager.resetInstance();
    __resetMockSsh();
    mgr = SshTunnelManager.getInstance();
  });

  afterEach(async () => {
    await mgr.closeAll();
  });

  it('passes SSH keepalive params to ssh2 connect config', async () => {
    await mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });
    expect(__mockSshClients).toHaveLength(1);
    const cfg = __mockSshClients[0].connectConfig;
    expect(cfg?.keepaliveInterval).toBe(30000);
    expect(cfg?.keepaliveCountMax).toBe(3);
  });

  it('evicts tunnel from map when sshClient emits close unexpectedly', async () => {
    await mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });
    expect(mgr.hasTunnel('p1')).toBe(true);

    // Simulate the bastion dropping us / keepalive timing out
    __mockSshClients[0].emit('close');
    await new Promise(r => setImmediate(r));

    expect(mgr.hasTunnel('p1')).toBe(false);
  });

  it('evicts tunnel from map when sshClient emits end unexpectedly', async () => {
    await mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });
    expect(mgr.hasTunnel('p1')).toBe(true);

    __mockSshClients[0].emit('end');
    await new Promise(r => setImmediate(r));

    expect(mgr.hasTunnel('p1')).toBe(false);
  });

  it('creates a fresh tunnel after the previous one died', async () => {
    const ep1 = await mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });

    __mockSshClients[0].emit('close');
    await new Promise(r => setImmediate(r));
    expect(mgr.hasTunnel('p1')).toBe(false);

    const ep2 = await mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });
    expect(__mockSshClients).toHaveLength(2);
    // A fresh real `net.createServer().listen(0)` allocates a different OS port
    // than the previous closed one (in practice, with overwhelming probability).
    expect(ep2.localPort).not.toBe(ep1.localPort);
    expect(mgr.hasTunnel('p1')).toBe(true);
  });

  it('reuses a live tunnel for the same profile', async () => {
    const ep1 = await mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });
    const ep2 = await mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });
    expect(ep2.localPort).toBe(ep1.localPort);
    expect(__mockSshClients).toHaveLength(1);
  });

  it('closeTunnel is idempotent', async () => {
    await mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });
    await mgr.closeTunnel('p1');
    await mgr.closeTunnel('p1');
    expect(mgr.hasTunnel('p1')).toBe(false);
  });

  it('explicit closeTunnel does not re-trigger eviction via the close handler', async () => {
    await mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });
    // closeTunnel deletes from the map first, then calls sshClient.end() which
    // emits 'close'. The handler must short-circuit because the entry is gone.
    await mgr.closeTunnel('p1');
    await new Promise(r => setImmediate(r));
    expect(mgr.hasTunnel('p1')).toBe(false);
  });

  it('rejects openTunnel if sshClient closes before ready', async () => {
    // Suppress the mock's auto-'ready' so we can fire 'close' during the
    // establishment phase — the defensive guard in handleUnexpectedClose
    // must reject the promise rather than letting it hang.
    __mockSshState.autoReady = false;
    const promise = mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });
    // Wait for connect() to register the mock client.
    await new Promise(r => setImmediate(r));
    __mockSshClients[0].emit('close');

    await expect(promise).rejects.toThrow(/closed before ready/);
    expect(mgr.hasTunnel('p1')).toBe(false);
  });

  it('deferred event from a dead client does not evict a freshly-reconnected tunnel', async () => {
    // Open T1 with sshClient_A.
    await mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });
    expect(mgr.hasTunnel('p1')).toBe(true);
    const clientA = __mockSshClients[0];

    // T1 dies — first event evicts it from the map.
    clientA.emit('close');
    await new Promise(r => setImmediate(r));
    expect(mgr.hasTunnel('p1')).toBe(false);

    // Reconnect: T2 comes up with a different sshClient instance.
    await mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });
    expect(mgr.hasTunnel('p1')).toBe(true);
    const clientB = __mockSshClients[1];
    expect(clientB).not.toBe(clientA);

    // Deferred 'end' from the OLD client A fires (e.g. the second leg of
    // ssh2's teardown sequence, or a residual event from sshClient.end()).
    // The old client's handler closure must NOT evict T2.
    clientA.emit('end');
    await new Promise(r => setImmediate(r));

    expect(mgr.hasTunnel('p1')).toBe(true);
  });

  it('deferred error from a dead client does not evict a freshly-reconnected tunnel', async () => {
    await mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });
    const clientA = __mockSshClients[0];
    clientA.emit('close');
    await new Promise(r => setImmediate(r));

    await mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });
    expect(mgr.hasTunnel('p1')).toBe(true);

    // Same race as above but via the 'error' handler path.
    clientA.emit('error', new Error('residual SSH error'));
    await new Promise(r => setImmediate(r));

    expect(mgr.hasTunnel('p1')).toBe(true);
  });

  it('does not insert a stale tunnel if close fires between ready and listen', async () => {
    // The narrow race the listen-callback race-guard covers: 'ready' has fired
    // (so the ready handler ran synchronously and called localServer.listen()),
    // but the OS port-bind callback has not yet executed. If 'close'/'end' fires
    // in this window, the listen callback would otherwise unconditionally
    // insert a stale entry that can never be auto-evicted (those events won't
    // fire again on this client).
    //
    // Disable auto-ready so we can fire 'ready' and 'close' synchronously
    // back-to-back, with the OS listen callback provably still pending.
    __mockSshState.autoReady = false;
    const promise = mgr.openTunnel('p1', sshConfig, 'db.internal', 1433, { sshPassword: 'pw' });

    // Wait for connect() to register the mock client.
    await new Promise(r => setImmediate(r));

    // Fire 'ready' synchronously: the ready handler creates localServer and
    // calls listen() — the listen callback is scheduled but has NOT yet run.
    __mockSshClients[0].emit('ready');

    // Trigger the race: fire 'close' before the listen callback can execute.
    __mockSshClients[0].emit('close');

    await expect(promise).rejects.toThrow(/closed before ready/);

    // Allow the now-orphaned listen callback to fire. With the guard it sees
    // settled=true, closes the local server, and returns without inserting.
    // Without the guard, it would insert a stale tunnel here.
    await new Promise(r => setTimeout(r, 50));

    expect(mgr.hasTunnel('p1')).toBe(false);
  });
});
