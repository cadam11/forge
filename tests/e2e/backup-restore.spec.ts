/**
 * Backup / restore round-trip — E2E spec.
 *
 * Covers the legacy 31-test audit's tests 20 (Backup feature) and 21
 * (Restore feature), which were deferred from the harness migration
 * because the harness containers don't ship the host-side CLIs that
 * Joinery's PG/MySQL backup services shell out to. With pg_dump /
 * pg_restore / mysqldump / mysql now available on the test host (see
 * CLAUDE.md), this spec proves the dialogs work end-to-end on every
 * non-MSSQL engine Joinery supports.
 *
 * Drives the full UX flow for both PG and MySQL through the actual
 * Backup Database / Restore Database dialogs, mirroring how a user
 * would back up one database and restore the dump into a fresh one.
 *
 * The integration tier (`tests/integration/backup/*`) already pins
 * the deep round-trip on the service layer. This spec's job is to
 * prove the dialog → IPC → service wiring stays intact: the form
 * accepts the engine-aware path, the snackbar reports completion,
 * the restored database actually contains the dumped data.
 *
 * For each engine we:
 *   1. Connect Joinery to the test container.
 *   2. Pre-create an empty `*_restore_target` database directly via the
 *      driver (Joinery's PG/MySQL restore dialog has no UI for "replace
 *      existing" — see restore-dialog.component.ts; that flag is
 *      MSSQL-only — so the cleanest dump-target is a brand-new DB).
 *   3. Open the Backup dialog, dump `joinery_test` to a tmp file, wait
 *      for the success snackbar, assert the file exists on disk.
 *   4. Open the Restore dialog, point at the dump, set the target DB
 *      to the pre-created empty database, wait for the success
 *      snackbar.
 *   5. Connect via the driver and assert at least one row of seeded
 *      data is present in the restored database.
 *   6. Drop the target DB and delete the tmp file (in a `finally` so
 *      a flaked test doesn't leak fixtures).
 */

import { expect, test, type Page } from '@playwright/test';
import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { withJoinery } from '../helpers/electron-app';
import {
  connectToTestPostgres,
  ensureJoineryTestSeeded,
  fillField,
  selectDatabase,
  TEST_PG,
} from '../helpers/joinery-actions';

// MySQL counterpart of TEST_PG. Mirrors tests/helpers/db-fixtures.ts
// so we don't have to re-import the integration fixture module here.
const TEST_MYSQL = {
  host: '127.0.0.1',
  port: 13306,
  user: 'root',
  password: 'joinery',
  database: 'joinery_test',
} as const;

test.beforeAll(ensureJoineryTestSeeded);

