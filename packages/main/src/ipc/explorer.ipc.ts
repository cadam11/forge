/**
 * Explorer IPC Handlers
 */

import { IPC_CHANNELS } from '@forgedb/shared';
import type {
  TableInfo,
  ViewInfo,
  ProcedureInfo,
  ObjectDefinition,
  ObjectMetadata,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  ConstraintInfo,
  TriggerInfo,
  ExtendedProperty,
  TableProperties,
  SchemaInfo,
} from '@forgedb/shared';
import { MetadataService } from '../services/sql/metadata';
import { createLogger } from '../utils/logger';
import { safeHandle } from './safe-handle';

const log = createLogger('IPC:Explorer');

export function registerExplorerHandlers(): void {
  const metadataService = MetadataService.getInstance();

  // Get children for a path (tables, views, procedures, functions)
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_CHILDREN,
    async (
      _event,
      connectionId: string,
      databaseName: string,
      parentPath: string
    ): Promise<ObjectMetadata[]> => {
      log.debug(`Getting children for ${databaseName}/${parentPath}`);

      if (parentPath === 'schemas') {
        const schemas = await metadataService.listSchemas(connectionId, databaseName);
        // Filter out system schemas and return as ObjectMetadata
        return schemas
          .filter(s => !s.isSystem)
          .map(s => ({
            name: s.name,
            type: 'schema' as const,
            schema: s.name,
          }));
      }

      if (parentPath === 'tables') {
        const tables = await metadataService.listTables(connectionId, databaseName);
        return tables.map(t => ({
          name: t.name,
          type: 'table' as const,
          schema: t.schema,
          rowCount: t.rowCount,
          sizeKb: t.sizeKb,
        }));
      }

      if (parentPath === 'views') {
        const views = await metadataService.listViews(connectionId, databaseName);
        return views.map(v => ({
          name: v.name,
          type: 'view' as const,
          schema: v.schema,
        }));
      }

      if (parentPath === 'procedures') {
        const procs = await metadataService.listProcedures(connectionId, databaseName);
        return procs.map(p => ({
          name: p.name,
          type: 'procedure' as const,
          schema: p.schema,
        }));
      }

      if (parentPath === 'functions') {
        const functions = await metadataService.listFunctions(connectionId, databaseName);
        return functions.map(f => ({
          name: f.name,
          type: 'function' as const,
          schema: f.schema,
        }));
      }

      return [];
    }
  );

  // Get object details
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_OBJECT_DETAILS,
    async (
      _event,
      _connectionId: string,
      _databaseName: string,
      objectType: string,
      objectName: string,
      schema?: string
    ): Promise<ObjectMetadata> => {
      return {
        name: objectName,
        type: objectType as ObjectMetadata['type'],
        schema: schema || 'dbo',
      };
    }
  );

  // Refresh node — invalidates cache and re-fetches children
  safeHandle(
    IPC_CHANNELS.EXPLORER.REFRESH_NODE,
    async (
      _event,
      connectionId: string,
      databaseName: string,
      nodePath: string
    ): Promise<ObjectMetadata[]> => {
      metadataService.invalidateConnection(connectionId);

      // Re-fetch using the same logic as GET_CHILDREN
      if (nodePath === 'tables') {
        const tables = await metadataService.listTables(connectionId, databaseName);
        return tables.map(t => ({
          name: t.name,
          type: 'table' as const,
          schema: t.schema,
          rowCount: t.rowCount,
          sizeKb: t.sizeKb,
        }));
      }
      if (nodePath === 'views') {
        const views = await metadataService.listViews(connectionId, databaseName);
        return views.map(v => ({ name: v.name, type: 'view' as const, schema: v.schema }));
      }
      if (nodePath === 'procedures') {
        const procs = await metadataService.listProcedures(connectionId, databaseName);
        return procs.map(p => ({ name: p.name, type: 'procedure' as const, schema: p.schema }));
      }
      if (nodePath === 'functions') {
        const functions = await metadataService.listFunctions(connectionId, databaseName);
        return functions.map(f => ({ name: f.name, type: 'function' as const, schema: f.schema }));
      }
      if (nodePath === 'schemas') {
        const schemas = await metadataService.listSchemas(connectionId, databaseName);
        return schemas
          .filter(s => !s.isSystem)
          .map(s => ({ name: s.name, type: 'schema' as const, schema: s.name }));
      }
      return [];
    }
  );

  // List schemas
  safeHandle(
    IPC_CHANNELS.EXPLORER.LIST_SCHEMAS,
    async (_event, connectionId: string, database: string): Promise<SchemaInfo[]> => {
      return metadataService.listSchemas(connectionId, database);
    }
  );

  // Get tables
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_TABLES,
    async (_event, connectionId: string, database: string): Promise<TableInfo[]> => {
      return metadataService.listTables(connectionId, database);
    }
  );

  // Get views
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_VIEWS,
    async (_event, connectionId: string, database: string): Promise<ViewInfo[]> => {
      return metadataService.listViews(connectionId, database);
    }
  );

  // Get procedures
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_PROCEDURES,
    async (_event, connectionId: string, database: string): Promise<ProcedureInfo[]> => {
      return metadataService.listProcedures(connectionId, database);
    }
  );

  // Get object definition
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_DEFINITION,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      name: string,
      type: string
    ): Promise<ObjectDefinition> => {
      return metadataService.getObjectDefinition(connectionId, database, schema, name, type);
    }
  );

  // Refresh
  safeHandle(IPC_CHANNELS.EXPLORER.REFRESH, async (_event, connectionId: string): Promise<void> => {
    metadataService.invalidateConnection(connectionId);
  });

  // Get table columns
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_TABLE_COLUMNS,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<ColumnInfo[]> => {
      return metadataService.listColumns(connectionId, database, schema, table);
    }
  );

  // Get table indexes
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_TABLE_INDEXES,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<IndexInfo[]> => {
      return metadataService.listIndexes(connectionId, database, schema, table);
    }
  );

  // Get table foreign keys
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_TABLE_KEYS,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<ForeignKeyInfo[]> => {
      return metadataService.listForeignKeys(connectionId, database, schema, table);
    }
  );

  // Get table constraints
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_TABLE_CONSTRAINTS,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<ConstraintInfo[]> => {
      return metadataService.listConstraints(connectionId, database, schema, table);
    }
  );

  // Get table triggers
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_TABLE_TRIGGERS,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<TriggerInfo[]> => {
      return metadataService.listTriggers(connectionId, database, schema, table);
    }
  );

  // Get table properties (comprehensive)
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_TABLE_PROPERTIES,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<TableProperties> => {
      log.debug(`Getting table properties for ${database}.${schema}.${table}`);
      return metadataService.getTableProperties(connectionId, database, schema, table);
    }
  );

  // Get extended properties
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_EXTENDED_PROPERTIES,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<ExtendedProperty[]> => {
      log.debug(`Getting extended properties for ${database}.${schema}.${table}`);
      return metadataService.listExtendedProperties(connectionId, database, schema, table);
    }
  );

  // Get enriched column metadata (with PK/FK info)
  safeHandle(
    IPC_CHANNELS.EXPLORER.GET_ENRICHED_COLUMNS,
    async (_event, connectionId: string, database: string, schema: string, table: string) => {
      log.debug(`Getting enriched columns for ${database}.${schema}.${table}`);
      return metadataService.getEnrichedColumnMetadata(connectionId, database, schema, table);
    }
  );

  // Script table as CREATE
  safeHandle(
    IPC_CHANNELS.EXPLORER.SCRIPT_TABLE_CREATE,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<string> => {
      log.debug(`Scripting ${database}.${schema}.${table} as CREATE`);
      return metadataService.scriptTableAsCreate(connectionId, database, schema, table);
    }
  );

  // Script table as INSERT
  safeHandle(
    IPC_CHANNELS.EXPLORER.SCRIPT_TABLE_INSERT,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<string> => {
      log.debug(`Scripting ${database}.${schema}.${table} as INSERT`);
      return metadataService.scriptTableAsInsert(connectionId, database, schema, table);
    }
  );
}
