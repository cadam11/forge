/**
 * The schema-comparison dialog against both live engines this tier has, because the interesting thing
 * about it is that they answer differently:
 *
 *  - **MySQL** can be asked, so the generated query lands in a tab AND RUNS — which is the assertion
 *    that matters, because a generator that emits unparseable SQL fails no unit test.
 *  - **PostgreSQL** cannot be asked at all (no cross-database queries), so the dialog opens and explains
 *    instead of emitting T-SQL. The Angular dialog emitted T-SQL for whatever engine was focused, which is
 *    exactly the case this covers.
 */

import mysql from 'mysql2/promise';

import { expect, test } from './fixtures';
import {
  connectFromSidebar,
  createAndConnectMysql,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  executeQuery,
  openSchemaDiff,
  openSchemaDiffFromNode,
  schemaDiffDialog,
  selectDatabase,
  queryEditor,
  selectDiffDatabase,
  TEST_MYSQL,
  visibleSql,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PG_PROFILE = 'Diff PG';
const MYSQL_PROFILE = 'Diff MySQL';

/**
 * A second MySQL database to compare `joinery_test` against, created out of band.
 *
 * It has to exist and it has to be created outside Joinery. The MySQL server the harness runs exposes
 * exactly one non-system schema, and Joinery's database list drops the system ones — so a comparison has
 * nothing to compare against by default, and the dialog correctly refuses to open ("only one database
 * loaded"). Creating it through the app would work but would leave it behind: `delete-database` is still
 * unowned, so there is no UI to remove it with, and an extra schema per run accumulates.
 *
 * Deliberately DIFFERENT from `joinery_test` — one shared table with a changed column type, one table only
 * it has — so the generated query has real differences to report rather than an empty result.
 */
const TARGET_SCHEMA = 'joinery_diff_target';

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

test.beforeAll(async () => {
  await ensureJoineryTestSeeded();
  await withMysql(async conn => {
    await conn.query(`DROP DATABASE IF EXISTS \`${TARGET_SCHEMA}\``);
    await conn.query(`CREATE DATABASE \`${TARGET_SCHEMA}\``);
    await conn.query(
      `CREATE TABLE \`${TARGET_SCHEMA}\`.customers (id INT PRIMARY KEY, email TEXT)`
    );
    await conn.query(`CREATE TABLE \`${TARGET_SCHEMA}\`.only_here (id INT PRIMARY KEY)`);
    await conn.query(
      `CREATE VIEW \`${TARGET_SCHEMA}\`.v_only_here AS SELECT id FROM \`${TARGET_SCHEMA}\`.only_here`
    );
  });
});

test.afterAll(async () => {
  await withMysql(conn => conn.query(`DROP DATABASE IF EXISTS \`${TARGET_SCHEMA}\``));
});

test.describe('Joinery (React) — comparing schemas', () => {
  test('generates a MySQL comparison query that the server accepts', async () => {
    await withJoineryReact(async ({ window }) => {
      await createAndConnectMysql(window, MYSQL_PROFILE);
      await selectDatabase(window, 'joinery_test');
      await dismissToasts(window);

      // From the sidebar node, which is Task 19b's new entry point — the Angular dialog was
      // palette-only, so a user right-clicking the database they meant found nothing.
      const dialog = await openSchemaDiffFromNode(window, 'joinery_test');
      // The source is pre-selected from the node that asked.
      await expect(dialog.getByTestId('schema-diff-source')).toContainText('joinery_test');
      // And the primary action says what it produces, not "Diff".
      await expect(dialog.getByTestId('schema-diff-generate')).toHaveText(
        'Generate comparison query'
      );

      await selectDiffDatabase(window, 'target', TARGET_SCHEMA);
      await dialog.getByTestId('schema-diff-generate').click();
      await expect(schemaDiffDialog(window)).toBeHidden();

      // The tab is new, so Monaco is still mounting when the dialog closes — wait for the document to
      // have painted before reading it.
      await expect(queryEditor(window).locator('.view-lines')).toContainText('Schema comparison', {
        timeout: 20_000,
      });
      const sql = await visibleSql(window);
      expect(sql).toContain(`Schema comparison: joinery_test vs ${TARGET_SCHEMA}`);
      // MySQL's spelling, not T-SQL's — the Angular generator emitted the latter for every engine.
      expect(sql).toContain('information_schema.TABLES');
      expect(sql).not.toContain('[joinery_test]');
      expect(sql).not.toContain('ISNULL(');

      // Not auto-executed: the whole point of generating SQL is that it can be read first.
      await expect(window.getByTestId('query-results-empty')).toBeVisible();

      // And now the assertion no unit test can make — the server parses it.
      await executeQuery(window);
      await expect(window.getByTestId('query-results')).toBeVisible({ timeout: 30_000 });
      await expect(window.getByTestId('query-results-error-text')).toBeHidden();
    });
  });

  test('emits only the sections left ticked', async () => {
    await withJoineryReact(async ({ window }) => {
      await createAndConnectMysql(window, MYSQL_PROFILE);
      await selectDatabase(window, 'joinery_test');
      await dismissToasts(window);

      const dialog = await openSchemaDiffFromNode(window, 'joinery_test');
      await selectDiffDatabase(window, 'target', TARGET_SCHEMA);
      await dialog.getByTestId('schema-diff-views').click();
      await dialog.getByTestId('schema-diff-routines').click();
      await dialog.getByTestId('schema-diff-indexes').click();
      await dialog.getByTestId('schema-diff-generate').click();

      await expect(queryEditor(window).locator('.view-lines')).toContainText('Schema comparison', {
        timeout: 20_000,
      });
      const sql = await visibleSql(window);
      expect(sql).toContain('TABLES AND COLUMNS');
      expect(sql).not.toContain('VIEWS');
      expect(sql).not.toContain('INDEXES');
    });
  });

  test('refuses PostgreSQL in the dialog, with the reason, rather than emitting T-SQL', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PG_PROFILE);
      await connectFromSidebar(window, PG_PROFILE);
      await selectDatabase(window, 'joinery_test');
      await dismissToasts(window);

      const dialog = await openSchemaDiff(window);
      await expect(dialog.getByTestId('schema-diff-unsupported')).toBeVisible();
      await expect(dialog).toContainText('cannot query across databases');
      // No picker and no generate button: there is nothing to pick and nothing to generate.
      await expect(dialog.getByTestId('schema-diff-source')).toBeHidden();
      await expect(dialog.getByTestId('schema-diff-generate')).toBeHidden();
      // Cancel is still there, because a dialog you cannot leave is worse than one that refuses.
      await dialog.getByTestId('schema-diff-cancel').click();
      await expect(schemaDiffDialog(window)).toBeHidden();
    });
  });

  test('will not generate until both sides are chosen, and says why', async () => {
    await withJoineryReact(async ({ window }) => {
      await createAndConnectMysql(window, MYSQL_PROFILE);
      await selectDatabase(window, 'joinery_test');
      await dismissToasts(window);

      const dialog = await openSchemaDiffFromNode(window, 'joinery_test');
      await expect(dialog.getByTestId('schema-diff-generate')).toBeDisabled();
      // The reason a disabled button is disabled, on screen — J-44's class of defect otherwise.
      await expect(dialog.getByTestId('schema-diff-problem')).toContainText('source and a target');

      await selectDiffDatabase(window, 'target', 'joinery_test');
      await expect(dialog.getByTestId('schema-diff-problem')).toContainText(
        'two different databases'
      );
      await expect(dialog.getByTestId('schema-diff-generate')).toBeDisabled();
    });
  });
});
