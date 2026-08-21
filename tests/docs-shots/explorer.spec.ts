/**
 * Documentation shots — the object explorer, an object's detail tab, and the relationship diagram.
 *
 * All three are driven against the seeded PostgreSQL container, so the content is the fixture schema
 * rather than a fake: `products`/`customers`/`orders`/`order_items`, and the FK web between them.
 * The diagram is a legitimate documentation subject for the same reason it is a legitimate baseline
 * subject in the visual tier — its layout is a pure function of the schema
 * (`features/erd/erd-layout.ts`: dagre with sorted inputs and `ranker` pinned), so it is the same
 * picture every run.
 *
 * ── One column is deliberately not in any of these ────────────────────────────────────────────
 *
 * `products.created_at` defaults to `NOW()` (`tests/fixtures/postgres/schema.sql`) and
 * `ensureJoineryTestSeeded` is idempotent, so its VALUES are the wall-clock time at which whoever
 * ran the harness first seeded the container — a different string on every machine, and a different
 * one again after `pnpm run test:harness:down`. The column NAME is fine and appears in the
 * object-detail shot, which is a picture of a schema; no shot in this set displays its values.
 */

import type { Page } from '@playwright/test';

import { blurFocus, capture, expect, test, withDocsApp } from './fixtures';
import { HERO_THEMES, PAGE_THEMES } from './catalogue';
import {
  connectFromSidebar,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  erdNode,
  erdNodes,
  erdPanel,
  expandTreeRow,
  objectDetailRows,
  openNodeMenu,
  openObjectDetail,
  openObjectSection,
  openRelationships,
  selectDatabase,
  treeRow,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Local Postgres';
const DATABASE = 'joinery_test';

test.beforeAll(ensureJoineryTestSeeded);

/** Connect, and walk the tree open to the table list every shot in this file starts from. */
async function openTableList(window: Page): Promise<void> {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, DATABASE);
  await dismissToasts(window);
  await expandTreeRow(window, DATABASE);
  await expandTreeRow(window, 'public');
  await expandTreeRow(window, 'Tables');
  await expect(treeRow(window, 'products')).toBeVisible();
}

for (const theme of PAGE_THEMES) {
  test.describe(`docs shots — explorer, ${theme}`, () => {
    test('the tree expanded to a table list', async () => {
      await withDocsApp(theme, async ({ window }) => {
        await openTableList(window);
        // The sidebar alone, not the window: the Object Explorer page is about the tree's own
        // hierarchy and node treatment, and framing the window would spend most of the image on the
        // empty workspace beside it.
        await blurFocus(window);
        await capture(
          window.getByTestId('sidebar'),
          'object-explorer',
          theme,
          'The sidebar tree expanded to a table list'
        );
      });
    });

    test("a table's columns", async () => {
      await withDocsApp(theme, async ({ window }) => {
        await openTableList(window);
        const panel = await openObjectDetail(window, 'products');
        await openObjectSection(window, 'columns');
        // Seven columns in the fixture's `products`. Asserted so the shot is of a loaded table
        // rather than of a panel that has mounted and is still fetching.
        await expect(objectDetailRows(window)).toHaveCount(7);
        await blurFocus(window);
        await capture(
          panel,
          'object-detail',
          theme,
          "A table's object-detail panel, columns section"
        );
      });
    });

    test('creating a database', async () => {
      await withDocsApp(theme, async ({ window }) => {
        await openTableList(window);

        // The picture `features/databases` needs. It used to be pointed at `object-detail`, which is
        // a table's column list — a mis-mapping that would have sent the page-integration task to
        // the wrong image (review m4). This is the create/rename dialog that page documents.
        const menu = await openNodeMenu(window, PROFILE);
        await menu.getByTestId('sidebar-menu-new-database').click();
        const dialog = window.getByTestId('create-database-dialog');
        await expect(dialog).toBeVisible();

        // Filled but NEVER submitted — the assertion below is what makes that a checked claim rather
        // than a hope, and it is why this shot leaves no database behind on the shared container.
        await window.getByTestId('database-name-input').fill('analytics_staging');
        await expect(window.getByTestId('database-dialog-submit')).toBeEnabled();
        await blurFocus(window);

        await capture(dialog, 'create-database', theme, 'The create-database dialog, name entered');

        await expect(dialog).toBeVisible();
      });
    });
  });
}

for (const theme of HERO_THEMES) {
  test.describe(`docs shots — relationships, ${theme}`, () => {
    test('the diagram for a focused table', async () => {
      await withDocsApp(theme, async ({ window }) => {
        await openTableList(window);
        const panel = await openRelationships(window, 'order_items');

        // `focusDepth: 2` draws the focused table, its two parents, and `customers` beyond `orders`.
        // Asserting all four are painted pins the shot to a finished layout rather than to a diagram
        // mid-load, which is the same gate `erd.spec.ts` uses.
        await expect(erdNodes(window)).toHaveCount(4);
        for (const table of ['order_items', 'orders', 'products', 'customers']) {
          await expect(erdNode(window, `public.${table}`)).toBeVisible();
        }
        // The zoom readout is the viewport's own statement that it has fitted the diagram.
        await expect(erdPanel(window).getByTestId('erd-zoom-level')).toHaveText(/%$/);
        await dismissToasts(window);
        await blurFocus(window);

        await capture(panel, 'hero-erd', theme, 'The relationship diagram for a focused table');
      });
    });
  });
}
