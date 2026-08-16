/**
 * The row-detail rail against the seeded PostgreSQL container: the row a user clicked, the order
 * Next/Previous walk, and a foreign key followed to a real referenced row.
 *
 * ── The two things only this tier can prove ───────────────────────────────────────────────────
 *
 * 1. **Displayed order.** `tests/e2e/row-detail.spec.ts` (the Angular spec, still green against the
 *    Angular renderer) was written for a bug: after a sort, displayed row N is not `resultSet.rows[N]`,
 *    so a drawer indexing the original array showed a different row than the one clicked. The React
 *    rail asks the grid instead, and this is where "asks the grid" is checked against a real AG Grid
 *    that has really sorted.
 *
 * 2. **Foreign keys that exist in a real catalogue.** `orders.customer_id` REFERENCES `customers(id)`
 *    in `tests/fixtures/postgres/schema.sql`, and a PostgreSQL result set carries none of that — the
 *    main process enriches columns on the MSSQL path only. So the badge, the link and the preview all
 *    depend on the renderer resolving the queried table and reading the catalogue itself
 *    (`fk-lookup.ts`), against a database where the FK is real and the referenced row is seeded.
 *
 * Seed facts used (`tests/fixtures/postgres/seed.sql`):
 *   - products: 10 rows. By `price_cents` ascending, row 1 is The Pragmatic Programmer (SKU-BOOK-02,
 *     3999) and row 2 Designing Data-Intensive Applications (SKU-BOOK-01, 4499). In `id` order, row 1
 *     is MacBook Air M4 and row 2 MacBook Pro 14 — the rows the bug showed instead.
 *   - orders: 8 rows; order 1 belongs to customer 1, who is Alice Anderson <alice@example.com>.
 */

import { expect, test } from './fixtures';
import {
  connectFromSidebar,
  createPostgresProfile,
  ensureJoineryTestSeeded,
  executeQuery,
  gridColumnValues,
  openQueryTab,
  openRowDetail,
  previewForeignKey,
  resultsGrid,
  rowDetailField,
  rowDetailFields,
  rowDetailPanel,
  selectDatabase,
  sortGridColumn,
  typeSql,
  withJoineryReact,
} from '../helpers/joinery-actions-react';
import type { Page } from '@playwright/test';

const PROFILE = 'Test PG';

const PRODUCTS_SQL = 'SELECT id, sku, name, price_cents FROM products ORDER BY id';
const ORDERS_SQL = 'SELECT id, customer_id, status, total_cents FROM orders ORDER BY id';

test.beforeAll(ensureJoineryTestSeeded);

async function readyEditor(window: Page) {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, 'joinery_test');
  return openQueryTab(window);
}

async function run(window: Page, sql: string): Promise<void> {
  await typeSql(window, sql);
  await executeQuery(window);
  await expect(resultsGrid(window).locator('.ag-row').first()).toBeVisible({ timeout: 20_000 });
}

