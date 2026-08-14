/**
 * SQL Server (T-SQL) Dialect Implementation
 *
 * Delegates metadata queries to the existing TsqlBuilder to avoid
 * duplicating its 950+ lines. As other dialects mature, the shared
 * interface ensures callers never see T-SQL specifics.
 */

import type {
  CreateDatabaseOptions,
  RenameDatabaseOptions,
  DeleteDatabaseOptions,
} from '@forgedb/shared';
import { SQLDialect } from './sql-dialect';
import { TsqlBuilder } from '../../../utils/tsql-builder';

export class MSSQLDialect extends SQLDialect {
  readonly engine = 'mssql' as const;
  readonly label = 'SQL Server';
  readonly defaultPort = 1433;
  readonly monacoLanguage = 'sql'; // Monaco's built-in SQL mode is T-SQL oriented
  readonly batchSeparator = 'GO';
  readonly supportsWindowsAuth = true;
  readonly supportsBackupRestore = true;
  readonly supportsExtendedProperties = true;
  readonly supportsObjectComments = true;
  readonly supportsServerFileBrowsing = true;

  quoteIdentifier(name: string): string {
    return TsqlBuilder.escapeIdentifier(name);
  }

  useDatabaseSQL(database: string): string {
    return `USE ${this.quoteIdentifier(database)};`;
  }

  // ── DDL ──────────────────────────────────────────────────────

  createDatabaseSQL(options: CreateDatabaseOptions): string {
    return TsqlBuilder.createDatabase(options);
  }

  renameDatabaseSQL(options: RenameDatabaseOptions): string {
    return TsqlBuilder.renameDatabase(options);
  }

  dropDatabaseSQL(options: DeleteDatabaseOptions): string {
    return TsqlBuilder.dropDatabase(options);
  }

  // ── Metadata queries ─────────────────────────────────────────

  listDatabasesSQL(isAzure = false): string {
    return TsqlBuilder.listDatabases(isAzure);
  }

  listSchemasSQL(database: string): string {
    return TsqlBuilder.listSchemas(database);
  }

  listTablesSQL(database: string): string {
    return TsqlBuilder.listTables(database);
  }

  listViewsSQL(database: string): string {
    return TsqlBuilder.listViews(database);
  }

  listProceduresSQL(database: string): string {
    return TsqlBuilder.listProcedures(database);
  }

  listFunctionsSQL(database: string): string {
    return TsqlBuilder.listFunctions(database);
  }

  listColumnsSQL(database: string, schema: string, table: string): string {
    return TsqlBuilder.listColumns(database, schema, table);
  }

  listIndexesSQL(database: string, schema: string, table: string): string {
    return TsqlBuilder.listIndexes(database, schema, table);
  }

  listForeignKeysSQL(database: string, schema: string, table: string): string {
    return TsqlBuilder.listForeignKeys(database, schema, table);
  }

  listConstraintsSQL(database: string, schema: string, table: string): string {
    return TsqlBuilder.listConstraints(database, schema, table);
  }

  listTriggersSQL(database: string, schema: string, table: string): string {
    return TsqlBuilder.listTriggers(database, schema, table);
  }

  getObjectDefinitionSQL(database: string, schema: string, name: string): string {
    return TsqlBuilder.getObjectDefinition(database, schema, name);
  }

  listObjectCommentsSQL(database: string, schema: string, table: string): string {
    return TsqlBuilder.listExtendedProperties(database, schema, table);
  }
}
