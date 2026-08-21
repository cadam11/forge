/**
 * Documentation shots — the four dialogs a docs page sends a reader to.
 *
 * Each is captured as an ELEMENT rather than as a window: what a reader needs from a picture of a
 * dialog is its fields and its actions, and framing the window spends most of the image on the scrim
 * and on whatever is behind it.
 *
 * ── Two things every path here is deliberate about ────────────────────────────────────────────
 *
 *  1. **No date is left to the clock.** The backup wizard's path field opens holding
 *     `suggestedFileName(db, engine, new Date())` — a filename with today's date in it — so a shot
 *     of the untouched form would show a different filename tomorrow. Both wizards are given a fixed
 *     absolute path instead, which is a fill rather than a mask: a path the image can actually show
 *     is better than a pink rectangle where the path goes.
 *  2. **The restore shot stops AT the gate.** It is taken in the `confirming` phase — the screen
 *     that says "This cannot be undone" — and `restore-confirm-start` is never pressed. The test
 *     asserts afterwards that no run started, so the picture is provably of a dialog that destroyed
 *     nothing.
 */

import { mkdirSync, writeFileSync } from 'node:fs';

import { blurFocus, capture, expect, test, withDocsApp } from './fixtures';
import { PAGE_THEMES } from './catalogue';
import {
  TEST_MYSQL,
  connectFromSidebar,
  createAndConnectMysql,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  fillRestoreForm,
  openBackupDialog,
  openRestoreDialog,
  openSchemaDiffFromNode,
  openSettings,
  openSettingsGroup,
  restoreDialog,
  schemaDiffDialog,
  selectDatabase,
  selectDiffDatabase,
} from '../helpers/joinery-actions-react';

import mysql from 'mysql2/promise';

const PG_PROFILE = 'Local Postgres';
const MYSQL_PROFILE = 'Local MySQL';
const DATABASE = 'joinery_test';

/**
 * A fixed directory, and fixed filenames inside it.
 *
 * `os.tmpdir()` is not usable: on macOS it is a per-user `/var/folders/**` path that differs between
 * machines and between reboots, and both wizards PRINT the path they were given — so an image of one
 * would show a string nobody else can reproduce. A literal path is the only kind that belongs in a
 * committed screenshot, and this one names no user.
 */
const FIXTURE_DIR = '/tmp/joinery-docs';
const BACKUP_DESTINATION = `${FIXTURE_DIR}/joinery_test.dump`;
const RESTORE_SOURCE = `${FIXTURE_DIR}/joinery_test.dump`;

/**
 * A second MySQL schema for the comparison dialog to have two sides.
 *
 * It has to exist and it has to be created out of band, for the reason `schema-diff.spec.ts`
 * documents: the harness's MySQL server exposes exactly one non-system schema, Joinery drops the
 * system ones from its list, and the dialog correctly refuses to open with only one database loaded.
 * Deliberately different from `joinery_test` so the picture is of a real comparison.
 */
const DIFF_TARGET = 'joinery_docs_target';

