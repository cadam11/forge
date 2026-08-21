/**
 * Documentation shots — the query tab and everything the results pane hangs off it.
 *
 * The hero is framed as the whole query PANEL, because the seam is the subject: Joinery's toolbar
 * above Monaco, and the results tab strip above AG Grid. A shot of the grid alone would be a picture
 * of AG Grid.
 *
 * ── Determinism, statement by statement ────────────────────────────────────────────────────────
 *
 * Every statement here is a literal with an explicit column list and an `ORDER BY`, so the rows and
 * the column order in a shot are properties of the fixture rather than of the planner. No statement
 * selects `products.created_at`, whose values are the wall-clock time the container was first seeded
 * (see `explorer.spec.ts`'s header). The plan is a PostgreSQL `EXPLAIN` without `ANALYZE` — the
 * provider never runs the statement for a plan on PostgreSQL or MySQL — so what it shows is the
 * planner's cost ESTIMATES, which are a function of the schema and the statistics rather than of how
 * busy the machine was.
 *
 * The one exception is named rather than hidden: the query-history rows carry a measured duration
 * ("3ms"), which is genuinely re-measured on every capture. It is a two-or-three character readout
 * on one line of one shot, it is what that page is documenting, and masking it would put a pink
 * rectangle in a documentation image. Recorded in the J-99 Phase 3 report as the set's one
 * drift-bearing region.
 */

import type { Page } from '@playwright/test';

import { blurFocus, capture, expect, test, withDocsApp } from './fixtures';
import { HERO_THEMES, PAGE_THEMES } from './catalogue';
import {
  UI_TIMEOUT_MS,
  connectFromSidebar,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  executeQuery,
  executionPlan,
  gridColumnHeaders,
  gridRows,
  historyEntryRows,
  openQueryHistory,
  openQueryTab,
  openRowDetail,
  planNodes,
  queryEditor,
  rowDetailFields,
  rowDetailPanel,
  selectDatabase,
  showExecutionPlan,
  suggestionsContaining,
  typeSql,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Local Postgres';
const DATABASE = 'joinery_test';

/** Ten rows of four columns — a result set that is the same one every capture. */
const LIST_PRODUCTS = 'SELECT id, sku, name, price_cents\nFROM products\nORDER BY id\nLIMIT 10;';

/** Six columns, so the row-detail rail has something to be a rail OF. No `created_at`. */
const PRODUCT_DETAIL =
  'SELECT id, sku, name, price_cents, category, active\nFROM products\nORDER BY id\nLIMIT 10;';

/** A join, so the plan has more than one operator in it. */
const JOINED = [
  'SELECT c.full_name, o.status, o.total_cents',
  'FROM orders o',
  'JOIN customers c ON c.id = o.customer_id',
  'ORDER BY o.id;',
].join('\n');

test.beforeAll(ensureJoineryTestSeeded);

async function connectAndSelect(window: Page): Promise<void> {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, DATABASE);
  await dismissToasts(window);
}

/** Open a tab, type one statement, run it, and wait for the grid to have drawn its rows. */
async function runInTab(window: Page, sql: string, expectedRows: number): Promise<void> {
  await openQueryTab(window);
  await typeSql(window, sql);
  await executeQuery(window);
  // The grid virtualizes and fills asynchronously, so "the run finished" is not "the rows are
  // drawn" — this is what pins a shot to a grid that has actually rendered.
  await expect(gridRows(window)).toHaveCount(expectedRows);
  await dismissToasts(window);
}

for (const theme of HERO_THEMES) {
  test.describe(`docs shots — query tab, ${theme}`, () => {
    test('editor above a populated results grid', async () => {
      await withDocsApp(theme, async ({ window }) => {
        await connectAndSelect(window);
        await runInTab(window, LIST_PRODUCTS, 10);
        expect(await gridColumnHeaders(window)).toEqual(['id', 'sku', 'name', 'price_cents']);
        // Monaco holds focus from `typeSql` and draws its own caret, which Playwright's
        // `caret: 'hide'` does not reach.
        await blurFocus(window);

        await capture(
          window.getByTestId('query-panel'),
          'hero-query-results',
          theme,
          'The query tab: editor above a populated results grid'
        );
      });
    });
  });
}

