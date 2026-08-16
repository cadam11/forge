/**
 * Restoring a database through the React wizard, against the live seeded containers.
 *
 * This is the RESTORE half of `tests/e2e/backup-restore.spec.ts`, whose assertions are the parity
 * floor — and the floor is a real one: **the restored database has to contain the rows**. Everything
 * upstream of `pg_restore` can look healthy while the target is empty (a missing `--create`, a
 * connecting user without privilege, an archive that never opened), which is exactly why
 * `pg-backup.ts:166-179` verifies the target exists before reporting success. A success banner is
 * evidence about a banner; `SELECT COUNT(*) FROM products` on a fresh connection is evidence about a
 * database.
 *
 * Four things are asserted here that the Angular spec could not be:
 *
 *  1. **The whole cycle runs through the UI.** The Angular spec pre-created the restore target with
 *     the driver, because — its own comment says so at `:24-27` — the dialog had no way to. It does
 *     now: `pg_restore` is never passed `--create`, so the wizard calls `database.create` first, in
 *     its own visible phase. Nothing in this spec creates a database out of band.
 *  2. **A restore over an existing database cannot start without the confirmation.** The Angular
 *     dialog had none at all. Asserted as an attempt: fill the form, press the primary, and check
 *     that what appears is the confirmation and not a progress bar.
 *  3. **Completion is reported INSIDE the dialog.** The Angular spec waited on a snackbar and only
 *     saw it because the dialog closed itself on the same tick (J-42 — a toast raised over a modal is
 *     visible and inert).
 *  4. **The sidebar learns about the database that was just created.**
 *
 * J-50 caveat: none of these tests browse the MSSQL server filesystem, so the POSIX-path sanitizer
 * wall is not in the way. The MSSQL half of the wizard is covered by the browser gate instead.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';

import { expect, test } from './fixtures';
import {
  createAndConnectMysql,
  createPostgresProfile,
  connectFromSidebar,
  ensureJoineryTestSeeded,
  fillRestoreForm,
  openBackupDialog,
  openRestoreDialog,
  openRestoreDialogFromNode,
  restoreDialog,
  runBackupTo,
  runRestoreIntoNew,
  runRestoreOver,
  selectDatabase,
  TEST_MYSQL,
  TEST_PG,
  treeRow,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PG_PROFILE = 'Test PG';
const MYSQL_PROFILE = 'Test MySQL';

/** A throwaway target name nothing else can collide with. Matches /^joinery_e2e_[a-z]{2}_[a-f0-9]+$/. */
function targetName(engine: 'pg' | 'my'): string {
  return `joinery_e2e_${engine}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function tempArchive(extension: string): string {
  return join(tmpdir(), `joinery-e2e-restore-${randomUUID().slice(0, 12)}.${extension}`);
}

test.beforeAll(ensureJoineryTestSeeded);

test.describe('Joinery (React) — restoring a database', () => {
  test('backs up the seeded PostgreSQL database and restores it into a database it creates', async () => {
    const archive = tempArchive('dump');
    const target = targetName('pg');

    await withJoineryReact(async ({ window }) => {
      try {
        await createPostgresProfile(window, PG_PROFILE);
        await connectFromSidebar(window, PG_PROFILE);
        await selectDatabase(window, TEST_PG.database);

        // ── Back up, so the archive under test is one Joinery itself wrote ──
        await openBackupDialog(window);
        await runBackupTo(window, archive);
        expect(existsSync(archive), `expected a dump at ${archive}`).toBe(true);
        expect(statSync(archive).size, 'the dump should not be empty').toBeGreaterThan(0);
        expect(readFileSync(archive).subarray(0, 5).toString('latin1')).toBe('PGDMP');
        await window.getByTestId('backup-close').click();
        await expect(window.getByTestId('backup-dialog')).toBeHidden();

        // ── …and restore it into a database that does not exist yet ──
        const dialog = await openRestoreDialog(window);
        await expect(window.getByTestId('missing-cli-tools')).toHaveCount(0);
        await expect(dialog.getByTestId('restore-format-note')).toContainText('pg_restore');

        await fillRestoreForm(window, archive, target);
        // The wizard says who will create it, because pg_restore will not.
        await expect(dialog.getByTestId('restore-target-note')).toContainText(
          'Joinery will create'
        );

        await runRestoreIntoNew(window, archive, target);

        // THE assertion. Not the banner — the rows, read on a connection Joinery has nothing to do
        // with. `products` is seeded by `ensureJoineryTestSeeded`.
        await expectPgSeed(target);

        // The dialog stayed open and said so in place; the Angular one closed itself, which is the
        // only reason its snackbar was ever reachable.
        await expect(dialog).toBeVisible();
        await dialog.getByTestId('restore-close').click();
        await expect(dialog).toBeHidden();

        // …and the sidebar knows about a database that did not exist when the app started.
        await expect(treeRow(window, target)).toBeVisible({ timeout: 15_000 });
      } finally {
        await dropPgDatabase(target).catch(() => undefined);
        await rm(archive, { force: true }).catch(() => undefined);
      }
    });
  });

  test('refuses to restore over an existing database until the name is typed out', async () => {
    // The Angular dialog had no confirmation at all: this is the deviation, driven as an attempt to
    // get past it rather than as a description of the panel.
    const archive = tempArchive('dump');
    const target = targetName('pg');

    await withJoineryReact(async ({ window }) => {
      try {
        await createPostgresProfile(window, PG_PROFILE);
        await connectFromSidebar(window, PG_PROFILE);
        await selectDatabase(window, TEST_PG.database);

        await openBackupDialog(window);
        await runBackupTo(window, archive);
        await window.getByTestId('backup-close').click();

        // Create the target the honest way — through the wizard — so it genuinely exists for the
        // second pass.
        const dialog = await openRestoreDialog(window);
        await runRestoreIntoNew(window, archive, target);
        await dialog.getByTestId('restore-close').click();
        await expect(dialog).toBeHidden();

        // Second pass, same name. It is an overwrite now, and the wizard has to know.
        const second = await openRestoreDialog(window);
        await fillRestoreForm(window, archive, target);
        await expect(second.getByTestId('restore-target-note')).toContainText('already exists');

        // The primary is not called Start any more, and pressing it reaches the confirmation.
        await expect(second.getByTestId('restore-submit')).toHaveText(/Review the restore/);
        await second.getByTestId('restore-submit').click();
        await expect(second.getByTestId('restore-confirm')).toBeVisible();
        await expect(second.getByTestId('restore-progress')).toHaveCount(0);

        // Refused while the box is empty, and while it holds anything but the exact name.
        const confirmButton = second.getByTestId('restore-confirm-start');
        await expect(confirmButton).toBeDisabled();
        await second.getByTestId('restore-confirm-input').fill(target.toUpperCase());
        await expect(confirmButton).toBeDisabled();
        await second.getByTestId('restore-confirm-input').fill(target);
        await expect(confirmButton).toBeEnabled();

        // Backing out leaves nothing running and no confirmation banked.
        await second.getByTestId('restore-confirm-back').click();
        await expect(second.getByTestId('restore-path')).toBeVisible();
        await second.getByTestId('restore-submit').click();
        await expect(second.getByTestId('restore-confirm-start')).toBeDisabled();

        await second.getByTestId('restore-confirm-back').click();
        await second.getByTestId('restore-cancel').click();
        await expect(second).toBeHidden();

        // Nothing was destroyed on the way through: the rows are still there.
        await expectPgSeed(target);
      } finally {
        await dropPgDatabase(target).catch(() => undefined);
        await rm(archive, { force: true }).catch(() => undefined);
      }
    });
  });

  test('restores over an existing database once the confirmation is given', async () => {
    // The other half: the confirmation is a gate, not a wall. `--clean --if-exists` is the mechanism,
    // and the rows have to survive it.
    const archive = tempArchive('dump');
    const target = targetName('pg');

    await withJoineryReact(async ({ window }) => {
      try {
        await createPostgresProfile(window, PG_PROFILE);
        await connectFromSidebar(window, PG_PROFILE);
        await selectDatabase(window, TEST_PG.database);

        await openBackupDialog(window);
        await runBackupTo(window, archive);
        await window.getByTestId('backup-close').click();

        const dialog = await openRestoreDialog(window);
        await runRestoreIntoNew(window, archive, target);
        await dialog.getByTestId('restore-close').click();

        const second = await openRestoreDialog(window);
        await runRestoreOver(window, archive, target, { overwrite: true });
        await expectPgSeed(target);
        await second.getByTestId('restore-close').click();
      } finally {
        await dropPgDatabase(target).catch(() => undefined);
        await rm(archive, { force: true }).catch(() => undefined);
      }
    });
  });

  test('backs up and restores the seeded MySQL database into a fresh one', async () => {
    // MySQL's target is created by the prelude `mysql-backup.ts` pipes ahead of the dump, not by
    // Joinery — so this is the same cycle with a different creator, and the note says so.
    await ensureMysqlSeeded();
    const archive = tempArchive('sql');
    const target = targetName('my');

    await withJoineryReact(async ({ window }) => {
      try {
        await createAndConnectMysql(window, MYSQL_PROFILE);
        await selectDatabase(window, TEST_MYSQL.database);

        await openBackupDialog(window);
        await runBackupTo(window, archive);
        expect(readFileSync(archive, 'utf8')).toContain('products');
        await window.getByTestId('backup-close').click();

        const dialog = await openRestoreDialog(window);
        await expect(dialog.getByTestId('restore-format-note')).toContainText('mysql client');
        await fillRestoreForm(window, archive, target);
        await expect(dialog.getByTestId('restore-target-note')).toContainText(
          'the restore creates it'
        );

        await runRestoreIntoNew(window, archive, target);
        await expectMysqlSeed(target);
      } finally {
        await dropMysqlDatabase(target).catch(() => undefined);
        await rm(archive, { force: true }).catch(() => undefined);
      }
    });
  });

  test('refuses a MySQL target name the main process would throw on', async () => {
    // `mysql-backup.ts:163-167` rejects anything outside [A-Za-z0-9_] by throwing. Being told in the
    // form beats being told after working through a confirmation step.
    await ensureMysqlSeeded();

    await withJoineryReact(async ({ window }) => {
      await createAndConnectMysql(window, MYSQL_PROFILE);
      await selectDatabase(window, TEST_MYSQL.database);

      const dialog = await openRestoreDialog(window);
      await fillRestoreForm(window, '/tmp/does-not-matter.sql', 'has-a-hyphen');
      await dialog.getByTestId('restore-submit').click();

      await expect(dialog.getByTestId('restore-hint')).toContainText(/letters, digits/i);
      await expect(dialog.getByTestId('restore-progress')).toHaveCount(0);
    });
  });

  test('refuses an empty source inline instead of doing nothing', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PG_PROFILE);
      await connectFromSidebar(window, PG_PROFILE);
      await selectDatabase(window, TEST_PG.database);

      const dialog = await openRestoreDialog(window);
      await expect(dialog.getByTestId('restore-path')).toHaveValue('');

      await dialog.getByTestId('restore-submit').click();

      // A click validates and says why, rather than a disabled button that explains nothing.
      await expect(dialog.getByTestId('restore-hint')).toContainText(/backup file/i);
      await expect(dialog.getByTestId('restore-progress')).toHaveCount(0);
    });
  });

  test('opens on the database the context menu names', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PG_PROFILE);
      await connectFromSidebar(window, PG_PROFILE);
      await selectDatabase(window, TEST_PG.database);

      // `postgres` is right-clicked while `joinery_test` is the selected database; the payload wins,
      // and it pre-selects the restore TARGET rather than naming a source.
      const dialog = await openRestoreDialogFromNode(window, 'postgres');
      await expect(dialog.getByTestId('restore-target-note')).toContainText(
        'postgres already exists'
      );
      await dialog.getByTestId('restore-cancel').click();
      await expect(restoreDialog(window)).toBeHidden();
    });
  });
});

// --- driver-side assertions, outside Joinery's IPC entirely ---

async function expectPgSeed(name: string): Promise<void> {
  const client = new PgClient({ ...TEST_PG, database: name });
  await client.connect();
  try {
    const table = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products'"
    );
    expect(table.rows[0]?.count, `expected a products table in ${name}`).toBe('1');

    const rows = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM products'
    );
    expect(
      Number(rows.rows[0]?.count),
      `expected restored products ROWS in ${name}, not just a success banner`
    ).toBeGreaterThan(0);
  } finally {
    await client.end();
  }
}

async function dropPgDatabase(name: string): Promise<void> {
  const client = new PgClient({ ...TEST_PG, database: 'postgres' });
  await client.connect();
  try {
    // Identifier interpolation is safe — `name` comes from `targetName`, which is a uuid slice.
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

async function expectMysqlSeed(name: string): Promise<void> {
  const connection = await mysql.createConnection({
    host: TEST_MYSQL.host,
    port: TEST_MYSQL.port,
    user: TEST_MYSQL.user,
    password: TEST_MYSQL.password,
    database: name,
  });
  try {
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT 1 AS hit FROM information_schema.tables WHERE table_schema = ? AND table_name = 'products'",
      [name]
    );
    expect(tables.length, `expected a products table in ${name}`).toBe(1);

    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM products'
    );
    expect(
      Number(rows[0]?.['n']),
      `expected restored products ROWS in ${name}, not just a success banner`
    ).toBeGreaterThan(0);
  } finally {
    await connection.end();
  }
}

async function dropMysqlDatabase(name: string): Promise<void> {
  const connection = await mysql.createConnection({
    host: TEST_MYSQL.host,
    port: TEST_MYSQL.port,
    user: TEST_MYSQL.user,
    password: TEST_MYSQL.password,
  });
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${name}\``);
  } finally {
    await connection.end();
  }
}

/**
 * Seed `joinery_test` in the MySQL container, idempotently.
 *
 * The same helper `backup.spec.ts` carries, and for the same reason its comment gives: the shared
 * `ensureJoineryTestSeeded` seeds PostgreSQL alone.
 */
async function ensureMysqlSeeded(): Promise<void> {
  const connection = await mysql.createConnection({
    host: TEST_MYSQL.host,
    port: TEST_MYSQL.port,
    user: TEST_MYSQL.user,
    password: TEST_MYSQL.password,
    multipleStatements: true,
  });
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${TEST_MYSQL.database}\``);
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = 'products'",
      [TEST_MYSQL.database]
    );
    if (rows.length > 0) return;

    const fixtures = join(__dirname, '..', 'fixtures', 'mysql');
    const use = `USE \`${TEST_MYSQL.database}\`;\n`;
    await connection.query(use + readFileSync(join(fixtures, 'schema.sql'), 'utf8'));
    await connection.query(use + readFileSync(join(fixtures, 'seed.sql'), 'utf8'));
  } finally {
    await connection.end();
  }
}