test.describe('Joinery (React) — the row-detail rail', () => {
  test('opens on the row that was double-clicked, and reads it vertically', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await run(window, PRODUCTS_SQL);

      const rail = await openRowDetail(window, 0);

      expect(await rowDetailFields(window)).toEqual(['id', 'sku', 'name', 'price_cents']);
      await expect(rail.getByTestId('rowdetail-title')).toContainText('Row 1 of 10');
      await expect(rowDetailField(window, 'sku')).toContainText('SKU-LAPTOP-01');
      await expect(rowDetailField(window, 'name')).toContainText('MacBook Air M4');
    });
  });

  test('shows the clicked DISPLAYED row after a sort, and navigates in displayed order', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await run(window, PRODUCTS_SQL);

      // Ascending by price: the cheapest product becomes displayed row 1.
      await sortGridColumn(window, 'price_cents');
      await expect
        .poll(() => gridColumnValues(window, 'sku'), { timeout: 10_000 })
        .toEqual([
          'SKU-BOOK-02',
          'SKU-BOOK-01',
          'SKU-COFFEE-02',
          'SKU-CHAIR-01',
          'SKU-DESK-01',
          'SKU-PHONE-01',
          'SKU-COFFEE-01',
          'SKU-PHONE-02',
          'SKU-LAPTOP-01',
          'SKU-LAPTOP-02',
        ]);

      const rail = await openRowDetail(window, 0);

      await expect(rail.getByTestId('rowdetail-title')).toContainText('Row 1 of 10');
      await expect(rowDetailField(window, 'sku')).toContainText('SKU-BOOK-02');
      // The bug showed the original row 1 here.
      await expect(rail).not.toContainText('MacBook Air M4');

      await rail.getByTestId('rowdetail-next').click();

      await expect(rail.getByTestId('rowdetail-title')).toContainText('Row 2 of 10');
      await expect(rowDetailField(window, 'sku')).toContainText('SKU-BOOK-01');
      await expect(rail).not.toContainText('MacBook Pro 14');

      // And back, which is the same walk in reverse.
      await rail.getByTestId('rowdetail-previous').click();
      await expect(rowDetailField(window, 'sku')).toContainText('SKU-BOOK-02');
      await expect(rail.getByTestId('rowdetail-previous')).toBeDisabled();
    });
  });

  test('follows orders.customer_id to the customer it references', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await run(window, ORDERS_SQL);
      await openRowDetail(window, 0);

      // The FK badge comes from the catalogue: PostgreSQL's result columns carry no reference at all.
      await expect(
        rowDetailField(window, 'customer_id').getByTitle('References public.customers.id')
      ).toBeVisible({ timeout: 20_000 });
      // `id` is the primary key, and that is catalogue knowledge too.
      await expect(rowDetailField(window, 'id').getByTitle('Primary key')).toBeVisible();

      const preview = await previewForeignKey(window, 'customer_id');

      await expect(preview.getByTestId('rowdetail-fk-target')).toHaveText('public.customers');
      // Order 1 belongs to customer 1 — Alice, from the seed.
      await expect(preview).toContainText('alice@example.com', { timeout: 20_000 });
      await expect(preview).toContainText('Alice Anderson');
    });
  });

  test('opens the referenced row in its own tab, and it executes', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await run(window, ORDERS_SQL);
      await openRowDetail(window, 0);
      await expect(
        rowDetailField(window, 'customer_id').getByTestId('rowdetail-fk-open')
      ).toBeVisible({ timeout: 20_000 });

      await rowDetailField(window, 'customer_id').getByTestId('rowdetail-fk-open').click();

      // The new tab is named after the reference and auto-executes, so the ONE referenced row is on
      // screen without the user pressing anything.
      await expect(window.getByTestId('results-row-count')).toHaveText('1', { timeout: 30_000 });
      await expect
        .poll(() => gridColumnValues(window, 'email'), { timeout: 20_000 })
        .toEqual(['alice@example.com']);
      await expect(window.getByTestId('query-context')).toContainText('joinery_test');
    });
  });

  test('a NULL cell has nothing to follow, and says NULL', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      // `NULLIF` gives a genuine NULL in a column the catalogue still knows nothing about.
      await run(
        window,
        'SELECT id, customer_id, NULLIF(status, status) AS missing FROM orders ORDER BY id'
      );
      await openRowDetail(window, 0);

      await expect(rowDetailField(window, 'missing').getByTestId('rowdetail-null')).toHaveText(
        'NULL'
      );
      await expect(rowDetailField(window, 'missing').getByTestId('rowdetail-fk-link')).toHaveCount(
        0
      );
    });
  });

  test('closes on Escape, leaving the grid where it was', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await run(window, PRODUCTS_SQL);
      await openRowDetail(window, 0);

      await window.keyboard.press('Escape');

      await expect(rowDetailPanel(window)).toBeHidden();
      await expect(window.getByTestId('results-row-count')).toHaveText('10');
    });
  });
});
