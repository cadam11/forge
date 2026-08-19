/**
 * Direct database work a spec needs that no UI offers — cleanup, mostly.
 *
 * The only module here that talks to a container instead of to the app. It is separate from the UI
 * helpers on purpose: a spec importing from this file is stating that it is reaching around Joinery,
 * which should always be a visible decision.
 */

import { Client as PgClient } from 'pg';
import { TEST_PG } from './app';

/** The database `ensureWideSchema` builds. Named so `dropDatabasesMatching` cannot sweep it up. */
export const WIDE_SCHEMA_DATABASE = 'joinery_wide_schema';

/**
 * Builds (once) a PostgreSQL database holding `tableCount` tables joined by real foreign keys, for
 * the ERD's 200-table gate (PLAN.md Task 23).
 *
 * ── Why this is generated rather than added to `tests/fixtures/postgres/schema.sql` ───────────
 *
 * That file is the seed EVERY tier shares. Two hundred extra tables in it would appear under the
 * `public` schema of `joinery_test`, where the explorer specs count tree rows, the object-search
 * specs rank results, and the ERD's own functional spec asserts that a whole-database diagram draws
 * exactly the four seeded tables. A separate database keeps the load where only this gate sees it.
 *
 * ── The shape, and why it is a tree rather than a chain ───────────────────────────────────────
 *
 * `t000 … t{n-1}`, each (except the root) with a foreign key to `t{floor(index / 4)}` — a 4-ary
 * tree, so `tableCount - 1` edges over about four ranks. A chain would give dagre a 200-rank layout
 * that no real schema has; a tree is the shape a schema this size actually takes, and it is the one
 * whose layout cost is worth bounding.
 *
 * ── It must be dropped again, and that is not tidiness ────────────────────────────────────────
 *
 * **Measured the hard way**: leaving it behind turns the React visual tier's two `shell-connected`
 * baselines RED. The explorer lists every database on the server, so a 201st one appears in the
 * sidebar of a screenshot taken by a completely different tier — 416 differing pixels reading
 * `joinery_wide_schema` where `postgres` used to be. It is the same hazard `dropDatabasesMatching`
 * was written for, one step further: a fixture that outlives its own tier is a fixture every other
 * tier now shares. So `dropWideSchema` runs in the perf tier's `afterAll`, and building it takes
 * about a second, which is the right price.
 *
 * ── Idempotent, and it checks rather than assumes ─────────────────────────────────────────────
 *
 * A database left behind by an interrupted run is reused when its table count is right and dropped
 * and rebuilt when it is wrong, because a gate that silently ran against 37 tables would still be
 * green.
 */
export async function ensureWideSchema(tableCount: number): Promise<void> {
  if (!Number.isInteger(tableCount) || tableCount < 2) {
    throw new Error(`[db] ensureWideSchema needs at least 2 tables, got ${String(tableCount)}`);
  }

  const admin = new PgClient({ ...TEST_PG });
  await admin.connect();
  try {
    const existing = await countTablesIn(WIDE_SCHEMA_DATABASE);
    if (existing === tableCount) return;
    if (existing !== null) {
      await admin.query(`DROP DATABASE IF EXISTS "${WIDE_SCHEMA_DATABASE}" WITH (FORCE)`);
    }
    await admin.query(`CREATE DATABASE "${WIDE_SCHEMA_DATABASE}"`);
  } finally {
    await admin.end();
  }

  const target = new PgClient({ ...TEST_PG, database: WIDE_SCHEMA_DATABASE });
  await target.connect();
  try {
    // One transaction: a half-built schema is worse than none, because the count check above would
    // then drop and rebuild it on every run and the "slow part happens once" property is lost.
    await target.query('BEGIN');
    for (let index = 0; index < tableCount; index += 1) {
      await target.query(createTableSql(index));
    }
    await target.query('COMMIT');
  } catch (error) {
    await target.query('ROLLBACK');
    throw error;
  } finally {
    await target.end();
  }

  const built = await countTablesIn(WIDE_SCHEMA_DATABASE);
  if (built !== tableCount) {
    throw new Error(
      `[db] built ${String(built)} tables in ${WIDE_SCHEMA_DATABASE}, want ${tableCount}`
    );
  }
}

/**
 * Drops the wide-schema database. Safe to call when it was never built.
 *
 * `WITH (FORCE)` for the reason `dropDatabasesMatching` gives: the app under test leaves a pooled
 * session on the database it was last pointed at, and without the clause `DROP DATABASE` refuses
 * and the cleanup silently does nothing — which is precisely the failure this function exists to
 * prevent.
 */
export async function dropWideSchema(): Promise<void> {
  const admin = new PgClient({ ...TEST_PG });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${WIDE_SCHEMA_DATABASE}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/** `CREATE TABLE` for one node of the tree. Index 0 is the root and has no parent. */
function createTableSql(index: number): string {
  const name = tableNameFor(index);
  const columns = [
    'id serial PRIMARY KEY',
    'label text NOT NULL',
    'amount numeric(12,2)',
    'created_at timestamptz NOT NULL DEFAULT now()',
  ];
  if (index > 0) {
    columns.push(`parent_id integer REFERENCES "${tableNameFor(Math.floor(index / 4))}" (id)`);
  }
  return `CREATE TABLE "${name}" (${columns.join(', ')})`;
}

/** `t000`, `t001`, … — zero-padded so the ERD's node ids sort the way a reader expects. */
export function tableNameFor(index: number): string {
  return `t${String(index).padStart(3, '0')}`;
}

/** How many user tables `database` holds, or `null` when the database does not exist. */
async function countTablesIn(database: string): Promise<number | null> {
  const admin = new PgClient({ ...TEST_PG });
  await admin.connect();
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (found.rowCount === 0) return null;
  } finally {
    await admin.end();
  }

  const target = new PgClient({ ...TEST_PG, database });
  await target.connect();
  try {
    const counted = await target.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'"
    );
    return Number(counted.rows[0]?.count ?? '0');
  } finally {
    await target.end();
  }
}

/**
 * Drops every database on the seeded PostgreSQL container whose name starts with `prefix`.
 *
 * The database-management specs create real databases and cannot delete them through the UI (the delete
 * dialog is Task 19b's), and leaving them behind is not neutral: the explorer tree is virtualized, so ten
 * extra databases under the server node push the rows below it out of the rendered window and an
 * unrelated spec that looks for a third server stops finding it. That is a real failure this suite hit
 * once, which is why the cleanup is a helper rather than a note in a comment.
 *
 * `WITH (FORCE)` because the app under test may have left a pooled session on the database it was last
 * pointed at; without it `DROP DATABASE` refuses and the cleanup silently does nothing.
 */
export async function dropDatabasesMatching(prefix: string): Promise<void> {
  const client = new PgClient({ ...TEST_PG });
  await client.connect();
  try {
    const found = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [`${prefix}%`]
    );
    for (const row of found.rows) {
      // The name comes from `pg_database`, so it is an existing identifier rather than user input; it is
      // still quoted, because a database created by a spec may legally contain characters that need it.
      await client.query(
        `DROP DATABASE IF EXISTS "${row.datname.replace(/"/g, '""')}" WITH (FORCE)`
      );
    }
  } finally {
    await client.end();
  }
}
