/**
 * The query-history dialog, against the seeded PostgreSQL container.
 *
 * There is no Angular predecessor: the 608-line dialog had no e2e coverage at all, which is part of why
 * `openInNewTab` could resolve to the wrong server for months without anyone noticing.
 *
 * The round trip is the test — **execute → the statement appears → load it back into a new tab** — and
 * it is a real round trip through the main process's own store (`services/config/query-history.ts`),
 * which is the only place history entries are written. Nothing in the renderer records one.
 */

import { expect, test } from '@playwright/test';
import {
  connectFromSidebar,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  executeQuery,
  historyEntryRow,
  historyEntryRows,
  openQueryHistory,
  queryHistoryDialog,
  searchQueryHistory,
  selectDatabase,
  typeSql,
  visibleSql,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Test PG';
/** Two statements that cannot be confused with each other in a search. */
const CUSTOMERS_SQL = 'select id, full_name from customers order by id';
const PRODUCTS_SQL = 'select id, sku from products order by id';

test.beforeAll(ensureJoineryTestSeeded);

test.describe('Joinery (React) — query history', () => {
  test('records what was executed, and loads it back into a new tab', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, 'joinery_test');
      await dismissToasts(window);

      await typeSql(window, CUSTOMERS_SQL);
      await executeQuery(window);

      const dialog = await openQueryHistory(app, window);
      // The statement is there, with the database it ran against beside it.
      const row = historyEntryRow(window, 'from customers');
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('joinery_test');

      // Loading opens a NEW tab rather than re-pointing the one that ran it (`reuseEmpty: false`).
      await row.getByTestId('query-history-load').click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });

      await expect(window.getByTestId('query-panel')).toBeVisible();
      // The document is the recorded statement, which is the whole claim of the load path.
      await expect
        .poll(async () => (await visibleSql(window)).replace(/\s+/g, ' ').trim(), {
          timeout: 10_000,
        })
        .toContain('from customers');
    });
  });

  test('searches the whole history through the main process', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, 'joinery_test');
      await dismissToasts(window);

      await typeSql(window, CUSTOMERS_SQL);
      await executeQuery(window);
      await typeSql(window, PRODUCTS_SQL);
      await executeQuery(window);

      await openQueryHistory(app, window);
      await expect(historyEntryRows(window).first()).toBeVisible({ timeout: 10_000 });

      await searchQueryHistory(window, 'products');
      await expect(historyEntryRow(window, 'from products')).toHaveCount(1);
      await expect(historyEntryRow(window, 'from customers')).toHaveCount(0);

      // And back: clearing the field restores the unfiltered list rather than leaving it narrowed.
      await searchQueryHistory(window, '');
      await expect(historyEntryRow(window, 'from customers')).toHaveCount(1);
    });
  });

  test('runs an entry on the way in when the run action is used', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, 'joinery_test');
      await dismissToasts(window);

      await typeSql(window, CUSTOMERS_SQL);
      await executeQuery(window);

      await openQueryHistory(app, window);
      await historyEntryRow(window, 'from customers').getByTestId('query-history-execute').click();
      await expect(queryHistoryDialog(window)).toBeHidden({ timeout: 10_000 });

      // `autoExecute` on the new tab: the difference between load and execute is that flag, and the
      // observable proof of it is rows on screen without anybody pressing Execute.
      await expect(window.getByTestId('results-grid')).toBeVisible({ timeout: 20_000 });
      await expect(window.getByTestId('status-executing')).toBeHidden({ timeout: 20_000 });
    });
  });

  test('says the history is empty rather than showing an empty list', async () => {
    await withJoineryReact(async ({ app, window }) => {
      // A fresh profile directory, so nothing has ever been executed.
      const dialog = await openQueryHistory(app, window);
      await expect(dialog.getByTestId('query-history-count')).toContainText('0 queries');
      await expect(dialog).toContainText('No queries yet');
      await expect(historyEntryRows(window)).toHaveCount(0);
    });
  });
});
