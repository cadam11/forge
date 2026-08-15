/**
 * Visual baselines — post-connection states.
 *
 * Connects to the seeded PostgreSQL test container (joinery_test) and
 * captures the UI states that only exist when Joinery has an active
 * connection: explorer tree populated, query editor open, results grid
 * after running a query.
 *
 * Each test launches a fresh Electron with an isolated user-data dir
 * (via withJoinery → launchJoinery), so the Connect button's "save profile"
 * side-effect doesn't leak between tests or pollute the welcome baseline.
 */

import { expect, test } from '@playwright/test';
import { withJoinery } from '../../helpers/electron-app';
import {
  connectToTestPostgres,
  ensureJoineryTestSeeded,
  executeQuery,
  openNewQueryTab,
  selectDatabase,
  typeInEditor,
} from '../../helpers/joinery-actions';

test.beforeAll(ensureJoineryTestSeeded);

test.describe('Joinery — connected visual baselines', () => {
  test('sidebar with populated explorer tree', async () => {
    await withJoinery(async ({ window }) => {
      await connectToTestPostgres(window);
      // Capture just the sidebar — full-window captures have dynamic content
      // (docker container uptime strings, snackbar fade) that would flake.
      // Sidebar shows the connected state and explorer tree, which is what
      // we actually want to lock down.
      const sidebar = window.locator('app-sidebar');
      await expect(sidebar).toHaveScreenshot('sidebar-with-populated-explorer-tree.png');
    });
  });

  test('query editor — empty new tab', async () => {
    await withJoinery(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'joinery_test');
      await openNewQueryTab(app, window);
      await window.waitForTimeout(800);
      const mainArea = window
        .locator('.main-area, app-shell .main-area, [class*="main-area"]')
        .first();
      await expect(mainArea).toHaveScreenshot('query-editor-empty-new-tab.png');
    });
  });

  test('result grid — products query', async () => {
    await withJoinery(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'joinery_test');
      await openNewQueryTab(app, window);
      await typeInEditor(
        window,
        'SELECT id, sku, name, price_cents FROM products ORDER BY id LIMIT 10;'
      );
      await executeQuery(window);
      const grid = window.locator('ag-grid-angular, .ag-root-wrapper').first();
      await expect(grid).toBeVisible({ timeout: 15000 });
      await window.waitForTimeout(1500);
      const mainArea = window
        .locator('.main-area, app-shell .main-area, [class*="main-area"]')
        .first();
      await expect(mainArea).toHaveScreenshot('result-grid-products-query.png');
    });
  });
});
