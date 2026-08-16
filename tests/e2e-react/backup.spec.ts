/**
 * Backing up a database through the React wizard, against the live seeded containers.
 *
 * This is the BACKUP half of `tests/e2e/backup-restore.spec.ts`, whose assertions are the parity
 * floor: the form accepts the engine-aware path, the run reports completion, and **the file exists on
 * disk and is non-empty**. The restore half stays with the Angular spec until Task 13 lands its dialog.
 *
 * Three things are asserted here that the Angular spec could not be:
 *
 *  1. **Completion is reported INSIDE the dialog.** The Angular spec waited on a snackbar
 *     (`.mat-mdc-snack-bar-container`) and only saw it because the dialog closed itself on the same
 *     tick. J-42: a toast raised while a modal is open is visible and inert, so a dialog that stays
 *     open — which this one does — could never report through one. `backup-success` and its path
 *     readout are the signal.
 *  2. **The path readout names the file that was written.** Which is what makes assertion 1 a check on
 *     the operation rather than on a label.
 *  3. **The context menu's target wins over the sidebar's selection.** The Angular sidebar's recurring
 *     bug was the reverse.
 *
 * Why the assertion on the file is the one that matters: everything upstream of `pg_dump` can look
 * healthy while the dump is empty — a wrong `-f`, a path the process cannot write, a `PGPASSWORD` that
 * never reached the environment. `statSync().size` is the only claim that cannot be faked by the UI.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

import { expect, test } from './fixtures';
import {
  createAndConnectMysql,
  createPostgresProfile,
  connectFromSidebar,
  ensureJoineryTestSeeded,
  openBackupDialog,
  openBackupDialogFromNode,
  runBackupTo,
  selectDatabase,
  TEST_MYSQL,
  TEST_PG,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PG_PROFILE = 'Test PG';
const MYSQL_PROFILE = 'Test MySQL';

/** A temp destination nothing else can collide with, so a leaked file never fails the next run. */
function tempDump(extension: string): string {
  return join(tmpdir(), `joinery-e2e-backup-${randomUUID().slice(0, 12)}.${extension}`);
}

test.beforeAll(ensureJoineryTestSeeded);

test.describe('Joinery (React) — backing up a database', () => {
  test('dumps the seeded PostgreSQL database to a real, non-empty file', async () => {
    const destination = tempDump('dump');

    await withJoineryReact(async ({ window }) => {
      try {
        await createPostgresProfile(window, PG_PROFILE);
        await connectFromSidebar(window, PG_PROFILE);
        await selectDatabase(window, TEST_PG.database);

        const dialog = await openBackupDialog(window);
        // The probe found pg_dump, so the form is up rather than the remediation view — which is the
        // negative half of `backup-cli-deps.spec.ts`.
        await expect(window.getByTestId('missing-cli-tools')).toHaveCount(0);
        // PG offers no format picker, because `pg-backup.ts` hard-codes `-F c` and would ignore one.
        await expect(dialog.getByTestId('backup-type')).toHaveCount(0);
        await expect(dialog.getByTestId('backup-format-note')).toContainText('pg_dump');

        await runBackupTo(window, destination);

        expect(existsSync(destination), `expected a dump at ${destination}`).toBe(true);
        expect(statSync(destination).size, 'the dump should not be empty').toBeGreaterThan(0);
        // `pg_dump -F c` writes the magic `PGDMP` header, so this also proves the *format* the note
        // promises — a plain-SQL dump or a truncated file would not carry it.
        expect(readFileSync(destination).subarray(0, 5).toString('latin1')).toBe('PGDMP');

        // The dialog stays open on success and says so in place. The Angular one closed itself, which
        // is why its snackbar was reachable at all.
        await expect(dialog).toBeVisible();
        await dialog.getByTestId('backup-close').click();
        await expect(dialog).toBeHidden();
      } finally {
        await rm(destination, { force: true }).catch(() => undefined);
      }
    });
  });

  test('dumps the seeded MySQL database to a real, non-empty file', async () => {
    await ensureMysqlSeeded();
    const destination = tempDump('sql');

    await withJoineryReact(async ({ window }) => {
      try {
        await createAndConnectMysql(window, MYSQL_PROFILE);
        await selectDatabase(window, TEST_MYSQL.database);

        const dialog = await openBackupDialog(window);
        await expect(dialog.getByTestId('backup-format-note')).toContainText('mysqldump');

        await runBackupTo(window, destination);

        expect(existsSync(destination), `expected a dump at ${destination}`).toBe(true);
        expect(statSync(destination).size, 'the dump should not be empty').toBeGreaterThan(0);
        // mysqldump writes a plain SQL script, so the seeded table has to be named in it. This is the
        // MySQL counterpart of the PGDMP header check: proof of content, not just of size.
        expect(readFileSync(destination, 'utf8')).toContain('products');
      } finally {
        await rm(destination, { force: true }).catch(() => undefined);
      }
    });
  });

  test('backs up the database the context menu names, not the selected one', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PG_PROFILE);
      await connectFromSidebar(window, PG_PROFILE);
      // `joinery_test` is the SELECTED database…
      await selectDatabase(window, TEST_PG.database);

      // …and `postgres` is the one right-clicked. The payload has to win.
      const dialog = await openBackupDialogFromNode(window, 'postgres');
      await expect(dialog).toContainText('Back up postgres');
      await expect(dialog).not.toContainText(`Back up ${TEST_PG.database}`);

      await dialog.getByTestId('backup-cancel').click();
      await expect(dialog).toBeHidden();
    });
  });

  test('refuses an empty destination inline instead of doing nothing', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PG_PROFILE);
      await connectFromSidebar(window, PG_PROFILE);
      await selectDatabase(window, TEST_PG.database);

      const dialog = await openBackupDialog(window);
      // PG has no server-side default to pre-fill, so the field starts empty.
      await expect(dialog.getByTestId('backup-path')).toHaveValue('');

      await dialog.getByTestId('backup-start').click();

      // A click validates and says why, rather than a disabled button that explains nothing.
      await expect(dialog.getByTestId('backup-hint')).toContainText(
        /where the backup should be written/i
      );
      await expect(dialog.getByTestId('backup-progress')).toHaveCount(0);
    });
  });
});

/**
 * Seed `joinery_test` in the MySQL container, idempotently.
 *
 * Lifted from the Angular `backup-restore.spec.ts`, which owns the only copy of this: the shared
 * `ensureJoineryTestSeeded` seeds PostgreSQL alone, and `db-fixtures.ts`'s MySQL helpers belong to the
 * integration tier's isolated-database flow rather than to the fixed `joinery_test` this tier connects
 * to through the UI.
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
