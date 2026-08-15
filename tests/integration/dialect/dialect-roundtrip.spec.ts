/**
 * Dialect roundtrip tests.
 *
 * Exercises the SQL strings produced by `getDialect(engine)` against real
 * databases. Catches regressions in identifier quoting, metadata-query
 * shape, and engine-specific syntax differences.
 *
 * Each test creates a fresh database (via `withFreshDatabase`), optionally
 * applies the seed fixture, runs dialect-generated SQL through the engine
 * driver, and asserts on the rows that come back.
 */

import { describe, expect, it } from 'vitest';
import sqlserver from 'mssql';
import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';

import { getDialect } from '@joinery/main/services/sql/dialect';
import type { DatabaseEngine } from '@joinery/shared';

import {
  applyFixture,
  TEST_CONNECTIONS,
  withFreshDatabase,
  type Engine,
} from '../../helpers/db-fixtures.js';

const FIXTURE_TO_DIALECT: Record<Engine, DatabaseEngine> = {
  mssql: 'mssql',
  postgres: 'postgresql',
  mysql: 'mysql',
};

const ENGINES: Engine[] = ['mssql', 'postgres', 'mysql'];
const FIXTURE_TABLES = ['customers', 'order_items', 'orders', 'products'];
const PRODUCT_COLUMNS = ['id', 'sku', 'name', 'price_cents', 'category', 'active', 'created_at'];

describe.each(ENGINES)('dialect roundtrip — %s', engine => {
  const dialect = getDialect(FIXTURE_TO_DIALECT[engine]);

  it('listTablesSQL returns the four fixture tables', async () => {
    await withFreshDatabase(engine, async db => {
      await applyFixture(engine, db.databaseName, 'seed');
      const { database, schema } = dialectArgs(engine, db.databaseName);
      const rows = await runQuery(engine, db.databaseName, dialect.listTablesSQL(database, schema));
      const names = rows.map(r => String(r.name).toLowerCase()).sort();
      expect(names).toEqual(FIXTURE_TABLES);
    });
  });

  it('listColumnsSQL on products returns the expected columns and flags id as PK', async () => {
    await withFreshDatabase(engine, async db => {
      const { database, schema } = dialectArgs(engine, db.databaseName);
      const rows = await runQuery(
        engine,
        db.databaseName,
        dialect.listColumnsSQL(database, schema, 'products')
      );
      const names = rows.map(r => String(r.name).toLowerCase());
      expect(names).toEqual(expect.arrayContaining(PRODUCT_COLUMNS));

      const id = rows.find(r => String(r.name).toLowerCase() === 'id');
      expect(id, 'expected an id column row').toBeDefined();
      expect(asBool(id!.isPrimaryKey)).toBe(true);
    });
  });

  it('listIndexesSQL on products surfaces ix_products_category', async () => {
    await withFreshDatabase(engine, async db => {
      const { database, schema } = dialectArgs(engine, db.databaseName);
      const rows = await runQuery(
        engine,
        db.databaseName,
        dialect.listIndexesSQL(database, schema, 'products')
      );
      const names = rows.map(r => String(r.name).toLowerCase());
      expect(names).toContain('ix_products_category');
    });
  });

  it('listForeignKeysSQL on orders points to customers', async () => {
    await withFreshDatabase(engine, async db => {
      const { database, schema } = dialectArgs(engine, db.databaseName);
      const rows = await runQuery(
        engine,
        db.databaseName,
        dialect.listForeignKeysSQL(database, schema, 'orders')
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const referenced = rows.map(r => String(r.referencedTable ?? '').toLowerCase());
      expect(referenced).toContain('customers');
    });
  });

  it('quoteIdentifier roundtrips through a SELECT', async () => {
    await withFreshDatabase(engine, async db => {
      await applyFixture(engine, db.databaseName, 'seed');
      const quoted = dialect.quoteIdentifier('products');
      const rows = await runQuery(engine, db.databaseName, `SELECT COUNT(*) AS n FROM ${quoted}`);
      expect(Number(rows[0].n)).toBe(10);
    });
  });
});

// ---- helpers ----

function dialectArgs(engine: Engine, dbName: string): { database: string; schema: string } {
  switch (engine) {
    case 'mssql':
      return { database: dbName, schema: 'dbo' };
    case 'postgres':
      return { database: '', schema: 'public' };
    // MySQL conflates schema and database: pass dbName as both.
    case 'mysql':
      return { database: dbName, schema: dbName };
  }
}

function asBool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 't';
}

async function runQuery(
  engine: Engine,
  dbName: string,
  sql: string
): Promise<Record<string, unknown>[]> {
  switch (engine) {
    case 'mssql':
      return runMssql(dbName, sql);
    case 'postgres':
      return runPostgres(dbName, sql);
    case 'mysql':
      return runMysql(dbName, sql);
  }
}

async function runMssql(dbName: string, sql: string): Promise<Record<string, unknown>[]> {
  const c = TEST_CONNECTIONS.mssql;
  const pool = new sqlserver.ConnectionPool({
    server: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: dbName,
    options: { trustServerCertificate: true, encrypt: false },
  });
  await pool.connect();
  try {
    // batch() handles `USE [db];` prefixes that the MSSQL dialect emits.
    const result = await pool.request().batch(sql);
    const recordsets = (result.recordsets ?? []) as unknown as Record<string, unknown>[][];
    return recordsets[recordsets.length - 1] ?? [];
  } finally {
    await pool.close();
  }
}

async function runPostgres(dbName: string, sql: string): Promise<Record<string, unknown>[]> {
  const c = TEST_CONNECTIONS.postgres;
  const client = new PgClient({
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: dbName,
  });
  await client.connect();
  try {
    const result = await client.query(sql);
    const results = Array.isArray(result) ? result : [result];
    return results[results.length - 1].rows as Record<string, unknown>[];
  } finally {
    await client.end();
  }
}

async function runMysql(dbName: string, sql: string): Promise<Record<string, unknown>[]> {
  const c = TEST_CONNECTIONS.mysql;
  const conn = await mysql.createConnection({
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: dbName,
    multipleStatements: true,
  });
  try {
    const [rows] = await conn.query(sql);
    if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0])) {
      const arr = rows as unknown[][];
      return arr[arr.length - 1] as Record<string, unknown>[];
    }
    return rows as Record<string, unknown>[];
  } finally {
    await conn.end();
  }
}
