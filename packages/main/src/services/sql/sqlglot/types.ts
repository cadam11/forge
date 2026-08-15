/**
 * Types for the sqlglot microservice client.
 *
 * Vendored from @memberjunction/sqlglot-ts (ISC licensed, MemberJunction),
 * trimmed to the surface Joinery actually uses. The underlying transpiler is
 * Python's sqlglot by Toby Mao (MIT) — https://github.com/tobymao/sqlglot.
 */

/**
 * Dialect names as sqlglot spells them. Joinery only maps its three engines
 * (tsql / postgres / mysql); the rest are accepted because the server does.
 */
export type SQLDialect =
  | 'tsql'
  | 'postgres'
  | 'mysql'
  | 'sqlite'
  | 'bigquery'
  | 'snowflake'
  | 'redshift'
  | 'spark'
  | 'duckdb'
  | 'oracle'
  | 'hive'
  | 'trino'
  | 'clickhouse'
  | 'databricks'
  | string;

export type ErrorLevel = 'IGNORE' | 'WARN' | 'RAISE' | 'IMMEDIATE';

export interface TranspileOptions {
  /** Source SQL dialect */
  fromDialect: SQLDialect;
  /** Target SQL dialect */
  toDialect: SQLDialect;
  /** Pretty-print output (default: true) */
  pretty?: boolean;
  /** Error handling level (default: 'WARN') */
  errorLevel?: ErrorLevel;
}

export interface TranspileResult {
  /** Whether transpilation succeeded without errors */
  success: boolean;
  /** Combined SQL output (all statements joined with ;\n) */
  sql: string;
  /** Individual transpiled statements */
  statements: string[];
  /** Error messages */
  errors: string[];
  /** Warning messages */
  warnings: string[];
}

export interface SqlGlotClientOptions {
  /**
   * Absolute path to sqlglot-server.py. Required — the upstream package
   * auto-detected this relative to its own dist/, which silently resolved to a
   * path inside app.asar in packaged builds where a spawned python3 cannot read
   * it. Callers must resolve it explicitly. See sql-converter.ts.
   */
  serverPath: string;
  /** Path to the Python executable (default: 'python3') */
  pythonPath?: string;
  /** How long to wait for the server to become ready (default: 30000) */
  startupTimeoutMs?: number;
  /** Per-request HTTP timeout (default: 60000) */
  requestTimeoutMs?: number;
}
