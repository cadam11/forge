/**
 * The React explorer tree, against the seeded PostgreSQL container.
 *
 * Replaces `tests/e2e/explorer.spec.ts`, which asserted one thing — "clicking the database node
 * produced more `.tree-item` elements than there were before" — and asserted it through three
 * locators that no longer exist (`app-sidebar`, `.tree-container`, `.tree-item`). Its comment said
 * it avoided naming schemas or tables because the tree shape "is part of Joinery's UX policy and
 * may change". The shape is now fixed by `state/explorer.ts` and `state/explorer-folders.ts`
 * (server ▸ database ▸ schema ▸ folder ▸ object), so this walks the whole chain and names what it
 * expects at each level. A tree that silently stopped fetching one level down used to pass.
 *
 * The lazy contract is the first assertion, not an afterthought: after connecting there is exactly
 * ONE row. The Angular tree eagerly rendered every loaded branch, so "one row" was never a
 * statement anyone could make about it.
 */

import { expect, test } from './fixtures';
import {
  createPostgresProfile,
  ensureJoineryTestSeeded,
  expandTreeRow,
  connectFromSidebar,
  selectDatabase,
  serverRows,
  treeRow,
  treeRows,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Test PG';
/** Seeded by `tests/fixtures/postgres/schema.sql`. */
const SEEDED_TABLES = ['products', 'customers', 'orders', 'order_items'];

test.beforeAll(ensureJoineryTestSeeded);

test.describe('Joinery (React) — explorer tree', () => {
  test('lazily reveals schemas, folders and the seeded tables', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);

      // Connecting adds the server node and expands it, so its databases are the first level
      // fetched. Nothing below them is: a schema row would mean the tree fetched ahead.
      await expect(serverRows(window)).toHaveCount(1);
      await expect(treeRow(window, 'joinery_test')).toBeVisible();
      await expect(treeRows(window).filter({ hasText: 'app_meta' })).toHaveCount(0);
      await expect(treeRow(window, 'joinery_test')).toHaveAttribute('aria-expanded', 'false');

      // database ▸ schemas
      await expandTreeRow(window, 'joinery_test');
      await expect(treeRow(window, 'public')).toBeVisible();
      await expect(treeRow(window, 'app_meta')).toBeVisible();

      // schema ▸ capability-gated folders. PostgreSQL supports stored procedures, so all four
      // appear (`state/explorer-folders.ts`).
      await expandTreeRow(window, 'public');
      for (const folder of ['Tables', 'Views', 'Stored Procedures', 'Functions']) {
        await expect(treeRow(window, folder)).toBeVisible();
      }

      // folder ▸ objects
      await expandTreeRow(window, 'Tables');
      for (const table of SEEDED_TABLES) {
        await expect(treeRow(window, table)).toBeVisible();
      }
    });
  });

  test('expands a table into its columns, indexes, keys, constraints and triggers', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, 'joinery_test');

      await expandTreeRow(window, PROFILE);
      await expandTreeRow(window, 'joinery_test');
      await expandTreeRow(window, 'public');
      await expandTreeRow(window, 'Tables');
      await expandTreeRow(window, 'orders');

      // The five table sub-folders, all of which PostgreSQL supports.
      for (const folder of ['Columns', 'Indexes', 'Keys', 'Constraints', 'Triggers']) {
        await expect(treeRow(window, folder)).toBeVisible();
      }

      // And one level deeper, which is where a per-table metadata query would fail silently.
      // `orders(id, customer_id, order_date, status, total_cents)` per the fixture schema.
      await expandTreeRow(window, 'Columns');
      await expect(treeRows(window).filter({ hasText: 'customer_id' })).not.toHaveCount(0);
      await expect(treeRows(window).filter({ hasText: 'total_cents' })).not.toHaveCount(0);
    });
  });

  test('double-clicking a table opens its object tab', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);

      await expandTreeRow(window, PROFILE);
      await expandTreeRow(window, 'joinery_test');
      await expandTreeRow(window, 'public');
      await expandTreeRow(window, 'Tables');

      await treeRow(window, 'products').dblclick();

      // The wire from the tree's `onActivate` through `tabStore.openObjectTab` to a mounted dock
      // panel. What that panel then SHOWS is `object-detail.spec.ts` — Task 19a replaced the
      // placeholder with the real surface.
      await expect(window.getByTestId('panel-object')).toBeVisible({ timeout: 10_000 });
      await expect(window.getByTestId('object-title')).toHaveText('public.products', {
        timeout: 20_000,
      });
    });
  });

  test('offers the table context menu and refuses nothing on a capable engine', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);

      await expandTreeRow(window, PROFILE);

      // The database node's menu is the capability-gated one: PostgreSQL supports backup and
      // restore (pg_dump / pg_restore), so neither item may be disabled here.
      await treeRow(window, 'joinery_test').click({ button: 'right' });
      const menu = window.getByTestId('sidebar-node-menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByTestId('sidebar-menu-backup')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      );
      await expect(menu.getByTestId('sidebar-menu-restore')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      );
      // `joinery_test` is not a SQL Server system database, so it is manageable.
      await expect(menu.getByTestId('sidebar-menu-rename-database')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      );

      // Opening the menu selects the row it belongs to.
      await expect(treeRow(window, 'joinery_test')).toHaveAttribute('aria-selected', 'true');
    });
  });
});
