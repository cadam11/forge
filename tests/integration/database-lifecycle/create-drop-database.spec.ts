/**
 * Integration tests for the database CREATE / DROP lifecycle that the renderer
 * exposes through the "New Database…" / "Drop Database…" affordances. These
 * exercise the full ConnectionPoolManager.executeDDL path against the live
 * test docker containers — not just the dialect's SQL generation. Catches
 * cases where dialect output is correct in isolation but the engine refuses
 * the SQL at execution time (most notably PG's "DROP DATABASE cannot run
 * inside a transaction block" when the dialect emits a multi-statement
 * "kick connections + DROP" batch).
 *
 * Each test creates a uniquely-named database, asserts CREATE landed,
 * cleans up via Forge's DROP path, and asserts the database is gone.
 *
 * The MSSQL DROP path needs `closeConnections: false` because mssql's
 * SINGLE_USER WITH ROLLBACK IMMEDIATE batch doesn't share PG's transaction
 * gotcha but does need to run *as a batch*. The relevant MSSQL test in
 * tests/helpers/db-fixtures.ts already wraps that pattern.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
import sqlserver from 'mssql';

import { TEST_CONNECTIONS } from '../../helpers/db-fixtures';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeProfiles: Map<string, any> = new Map();
const fakePasswords: Map<string, string> = new Map();

vi.mock('@mj-forge/main/services/config/connection-profiles', () => ({
  ConnectionProfilesStore: {
    getInstance: () => ({
      getById: (id: string) => fakeProfiles.get(id),
      getPassword: async (id: string) => fakePasswords.get(id) ?? null,
    }),
  },
}));

import { ConnectionPoolManager } from '@mj-forge/main/services/sql/connection-pool';
import { PgDialect } from '@mj-forge/main/services/sql/dialect/pg-dialect';
import { MySQLDialect } from '@mj-forge/main/services/sql/dialect/mysql-dialect';
import { MSSQLDialect } from '@mj-forge/main/services/sql/dialect/mssql-dialect';

function freshDbName(): string {
  return `forge_t_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

async function pgHasDb(name: string): Promise<boolean> {
  const c = TEST_CONNECTIONS.postgres;
  const client = new PgClient({
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: 'postgres',
  });
  await client.connect();
  try {
    const r = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return r.rowCount === 1;
  } finally {
    await client.end();
  }
}

async function mysqlHasDb(name: string): Promise<boolean> {
  const c = TEST_CONNECTIONS.mysql;
  const conn = await mysql.createConnection({
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
  });
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [name]
    );
    return rows.length === 1;
  } finally {
    await conn.end();
  }
}

async function mssqlHasDb(name: string): Promise<boolean> {
  const c = TEST_CONNECTIONS.mssql;
  const pool = new sqlserver.ConnectionPool({
    server: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: 'master',
    options: { trustServerCertificate: true, encrypt: false },
  });
  await pool.connect();
  try {
    const r = await pool
      .request()
      .input('name', sqlserver.NVarChar, name)
      .query('SELECT 1 AS hit FROM sys.databases WHERE name = @name');
    return r.recordset.length === 1;
  } finally {
    await pool.close();
  }
}

async function pgForceDrop(name: string): Promise<void> {
  const c = TEST_CONNECTIONS.postgres;
  const client = new PgClient({
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: 'postgres',
  });
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name]
    );
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await client.end();
  }
}

async function mysqlForceDrop(name: string): Promise<void> {
  const c = TEST_CONNECTIONS.mysql;
  const conn = await mysql.createConnection({
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
  });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
  } finally {
    await conn.end();
  }
}

async function mssqlForceDrop(name: string): Promise<void> {
  const c = TEST_CONNECTIONS.mssql;
  const pool = new sqlserver.ConnectionPool({
    server: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: 'master',
    options: { trustServerCertificate: true, encrypt: false },
  });
  await pool.connect();
  try {
    await pool
      .request()
      .batch(
        `IF DB_ID('${name}') IS NOT NULL ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; ` +
          `IF DB_ID('${name}') IS NOT NULL DROP DATABASE [${name}];`
      );
  } finally {
    await pool.close();
  }
}

// --- engine-parameterised matrix ---

describe('database CREATE / DROP through ConnectionPoolManager.executeDDL', () => {
  beforeEach(() => {
    fakeProfiles.clear();
    fakePasswords.clear();
    ConnectionPoolManager.resetInstance();
  });

  afterEach(() => {
    // resetInstance in beforeEach drops the singleton's reference to its
    // pools; the test process exits and frees them so we don't leak across
    // the suite.
    ConnectionPoolManager.resetInstance();
  });

  describe('postgres', () => {
    const dialect = new PgDialect();
    let dbName: string;
    let connectionId: string;

    beforeEach(() => {
      dbName = freshDbName();
      connectionId = randomUUID();
      const c = TEST_CONNECTIONS.postgres;
      fakeProfiles.set(connectionId, {
        id: connectionId,
        name: 'pg-test',
        engine: 'postgresql',
        server: c.host,
        port: c.port,
        username: c.user,
        database: 'postgres',
      });
      fakePasswords.set(connectionId, c.password);
    });

    afterEach(async () => {
      // Defensive cleanup so a test that fails mid-flight doesn't leak a db.
      await pgForceDrop(dbName).catch(() => {});
    });

    it('creates a new database', async () => {
      const sql = dialect.createDatabaseSQL({ name: dbName });
      const pool = ConnectionPoolManager.getInstance();
      await pool.executeDDL(connectionId, sql);
      expect(await pgHasDb(dbName)).toBe(true);
    });

    it('drops a database with closeConnections=true (multi-statement DDL)', async () => {
      // Pre-create so we have something to drop.
      await pgForceDrop(dbName).catch(() => {});
      const pool = ConnectionPoolManager.getInstance();
      await pool.executeDDL(connectionId, dialect.createDatabaseSQL({ name: dbName }));
      expect(await pgHasDb(dbName)).toBe(true);

      // The dialect emits a kick-connections SELECT followed by DROP DATABASE
      // separated by ;\n\n. Without splitting the batch into separate
      // client.query() calls, PG's simple query protocol wraps both in an
      // implicit transaction and DROP DATABASE errors out:
      //   "DROP DATABASE cannot run inside a transaction block"
      const dropSql = dialect.dropDatabaseSQL({ name: dbName, closeConnections: true });
      await pool.executeDDL(connectionId, dropSql);
      expect(await pgHasDb(dbName)).toBe(false);
    });

    it('drops a database without closeConnections (single-statement)', async () => {
      const pool = ConnectionPoolManager.getInstance();
      await pool.executeDDL(connectionId, dialect.createDatabaseSQL({ name: dbName }));
      expect(await pgHasDb(dbName)).toBe(true);

      const dropSql = dialect.dropDatabaseSQL({ name: dbName, closeConnections: false });
      await pool.executeDDL(connectionId, dropSql);
      expect(await pgHasDb(dbName)).toBe(false);
    });

    // Regression for "can't delete a DB that's expanded in the explorer or has
    // a query window open": those affordances keep a live per-database pool,
    // and PG refuses a plain DROP DATABASE while any session is connected.
    // closePoolForDatabase must release Forge's own pool so the drop succeeds
    // without an app restart.
    it('releases its own pool so an in-use database can be dropped', async () => {
      const pool = ConnectionPoolManager.getInstance();
      await pool.executeDDL(connectionId, dialect.createDatabaseSQL({ name: dbName }));
      expect(await pgHasDb(dbName)).toBe(true);

      // Simulate an open query window / expanded node: a live backend on the
      // target database held by Forge's own per-DB pool.
      const dbPool = await pool.getPgPool(connectionId, dbName);
      await dbPool.query('SELECT 1');

      // Without eviction this plain DROP would fail with
      // "database is being accessed by other users".
      await pool.closePoolForDatabase(connectionId, dbName);
      await pool.executeDDL(
        connectionId,
        dialect.dropDatabaseSQL({ name: dbName, closeConnections: false })
      );
      expect(await pgHasDb(dbName)).toBe(false);
    });
  });

  describe('mysql', () => {
    const dialect = new MySQLDialect();
    let dbName: string;
    let connectionId: string;

    beforeEach(() => {
      dbName = freshDbName();
      connectionId = randomUUID();
      const c = TEST_CONNECTIONS.mysql;
      fakeProfiles.set(connectionId, {
        id: connectionId,
        name: 'mysql-test',
        engine: 'mysql',
        server: c.host,
        port: c.port,
        username: c.user,
      });
      fakePasswords.set(connectionId, c.password);
    });

    afterEach(async () => {
      await mysqlForceDrop(dbName).catch(() => {});
    });

    it('creates a new database', async () => {
      const sql = dialect.createDatabaseSQL({ name: dbName });
      const pool = ConnectionPoolManager.getInstance();
      await pool.executeDDL(connectionId, sql);
      expect(await mysqlHasDb(dbName)).toBe(true);
    });

    it('drops a database', async () => {
      const pool = ConnectionPoolManager.getInstance();
      await pool.executeDDL(connectionId, dialect.createDatabaseSQL({ name: dbName }));
      expect(await mysqlHasDb(dbName)).toBe(true);

      // closeConnections is irrelevant on MySQL — KILL <id> can't be issued
      // by the same connection that's running DROP DATABASE for that schema.
      // The dialect just emits DROP DATABASE.
      const dropSql = dialect.dropDatabaseSQL({ name: dbName, closeConnections: false });
      await pool.executeDDL(connectionId, dropSql);
      expect(await mysqlHasDb(dbName)).toBe(false);
    });
  });

  describe('mssql', () => {
    const dialect = new MSSQLDialect();
    let dbName: string;
    let connectionId: string;

    beforeEach(() => {
      dbName = freshDbName();
      connectionId = randomUUID();
      const c = TEST_CONNECTIONS.mssql;
      fakeProfiles.set(connectionId, {
        id: connectionId,
        name: 'mssql-test',
        engine: 'mssql',
        server: c.host,
        port: c.port,
        username: c.user,
        encrypt: false,
        trustServerCertificate: true,
        connectionTimeout: 30,
      });
      fakePasswords.set(connectionId, c.password);
    });

    afterEach(async () => {
      await mssqlForceDrop(dbName).catch(() => {});
    });

    it('creates a new database', async () => {
      const sql = dialect.createDatabaseSQL({ name: dbName });
      const pool = ConnectionPoolManager.getInstance();
      await pool.executeDDL(connectionId, sql);
      expect(await mssqlHasDb(dbName)).toBe(true);
    });

    it('drops a database with closeConnections=true (multi-statement T-SQL batch)', async () => {
      const pool = ConnectionPoolManager.getInstance();
      await pool.executeDDL(connectionId, dialect.createDatabaseSQL({ name: dbName }));
      expect(await mssqlHasDb(dbName)).toBe(true);

      const dropSql = dialect.dropDatabaseSQL({ name: dbName, closeConnections: true });
      await pool.executeDDL(connectionId, dropSql);
      expect(await mssqlHasDb(dbName)).toBe(false);
    });
  });
});
