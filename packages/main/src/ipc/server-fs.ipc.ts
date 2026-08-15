/**
 * Server File System IPC Handlers
 * Handles browsing the database server's file system.
 * Only supported on SQL Server (via xp_dirtree, xp_fixeddrives).
 */

import { IPC_CHANNELS } from '@joinery/shared';
import { ServerFilesystemService } from '../services/sql/server-filesystem';
import { ConnectionPoolManager } from '../services/sql/connection-pool';
import { safeHandle } from './safe-handle';

const serverFs = new ServerFilesystemService();

function assertServerFileBrowsing(connectionId: string): void {
  const pool = ConnectionPoolManager.getInstance();
  const dialect = pool.getDialectForProfile(connectionId);
  if (!dialect.supportsServerFileBrowsing) {
    throw new Error(
      `Server file browsing is not supported for ${dialect.label}. ` +
        `Use a local file path instead.`
    );
  }
}

export function registerServerFsHandlers(): void {
  // Get available drives
  safeHandle(IPC_CHANNELS.SERVER_FS.GET_DRIVES, async (_event, connectionId: string) => {
    assertServerFileBrowsing(connectionId);
    return serverFs.getDrives(connectionId);
  });

  // List directory contents
  safeHandle(
    IPC_CHANNELS.SERVER_FS.LIST_DIRECTORY,
    async (_event, connectionId: string, path: string, includeFiles = true) => {
      assertServerFileBrowsing(connectionId);
      return serverFs.listDirectory(connectionId, path, includeFiles);
    }
  );

  // Get default paths
  safeHandle(IPC_CHANNELS.SERVER_FS.GET_DEFAULT_PATHS, async (_event, connectionId: string) => {
    assertServerFileBrowsing(connectionId);
    return serverFs.getDefaultPaths(connectionId);
  });
}
