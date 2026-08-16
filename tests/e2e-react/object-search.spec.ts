/**
 * The object search against the seeded PostgreSQL container.
 *
 * Two things need a live database rather than a fixture:
 *
 * 1. **the objects are the server's.** The four `explorer.getChildren` reads are the same calls the
 *    tree makes, so a search that found nothing here would mean the paths and the metadata handler
 *    disagree — which is exactly what a mocked test cannot tell you.
 * 2. **the reveal has to survive lazy loading.** Revealing `public.customers` expands server →
 *    database → schema → Tables, each an IPC round trip against the real server, and then scrolls to a
 *    row the virtualizer had never mounted. There is no way to fake that and learn anything.
 */

import { expect, test } from './fixtures';
import {
  closeOverlay,
  connectFromSidebar,
  createPostgresProfile,
  ensureJoineryTestSeeded,
  filterOverlay,
  gridRows,
  objectSearchRow,
  openObjectSearch,
  overlayRows,
  selectDatabase,
  treeRow,
  visibleSql,
  withJoineryReact,
} from '../helpers/joinery-actions-react';
import type { Page } from '@playwright/test';

const PROFILE = 'Test PG';

test.beforeAll(ensureJoineryTestSeeded);

async function connected(window: Page): Promise<void> {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, 'joinery_test');
}

test.describe('Joinery — finding a database object', () => {
  test('opens on ⌘P and lists the seeded tables', async () => {
    await withJoineryReact(async ({ window }) => {
      await connected(window);
      await openObjectSearch(window);

      // The four seeded tables of the public schema (`tests/fixtures/postgres/schema.sql`).
      for (const name of [
        'public.products',
        'public.customers',
        'public.orders',
        'public.order_items',
      ]) {
        await expect(objectSearchRow(window, name)).toBeVisible();
      }
      await expect(window.getByTestId('objsearch-count')).toContainText('joinery_test');
    });
  });

  test('ranks the exact match first and refuses an unrelated one', async () => {
    await withJoineryReact(async ({ window }) => {
      await connected(window);
      await openObjectSearch(window);

      await filterOverlay(window, 'objsearch', 'orders');
      await expect(
        overlayRows(window, 'objsearch').first().getByTestId('objsearch-row-name')
      ).toHaveText('public.orders');
      // "customers" shares five letters in order with "orders", which is enough for a distance-based
      // matcher and not enough for this one. That difference is the Angular search's noise, gone.
      await expect(objectSearchRow(window, 'public.customers')).toHaveCount(0);
    });
  });

  test('opens a table in a query tab and runs its capped SELECT', async () => {
    await withJoineryReact(async ({ window }) => {
      await connected(window);
      await openObjectSearch(window);

      await filterOverlay(window, 'objsearch', 'customers');
      const row = objectSearchRow(window, 'public.customers');
      // The promise is on the row BEFORE Enter: this one runs.
      await expect(row.getByTestId('objsearch-row-promise')).toHaveText('Top 1000');
      await row.click();

      // PostgreSQL quoting and `LIMIT`, not the T-SQL brackets and `TOP` the Angular version emitted on
      // every engine.
      await expect
        .poll(() => visibleSql(window), { timeout: 20_000 })
        .toContain('SELECT * FROM "public"."customers" LIMIT 1000');
      await expect(gridRows(window).first()).toBeVisible({ timeout: 20_000 });
      await expect(window.getByTestId('status-executing')).toBeHidden({ timeout: 20_000 });
    });
  });

  test('reveals an object in the explorer tree with ⌘⏎', async () => {
    await withJoineryReact(async ({ window }) => {
      await connected(window);
      // Nothing under the server node is expanded yet, which is the state the reveal has to work from.
      await expect(treeRow(window, 'order_items')).toHaveCount(0);

      await openObjectSearch(window);
      await filterOverlay(window, 'objsearch', 'order_items');
      await expect(objectSearchRow(window, 'public.order_items')).toBeVisible();
      await window.keyboard.press('ControlOrMeta+Enter');

      // Four lazy expands and a scroll later, the row is in the tree and selected. This is Task 6's
      // `TreeHandle.scrollToId` doing the part only it can do.
      await expect(treeRow(window, 'order_items')).toBeVisible({ timeout: 20_000 });
      await expect(treeRow(window, 'order_items')).toHaveAttribute('aria-selected', 'true');
      // And the chord revealed INSTEAD of opening: no query tab was created by it.
      await expect(window.getByTestId('query-panel')).toHaveCount(0);
    });
  });

  test('reveals from the row’s own button too, and does not open a tab', async () => {
    await withJoineryReact(async ({ window }) => {
      await connected(window);
      await openObjectSearch(window);

      await filterOverlay(window, 'objsearch', 'products');
      await objectSearchRow(window, 'public.products').getByTestId('objsearch-row-reveal').click();

      await expect(treeRow(window, 'products')).toBeVisible({ timeout: 20_000 });
      await expect(window.getByTestId('query-panel')).toHaveCount(0);
    });
  });

  test('says what is missing when nothing is connected', async () => {
    await withJoineryReact(async ({ window }) => {
      await window.keyboard.press('ControlOrMeta+p');
      await expect(window.getByTestId('objsearch-overlay')).toBeVisible();
      await expect(window.getByTestId('objsearch-disconnected')).toContainText(
        'Connect to a server'
      );
      await closeOverlay(window, 'objsearch');
    });
  });
});
