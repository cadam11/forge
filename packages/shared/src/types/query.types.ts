/**
 * Query-related type definitions
 */

export interface QueryRequest {
  connectionId: string;
  database?: string;
  sql: string;
  queryId?: string;
  timeout?: number;
  /**
   * Originating query-tab id. When present (and database is set), the main
   * process persists a result snapshot after execution — the renderer never
   * ships the result back over IPC for snapshotting.
   */
  tabId?: string;
  /**
   * User's maxRowsToDisplay setting. The executor truncates each result set
   * to this many rows before the result crosses IPC (ResultSet.truncated
   * marks capped sets; rowCount keeps the true received count).
   */
  maxRows?: number;
}

export interface ColumnMetadata {
  name: string;
  type: string;
  dataType?: string; // alias for type
  nullable?: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
  /** Whether this column is a primary key */
  isPrimaryKey?: boolean;
  /** Foreign key reference info if this column is a FK */
  foreignKey?: {
    referencedSchema: string;
    referencedTable: string;
    referencedColumn: string;
    constraintName?: string;
  };
  /** Whether this column is an identity/auto-increment column */
  isIdentity?: boolean;
  /** Default value expression */
  defaultValue?: string;
}

export interface ResultSet {
  columns: ColumnMetadata[];
  rows: Record<string, unknown>[];
  /** True received count — may exceed rows.length when truncated. */
  rowCount?: number;
  /** Set when rows were capped to the user's maxRowsToDisplay setting. */
  truncated?: boolean;
}

// Legacy alias
export type QueryResultSet = ResultSet;

export interface QueryMessage {
  type: 'info' | 'warning' | 'error';
  text: string;
  lineNumber?: number;
  timestamp?: string;
}

export interface QueryResult {
  queryId: string;
  success: boolean;
  resultSets?: ResultSet[];
  messages?: string[];
  rowsAffected?: number;
  executionTime?: number; // milliseconds
  executionTimeMs?: number; // alias
  error?: string;
}

export interface QueryTab {
  id: string;
  title: string;
  connectionId?: string;
  database?: string;
  content: string;
  isDirty: boolean;
  filePath?: string;
  lastExecuted?: string;
  results?: QueryResult;
}

/**
 * Query history entry
 */
export interface QueryHistoryEntry {
  id: string;
  connectionId: string;
  connectionName: string;
  database: string;
  sql: string;
  executedAt: string; // ISO date string
  executionTimeMs: number;
  rowCount?: number;
  success: boolean;
  error?: string;
}

/**
 * Query history filter options
 */
export interface QueryHistoryFilter {
  connectionId?: string;
  database?: string;
  searchText?: string;
  startDate?: string;
  endDate?: string;
  successOnly?: boolean;
  limit?: number;
}

/**
 * Export format options
 */
export type ExportFormat = 'csv' | 'json' | 'sql';

/**
 * Export options for query results
 */
export interface ExportOptions {
  format: ExportFormat;
  includeHeaders?: boolean;
  delimiter?: string; // for CSV
  prettyPrint?: boolean; // for JSON
  tableName?: string; // for SQL INSERT statements
}

/**
 * Export result
 */
export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
  rowsExported?: number;
}

/**
 * Request to fetch a foreign key referenced record
 */
export interface FkRecordRequest {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  column: string;
  value: unknown;
}

/**
 * Result of fetching a foreign key referenced record
 */
export interface FkRecordResult {
  success: boolean;
  record?: Record<string, unknown>;
  columns?: ColumnMetadata[];
  error?: string;
}