for (const theme of PAGE_THEMES) {
  test.describe(`docs shots — query surfaces, ${theme}`, () => {
    test('the completion widget mid-statement', async () => {
      await withDocsApp(theme, async ({ window }) => {
        await connectAndSelect(window);
        await openQueryTab(window);
        await typeSql(window, 'SELECT * FROM ');
        // `suggestionsContaining` re-triggers until the schema metadata has landed: Monaco computes
        // a completion list once per trigger and does not recompute it when a provider's metadata
        // arrives afterwards, so a widget opened too early lists keywords and stays that way — and
        // a picture of that is a picture of the race, not of the feature.
        const suggestionRows = await suggestionsContaining(window, 'products');

        // ── Then close the details pane, because that helper's loop may have opened it ─────────
        //
        // Measured, not defensive: two capture runs produced visibly different pictures of this
        // surface — one with Monaco's details pane expanded beside the list, one without — and the
        // diff was 86,766 pixels, 3% of the image. The cause is that `Ctrl+Space` on an ALREADY-OPEN
        // suggest widget is Monaco's `toggleSuggestionDetails`, so the parity of `suggestionsContaining`'s
        // re-trigger count decides whether the pane is open, and that count is a race with the
        // metadata prefetch. Closing and re-opening the widget does not reset it either: Monaco
        // keeps details visibility as editor-session state, which was checked before this loop was
        // written.
        //
        // So it is converged to a known state rather than inherited. Hidden rather than expanded
        // because the pane for a table completion carries one word ("Table") that the list already
        // shows inline, and it doubles the width of the widget to say it. Bounded by `toPass`.
        const details = window.locator('.suggest-details:visible');
        await expect(async () => {
          if ((await details.count()) > 0) await window.keyboard.press('Control+Space');
          await expect(details).toHaveCount(0, { timeout: 500 });
        }).toPass({ timeout: UI_TIMEOUT_MS, intervals: [50, 100, 250, 500] });
        await expect(suggestionRows.filter({ hasText: 'products' })).not.toHaveCount(0);

        // No `blurFocus` here, and that is the one place in this set where the caret belongs: the
        // widget is anchored to the cursor and closes when the editor loses focus.
        await capture(
          window.getByTestId('query-panel'),
          'query-completions',
          theme,
          "The editor's completion widget mid-statement"
        );
      });
    });

    test('the row-detail rail', async () => {
      await withDocsApp(theme, async ({ window }) => {
        await connectAndSelect(window);
        await runInTab(window, PRODUCT_DETAIL, 10);
        const rail = await openRowDetail(window, 0);
        expect(await rowDetailFields(window)).toEqual([
          'id',
          'sku',
          'name',
          'price_cents',
          'category',
          'active',
        ]);
        await expect(rowDetailPanel(window)).toBeVisible();
        await blurFocus(window);
        await capture(rail, 'row-detail', theme, 'The row-detail panel for one result row');
      });
    });

    test('the execution plan', async () => {
      await withDocsApp(theme, async ({ window }) => {
        await connectAndSelect(window);
        await openQueryTab(window);
        await typeSql(window, JOINED);
        const plan = await showExecutionPlan(window);
        // More than one operator, or the picture is of a plan with nothing to show.
        await expect(planNodes(window).first()).toBeVisible();
        expect(await planNodes(window).count()).toBeGreaterThan(1);
        await dismissToasts(window);
        await blurFocus(window);
        await expect(executionPlan(window)).toBeVisible();
        await capture(
          window.getByTestId('query-panel'),
          'execution-plan',
          theme,
          'The execution plan tree for a joined SELECT'
        );
        // `plan` is the tree inside the panel; asserting it is still there proves the panel shot
        // above framed a plan rather than a results tab that had switched back.
        await expect(plan).toBeVisible();
      });
    });

    test('the query history dialog', async () => {
      await withDocsApp(theme, async ({ app, window }) => {
        await connectAndSelect(window);
        await runInTab(window, LIST_PRODUCTS, 10);
        await typeSql(window, PRODUCT_DETAIL);
        await executeQuery(window);
        await typeSql(window, JOINED);
        await executeQuery(window);
        await dismissToasts(window);

        const dialog = await openQueryHistory(app, window);
        // Three statements were run in this launch and the user-data directory is a fresh
        // `mkdtemp`, so the history is exactly those three — never a previous run's, and never the
        // developer's own.
        await expect(historyEntryRows(window)).toHaveCount(3);
        await blurFocus(window);
        await capture(
          dialog,
          'query-history',
          theme,
          'The query history dialog after a few statements have run'
        );
        // The editor is still holding the last statement, i.e. nothing in this shot replayed one.
        await expect(queryEditor(window)).toBeVisible();
      });
    });

    test('the dialect conversion menu', async () => {
      await withDocsApp(theme, async ({ window }) => {
        await connectAndSelect(window);
        await openQueryTab(window);
        await typeSql(window, LIST_PRODUCTS);
        await dismissToasts(window);
        await blurFocus(window);

        // The MENU rather than a converted tab, and that is a determinism decision as much as a
        // framing one: the conversion itself shells out to Python + sqlglot
        // (`getting-started/prerequisites`), so a shot of its output would be a picture of whether
        // the capturing machine had that installed. The menu is what the feature page has to show a
        // reader anyway — where the control is, and which dialects it offers.
        await window.getByTestId('query-convert').click();
        const menu = window.getByRole('menu');
        await expect(menu).toBeVisible();
        // Connected to PostgreSQL, so the list is the other two engines: the toolbar omits the
        // current one (`query-toolbar.tsx:214`).
        await expect(window.getByTestId('query-convert-mssql')).toBeVisible();
        await expect(window.getByTestId('query-convert-mysql')).toBeVisible();
        await expect(window.getByTestId('query-convert-postgresql')).toHaveCount(0);

        // The whole window: a portalled dropdown is not inside `query-panel`, and the picture has to
        // show which toolbar button opened it.
        await capture(
          window,
          'sql-dialect-conversion',
          theme,
          'The query toolbar’s dialect conversion menu, open over a statement'
        );

        // Nothing was converted: no second tab, and the menu is still the menu.
        await expect(menu).toBeVisible();
      });
    });
  });
}
