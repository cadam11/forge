/**
 * Smoke test for the regression harness itself.
 *
 * Verifies each engine in the docker-compose.test.yml network is reachable,
 * that `withFreshDatabase` creates+applies+drops a database cleanly, and that
 * the synthetic seed produces the expected row counts.
 *
 * Requires `pnpm run test:harness:up` to have been run first.
 */

import { describe, expect, it } from 'vitest';

import sqlserver from 'mssql';
import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';

import {
  applyFixture,
  databaseExists,
  pingEngine,
  TEST_CONNECTIONS,
  withFreshDatabase,
  type Engine,
} from '../helpers/db-fixtures.js';

const ENGINES: Engine[] = ['mssql', 'postgres', 'mysql'];
const EXPECTED_COUNTS = {
  products: 10,
  customers: 5,
  orders: 8,
  order_items: 15,
} as const;

describe.each(ENGINES)('regression harness — %s', engine => {
  it('ping reaches the engine', async () => {
    await expect(pingEngine(engine)).resolves.toBeUndefined();
  });

  it('withFreshDatabase creates, schema-loads, and drops cleanly', async () => {
    const observed = await withFreshDatabase(engine, async db => {
      expect(db.engine).toBe(engine);
      expect(db.databaseName).toMatch(/^joinery_t_[a-f0-9]{16}$/);
      // Schema must be present and empty after applyFixture('schema').
      expect(await databaseExists(engine, db.databaseName)).toBe(true);
      const counts = await countTables(engine, db.databaseName);
      expect(counts.products).toBe(0);
      expect(counts.customers).toBe(0);
      return db.databaseName;
    });
    // After the callback resolves the DB must be gone from the catalog.
    expect(await databaseExists(engine, observed)).toBe(false);
  });

  it('applyFixture("seed") produces expected row counts', async () => {
    await withFreshDatabase(engine, async db => {
      await applyFixture(engine, db.databaseName, 'seed');
      const counts = await countTables(engine, db.databaseName);
      expect(counts).toEqual(EXPECTED_COUNTS);
    });
  });
});

// ---- helpers (test-only — would be over-abstraction in db-fixtures.ts) ----

interface TableCounts {
  products: number;
  customers: number;
  orders: number;
  order_items: number;
}

async function countTables(engine: Engine, dbName: string): Promise<TableCounts> {
  switch (engine) {
    case 'mssql':
      return countTablesMssql(dbName);
    case 'postgres':
      return countTablesPostgres(dbName);
    case 'mysql':
      return countTablesMysql(dbName);
  }
}

const COUNT_SQL = `SELECT
     (SELECT COUNT(*) FROM products)    AS products,
     (SELECT COUNT(*) FROM customers)   AS customers,
     (SELECT COUNT(*) FROM orders)      AS orders,
     (SELECT COUNT(*) FROM order_items) AS order_items;`;

async function countTablesMssql(dbName: string): Promise<TableCounts> {
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
    const result = await pool.request().query(COUNT_SQL);
    return result.recordset[0] as TableCounts;
  } finally {
    await pool.close();
  }
}

async function countTablesPostgres(dbName: string): Promise<TableCounts> {
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
    const result = await client.query<{
      products: string;
      customers: string;
      orders: string;
      order_items: string;
    }>(COUNT_SQL);
    const r = result.rows[0];
    return {
      products: Number(r.products),
      customers: Number(r.customers),
      orders: Number(r.orders),
      order_items: Number(r.order_items),
    };
  } finally {
    await client.end();
  }
}

async function countTablesMysql(dbName: string): Promise<TableCounts> {
  const c = TEST_CONNECTIONS.mysql;
  const conn = await mysql.createConnection({
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: dbName,
  });
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(COUNT_SQL);
    return rows[0] as TableCounts;
  } finally {
    await conn.end();
  }
}
