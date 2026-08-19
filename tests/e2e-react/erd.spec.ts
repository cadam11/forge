/**
 * The ERD tab against the seeded PostgreSQL container.
 *
 * There is no Angular predecessor for this spec, and the reason is itself a finding: the Angular ERD
 * had no e2e coverage at all, and one of its two entry points — the whole-database diagram — asked the
 * explorer for a `'Tables'` path the main process does not match, so it always drew an empty diagram.
 * A test at this level would have caught it in a line. Both entry points are covered here.
 *
 * The seeded schema (`tests/fixtures/postgres/schema.sql`) gives three known FK pairs:
 * `orders → customers`, `order_items → orders`, `order_items → products`. They are named, not
 * discovered — a diagram that silently drew no edges used to be indistinguishable from one that drew
 * the right ones.
 */

import { expect, test, type Page } from '@playwright/test';
import {
  connectFromSidebar,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  erdCanvas,
  erdDetails,
  erdEdge,
  erdNode,
  erdNodes,
  erdPanel,
  erdTransform,
  erdZoomLevel,
  expandTreeRow,
  openPalette,
  openRelationships,
  paletteRowState,
  runPaletteCommand,
  selectDatabase,
  treeRow,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Test PG';
const SEEDED_TABLES = ['products', 'customers', 'orders', 'order_items'];

test.beforeAll(ensureJoineryTestSeeded);

/** Connect, select the database, and walk the tree down to the Tables folder. */
async function openTables(window: Page): Promise<void> {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, 'joinery_test');
  await expandTreeRow(window, PROFILE);
  await expandTreeRow(window, 'joinery_test');
  await expandTreeRow(window, 'public');
  await expandTreeRow(window, 'Tables');
}

