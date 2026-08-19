/**
 * **The ERD at 200 tables** — PLAN.md Task 23's third number, and the one that had no measurement
 * at all before this file.
 *
 * Task 18 replaced the hand-rolled ERD layout with real dagre and asserted its determinism under a
 * shuffled input. What it did not establish is what dagre costs on a schema the size the plan names:
 * the seeded fixture has four tables, and four tables lay out in a frame whatever the algorithm is.
 * A quadratic regression in layout, or a lost memo around it, is invisible at that size and obvious
 * at 200.
 *
 * ── The fixture ───────────────────────────────────────────────────────────────────────────────
 *
 * `ensureWideSchema` builds a separate PostgreSQL database of 200 FK-joined tables, once, and
 * explains there why it is not in the shared seed. It is left in place between runs: building it is
 * the slow part, and the helper's fast path is a table count rather than a rebuild.
 *
 * ── "Draws 200 tables" is not "200 nodes in the DOM", and the difference is a FINDING ─────────
 *
 * The canvas culls to the viewport plus one viewport of margin (`erd-viewport.ts`), so a 200-table
 * diagram renders **176** of them at rest. That much is the feature working, and a spec demanding
 * 200 nodes would be demanding the culling be switched off.
 *
 * What this file established while trying to write that spec is the part worth carrying forward:
 * **at 200 tables the diagram cannot be seen whole, at any zoom the toolbar offers.** Dagre lays a
 * 200-table 4-ary tree out around 42,000px wide; `MIN_ZOOM` is 0.1 (`erd-viewport.ts:37`), so the
 * furthest-out view spans about 33,000 diagram pixels including the cull margin. Fit-on-load is
 * therefore CLAMPED — the zoom readout is at the minimum from the moment the diagram appears, and
 * further zoom-out presses are no-ops. The count sits at 176 and does not move. That is a real
 * usability gap (a minimap, or a lower `MIN_ZOOM`, would close it) and it is recorded as a follow-up
 * rather than fixed here: it is a feature, not a performance regression, and Task 23 is the latter.
 *
 * So the gates are: the diagram is not truncated (all 200 were fetched), the rendered set is a
 * genuine window (fewer than 200, more than half), named nodes are present, and the build+layout
 * stays inside a bounded main-thread budget. The zoom at fit is recorded in the measurement file as
 * the evidence for the clamp above.
 */

import type { Page } from '@playwright/test';

import {
  UI_TIMEOUT_MS,
  WIDE_SCHEMA_DATABASE,
  connectFromSidebar,
  createPostgresProfile,
  dismissToasts,
  ensureWideSchema,
  erdCanvas,
  erdNodes,
  erdPanel,
  erdTransform,
  openPalette,
  paletteRowState,
  runPaletteCommand,
  selectDatabase,
  tableNameFor,
  withJoineryReact,
} from '../helpers/joinery-actions-react';
import { attachMeasurements, expect, test, withMainThreadWatch } from './fixtures';

const PROFILE = 'Perf ERD PG';

/** The plan's number. */
const TABLES = 200;

/**
 * Outer bound on "run the command → the diagram is on screen with nodes in it".
 *
 * This covers more than dagre: the whole-database diagram asks the main process for the schema of
 * every table first, in batches of five (`erd-adapter.ts`), so 400 IPC calls and their SQL are
 * inside the number. That is deliberate — it is what a user waits for — and it is also why the
 * bound is generous.
 *
 * **Measured**: 826 / 835 / 838 ms over three runs (median 835) on the development machine, with
 * every run's number written to `erd-200.json` beside the test. 20s is 24× that. Re-activating an
 * already-built diagram measured 79 ms, which is the cached path.
 */
const DRAW_BUDGET_MS = 20_000;

/**
 * Total main-thread blocking time allowed while the diagram is built, laid out and painted.
 *
 * Unlike the grid's scroll this is expected to be non-zero — laying out 200 nodes is real
 * synchronous work that happens once. **Measured**: a single `longtask` of 52–54 ms, for a total
 * blocking time of **2–4 ms** (blocking time counts only the part of a task past 50 ms). 5s is
 * three orders of magnitude above that, and it is where a pause stops being a pause: a quadratic
 * layout at 200 nodes lands far outside it, while a busy laptop does not.
 */
const BLOCKING_BUDGET_MS = 5_000;

test.beforeAll(async () => {
  await ensureWideSchema(TABLES);
});

