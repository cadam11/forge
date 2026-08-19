/**
 * The explorer object tab, against the seeded PostgreSQL container.
 *
 * The Angular explorer tab had no e2e coverage, and the two things this spec names are exactly the two
 * it could not have shown: **the identity flag** and **where a column points**. Both come from
 * `explorer.getEnrichedColumns`, which the Angular tab did not call — it read `getTableColumns`, whose
 * `ColumnInfo` carries neither.
 *
 * Every value asserted here is a fact about `tests/fixtures/postgres/schema.sql` rather than a shape
 * discovered at runtime: `order_items(id, order_id, product_id, quantity, price_cents)` with two
 * foreign keys, one of them `ON DELETE CASCADE`. A tab that rendered four empty tables used to be indistinguishable from a correct one.
 */

import { expect, test, type Page } from '@playwright/test';
import {
  connectFromSidebar,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  expandTreeRow,
  objectDetailRows,
  objectPanel,
  objectRowCells,
  openObjectDetail,
  openObjectSection,
  selectDatabase,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Test PG';

/** Connect and walk the tree down to the Tables folder. */
async function openTables(window: Page): Promise<void> {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, 'joinery_test');
  await dismissToasts(window);
  await expandTreeRow(window, PROFILE);
  await expandTreeRow(window, 'joinery_test');
  await expandTreeRow(window, 'public');
  await expandTreeRow(window, 'Tables');
}

/** The row of whichever section is on screen whose first cell is `name`. */
function detailRow(window: Page, name: string) {
  return objectDetailRows(window).filter({ has: window.locator(`td:text-is("${name}")`) });
}

test.beforeAll(ensureJoineryTestSeeded);

test.describe('Joinery (React) — object detail tab', () => {
  test('shows the real columns, including the identity and the references', async () => {
    await withJoineryReact(async ({ window }) => {
      await openTables(window);
      const panel = await openObjectDetail(window, 'order_items');

      await expect(panel.getByTestId('object-title')).toHaveText('public.order_items');
      await expect(panel.getByTestId('object-type')).toHaveText('table');

      // Five columns per the fixture schema. The count is on the tab label too, derived from the same
      // fetch, so a mismatch between them would be a rendering bug rather than a data one.
      await expect(objectDetailRows(window)).toHaveCount(5);
      await expect(panel.getByTestId('object-tab-columns')).toContainText('5');

      // `id` is the primary key AND the identity — the second is what `getTableColumns` could not say.
      const idCells = await objectRowCells(detailRow(window, 'id').first());
      expect(idCells[0]).toBe('id');
      expect(idCells[2]).toBe('no'); // not nullable
      expect(idCells[3]).toContain('PK');
      expect(idCells[3]).toContain('identity');

      // `order_id` points at `public.orders.id` — the other thing the old reader could not report.
      const orderCells = await objectRowCells(detailRow(window, 'order_id').first());
      expect(orderCells[5]).toBe('public.orders.id');

      const productCells = await objectRowCells(detailRow(window, 'product_id').first());
      expect(productCells[5]).toBe('public.products.id');
    });
  });

  test('lists indexes and whole foreign-key constraints on their own tabs', async () => {
    await withJoineryReact(async ({ window }) => {
      await openTables(window);
      await openObjectDetail(window, 'order_items');

      await openObjectSection(window, 'indexes');
      // The primary key's index, whatever PostgreSQL called it — named by its columns, not its name.
      await expect(objectDetailRows(window)).not.toHaveCount(0);
      await expect(objectPanel(window)).toContainText('id');

      await openObjectSection(window, 'keys');
      // Two constraints, each a WHOLE constraint with its target — which per-column FK badges on the
      // Columns tab cannot express, and which is why this tab exists.
      await expect(objectDetailRows(window)).toHaveCount(2);
      await expect(objectPanel(window)).toContainText('public.orders (id)');
      await expect(objectPanel(window)).toContainText('public.products (id)');
      // And the referential action the fixture declares, which is per-CONSTRAINT information.
      await expect(objectPanel(window)).toContainText('ON DELETE CASCADE');
    });
  });

  test('has no Definition tab for a table, and offers Script as CREATE instead', async () => {
    // The fixture schema declares no views, functions or procedures, so the *presence* of a definition
    // is not assertable here — the unit spec covers a procedure against a double. What IS assertable,
    // and is the decision this file records, is the absence: a table's definition IS its columns, and
    // the Angular tab rendered the section anyway with a paragraph explaining that it was empty.
    await withJoineryReact(async ({ window }) => {
      await openTables(window);
      await openObjectDetail(window, 'order_items');

      await expect(objectPanel(window).getByTestId('object-tab-definition')).toHaveCount(0);
      await expect(objectPanel(window).getByTestId('object-script-create')).toBeVisible();
    });
  });

  test('re-reads the object from the server on Refresh', async () => {
    await withJoineryReact(async ({ window }) => {
      await openTables(window);
      await openObjectDetail(window, 'customers');
      const before = await objectDetailRows(window).count();
      expect(before).toBeGreaterThan(0);

      await objectPanel(window).getByTestId('object-refresh').click();

      // The rows come back — the assertion is that invalidating the query re-fetches rather than
      // emptying the tables, which is what a refresh that dropped the cache without refetching would do.
      await expect(objectDetailRows(window)).toHaveCount(before, { timeout: 20_000 });
    });
  });

  test('opens two object tabs, each holding its own object', async () => {
    // The Angular component was a singleton watching the ACTIVE tab, so the second object replaced the
    // first one's data. Two tabs, two sets of columns.
    await withJoineryReact(async ({ window }) => {
      await openTables(window);
      await openObjectDetail(window, 'order_items');
      await expect(objectPanel(window).getByTestId('object-title')).toHaveText(
        'public.order_items'
      );

      await openObjectDetail(window, 'products');
      await expect(objectPanel(window).getByTestId('object-title')).toHaveText('public.products');

      // Back to the first tab, addressed by the title the dock's tab strip renders.
      await window
        .locator('[data-tab-type="object"]')
        .filter({ hasText: 'order_items' })
        .first()
        .click();
      await expect(objectPanel(window).getByTestId('object-title')).toHaveText(
        'public.order_items'
      );
      await expect(objectDetailRows(window)).toHaveCount(5);
    });
  });
});
