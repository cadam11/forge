/**
 * Tab management E2E specs — adapted from the legacy 31-test audit's
 * "Tab management" + "Multiple result sets" cases (test 26).
 *
 * Joinery uses Golden Layout for its tab system; tabs are .lm_tab elements
 * with .lm_active marking the focused one. Welcome is always tab 0.
 */

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { withJoinery } from '../helpers/electron-app';
import {
  connectToTestPostgres,
  ensureJoineryTestSeeded,
  openNewQueryTab,
  selectDatabase,
  typeInEditor,
} from '../helpers/joinery-actions';

test.beforeAll(ensureJoineryTestSeeded);

/**
 * Joinery's openQueryTab dedupes against existing empty tabs for the same
 * connection+database, so calling menu:new-query twice in a row only opens
 * one tab. To get multiple tabs, type something into the active editor
 * first so it's no longer "empty", then open another.
 */
async function openAdditionalQueryTab(app: ElectronApplication, window: Page, sqlInPrev: string) {
  await typeInEditor(window, sqlInPrev);
  await openNewQueryTab(app, window);
}

test.describe('Joinery — tab management', () => {
  test('opens multiple query tabs alongside Welcome', async () => {
    await withJoinery(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'joinery_test');

      await openNewQueryTab(app, window); // Query 1
      await openAdditionalQueryTab(app, window, '-- one\n'); // Query 2
      await openAdditionalQueryTab(app, window, '-- two\n'); // Query 3

      const tabs = window.locator('.lm_tab');
      await expect(tabs.filter({ hasText: 'Welcome' })).toBeVisible();
      await expect(tabs.filter({ hasText: 'Query 1' })).toBeVisible();
      await expect(tabs.filter({ hasText: 'Query 2' })).toBeVisible();
      await expect(tabs.filter({ hasText: 'Query 3' })).toBeVisible();
    });
  });

  test('clicking a tab makes it active', async () => {
    await withJoinery(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'joinery_test');
      await openNewQueryTab(app, window);
      await openAdditionalQueryTab(app, window, '-- one\n');

      const tabs = window.locator('.lm_tab');
      // After opening Query 2 it's active. Click Query 1 to switch.
      await tabs.filter({ hasText: 'Query 1' }).click();
      await expect(tabs.filter({ hasText: 'Query 1' })).toHaveClass(/lm_active/);
      await expect(tabs.filter({ hasText: 'Query 2' })).not.toHaveClass(/lm_active/);
    });
  });

  test('closing a tab removes it from the strip', async () => {
    await withJoinery(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'joinery_test');
      await openNewQueryTab(app, window);
      await openAdditionalQueryTab(app, window, '-- one\n');

      const tabs = window.locator('.lm_tab');
      const query2 = tabs.filter({ hasText: 'Query 2' });
      await expect(query2).toBeVisible();
      await query2.locator('.lm_close_tab').click();
      await expect(tabs.filter({ hasText: 'Query 2' })).toHaveCount(0, { timeout: 5000 });
      await expect(tabs.filter({ hasText: 'Query 1' })).toBeVisible();
    });
  });
});
