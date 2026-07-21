/**
 * Connection IPC Handlers
 */

import { IPC_CHANNELS } from '@mj-forge/shared';
import type { ConnectionProfile, TestConnectionResult, ActiveConnection } from '@mj-forge/shared';
import { ConnectionPoolManager } from '../services/sql/connection-pool';
import { ConnectionProfilesStore } from '../services/config/connection-profiles';
import { capabilitiesForDialect } from '../services/sql/dialect';
import { listAwsProfiles } from '../services/config/aws-profiles';
import { createLogger } from '../utils/logger';
import { safeHandle } from './safe-handle';

const log = createLogger('IPC:Connection');

export function registerConnectionHandlers(): void {
  const poolManager = ConnectionPoolManager.getInstance();
  const profileStore = ConnectionProfilesStore.getInstance();

  // Test connection
  safeHandle(
    IPC_CHANNELS.CONNECTION.TEST,
    async (
      _event,
      profile: ConnectionProfile,
      password?: string,
      sshPassword?: string,
      sshPassphrase?: string
    ): Promise<TestConnectionResult> => {
      // Get password from the profile store if this is a saved profile and no password provided
      const pwd =
        password ??
        (profile.id ? ((await profileStore.getPassword(profile.id)) ?? undefined) : undefined);

      // Pass SSH credentials directly for test connections (not yet saved to Keychain)
      const sshCreds = sshPassword || sshPassphrase ? { sshPassword, sshPassphrase } : undefined;

      return poolManager.testConnection(profile, pwd, sshCreds);
    }
  );

  // Save connection
  safeHandle(
    IPC_CHANNELS.CONNECTION.SAVE,
    async (
      _event,
      profile: ConnectionProfile,
      password?: string,
      sshPassword?: string,
      sshPassphrase?: string
    ): Promise<ConnectionProfile> => {
      log.info(`Saving profile: ${profile.name}`);
      const savedProfile = await profileStore.save({
        profile,
        password,
        sshPassword,
        sshPassphrase,
      });
      return savedProfile;
    }
  );

  // Delete connection
  safeHandle(IPC_CHANNELS.CONNECTION.DELETE, async (_event, id: string): Promise<void> => {
    try {
      await poolManager.closePool(id);
    } catch {
      // Pool may already be closed — continue with profile deletion
    }
    await profileStore.delete(id);
  });

  // List connections
  safeHandle(IPC_CHANNELS.CONNECTION.LIST, async (): Promise<ConnectionProfile[]> => {
    return profileStore.getAll();
  });

  // Connect
  safeHandle(
    IPC_CHANNELS.CONNECTION.CONNECT,
    async (_event, id: string): Promise<ActiveConnection> => {
      log.info(`Connecting with profile: ${id}`);
      const profile = profileStore.getById(id);
      if (!profile) {
        log.error(`Profile not found: ${id}`);
        throw new Error('Connection profile not found');
      }

      const engine = profile.engine || 'mssql';
      if (engine === 'postgresql') {
        await poolManager.getPgPool(id);
        await poolManager.detectDsql(id);
      } else if (engine === 'mysql') {
        await poolManager.getMySQLPool(id);
      } else {
        await poolManager.getPool(id);
      }
      log.info(`Connected to ${profile.name} (${engine})`);

      const defaultDb =
        engine === 'postgresql'
          ? profile.database || 'postgres'
          : engine === 'mysql'
            ? profile.database || 'information_schema'
            : profile.database || 'master';

      const dialect = poolManager.getDialectForProfile(id);
      return {
        id,
        profile,
        status: 'connected',
        connectedAt: new Date().toISOString(),
        currentDatabase: defaultDb,
        engineVariant: dialect.variant,
        capabilities: capabilitiesForDialect(dialect),
      };
    }
  );

  // Disconnect
  safeHandle(IPC_CHANNELS.CONNECTION.DISCONNECT, async (_event, id: string): Promise<void> => {
    await poolManager.closePool(id);
  });

  // Cheap liveness ping used by the renderer heartbeat (SELECT 1)
  safeHandle(IPC_CHANNELS.CONNECTION.PING, async (_event, id: string): Promise<boolean> => {
    return poolManager.pingConnection(id);
  });

  // AWS profile names for the aws-iam auth picker (names only — no credentials)
  safeHandle(IPC_CHANNELS.CONNECTION.LIST_AWS_PROFILES, async (): Promise<string[]> => {
    return listAwsProfiles();
  });
}
