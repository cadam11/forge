/**
 * Query editor E2E specs — adapted from the legacy 31-test audit's
 * "Query Editor" section (tests 6, 7, 8, 26 in particular).
 *
 * Covers: opening a new query tab, executing a SELECT and verifying
 * results in the ag-grid, error display on invalid SQL, and tab labeling.
 */

import { expect, test } from '@playwright/test';
import { withForge } from '../helpers/electron-app';
import {
  connectToTestPostgres,
  ensureForgeTestSeeded,
  executeQuery,
  openNewQueryTab,
  selectDatabase,
  typeInEditor,
} from '../helpers/forge-actions';

test.beforeAll(ensureForgeTestSeeded);

test.describe('Forge — query editor', () => {
  test('opens a new query tab via menu:new-query', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);

      // Monaco editor visible.
      await expect(window.locator('.monaco-editor').first()).toBeVisible();
      // A query tab labeled "Query 1" is added next to the welcome tab.
      await expect(window.locator('.lm_tab').filter({ hasText: 'Query 1' })).toBeVisible();
    });
  });

  test('executes a SELECT and renders the result grid', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);
      await typeInEditor(window, 'SELECT id, sku, name, price_cents FROM products ORDER BY id;');
      await executeQuery(window);

      // Result grid renders.
      const grid = window.locator('ag-grid-angular, .ag-root-wrapper').first();
      await expect(grid).toBeVisible({ timeout: 15000 });
      // Synthetic seed has exactly 10 products.
      await expect(window.getByText(/10 rows/i).first()).toBeVisible({ timeout: 10000 });
      // First product is "MacBook Air M4" per fixtures.
      await expect(window.getByText('MacBook Air M4').first()).toBeVisible({ timeout: 5000 });
    });
  });

  test('displays an error message on invalid SQL', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);
      await typeInEditor(window, 'SELECT * FROM definitely_not_a_table;');
      await executeQuery(window);

      // PG raises 'relation "X" does not exist' which Forge surfaces in
      // the result area below the editor.
      await expect(window.getByText(/does not exist/i).first()).toBeVisible({ timeout: 10000 });
    });
  });

  // Multi-statement query test was removed: Forge surfaces an error for
  // semicolon-separated statements on PostgreSQL (the underlying pg driver
  // requires one statement per query unless you use the simple-query
  // protocol). The legacy regression-suite assertion (#9) was MSSQL-shaped
  // and doesn't translate. When MSSQL joins the e2e tier we can re-add this
  // case engine-gated.

  test('Cmd+Shift+F formats SQL (lowercase → SELECT uppercase)', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);
      // Type unformatted lowercase SQL.
      await typeInEditor(window, 'select id, name from products where id = 1');
      // Fire format via the same menu IPC the macOS menu uses.
      // (The component's Cmd+Shift+F handler also works but this path is
      // independent of which platform Playwright resolves the modifier for.)
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('menu:format-sql');
      });
      await window.waitForTimeout(800);
      // Forge's formatter uppercases keywords and reflows whitespace. Read
      // the editor's rendered text and assert SELECT is now uppercase.
      const editorText = (await window.locator('.monaco-editor .view-line').allTextContents()).join(
        '\n'
      );
      expect(editorText).toContain('SELECT');
      expect(editorText).toContain('FROM');
    });
  });

  test('execution persists a result snapshot visible in the history tab', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);
      await typeInEditor(window, 'SELECT id, sku FROM products ORDER BY id;');
      await executeQuery(window);

      await expect(window.locator('ag-grid-angular, .ag-root-wrapper').first()).toBeVisible({
        timeout: 15000,
      });

      // Open the Result History tab in the results pane and expect the
      // execution above to have been captured as a snapshot.
      await window
        .locator('.result-tab.icon-tab', { has: window.locator('mat-icon:text("history")') })
        .first()
        .click();
      await expect(window.locator('app-result-history-panel')).toBeVisible({ timeout: 5000 });
      await expect(window.locator('.snapshot-item').first()).toBeVisible({ timeout: 10000 });

      // Viewing a snapshot hydrates rows by id (the list itself is
      // metadata-only) and shows the historical banner over the grid.
      await window.locator('.snapshot-item').first().click();
      await expect(window.locator('.historical-banner')).toBeVisible({ timeout: 10000 });
      await expect(window.locator('.ag-root-wrapper').first()).toBeVisible({ timeout: 10000 });
    });
  });
});
