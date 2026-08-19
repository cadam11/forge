/**
 * Visual baselines — the two panels that carry a vendor surface inside Joinery's own chrome.
 *
 * The query tab is Monaco above AG Grid, and the ERD tab is a hand-drawn SVG diagram; both are
 * captured as the whole PANEL, because the thing worth locking down is exactly the seam — the
 * toolbar above the vendor widget, the results tab strip, the diagram's toolbar and details rail. A
 * shot of the grid alone would compare AG Grid's rendering and nothing Joinery wrote.
 *
 * Both are driven against the seeded PostgreSQL container, so the content is the fixture schema
 * rather than a fake: `products` for the grid, and the `order_items → orders → customers` /
 * `order_items → products` FK web for the diagram. The ERD's layout is a pure function of the
 * schema (`features/erd/erd-layout.ts`: dagre with sorted inputs and `ranker` pinned), which is why
 * a diagram is a legitimate baseline subject at all.
 */

import type { Page } from '@playwright/test';

import { VISUAL_THEMES, expect, shoot, test, withVisualApp } from './fixtures';
import {
  connectFromSidebar,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  erdNode,
  erdNodes,
  erdPanel,
  executeQuery,
  expandTreeRow,
  gridColumnHeaders,
  gridRows,
  openQueryTab,
  openRelationships,
  selectDatabase,
  treeRow,
  typeSql,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Test PG';
const DATABASE = 'joinery_test';

/** A fixed ten rows of a fixed four columns — the result set has to be the same one every run. */
const QUERY = 'SELECT id, sku, name, price_cents\nFROM products\nORDER BY id\nLIMIT 10;';

test.beforeAll(ensureJoineryTestSeeded);

async function connectAndSelect(window: Page): Promise<void> {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, DATABASE);
  await dismissToasts(window);
}

for (const theme of VISUAL_THEMES) {
  test.describe(`Joinery (React) — workbench baselines, ${theme}`, () => {
    test('query tab with a populated results grid', async () => {
      await withVisualApp(theme, async ({ window }) => {
        await connectAndSelect(window);
        await openQueryTab(window);
        await typeSql(window, QUERY);
        await executeQuery(window);

        // The grid virtualizes and fills asynchronously, so "the run finished" is not "the rows are
        // drawn". Both the header set and the row count are asserted, which pins the shot to a grid
        // that has actually rendered the ten rows the LIMIT asked for.
        await expect(gridRows(window)).toHaveCount(10);
        expect(await gridColumnHeaders(window)).toEqual(['id', 'sku', 'name', 'price_cents']);
        await dismissToasts(window);

        await shoot(window.getByTestId('query-panel'), `query-results-${theme}.png`);
      });
    });

    test('ERD of the seeded schema', async () => {
      await withVisualApp(theme, async ({ window }) => {
        await connectAndSelect(window);
        await expandTreeRow(window, DATABASE);
        await expandTreeRow(window, 'public');
        await expandTreeRow(window, 'Tables');
        await expect(treeRow(window, 'order_items')).toBeVisible();

        const panel = await openRelationships(window, 'order_items');
        // `focusDepth: 2` draws the focused table, its two parents, and `customers` beyond `orders`.
        // Asserting all four are painted is what pins the shot to a finished layout rather than to a
        // diagram mid-load — `erd.spec.ts` covers the same four for the same reason.
        await expect(erdNodes(window)).toHaveCount(4);
        for (const table of ['order_items', 'orders', 'products', 'customers']) {
          await expect(erdNode(window, `public.${table}`)).toBeVisible();
        }
        // The zoom readout is the viewport's own statement that it has fitted the diagram.
        await expect(erdPanel(window).getByTestId('erd-zoom-level')).toHaveText(/%$/);
        await dismissToasts(window);

        await shoot(panel, `erd-relationships-${theme}.png`);
      });
    });
  });
}