test.describe('Joinery — backup/restore round-trip via dialog UI', () => {
  test('postgres backup of joinery_test restores into a fresh database', async () => {
    const targetDb = `joinery_e2e_pg_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const dumpPath = join(tmpdir(), `joinery-e2e-${targetDb}.dump`);

    await withJoinery(async ({ window }) => {
      try {
        await connectToTestPostgres(window);
        await selectDatabase(window, TEST_PG.database);

        await createEmptyPgDatabase(targetDb);

        await openBackupDialog(window);
        await fillField(
          window.locator('mat-dialog-container'),
          'Backup File Path (local)',
          dumpPath
        );
        await window
          .locator('mat-dialog-container')
          .getByRole('button', { name: /^Start Backup$/ })
          .click();
        await expectSnackbar(window, /backup completed successfully/i);
        expect(existsSync(dumpPath), `expected dump at ${dumpPath}`).toBe(true);
        expect(statSync(dumpPath).size, 'dump file should be non-empty').toBeGreaterThan(0);

        await openRestoreDialog(window);
        const restoreDialog = window.locator('mat-dialog-container');
        await fillField(restoreDialog, 'Backup File Path (local)', dumpPath);
        await fillField(restoreDialog, 'Restore As Database', targetDb);
        await restoreDialog.getByRole('button', { name: /^Start Restore$/ }).click();
        await expectSnackbar(window, /database restored successfully/i);

        await assertPgDatabaseHasSeed(targetDb);
      } finally {
        await dropPgDatabase(targetDb).catch(() => {});
        await rm(dumpPath, { force: true }).catch(() => {});
      }
    });
  });

  test('mysql backup of joinery_test restores into a fresh database', async () => {
    await ensureMysqlJoineryTestSeeded();

    const targetDb = `joinery_e2e_my_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const dumpPath = join(tmpdir(), `joinery-e2e-${targetDb}.sql`);

    await withJoinery(async ({ window }) => {
      try {
        await connectToTestMysql(window);
        await selectDatabase(window, TEST_MYSQL.database);

        await createEmptyMysqlDatabase(targetDb);

        await openBackupDialog(window);
        await fillField(
          window.locator('mat-dialog-container'),
          'Backup File Path (local)',
          dumpPath
        );
        await window
          .locator('mat-dialog-container')
          .getByRole('button', { name: /^Start Backup$/ })
          .click();
        await expectSnackbar(window, /backup completed successfully/i);
        expect(existsSync(dumpPath), `expected dump at ${dumpPath}`).toBe(true);
        expect(statSync(dumpPath).size, 'dump file should be non-empty').toBeGreaterThan(0);

        await openRestoreDialog(window);
        const restoreDialog = window.locator('mat-dialog-container');
        await fillField(restoreDialog, 'Backup File Path (local)', dumpPath);
        await fillField(restoreDialog, 'Restore As Database', targetDb);
        await restoreDialog.getByRole('button', { name: /^Start Restore$/ }).click();
        await expectSnackbar(window, /database restored successfully/i);

        await assertMysqlDatabaseHasSeed(targetDb);
      } finally {
        await dropMysqlDatabase(targetDb).catch(() => {});
        await rm(dumpPath, { force: true }).catch(() => {});
      }
    });
  });
});

// --- UI helpers ---

async function openBackupDialog(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Backup Database' }).click();
  await expect(window.locator('mat-dialog-container')).toBeVisible({ timeout: 5000 });
}

async function openRestoreDialog(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Restore Database' }).click();
  await expect(window.locator('mat-dialog-container')).toBeVisible({ timeout: 5000 });
}

async function expectSnackbar(window: Page, pattern: RegExp): Promise<void> {
  // Multiple stacked snackbars are possible (e.g. an earlier one hasn't
  // auto-dismissed by the time the next operation completes), so target
  // the one whose text matches the pattern rather than asserting on the
  // bare container locator.
  const bar = window.locator('.mat-mdc-snack-bar-container').filter({ hasText: pattern }).first();
  await expect(bar).toBeVisible({ timeout: 30_000 });
  // Dismiss it so it doesn't stack with the next phase's snackbar.
  await bar
    .locator('button')
    .first()
    .click({ timeout: 2000 })
    .catch(() => {
      /* may have auto-dismissed */
    });
  await window.waitForTimeout(200);
}

// --- DB helpers (driver-side, outside Joinery's IPC) ---

async function createEmptyPgDatabase(name: string): Promise<void> {
  const client = new PgClient({ ...TEST_PG, database: 'postgres' });
  await client.connect();
  try {
    // Identifier interpolation safe — `name` is generated from randomUUID
    // and matches /^joinery_e2e_pg_[a-f0-9]+$/.
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

async function dropPgDatabase(name: string): Promise<void> {
  const client = new PgClient({ ...TEST_PG, database: 'postgres' });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

async function assertPgDatabaseHasSeed(name: string): Promise<void> {
  const client = new PgClient({ ...TEST_PG, database: name });
  await client.connect();
  try {
    const r = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM information_schema.tables ' +
        "WHERE table_schema = 'public' AND table_name = 'products'"
    );
    expect(r.rows[0].count, `expected products table in ${name}`).toBe('1');

    const data = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM products'
    );
    expect(
      Number(data.rows[0].count),
      `expected restored products rows in ${name}`
    ).toBeGreaterThan(0);
  } finally {
    await client.end();
  }
}

async function ensureMysqlJoineryTestSeeded(): Promise<void> {
  const conn = await mysql.createConnection({
    host: TEST_MYSQL.host,
    port: TEST_MYSQL.port,
    user: TEST_MYSQL.user,
    password: TEST_MYSQL.password,
    multipleStatements: true,
  });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${TEST_MYSQL.database}\``);
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT 1 AS seeded FROM information_schema.tables ' +
        "WHERE table_schema = ? AND table_name = 'products'",
      [TEST_MYSQL.database]
    );
    if (rows.length > 0) return;

    const fixturesRoot = join(__dirname, '..', 'fixtures', 'mysql');
    const { readFileSync } = await import('node:fs');
    const useDb = `USE \`${TEST_MYSQL.database}\`;\n`;
    const schema = readFileSync(join(fixturesRoot, 'schema.sql'), 'utf8');
    const seed = readFileSync(join(fixturesRoot, 'seed.sql'), 'utf8');
    await conn.query(useDb + schema);
    await conn.query(useDb + seed);
  } finally {
    await conn.end();
  }
}

