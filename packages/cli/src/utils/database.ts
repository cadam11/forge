import * as sql from 'mssql';
import chalk from 'chalk';
import type { ConnectionConfig } from './config';

let currentPool: sql.ConnectionPool | null = null;

/** Escape a SQL identifier for use inside square brackets (doubles any `]` characters) */
function escId(name: string): string {
  return name.replace(/\]/g, ']]');
}

export async function connect(config: ConnectionConfig): Promise<sql.ConnectionPool> {
  // Close existing connection if any
  if (currentPool) {
    try {
      await currentPool.close();
    } catch {
      // Ignore close errors from stale connections
    }
    currentPool = null;
  }

  const sqlConfig: sql.config = {
    server: config.server,
    port: config.port || 1433,
    database: config.database || 'master',
    user: config.user,
    password: config.password,
    options: {
      encrypt: config.encrypt ?? true,
      trustServerCertificate: config.trustServerCertificate ?? true,
      enableArithAbort: true,
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };

  currentPool = await sql.connect(sqlConfig);
  return currentPool;
}

export async function disconnect(): Promise<void> {
  if (currentPool) {
    await currentPool.close();
    currentPool = null;
  }
}

export async function executeQuery(
  query: string,
  maxRows?: number
): Promise<sql.IRecordSet<Record<string, unknown>>[]> {
  if (!currentPool) {
    throw new Error('Not connected to a database. Use "joinery connect" first.');
  }

  const request = currentPool.request();

  // Add row limiting if specified
  let finalQuery = query;
  if (maxRows && !query.toLowerCase().includes('top')) {
    // Simple heuristic - only add TOP for SELECT statements
    const trimmed = query.trim().toLowerCase();
    if (trimmed.startsWith('select') && !trimmed.includes('top')) {
      finalQuery = query.replace(/^select/i, `SELECT TOP ${maxRows}`);
    }
  }

  const result = await request.query(finalQuery);
  return result.recordsets as sql.IRecordSet<Record<string, unknown>>[];
}

export async function getDatabases(): Promise<string[]> {
  if (!currentPool) {
    throw new Error('Not connected to a server.');
  }

  const result = await currentPool.request().query(`
    SELECT name FROM sys.databases
    WHERE state_desc = 'ONLINE'
    ORDER BY name
  `);

  return result.recordset.map((r: { name: string }) => r.name);
}

export async function getTables(
  database?: string
): Promise<Array<{ schema: string; name: string }>> {
  if (!currentPool) {
    throw new Error('Not connected to a server.');
  }

  const db = database ? `[${escId(database)}].` : '';
  const result = await currentPool.request().query(`
    SELECT
      s.name AS [schema],
      t.name AS [name]
    FROM ${db}sys.tables t
    INNER JOIN ${db}sys.schemas s ON t.schema_id = s.schema_id
    ORDER BY s.name, t.name
  `);

  return result.recordset;
}

export async function getViews(
  database?: string
): Promise<Array<{ schema: string; name: string }>> {
  if (!currentPool) {
    throw new Error('Not connected to a server.');
  }

  const db = database ? `[${escId(database)}].` : '';
  const result = await currentPool.request().query(`
    SELECT
      s.name AS [schema],
      v.name AS [name]
    FROM ${db}sys.views v
    INNER JOIN ${db}sys.schemas s ON v.schema_id = s.schema_id
    ORDER BY s.name, v.name
  `);

  return result.recordset;
}

export async function getProcedures(
  database?: string
): Promise<Array<{ schema: string; name: string }>> {
  if (!currentPool) {
    throw new Error('Not connected to a server.');
  }

  const db = database ? `[${escId(database)}].` : '';
  const result = await currentPool.request().query(`
    SELECT
      s.name AS [schema],
      p.name AS [name]
    FROM ${db}sys.procedures p
    INNER JOIN ${db}sys.schemas s ON p.schema_id = s.schema_id
    ORDER BY s.name, p.name
  `);

  return result.recordset;
}

export async function getConnectionInfo(): Promise<{
  server: string;
  version: string;
  database: string;
}> {
  if (!currentPool) {
    throw new Error('Not connected to a server.');
  }

  const result = await currentPool.request().query(`
    SELECT
      @@SERVERNAME AS [server],
      @@VERSION AS [version],
      DB_NAME() AS [database]
  `);

  const row = result.recordset[0];
  if (!row) {
    throw new Error('Failed to retrieve server information');
  }
  const versionMatch = row.version.match(/Microsoft SQL Server (\d+)/);

  return {
    server: row.server,
    version: versionMatch ? `SQL Server ${versionMatch[1]}` : row.version.split('\n')[0],
    database: row.database,
  };
}

export function isConnected(): boolean {
  return currentPool !== null && currentPool.connected;
}

export function formatError(error: unknown): string {
  if (error instanceof sql.RequestError) {
    return `${chalk.red('SQL Error')} [${error.number}]: ${error.message}`;
  }
  if (error instanceof sql.ConnectionError) {
    return `${chalk.red('Connection Error')}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
