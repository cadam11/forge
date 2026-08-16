/**
 * The results grid against the seeded PostgreSQL container: sort, select, copy, filter, and the two
 * states that are not rows — the row cap and a query that matched nothing.
 *
 * This is the half of the query loop Task 10 could not cover: its results pane was a labelled slot, so
 * `query-toolbar.spec.ts` could only assert that a result *arrived*. What is new here is that the rows
 * are real, addressable and interactive, and that the bytes on the clipboard are the bytes a user's next
 * ⌘V pastes — read back through Electron's own clipboard module, not asserted from a toast.
 *
 * Locator policy: Joinery's chrome by `results-*` testid, AG Grid's internals structurally (the vendor
 * exemption in PLAN.md's test-hook rule). Both live in `tests/helpers/joinery-actions-react.ts`, which
 * also documents the two AG Grid 36 DOM facts these assertions depend on.
 */

import { expect, test } from './fixtures';
import {
  connectFromSidebar,
  copyGridSelection,
  createPostgresProfile,
  ensureJoineryTestSeeded,
  executeQuery,
  gridColumnHeaders,
  gridColumnValues,
  gridRows,
  gridSortState,
  openQueryTab,
  resultsGrid,
  selectDatabase,
  selectGridRow,
  sortGridColumn,
  typeSql,
  withJoineryReact,
} from '../helpers/joinery-actions-react';
import type { Page } from '@playwright/test';

const PROFILE = 'Test PG';

test.beforeAll(ensureJoineryTestSeeded);

async function readyEditor(window: Page) {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, 'joinery_test');
  return openQueryTab(window);
}

/** The five seeded customers, ordered by id. Small enough to assert exactly. */
const CUSTOMERS_SQL = 'SELECT id, email, full_name, country_code FROM customers ORDER BY id';