async function createEmptyMysqlDatabase(name: string): Promise<void> {
  const conn = await mysql.createConnection({
    host: TEST_MYSQL.host,
    port: TEST_MYSQL.port,
    user: TEST_MYSQL.user,
    password: TEST_MYSQL.password,
  });
  try {
    await conn.query(`CREATE DATABASE \`${name}\``);
  } finally {
    await conn.end();
  }
}

async function dropMysqlDatabase(name: string): Promise<void> {
  const conn = await mysql.createConnection({
    host: TEST_MYSQL.host,
    port: TEST_MYSQL.port,
    user: TEST_MYSQL.user,
    password: TEST_MYSQL.password,
  });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
  } finally {
    await conn.end();
  }
}

async function assertMysqlDatabaseHasSeed(name: string): Promise<void> {
  const conn = await mysql.createConnection({
    host: TEST_MYSQL.host,
    port: TEST_MYSQL.port,
    user: TEST_MYSQL.user,
    password: TEST_MYSQL.password,
    database: name,
  });
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT 1 AS hit FROM information_schema.tables ' +
        "WHERE table_schema = ? AND table_name = 'products'",
      [name]
    );
    expect(rows.length, `expected products table in ${name}`).toBe(1);

    const [data] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM products');
    expect(Number(data[0].n), `expected restored products rows in ${name}`).toBeGreaterThan(0);
  } finally {
    await conn.end();
  }
}

async function connectToTestMysql(window: Page): Promise<void> {
  await expect(window.locator('app-root')).toBeVisible({ timeout: 15_000 });
  await window.locator('[data-testid="welcome-new-connection"]').click();
  const dialog = window.locator('mat-dialog-container');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  await dialog.locator('mat-select').first().click();
  await window.locator('mat-option').filter({ hasText: 'MySQL' }).first().click();
  await window.waitForTimeout(300);

  await fillField(dialog, 'Connection Name', 'Test MySQL');
  await fillField(dialog, 'Server', TEST_MYSQL.host);
  await fillField(dialog, 'Port', String(TEST_MYSQL.port));
  await fillField(dialog, 'Username', TEST_MYSQL.user);
  await fillField(dialog, 'Password', TEST_MYSQL.password);
  await fillField(dialog, 'Default Database', TEST_MYSQL.database);

  await dialog
    .locator('mat-checkbox')
    .filter({ hasText: 'Encrypt Connection' })
    .locator('input[type="checkbox"]')
    .uncheck({ force: true })
    .catch(() => {
      /* MySQL form may not expose this checkbox */
    });

  await dialog.getByRole('button', { name: /^Connect$/ }).click();

  await expect(window.locator('app-sidebar .database-selector')).toBeVisible({ timeout: 20_000 });
  await window.waitForTimeout(1500);

  await window
    .locator('.mat-mdc-snack-bar-container button')
    .first()
    .click({ timeout: 2000 })
    .catch(() => {
      /* may have auto-dismissed */
    });
  await window.waitForTimeout(300);
}
