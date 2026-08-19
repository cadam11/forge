/**
 * **R2, asserted: 100,000 rows in the results grid, and the DOM never holds more than a window of
 * them.**
 *
 * PLAN.md's R2 is "a React port can accidentally re-render 10k rows per keystroke through a
 * badly-scoped store selector", and CLAUDE.md requires virtualization above 1,000 rows. Task 11
 * ported AG Grid with that gate in mind; this file is the gate as a durable suite member rather
 * than a number in a report.
 *
 * ── The rows are generated, not seeded ────────────────────────────────────────────────────────
 *
 * `generate_series` on the seeded PostgreSQL container, so there is no 100k-row fixture to create,
 * clean up, or leave behind for the explorer specs to trip over — the load is entirely in the query
 * and lives exactly as long as the tab does. It also means the number is a constant in this file
 * rather than a property of the seed, so raising it is a one-line experiment.
 *
 * ── What is gated, and what is only recorded ─────────────────────────────────────────────────
 *
 * See `fixtures.ts` for the rule. The gates here are structural: the DOM row count under 100k rows,
 * the same count after scrolling to the very bottom, and the mutation count on the SIDEBAR while
 * the grid scrolls (a scroll must not reach the explorer — that is R2's "badly-scoped selector"
 * expressed as something observable). The durations are recorded and bounded generously; each says
 * what it was sized from.
 */

import type { ElectronApplication, Page } from '@playwright/test';

import {
  CONNECT_TIMEOUT_MS,
  UI_TIMEOUT_MS,
  connectFromSidebar,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  executeQuery,
  gridRows,
  openSettings,
  openSettingsGroup,
  resultsGrid,
  selectDatabase,
  setNumberSetting,
  sortGridColumn,
  typeSql,
  withJoineryReact,
} from '../helpers/joinery-actions-react';
import { attachMeasurements, countMutations, expect, test, withMainThreadWatch } from './fixtures';

const PROFILE = 'Perf PG';
const DATABASE = 'joinery_test';

/** The plan's number. Also the executor's row cap for this spec — see `raiseRowCap`. */
const ROWS = 100_000;

/**
 * 100,000 rows of three columns, wide enough that the grid has real work to do.
 *
 * `generate_series` is the only PostgreSQL-specific thing in this file. MySQL and SQL Server would
 * need their own generator, and covering all three would triple the runtime of the slowest tier to
 * measure the same React component — the grid does not know which engine produced the rows.
 */
const SQL =
  `SELECT i AS id, 'row-' || i AS label, (i * 7 % 1000) AS bucket, ` +
  `md5(i::text) AS token FROM generate_series(1, ${ROWS}) AS i`;

/**
 * The virtualization budget: how many row elements AG Grid may have in the DOM at once.
 *
 * Measured at 30–40 rendered rows for a 798px-tall grid, plus AG Grid's own overscan buffer. 200 is
 * five times that, and it is four orders of magnitude below `ROWS` — which is the point. A change
 * that turned virtualization off would put 100,000 `.ag-row` elements in the document and fail this
 * by a factor of 500, while normal variation in window height moves it by tens.
 */
const MAX_RENDERED_ROWS = 200;

/**
 * Outer bound on "execute → first row painted", including the round trip to the container and
 * PostgreSQL materialising 100k rows.
 *
 * **Measured**: 379 / 380 / 392 ms over three runs (median 380) on the development machine, with
 * the numbers of every run written to `grid-100k.json` beside the test. 10s is 26× that — generous
 * on purpose, per `fixtures.ts` rule 2. What it is sized to catch is an algorithmic change (a grid
 * that renders every row before showing one), not a busy laptop.
 */
const FIRST_PAINT_BUDGET_MS = 10_000;

/** Outer bound on a full-column sort of 100k rows. **Measured**: 88 / 90 / 103 ms; 55× the median. */
const SORT_BUDGET_MS = 5_000;

/**
 * Total main-thread blocking time allowed while the grid scrolls from row 1 to row 100,000.
 *
 * **Measured: zero**, on all three runs — no `longtask` entry at all during the scroll. Gated at
 * 500ms rather than at 0 because a garbage collection during an unrelated moment can produce one
 * long task and this suite must not go red for that; half a second is well past the point where a
 * scroll stops feeling like a scroll, so a regression that re-renders the workbench per frame lands
 * far outside it.
 */
const SCROLL_BLOCKING_BUDGET_MS = 500;

test.beforeAll(ensureJoineryTestSeeded);

/**
 * Raises `query.maxRowsToDisplay` to `ROWS`.
 *
 * Necessary, not incidental: the default is 10,000 (`settings.types.ts`) and it is passed to the
 * main-process executor as `QueryRequest.maxRows`, so without this the query returns a tenth of the
 * rows and the spec would claim a 100k gate it never ran. Done through the settings dialog rather
 * than by writing state, so the value goes the same route a user's would.
 */
async function raiseRowCap(app: ElectronApplication, window: Page): Promise<void> {
  await openSettings(app, window);
  await openSettingsGroup(window, 'query');
  await setNumberSetting(window, 'settings-query-max-rows', ROWS);
  await window.keyboard.press('Escape');
  await expect(window.getByTestId('settings-dialog')).toBeHidden({ timeout: UI_TIMEOUT_MS });
}