test.describe('Joinery (React) — the results grid', () => {
  test('renders the result’s columns and rows, and counts them', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await typeSql(window, CUSTOMERS_SQL);
      await executeQuery(window);

      await expect(resultsGrid(window)).toBeVisible();
      expect(await gridColumnHeaders(window)).toEqual(['id', 'email', 'full_name', 'country_code']);
      expect(await gridColumnValues(window, 'id')).toEqual(['1', '2', '3', '4', '5']);
      await expect(window.getByTestId('results-row-count')).toHaveText('5');
      await expect(window.getByTestId('results-column-count')).toHaveText('4 cols');
      // Nothing was capped, so the "showing first N of M" banner must not be there at all.
      await expect(window.getByTestId('results-truncated')).toHaveCount(0);
    });
  });

  test('sorts a column, and says so through aria-sort', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await typeSql(window, CUSTOMERS_SQL);
      await executeQuery(window);
      await expect(gridRows(window).first()).toBeVisible();

      await sortGridColumn(window, 'id'); // ascending, which is already the SQL order
      await expect(gridSortState(window, 'id')).toHaveAttribute('aria-sort', 'ascending');
      expect(await gridColumnValues(window, 'id')).toEqual(['1', '2', '3', '4', '5']);

      await sortGridColumn(window, 'id'); // descending
      await expect(gridSortState(window, 'id')).toHaveAttribute('aria-sort', 'descending');
      expect(await gridColumnValues(window, 'id')).toEqual(['5', '4', '3', '2', '1']);

      // Sorting is client-side, so the row count is untouched — this is the assertion that catches a
      // "sort" that silently re-ran the query with an ORDER BY.
      await expect(window.getByTestId('results-row-count')).toHaveText('5');
    });
  });

  test('selects rows, and copies the selection to the system clipboard', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await readyEditor(window);
      await typeSql(window, CUSTOMERS_SQL);
      await executeQuery(window);
      await expect(gridRows(window).first()).toBeVisible();

      // Nothing selected yet, so the count is absent rather than zero.
      await expect(window.getByTestId('results-selected-count')).toHaveCount(0);

      await selectGridRow(window, 0);
      await selectGridRow(window, 2);
      await expect(window.getByTestId('results-selected-count')).toContainText('2');

      // TSV with headers is the shipped default (`DEFAULT_SETTINGS.grid`), so this is what a user who
      // has never opened settings gets. Tab-separated, `\n` between rows, no ordinal column and no
      // checkbox column — the two structural columns are not data.
      const copied = await copyGridSelection(app, window);
      expect(copied).toBe(
        [
          'id\temail\tfull_name\tcountry_code',
          '1\talice@example.com\tAlice Anderson\tUS',
          '3\tcarol@example.com\tCarol Chen\tGB',
        ].join('\n')
      );
    });
  });

  test('copies every displayed row when nothing is selected', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await readyEditor(window);
      await typeSql(window, 'SELECT id, country_code FROM customers ORDER BY id');
      await executeQuery(window);
      await expect(gridRows(window).first()).toBeVisible();

      // Craig's rule, ported from `results-grid.component.ts:1506-1508`: pressing Copy with no
      // selection must never silently copy nothing.
      const copied = await copyGridSelection(app, window);
      expect(copied.split('\n')).toHaveLength(6); // the header plus five customers
      expect(copied.split('\n')[0]).toBe('id\tcountry_code');
      expect(copied).toContain('5\tDE');
    });
  });

  test('copies what the grid is SHOWING — sorted, filtered order', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await readyEditor(window);
      await typeSql(window, 'SELECT id, country_code FROM customers ORDER BY id');
      await executeQuery(window);
      await expect(gridRows(window).first()).toBeVisible();

      await sortGridColumn(window, 'id');
      await sortGridColumn(window, 'id'); // descending

      const copied = await copyGridSelection(app, window);
      // Descending, because that is what the user is looking at. A copy that read the result set
      // instead of the grid would come back ascending and nobody would notice until they pasted.
      expect(copied.split('\n').slice(1, 3)).toEqual(['5\tDE', '4\tAU']);
    });
  });

  test('the quick filter narrows the grid and announces itself', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await typeSql(window, CUSTOMERS_SQL);
      await executeQuery(window);
      await expect(gridRows(window)).toHaveCount(5);

      await window.getByTestId('results-filter').fill('carol');
      await expect(gridRows(window)).toHaveCount(1);
      await expect(window.getByTestId('results-filtered')).toBeVisible();
      expect(await gridColumnValues(window, 'email')).toEqual(['carol@example.com']);

      await window.getByTestId('results-filter-clear').click();
      await expect(gridRows(window)).toHaveCount(5);
      await expect(window.getByTestId('results-filtered')).toHaveCount(0);
    });
  });

  test('surfaces the row cap instead of silently showing fewer rows', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      // 20,000 rows against the 10,000-row `maxRowsToDisplay` default, which the executor enforces
      // main-side (`services/sql/row-cap.ts`) — so the grid never sees the other 10,000 and the banner
      // is the only place a user learns that.
      await typeSql(
        window,
        'SELECT i AS id, md5(i::text) AS hash FROM generate_series(1, 20000) i'
      );
      await executeQuery(window);

      const banner = window.getByTestId('results-truncated');
      await expect(banner).toBeVisible();
      await expect(window.getByTestId('results-displayed-count')).toHaveText('10,000');
      await expect(window.getByTestId('results-row-count')).toHaveText('20,000');
      await expect(banner).toContainText(/showing first/i);

      // And it is still virtualizing: a couple of screens of rows in the DOM, not ten thousand.
      const rendered = await gridRows(window).count();
      expect(rendered).toBeGreaterThan(0);
      expect(rendered).toBeLessThan(200);
    });
  });

  test('says a query that matched nothing succeeded', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await typeSql(window, 'SELECT * FROM customers WHERE 1 = 0');
      await executeQuery(window);

      // Not the "no results yet" empty state, and not an error: the query ran and matched nothing.
      await expect(window.getByTestId('results-empty')).toContainText('0 rows returned');
      await expect(window.getByTestId('query-results-empty')).toHaveCount(0);
      await expect(window.getByTestId('query-results-error')).toHaveCount(0);
      await expect(window.getByTestId('results-row-count')).toHaveText('0');
    });
  });

  test('shows one grid per result set in a multi-statement batch', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await typeSql(
        window,
        'SELECT id FROM customers ORDER BY id; SELECT sku, price_cents FROM products ORDER BY sku'
      );
      await executeQuery(window);

      // The first result set is showing; Radix unmounts the other tab's content, so there is exactly
      // one grid mounted at a time however many statements the batch had.
      await expect(resultsGrid(window)).toHaveCount(1);
      expect(await gridColumnHeaders(window)).toEqual(['id']);

      await window.getByTestId('query-results-tab').nth(1).click();
      await expect(resultsGrid(window)).toHaveCount(1);
      expect(await gridColumnHeaders(window)).toEqual(['sku', 'price_cents']);
    });
  });
});
