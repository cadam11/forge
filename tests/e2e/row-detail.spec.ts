/**
 * Row-detail drawer vs. grid display order.
 *
 * Regression spec: after sorting (or quick-filtering) the results grid,
 * clicking a row must open the detail drawer for the row the user actually
 * clicked — the DISPLAYED row — not the row occupying the same index in the
 * original, unsorted result set. Next/Previous must likewise walk the
 * displayed order.
 *
 * Seed facts used (tests/fixtures/postgres/seed.sql, products table):
 *   - Original order row 1: MacBook Air M4 (SKU-LAPTOP-01), row 2: MacBook Pro 14.
 *   - Sorted by price_cents ascending, row 1 becomes The Pragmatic Programmer
 *     (SKU-BOOK-02, 3999) and row 2 Designing Data-Intensive Applications
 *     (SKU-BOOK-01, 4499).
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

test.describe('Forge — row detail drawer', () => {
  test('drawer shows the clicked displayed row after sorting, and navigates in displayed order', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);
      await typeInEditor(window, 'SELECT id, sku, name, price_cents FROM products ORDER BY id;');
      await executeQuery(window);

      await expect(window.getByText(/10 rows/i).first()).toBeVisible({ timeout: 15000 });

      // Sort ascending by price. Cheapest product moves to displayed row 1.
      await window
        .locator('.ag-header-cell-label')
        .filter({ hasText: 'price_cents' })
        .first()
        .click();
      const firstDisplayedRow = window.locator('.ag-center-cols-container .ag-row[row-index="0"]');
      await expect(firstDisplayedRow).toContainText('The Pragmatic Programmer', {
        timeout: 5000,
      });

      // Click the first displayed row → drawer must show THAT row.
      await window
        .locator('.ag-cell')
        .filter({ hasText: 'The Pragmatic Programmer' })
        .first()
        .click();

      const drawer = window.locator('.detail-panel');
      await expect(drawer).toBeVisible({ timeout: 5000 });
      await expect(drawer).toContainText('Row 1 Details');
      await expect(drawer).toContainText('SKU-BOOK-02');
      // The bug showed original row 1 (MacBook Air M4) instead.
      await expect(drawer).not.toContainText('MacBook Air M4');

      // Next must move to displayed row 2 (DDIA), not original row 2 (MacBook Pro 14).
      await drawer.getByRole('button', { name: /next/i }).click();
      await expect(drawer).toContainText('Row 2 Details');
      await expect(drawer).toContainText('SKU-BOOK-01');
      await expect(drawer).not.toContainText('MacBook Pro 14');
    });
  });
});