test.describe('Joinery (React) — ERD', () => {
  test('draws the focused table, its parents and the FK edges between them', async () => {
    await withJoineryReact(async ({ window }) => {
      await openTables(window);
      await openRelationships(window, 'order_items');

      // `focusDepth: 2` from `openErdTab`: order_items, its two parents, and customers beyond orders.
      await expect(erdNode(window, 'public.order_items')).toBeVisible();
      await expect(erdNode(window, 'public.orders')).toBeVisible();
      await expect(erdNode(window, 'public.products')).toBeVisible();
      await expect(erdNode(window, 'public.customers')).toBeVisible();

      // The three seeded relationships, each asserted by its endpoints.
      await expect(erdEdge(window, 'public.order_items', 'public.orders')).toHaveCount(1);
      await expect(erdEdge(window, 'public.order_items', 'public.products')).toHaveCount(1);
      await expect(erdEdge(window, 'public.orders', 'public.customers')).toHaveCount(1);

      // The tab it landed in is titled after the table it was opened from.
      await expect(erdPanel(window).getByTestId('erd-toolbar')).toContainText(
        'Relationships: order_items'
      );
    });
  });

  test('opens with the focused table selected and its columns listed', async () => {
    await withJoineryReact(async ({ window }) => {
      await openTables(window);
      await openRelationships(window, 'orders');

      await expect(erdNode(window, 'public.orders')).toHaveAttribute(
        'data-erd-node-state',
        'selected'
      );
      // Its immediate FK neighbour is marked, which is the diagram's whole highlight vocabulary.
      await expect(erdNode(window, 'public.customers')).toHaveAttribute(
        'data-erd-node-state',
        'related'
      );

      // The rail lists every column, not only the keys the box shows.
      const rail = erdDetails(window);
      await expect(rail).toBeVisible();
      await expect(rail.getByTestId('erd-column-row')).toHaveCount(5);
      await expect(rail).toContainText('total_cents');
    });
  });

  test('draws every seeded table for a whole-database diagram, opened from the palette', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, 'joinery_test');

      // The command Task 16 registered and this task claimed. It must no longer read as unowned.
      await openPalette(window);
      expect(await paletteRowState(window, 'command:open-erd')).toBe('ready');
      await runPaletteCommand(window, 'command:open-erd');

      await expect(erdPanel(window)).toBeVisible({ timeout: 15_000 });
      await expect(erdNodes(window).first()).toBeVisible({ timeout: 15_000 });

      for (const table of SEEDED_TABLES) {
        await expect(erdNode(window, `public.${table}`)).toBeVisible();
      }
      await expect(erdPanel(window).getByTestId('erd-toolbar')).toContainText(
        'Database ERD: joinery_test'
      );
    });
  });

  test('pans and zooms', async () => {
    await withJoineryReact(async ({ window }) => {
      await openTables(window);
      await openRelationships(window, 'order_items');

      // Fit-on-load has already run against a real, measured viewport, so this is not the identity.
      const fitted = await erdTransform(window);
      expect(fitted).toMatch(/translate\(/);

      const fittedZoom = await erdZoomLevel(window);
      await erdPanel(window).getByTestId('erd-zoom-in').click();
      await expect.poll(async () => erdZoomLevel(window), { timeout: 5_000 }).not.toBe(fittedZoom);
      const zoomedIn = await erdTransform(window);
      expect(zoomedIn).not.toBe(fitted);

      // A drag on the background pans. The transform is written imperatively, so this asserts the
      // one mechanism a React-owned attribute would have broken.
      //
      // The gesture starts in the canvas's LOWER-LEFT, and both halves of that are load-bearing: the
      // lower band is below the fitted diagram (a press on a box is that box's click, by design), and
      // the left avoids the bottom-RIGHT corner, where Sonner stacks its toasts — a connection toast
      // over that corner is what swallowed the first version of this drag.
      await dismissToasts(window);
      const box = await erdCanvas(window).boundingBox();
      expect(box).not.toBeNull();
      if (box !== null) {
        await window.mouse.move(box.x + 60, box.y + box.height - 60);
        await window.mouse.down();
        await window.mouse.move(box.x + 180, box.y + box.height - 140, { steps: 8 });
        await window.mouse.up();
      }

      await expect.poll(async () => erdTransform(window), { timeout: 5_000 }).not.toBe(zoomedIn);

      // Fit puts it back to a whole-diagram view.
      await erdPanel(window).getByTestId('erd-zoom-fit').click();
      await expect.poll(async () => erdZoomLevel(window), { timeout: 5_000 }).toMatch(/^\d+%$/);
    });
  });

  test('a wheel over the canvas zooms about the cursor', async () => {
    await withJoineryReact(async ({ window }) => {
      await openTables(window);
      await openRelationships(window, 'order_items');
      const before = await erdZoomLevel(window);

      const box = await erdCanvas(window).boundingBox();
      expect(box).not.toBeNull();
      if (box !== null) {
        await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await window.mouse.wheel(0, -400);
      }

      // The listener is attached by hand with `{ passive: false }` precisely so this works — a React
      // `onWheel` prop is passive and could not have prevented the page-zoom default.
      await expect.poll(async () => erdZoomLevel(window), { timeout: 5_000 }).not.toBe(before);
    });
  });

  test('double-clicking a table opens its object tab', async () => {
    await withJoineryReact(async ({ window }) => {
      await openTables(window);
      await openRelationships(window, 'order_items');

      await erdNode(window, 'public.orders').dblclick();

      // Task 19's placeholder; what is asserted is the wire from a node to `openObjectTab`.
      await expect(window.getByTestId('panel-object')).toBeVisible({ timeout: 10_000 });
    });
  });

  test('the rail reveals a table in the explorer', async () => {
    await withJoineryReact(async ({ window }) => {
      await openTables(window);
      await openRelationships(window, 'order_items');

      await erdNode(window, 'public.customers').click();
      const rail = erdDetails(window);
      await expect(rail).toContainText('customers');
      await rail.getByTestId('erd-details-reveal').click();

      // The existing reveal wire: the tree expands to the object and selects it.
      await expect(treeRow(window, 'customers')).toHaveAttribute('aria-selected', 'true', {
        timeout: 10_000,
      });
    });
  });

  test('refresh redraws the same diagram deterministically', async () => {
    await withJoineryReact(async ({ window }) => {
      await openTables(window);
      await openRelationships(window, 'order_items');

      const positions = async () =>
        erdNodes(window).evaluateAll(nodes =>
          nodes
            .map(
              node =>
                `${node.getAttribute('data-erd-node-id')}@${node.getAttribute('transform') ?? ''}`
            )
            .sort()
        );

      const before = await positions();
      await erdPanel(window).getByTestId('erd-refresh').click();
      await expect(erdNodes(window).first()).toBeVisible({ timeout: 15_000 });

      // The layout is a pure function of the schema, so a refresh must not reshuffle the boxes.
      await expect.poll(positions, { timeout: 10_000 }).toEqual(before);
    });
  });
});
