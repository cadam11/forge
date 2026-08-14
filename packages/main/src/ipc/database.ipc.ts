/**
 * Database IPC Handlers
 */

import { IPC_CHANNELS } from '@forgedb/shared';
import type {
  DatabaseInfo,
  CreateDatabaseOptions,
  CreateDatabaseResult,
  RenameDatabaseOptions,
  RenameDatabaseResult,
  DeleteDatabaseOptions,
  DeleteDatabaseResult,
} from '@forgedb/shared';
import { ConnectionPoolManager } from '../services/sql/connection-pool';
import { MetadataService } from '../services/sql/metadata';
import { createLogger } from '../utils/logger';
import { safeHandle } from './safe-handle';

export function registerDatabaseHandlers(): void {
  const poolManager = ConnectionPoolManager.getInstance();
  const metadataService = MetadataService.getInstance();

  // List databases
  safeHandle(
    IPC_CHANNELS.DATABASE.LIST,
    async (_event, connectionId: string): Promise<DatabaseInfo[]> => {
      return metadataService.listDatabases(connectionId);
    }
  );

  // Create database
  safeHandle(
    IPC_CHANNELS.DATABASE.CREATE,
    async (
      _event,
      connectionId: string,
      options: CreateDatabaseOptions
    ): Promise<CreateDatabaseResult> => {
      const dialect = poolManager.getDialectForProfile(connectionId);
      const sql = dialect.createDatabaseSQL(options);

      try {
        await poolManager.executeDDL(connectionId, sql);
        metadataService.invalidateDatabases(connectionId);
        return { success: true, tsql: sql };
      } catch (error) {
        const err = error as Error;
        return { success: false, tsql: sql, error: err.message };
      }
    }
  );

  // Rename database
  safeHandle(
    IPC_CHANNELS.DATABASE.RENAME,
    async (
      _event,
      connectionId: string,
      options: RenameDatabaseOptions
    ): Promise<RenameDatabaseResult> => {
      const dialect = poolManager.getDialectForProfile(connectionId);
      const sql = dialect.renameDatabaseSQL(options);

      try {
        await poolManager.executeDDL(connectionId, sql);
        metadataService.invalidateDatabases(connectionId);
        return { success: true, tsql: sql };
      } catch (error) {
        const err = error as Error;
        return { success: false, tsql: sql, error: err.message };
      }
    }
  );

  // Delete database
  safeHandle(
    IPC_CHANNELS.DATABASE.DELETE,
    async (
      _event,
      connectionId: string,
      options: DeleteDatabaseOptions
    ): Promise<DeleteDatabaseResult> => {
      const engine = poolManager.getEngineForProfile(connectionId);
      const dialect = poolManager.getDialectForProfile(connectionId);
      const sql = dialect.dropDatabaseSQL(options);
      // Diagnostic logging — useful for tracking down "delete went to the
      // wrong server" complaints. Reports the routing decision (engine
      // resolved from the connection profile) and the SQL Forge ran.
      const log = createLogger('IPC:Database');
      log.info(
        `delete database: connectionId=${connectionId} engine=${engine} target=${options.name}`
      );
      log.debug(`delete database SQL: ${sql}`);

      try {
        // Forge's own pool may be holding the target database open (an
        // expanded explorer node or open query window keeps a live pool),
        // which blocks DROP DATABASE even after the SQL kicks external
        // sessions. Release our grip first. Reconnects lazily, so no restart.
        await poolManager.closePoolForDatabase(connectionId, options.name);
        await poolManager.executeDDL(connectionId, sql);
        metadataService.invalidateDatabases(connectionId);
        return { success: true, tsql: sql };
      } catch (error) {
        const err = error as Error;
        log.error(`delete database failed (engine=${engine}): ${err.message}`);
        return { success: false, tsql: sql, error: err.message };
      }
    }
  );

  // Get database info
  safeHandle(
    IPC_CHANNELS.DATABASE.GET_INFO,
    async (_event, connectionId: string, name: string): Promise<DatabaseInfo | null> => {
      const databases = await metadataService.listDatabases(connectionId);
      return databases.find(d => d.name === name) || null;
    }
  );
}