test.describe('the results grid at 100,000 rows', () => {
  test('paints, stays virtualized, scrolls to the end, and sorts', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, DATABASE);
      await raiseRowCap(app, window);
      await dismissToasts(window);

      await typeSql(window, SQL);

      const startedAt = Date.now();
      const { main: executeMain } = await withMainThreadWatch(window, async () => {
        await executeQuery(window);
        await expect(gridRows(window).first()).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });
      });
      const firstPaintMs = Date.now() - startedAt;

      // The grid says how many rows it has. Asserted BEFORE anything about the DOM, because every
      // number below is meaningless if the executor capped the result at 10,000.
      await expect(window.getByTestId('results-row-count')).toContainText('100,000', {
        timeout: UI_TIMEOUT_MS,
      });

      // ── Gate 1: virtualization at rest ──────────────────────────────────────────────────────
      const renderedAtTop = await gridRows(window).count();
      expect(
        renderedAtTop,
        `${renderedAtTop} row elements in the DOM for ${ROWS} rows — virtualization is off`
      ).toBeLessThan(MAX_RENDERED_ROWS);

      // ── Gate 2: virtualization after a scroll to the very end ────────────────────────────────
      //
      // Also the honest proof that all 100k rows are addressable: the last row's id is `ROWS`, and
      // a grid that had quietly truncated would show something else there.
      const { main: scrollMain } = await withMainThreadWatch(window, async () => {
        await scrollGridToBottom(window);
      });
      const renderedAtBottom = await gridRows(window).count();
      expect(renderedAtBottom).toBeLessThan(MAX_RENDERED_ROWS);
      await expect(
        resultsGrid(window).locator(
          `.ag-grid-scrolling-container .ag-row[row-index="${ROWS - 1}"]`
        ),
        'the last row of 100,000 was never reachable'
      ).toBeVisible({ timeout: UI_TIMEOUT_MS });

      // ── Gate 3: a full-column sort still virtualizes ─────────────────────────────────────────
      const sortStartedAt = Date.now();
      await sortGridColumn(window, 'bucket');
      await expect(gridRows(window).first()).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });
      const sortMs = Date.now() - sortStartedAt;
      expect(await gridRows(window).count()).toBeLessThan(MAX_RENDERED_ROWS);

      // The instrument has to have been installed, or "0 long tasks" means "nothing was watching".
      expect(
        executeMain.available,
        'no longtask observer — the main-thread numbers are empty'
      ).toBe(true);
      expect(scrollMain.available).toBe(true);

      expect(firstPaintMs).toBeLessThan(FIRST_PAINT_BUDGET_MS);
      expect(sortMs).toBeLessThan(SORT_BUDGET_MS);
      expect(
        scrollMain.totalBlockingMs,
        'the main thread blocked while the grid scrolled — something re-renders per frame'
      ).toBeLessThan(SCROLL_BLOCKING_BUDGET_MS);

      await attachMeasurements('grid-100k.json', {
        rows: ROWS,
        firstPaintMs,
        sortMs,
        renderedAtTop,
        renderedAtBottom,
        maxRenderedRowsAllowed: MAX_RENDERED_ROWS,
        execute: executeMain,
        scroll: scrollMain,
      });
    });
  });

  test('scrolling the grid does not touch the explorer or the tab strip', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, DATABASE);
      await raiseRowCap(app, window);
      await dismissToasts(window);

      await typeSql(window, SQL);
      await executeQuery(window);
      await expect(gridRows(window).first()).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });

      // R2 made observable. A store selector scoped to a whole slice — the failure the risk names —
      // would re-render the shell on every scroll frame, and the sidebar's DOM would move with it.
      // Zero, not "few": the sidebar has no reason to change at all while a grid scrolls.
      const sidebarMutations = await countMutations(window, '[data-testid="sidebar"]', async () => {
        await scrollGridToBottom(window);
      });
      expect(
        sidebarMutations,
        'scrolling the results grid mutated the explorer — a store selector is too wide'
      ).toBe(0);

      await attachMeasurements('grid-scroll-isolation.json', { rows: ROWS, sidebarMutations });
    });
  });
});

/**
 * Scrolls the grid to its last row and waits for that row to be rendered.
 *
 * `api.ensureIndexVisible` would be shorter, but it is AG Grid moving itself rather than the app
 * responding to a scroll, and this spec is about the second thing. So the scroll container is
 * driven directly — the same element a wheel gesture drives.
 *
 * **Found rather than named.** `.ag-body-viewport` is the v32-era class the Angular suite knew and
 * it does not exist in AG Grid 36; `tests/helpers/react/results.ts` records the same lesson about
 * `.ag-center-cols-container`. Searching the grid's own subtree for the element that actually
 * overflows costs one `evaluate` and survives the next rename. The search is bounded by the
 * subtree, which is small precisely because the grid virtualizes.
 */
async function scrollGridToBottom(window: Page): Promise<void> {
  const scrolled = await resultsGrid(window).evaluate(host => {
    const scroller = Array.from(host.querySelectorAll<HTMLElement>('*')).find(
      // A margin, so a container that overflows by a pixel of rounding is not mistaken for the
      // one holding 100,000 rows.
      node => node.scrollHeight > node.clientHeight + 100
    );
    if (scroller === undefined) return false;
    scroller.scrollTop = scroller.scrollHeight;
    return true;
  });
  expect(scrolled, 'no element inside the results grid scrolls — nothing was virtualized').toBe(
    true
  );

  await expect(
    resultsGrid(window).locator(`.ag-grid-scrolling-container .ag-row[row-index="${ROWS - 1}"]`)
  ).toBeVisible({ timeout: UI_TIMEOUT_MS });
}
