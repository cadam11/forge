/**
 * Explorer-tree E2E spec — covers the legacy 31-test audit's test 5
 * (tree expansion reveals schema / table nodes).
 *
 * Connects to the seeded joinery_test PG database and clicks the database
 * tree node to expand it. Asserts that child nodes appear (schemas and/or
 * the seeded tables: products, customers, orders, order_items).
 */

import { expect, test } from '@playwright/test';
import { withJoinery } from '../helpers/electron-app';
import {
  connectToTestPostgres,
  ensureJoineryTestSeeded,
  selectDatabase,
} from '../helpers/joinery-actions';

test.beforeAll(ensureJoineryTestSeeded);

test.describe('Joinery — explorer tree', () => {
  test('expanding the joinery_test node reveals child schema/table nodes', async () => {
    await withJoinery(async ({ window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'joinery_test');

      const tree = window.locator('app-sidebar .tree-container');
      await expect(tree).toBeVisible({ timeout: 10000 });

      // Count tree items before expansion. The database node is one of them.
      const itemsBefore = await tree.locator('.tree-item').count();
      expect(itemsBefore).toBeGreaterThan(0);

      // Click the joinery_test node to expand it. Filter by visible text so
      // we hit the right row even if other databases are listed too.
      const dbNode = tree.locator('.tree-item').filter({ hasText: 'joinery_test' }).first();
      await expect(dbNode).toBeVisible();
      await dbNode.click();

      // After expansion the tree should have more items than before. We
      // don't assert specific schema/table names because the exact tree
      // shape (schemas-first vs tables-first) is part of Joinery's UX policy
      // and may change — we just want to know expansion produced children.
      await expect
        .poll(() => tree.locator('.tree-item').count(), { timeout: 5000 })
        .toBeGreaterThan(itemsBefore);
    });
  });
});
