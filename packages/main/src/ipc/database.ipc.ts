/**
 * Database IPC Handlers
 */

import { IPC_CHANNELS } from '@mj-forge/shared';
import type {
  DatabaseInfo,
  CreateDatabaseOptions,
  CreateDatabaseResult,
  RenameDatabaseOptions,
  RenameDatabaseResult,
  DeleteDatabaseOptions,
  DeleteDatabaseResult,
  MJDatabaseInfo,
  MJEntityInfo,
  MJEntityFieldInfo,
  MJApplicationInfo,
  MJRecordChange,
  MJAuditLog,
  MJQuery,
  MJErrorLog,
  MJUserRecordLog,
  MJEntityRelationship,
} from '@mj-forge/shared';
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

  // ============================================================
  // MemberJunction Integration
  // ============================================================

  // Detect if database has MemberJunction installed
  safeHandle(
    IPC_CHANNELS.MJ.DETECT,
    async (
      _event,
      connectionId: string,
      database: string,
      mjSchemaName?: string
    ): Promise<MJDatabaseInfo> => {
      return metadataService.detectMJDatabase(connectionId, database, mjSchemaName);
    }
  );

  // Get MJ entities
  safeHandle(
    IPC_CHANNELS.MJ.GET_ENTITIES,
    async (
      _event,
      connectionId: string,
      database: string,
      mjSchemaName?: string
    ): Promise<MJEntityInfo[]> => {
      return metadataService.getMJEntities(connectionId, database, mjSchemaName);
    }
  );

  // Get MJ entity fields
  safeHandle(
    IPC_CHANNELS.MJ.GET_ENTITY_FIELDS,
    async (
      _event,
      connectionId: string,
      database: string,
      entityId: string,
      mjSchemaName?: string
    ): Promise<MJEntityFieldInfo[]> => {
      return metadataService.getMJEntityFields(connectionId, database, entityId, mjSchemaName);
    }
  );

  // Get MJ applications
  safeHandle(
    IPC_CHANNELS.MJ.GET_APPLICATIONS,
    async (
      _event,
      connectionId: string,
      database: string,
      mjSchemaName?: string
    ): Promise<MJApplicationInfo[]> => {
      return metadataService.getMJApplications(connectionId, database, mjSchemaName);
    }
  );

  // Get MJ entity relationships
  safeHandle(
    IPC_CHANNELS.MJ.GET_ENTITY_RELATIONSHIPS,
    async (
      _event,
      connectionId: string,
      database: string,
      entityId?: string,
      mjSchemaName?: string
    ): Promise<MJEntityRelationship[]> => {
      return metadataService.getMJEntityRelationships(
        connectionId,
        database,
        entityId,
        mjSchemaName
      );
    }
  );

  // Get MJ record changes (change history)
  safeHandle(
    IPC_CHANNELS.MJ.GET_RECORD_CHANGES,
    async (
      _event,
      connectionId: string,
      database: string,
      options?: { entityId?: string; entityName?: string; recordId?: string; limit?: number },
      mjSchemaName?: string
    ): Promise<MJRecordChange[]> => {
      return metadataService.getMJRecordChanges(connectionId, database, options, mjSchemaName);
    }
  );

  // Get MJ audit logs
  safeHandle(
    IPC_CHANNELS.MJ.GET_AUDIT_LOGS,
    async (
      _event,
      connectionId: string,
      database: string,
      options?: { entityId?: string; recordId?: string; userId?: string; limit?: number },
      mjSchemaName?: string
    ): Promise<MJAuditLog[]> => {
      return metadataService.getMJAuditLogs(connectionId, database, options, mjSchemaName);
    }
  );

  // Get MJ saved queries
  safeHandle(
    IPC_CHANNELS.MJ.GET_SAVED_QUERIES,
    async (
      _event,
      connectionId: string,
      database: string,
      categoryId?: string,
      mjSchemaName?: string
    ): Promise<MJQuery[]> => {
      return metadataService.getMJSavedQueries(connectionId, database, categoryId, mjSchemaName);
    }
  );

  // Get MJ error logs
  safeHandle(
    IPC_CHANNELS.MJ.GET_ERROR_LOGS,
    async (
      _event,
      connectionId: string,
      database: string,
      options?: { category?: string; limit?: number },
      mjSchemaName?: string
    ): Promise<MJErrorLog[]> => {
      return metadataService.getMJErrorLogs(connectionId, database, options, mjSchemaName);
    }
  );

  // Get MJ user record logs
  safeHandle(
    IPC_CHANNELS.MJ.GET_USER_RECORD_LOGS,
    async (
      _event,
      connectionId: string,
      database: string,
      options?: { entityId?: string; recordId?: string; userId?: string; limit?: number },
      mjSchemaName?: string
    ): Promise<MJUserRecordLog[]> => {
      return metadataService.getMJUserRecordLogs(connectionId, database, options, mjSchemaName);
    }
  );
}
