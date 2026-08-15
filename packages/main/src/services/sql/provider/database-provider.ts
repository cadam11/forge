/**
 * Database Provider Abstraction
 *
 * Defines the interface that every database engine must implement.
 *
 * The hierarchy is:
 *   DatabaseProvider (abstract) → MSSQLProvider / PgProvider
 */

import type { ConnectionProfile, TestConnectionResult, DatabaseEngine } from '@joinery/shared';
import { SQLDialect } from '../dialect/sql-dialect';

/** Result of executing a SQL statement through a provider */
export interface ProviderQueryResult {
  /** Array of result sets (one per SELECT in a batch) */
  recordsets: Record<string, unknown>[][];
  /** Column metadata per result set */
  columns: Record<string, unknown>[];
  /** Rows affected per statement */
  rowsAffected: number[];
}

/**
 * Abstract database provider — subclassed per engine.
 */
export abstract class DatabaseProvider {
  abstract readonly engine: DatabaseEngine;
  abstract readonly dialect: SQLDialect;

  /** Whether the provider is currently connected */
  abstract get connected(): boolean;

  /** Connect to the database using a profile and password */
  abstract connect(profile: ConnectionProfile, password: string): Promise<void>;

  /** Disconnect and release all resources */
  abstract disconnect(): Promise<void>;

  /** Test a connection without persisting it */
  abstract testConnection(
    profile: ConnectionProfile,
    password: string
  ): Promise<TestConnectionResult>;

  /**
   * Execute a SQL batch and return results.
   * The provider handles any engine-specific batch splitting (e.g. GO for MSSQL).
   */
  abstract execute(sql: string, database?: string): Promise<ProviderQueryResult>;

  /** Cancel a running request, if supported. Returns true if cancelled. */
  abstract cancelRequest(requestRef: unknown): boolean;

  /** Get the underlying connection/pool for advanced use (e.g. streaming) */
  abstract getPool(): unknown;
}
