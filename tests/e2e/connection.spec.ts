/**
 * Connection flow E2E specs — adapted from the legacy 31-test audit's
 * "Connection & Setup" + "Explorer Tree" + "Status Bar" sections.
 *
 * Uses the seeded postgres test container instead of the legacy MSSQL
 * fixture database (which the legacy audit assumed). Each test launches fresh Electron
 * with isolated user-data so saves don't leak between specs.
 */

import { expect, test } from '@playwright/test';
import { withForge } from '../helpers/electron-app';
import {
  connectToTestPostgres,
  ensureForgeTestSeeded,
  selectDatabase,
} from '../helpers/forge-actions';

test.beforeAll(ensureForgeTestSeeded);

test.describe('Forge — connection flow', () => {
  test('connects to test postgres and shows the explorer tree', async () => {
    await withForge(async ({ window }) => {
      await connectToTestPostgres(window);
      // Sidebar should show the connection name.
      await expect(window.locator('app-sidebar').getByText('Test PG').first()).toBeVisible();
      // Explorer tree should show both the seeded forge_test database and
      // the default postgres database that ships in every PG container.
      const tree = window.locator('app-sidebar .explorer-tree, app-explorer');
      await expect(tree.getByText('forge_test').first()).toBeVisible();
      await expect(tree.getByText('postgres').first()).toBeVisible();
    });
  });

  test('database picker selects forge_test', async () => {
    await withForge(async ({ window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      // After selection the picker button label should reflect the choice.
      const picker = window.locator('app-sidebar .database-selector button').first();
      await expect(picker).toContainText('forge_test', { timeout: 5000 });
    });
  });

  test('status bar shows the active connection name', async () => {
    await withForge(async ({ window }) => {
      await connectToTestPostgres(window);
      // Forge's status bar lives at the bottom of the shell. It surfaces
      // the connection name once connected.
      const statusBar = window.locator('app-status-bar, [class*="status-bar"]').first();
      await expect(statusBar).toBeVisible();
      await expect(statusBar).toContainText('Test PG', { timeout: 5000 });
    });
  });
});