async function withMysql<T>(fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const conn = await mysql.createConnection({
    host: TEST_MYSQL.host,
    port: TEST_MYSQL.port,
    user: TEST_MYSQL.user,
    password: TEST_MYSQL.password,
    multipleStatements: true,
  });
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

test.beforeAll(ensureJoineryTestSeeded);

test.beforeAll(() => {
  // The restore wizard reads nothing out of the archive on PostgreSQL (header inspection is the
  // MSSQL path), but a source file that exists keeps the shot honest about what it describes.
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(RESTORE_SOURCE, 'not a real archive — this shot never runs the restore\n');
});

test.beforeAll(async () => {
  await withMysql(async conn => {
    await conn.query(`DROP DATABASE IF EXISTS \`${DIFF_TARGET}\``);
    await conn.query(`CREATE DATABASE \`${DIFF_TARGET}\``);
    await conn.query(`CREATE TABLE \`${DIFF_TARGET}\`.customers (id INT PRIMARY KEY, email TEXT)`);
    await conn.query(`CREATE TABLE \`${DIFF_TARGET}\`.only_here (id INT PRIMARY KEY)`);
  });
});

test.afterAll(async () => {
  await withMysql(conn => conn.query(`DROP DATABASE IF EXISTS \`${DIFF_TARGET}\``));
});

for (const theme of PAGE_THEMES) {
  test.describe(`docs shots — dialogs, ${theme}`, () => {
    test('the settings panel, appearance', async () => {
      await withDocsApp(theme, async ({ app, window }) => {
        await openSettings(app, window);
        const group = await openSettingsGroup(window, 'appearance');
        // The theme radio reflects the pin `withDocsApp` applied, so the shot cannot show a panel
        // disagreeing with the canvas it was captured on.
        await expect(group.getByTestId(`settings-theme-${theme}`)).toBeChecked();
        await blurFocus(window);
        await capture(
          window.getByTestId('settings-dialog'),
          'settings-appearance',
          theme,
          'The settings panel, appearance group'
        );
      });
    });

    test('the backup wizard', async () => {
      await withDocsApp(theme, async ({ window }) => {
        await createPostgresProfile(window, PG_PROFILE);
        await connectFromSidebar(window, PG_PROFILE);
        await selectDatabase(window, DATABASE);
        await dismissToasts(window);

        const dialog = await openBackupDialog(window);
        // Without `pg_dump` the wizard renders its remediation view instead, and this shot would
        // silently become a picture of that. Asserted, so a missing tool is reported as one.
        await expect(window.getByTestId('missing-cli-tools')).toHaveCount(0);

        const path = dialog.getByTestId('backup-path');
        await path.fill(BACKUP_DESTINATION);
        await expect(path).toHaveValue(BACKUP_DESTINATION);
        await blurFocus(window);
        await capture(dialog, 'backup-wizard', theme, 'The backup wizard, ready to run');

        // Nothing was started: the picture is of a wizard that has not run.
        await expect(dialog.getByTestId('backup-progress')).toHaveCount(0);
      });
    });

    test('the restore wizard at its confirmation', async () => {
      await withDocsApp(theme, async ({ window }) => {
        await createPostgresProfile(window, PG_PROFILE);
        await connectFromSidebar(window, PG_PROFILE);
        await selectDatabase(window, DATABASE);
        await dismissToasts(window);

        const dialog = await openRestoreDialog(window);
        await expect(window.getByTestId('missing-cli-tools')).toHaveCount(0);

        // The target is a database that exists, which is what makes this an overwrite and puts the
        // confirmation in the way. Naming `joinery_test` is safe precisely because the confirmation
        // is never given below.
        await fillRestoreForm(window, RESTORE_SOURCE, DATABASE);
        await expect(dialog.getByTestId('restore-target-note')).toContainText('already exists');
        await dialog.getByTestId('restore-submit').click();
        await expect(dialog.getByTestId('restore-confirm')).toBeVisible();
        await blurFocus(window);

        await capture(
          dialog,
          'restore-wizard',
          theme,
          'The restore wizard at its overwrite confirmation'
        );

        // The gate held: no run began, and the button that would begin one is still waiting.
        await expect(dialog.getByTestId('restore-progress')).toHaveCount(0);
        await expect(dialog.getByTestId('restore-confirm-start')).toBeDisabled();
        await expect(restoreDialog(window)).toBeVisible();
      });
    });

    test('the schema comparison dialog', async () => {
      await withDocsApp(theme, async ({ window }) => {
        // MySQL rather than PostgreSQL, because PostgreSQL cannot be asked at all — it has no
        // cross-database queries, so the dialog opens and explains instead of offering a picker
        // (`schema-diff.spec.ts` covers that path). A shot of the refusal is not what the feature
        // page is documenting.
        await createAndConnectMysql(window, MYSQL_PROFILE);
        await selectDatabase(window, DATABASE);
        await dismissToasts(window);

        const dialog = await openSchemaDiffFromNode(window, DATABASE);
        await expect(dialog.getByTestId('schema-diff-source')).toContainText(DATABASE);
        await selectDiffDatabase(window, 'target', DIFF_TARGET);
        await expect(dialog.getByTestId('schema-diff-target')).toContainText(DIFF_TARGET);
        await blurFocus(window);

        await capture(
          dialog,
          'schema-diff',
          theme,
          'The schema comparison dialog with both sides chosen'
        );

        // Nothing was generated: the dialog is still the dialog, not a query tab.
        await expect(schemaDiffDialog(window)).toBeVisible();
      });
    });
  });
}