test.describe(`the ERD at ${TABLES} tables`, () => {
  test('lays out all 200 tables, and culls to the viewport until asked not to', async () => {
    await withJoineryReact(async ({ window }) => {
      await openWideSchema(window);

      await openPalette(window);
      expect(
        await paletteRowState(window, 'command:open-erd'),
        'the whole-database ERD command is not available, so nothing below was measured'
      ).toBe('ready');

      const startedAt = Date.now();
      const { main } = await withMainThreadWatch(window, async () => {
        await runPaletteCommand(window, 'command:open-erd');
        await expect(erdPanel(window)).toBeVisible({ timeout: DRAW_BUDGET_MS });
        await expect(erdNodes(window).first()).toBeVisible({ timeout: DRAW_BUDGET_MS });
      });
      const drawMs = Date.now() - startedAt;

      // Fit-on-load ran against a real viewport, so the transform is not the identity — the same
      // assertion `erd.spec.ts` makes at four tables.
      expect(await erdTransform(window)).toMatch(/translate\(/);

      // ── Gate 1: culling is on ────────────────────────────────────────────────────────────────
      const renderedAtFit = await nodeCount(window);
      expect(
        renderedAtFit,
        'the diagram is empty, so nothing below means anything'
      ).toBeGreaterThan(0);
      expect(
        renderedAtFit,
        'every one of 200 nodes is in the DOM at fit zoom — viewport culling is off'
      ).toBeLessThan(TABLES);

      // ── Gate 2: nothing was dropped on the way in ────────────────────────────────────────────
      //
      // `MAX_ERD_TABLES` is 400 and the panel shows a notice when it bites, so its ABSENCE is the
      // statement that all 200 tables were fetched rather than the first N of them.
      await expect(
        erdPanel(window).getByTestId('erd-truncated'),
        'the diagram was truncated, so it is not a 200-table diagram'
      ).toHaveCount(0);

      // ── Gate 3: the diagram is populated, and the culled window is a WINDOW ──────────────────
      //
      // A lower bound as well as the upper one above, because "fewer than 200" is also true of a
      // diagram that drew three boxes. Half the schema is what the viewport plus its one-viewport
      // cull margin holds at this size — measured at 176 of 200.
      expect(renderedAtFit, 'the diagram drew almost nothing').toBeGreaterThan(TABLES / 2);

      // Named nodes, so "176 nodes" cannot be 176 copies of one table. The root and the first rank
      // are what fit-on-load centres on, which is what makes these three findable at rest.
      for (const index of [0, 1, 2]) {
        await expect(
          window.locator(
            `[data-testid="erd-node"][data-erd-node-id="public.${tableNameFor(index)}"]`
          ),
          `public.${tableNameFor(index)} is missing from the diagram`
        ).toHaveCount(1);
      }

      expect(main.available, 'no longtask observer — the main-thread numbers are empty').toBe(true);
      expect(drawMs).toBeLessThan(DRAW_BUDGET_MS);
      expect(
        main.totalBlockingMs,
        'the main thread blocked for too long building and laying out the diagram'
      ).toBeLessThan(BLOCKING_BUDGET_MS);

      await attachMeasurements('erd-200.json', {
        tables: TABLES,
        drawMs,
        renderedAtFit,
        // Recorded rather than asserted: it is the evidence behind the finding in this file's
        // header that fit-on-load bottoms out at `MIN_ZOOM` for a schema this wide.
        zoomAtFit: await erdPanel(window).getByTestId('erd-zoom-level').textContent(),
        main,
      });
    });
  });

  test('re-activating the diagram does not rebuild it', async () => {
    await withJoineryReact(async ({ window }) => {
      await openWideSchema(window);

      await openPalette(window);
      await runPaletteCommand(window, 'command:open-erd');
      await expect(erdNodes(window).first()).toBeVisible({ timeout: DRAW_BUDGET_MS });
      const firstRender = await nodeCount(window);

      // Running the command again focuses the existing tab rather than opening a second one, so this
      // is the cost of RE-ACTIVATING a 200-node diagram — the operation a user repeats all day.
      const startedAt = Date.now();
      await openPalette(window);
      await runPaletteCommand(window, 'command:open-erd');
      await expect(erdNodes(window).first()).toBeVisible({ timeout: UI_TIMEOUT_MS });
      const reopenMs = Date.now() - startedAt;

      // Structural, not a ratio of two stopwatch readings: a re-activation that re-fetched the
      // schema and re-ran dagre would empty the canvas first and settle on a different fit. Same
      // node count from the same viewport is what "the cache held" looks like from outside.
      expect(
        await nodeCount(window),
        'the diagram was torn down and rebuilt when its tab was re-activated'
      ).toBe(firstRender);
      // And it really was a re-ACTIVATION: a second command that had opened a second diagram would
      // leave two ERD tabs in the strip, and the number above would be about a fresh build.
      await expect(
        window.locator('[data-testid^="workspace-tab-"][data-tab-type="erd"]'),
        'the command opened a second ERD tab, so nothing above measured a re-activation'
      ).toHaveCount(1);

      await attachMeasurements('erd-200-reopen.json', { tables: TABLES, firstRender, reopenMs });
    });
  });
});

/** Connects to the 200-table database and settles the shell. */
async function openWideSchema(window: Page): Promise<void> {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, WIDE_SCHEMA_DATABASE);
  await dismissToasts(window);
}

/** What the canvas says it is currently rendering — the culled set, as `erd-canvas.tsx` writes it. */
async function nodeCount(window: Page): Promise<number> {
  const attribute = await erdCanvas(window).getAttribute('data-erd-node-count');
  expect(attribute, 'the ERD canvas is not reporting a node count').not.toBeNull();
  return Number(attribute);
}
