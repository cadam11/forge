/**
 * SQL Dialect Converter Service
 *
 * Spawns a Python FastAPI microservice wrapping the real Python sqlglot
 * library. Much more reliable than pure TS ports.
 *
 * Lifecycle:
 * - The Python microservice is started lazily on first conversion request
 * - It runs on 127.0.0.1 with an ephemeral port
 * - It is stopped during app shutdown
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { SqlGlotClient } from './sqlglot/sqlglot-client';
import type {
  TranspileOptions,
  TranspileResult,
  SQLDialect as SqlGlotDialect,
} from './sqlglot/types';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';

const log = createLogger('SQLConverter');

const SERVER_SCRIPT = path.join('resources', 'python', 'sqlglot-server.py');

/**
 * Locate sqlglot-server.py.
 *
 * The script MUST live outside app.asar. Electron's asar shim virtualizes paths
 * for Node's own fs, so an in-asar path passes existsSync() — but a spawned
 * python3 is an external process and cannot read inside the archive. Serving it
 * from `resources/` means electron-builder's extraResources block copies it out.
 *
 * Exported for testing.
 */
export function resolveServerPath(): string {
  // Packaged: extraResources copies resources/ under process.resourcesPath.
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, SERVER_SCRIPT) : null;
  if (packaged && existsSync(packaged)) return packaged;

  // Dev / test: the repo copy. This file compiles to
  // packages/main/dist/services/sql/, so the repo root is five levels up —
  // the same depth as its TypeScript source, which keeps vitest working.
  const dev = path.resolve(__dirname, '..', '..', '..', '..', '..', SERVER_SCRIPT);
  if (existsSync(dev)) return dev;

  throw new Error(
    `sqlglot server script not found. Looked in: ${packaged ?? '(not packaged)'}, ${dev}`
  );
}

export interface ConversionResult {
  success: boolean;
  sql: string;
  sourceDialect: string;
  targetDialect: string;
  statements?: string[];
  warnings?: string[];
  error?: string;
}

// Map our engine names to sqlglot dialect names
const DIALECT_MAP: Record<string, SqlGlotDialect> = {
  mssql: 'tsql',
  postgresql: 'postgres',
  mysql: 'mysql',
};

/** The slice of SqlGlotClient this service uses, so tests can inject a fake. */
export interface SqlGlotClientLike {
  readonly IsRunning: boolean;
  readonly Port: number | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  transpile(sql: string, options: TranspileOptions): Promise<TranspileResult>;
}

export class SQLConverterService extends BaseSingleton {
  private client: SqlGlotClientLike | null;
  private starting: Promise<void> | null = null;

  /**
   * @param client Optional pre-built client. Omit in production — the real one
   * is constructed lazily so that a missing server script surfaces on first
   * conversion rather than throwing while the singleton is being created.
   */
  constructor(client?: SqlGlotClientLike) {
    super();
    this.client = client ?? null;
  }

  private getClient(): SqlGlotClientLike {
    if (!this.client) {
      this.client = new SqlGlotClient({
        serverPath: resolveServerPath(),
        startupTimeoutMs: 15000,
        requestTimeoutMs: 30000,
      });
    }
    return this.client;
  }

  /**
   * Ensure the Python microservice is running
   */
  private async ensureRunning(): Promise<void> {
    const client = this.getClient();
    if (client.IsRunning) return;

    // Serialize concurrent start requests
    if (!this.starting) {
      this.starting = client
        .start()
        .then(() => {
          log.info(`sqlglot microservice started on port ${client.Port}`);
          this.starting = null;
        })
        .catch(err => {
          this.starting = null;
          throw err;
        });
    }

    return this.starting;
  }

  /**
   * Convert SQL from one dialect to another
   */
  async convert(sql: string, fromEngine: string, toEngine: string): Promise<ConversionResult> {
    const fromDialect = DIALECT_MAP[fromEngine] || fromEngine;
    const toDialect = DIALECT_MAP[toEngine] || toEngine;

    try {
      await this.ensureRunning();

      const result: TranspileResult = await this.getClient().transpile(sql, {
        fromDialect,
        toDialect,
        pretty: true,
        errorLevel: 'WARN',
      });

      log.info(
        `Converted SQL from ${fromDialect} to ${toDialect} (${result.statements.length} statements)`
      );

      return {
        success: result.success,
        sql: result.sql,
        sourceDialect: fromDialect,
        targetDialect: toDialect,
        statements: result.statements,
        warnings: result.warnings,
        error: result.errors.length > 0 ? result.errors.join('\n') : undefined,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`SQL conversion failed: ${errorMsg}`);

      // Check for common issues. Order matters: a missing server script names a
      // path containing "python", so it must be matched before the Python check
      // or a packaging fault gets reported as a missing interpreter.
      let userError = errorMsg;
      if (errorMsg.includes('server script not found')) {
        userError =
          'SQL conversion is unavailable: the sqlglot server script is missing from this build.';
      } else if (errorMsg.includes('ENOENT') || errorMsg.includes('python')) {
        userError =
          'Python 3 is required for SQL conversion. Please install Python 3 and ensure "python3" is on your PATH.';
      } else if (errorMsg.includes('timeout')) {
        userError =
          'SQL conversion service timed out. The microservice may still be starting — try again.';
      }

      return {
        success: false,
        sql,
        sourceDialect: fromDialect,
        targetDialect: toDialect,
        error: userError,
      };
    }
  }

  /**
   * Check if the converter service is running
   */
  isRunning(): boolean {
    return this.client?.IsRunning ?? false;
  }

  /**
   * Stop the Python microservice (called during app shutdown).
   *
   * Deliberately does NOT construct a client: if conversion was never used there
   * is nothing to stop, and shutdown must not fail just because the server
   * script is missing from the build.
   */
  async stop(): Promise<void> {
    if (!this.client?.IsRunning) return;
    log.info('Stopping sqlglot microservice...');
    await this.client.stop();
    log.info('sqlglot microservice stopped');
  }
}
