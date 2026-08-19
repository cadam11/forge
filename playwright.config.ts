import { defineConfig } from '@playwright/test';

// Playwright + Electron config for the Joinery regression harness.
//
// Each test launches its own Electron instance via tests/helpers/electron-app.ts.
//
// Three projects, one per tier, each with its own testDir:
//   - e2e-react: functional specs (tests/e2e-react/)
//   - perf-react: the slow-by-construction performance specs (tests/e2e-react-perf/)
//   - visual-react: snapshot baselines, with the two host variables pinned —
//     device pixel ratio and macOS scroller style (tests/e2e-react-visual/)
//
// Each has a `pnpm run test:*:react` script so the static report and the live
// dashboard can show them as distinct tiers.
//
// The `-react` suffixes are historical: they distinguished these tiers from the
// Angular ones while the two renderers coexisted (PLAN.md §3). Task 24 deleted
// the Angular tiers; the names stay because the committed baseline tree
// (tests/__snapshots__/visual-react/) is keyed by them and renaming it would
// rewrite 22 baselines for cosmetics.
export default defineConfig({
  // Every project below sets its own testDir, so this is only the fallback for a
  // project that forgets to — pointed at the functional tier rather than at
  // ./tests, which would sweep the vitest integration specs into discovery.
  testDir: './tests/e2e-react',
  outputDir: './tests/reports/.cache/playwright-results',
  timeout: 60000,
  expect: {
    timeout: 10000,
    toHaveScreenshot: {
      // Allow up to 1% pixels to differ — sub-pixel anti-aliasing varies
      // slightly between identical runs.
      maxDiffPixelRatio: 0.01,
      // Threshold for what counts as "different" per pixel (0-1; 0.2 is the
      // Playwright default and works well for most UI).
      threshold: 0.2,
    },
  },
  // ── Serial, on purpose (Task 20 audit) ─────────────────────────────────────
  //
  // Not a default nobody revisited. Every test in every tier launches its own Electron app against
  // the SAME five Docker containers and the same `joinery_test` database, so parallel workers would
  // share mutable server state, not just CPU:
  //
  //  - `restore.spec.ts` and `create-database.spec.ts` create, rename and DROP real databases, and
  //    `dropDatabasesMatching` drops by PREFIX — a concurrent spec's database can be inside another's
  //    cleanup pattern.
  //  - `dropDatabasesMatching` uses `WITH (FORCE)`, which terminates other sessions on the target.
  //  - the explorer tree is virtualized, so databases a parallel worker left lying around push rows
  //    out of the rendered window and specs that look for a third server node stop finding it (a real
  //    failure this suite hit).
  //  - `docker-panel.spec.ts` starts and stops a container of its own and asserts on the pip's
  //    reading of what is running.
  //  - the visual tier needs one screenshot at a time regardless.
  //
  // `retries: 0` is the other half of the same position: a retried Electron launch would hide exactly
  // the flake this suite exists to find, and every wait in `tests/helpers/react/` is bounded and
  // observable so that retries are not needed to paper over one.
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    // Custom reporter posts per-test events to the live dashboard when
    // JOINERY_LIVE_REPORTER_URL is set. No-op otherwise — safe in CI.
    ['./tests/reporter/playwright-live-reporter.mjs'],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // The functional tier.
    {
      name: 'e2e-react',
      testDir: './tests/e2e-react',
    },
    // ── The performance tier (Task 23) ────────────────────────────────────────
    //
    // A sibling directory rather than a subdirectory of the functional tier:
    // `e2e-react` discovers by a plain `testDir`, so a nested `perf/` would join
    // it and change its count.
    //
    // Separate from `e2e-react` rather than tagged inside it because these
    // specs are SLOW BY CONSTRUCTION — a 100k-row result set, a 200-table
    // schema built from scratch, and a 600-chunk stream injected in real time —
    // and their cost should not be paid by every run of the functional suite.
    // `pnpm run test:perf:react` invokes them on their own.
    //
    // `timeout` is raised from the root's 60s because a single test here does
    // minutes of real work before its first assertion: the chat spec spends
    // six seconds streaming alone, and the ERD spec's fixture is 200 CREATE
    // TABLEs. The thresholds the specs assert are their own, stated next to
    // each measurement with the median it was sized from — this number is only
    // the outer bound on a test that has hung.
    {
      name: 'perf-react',
      testDir: './tests/e2e-react-perf',
      timeout: 300_000,
    },
    // ── The visual tier ───────────────────────────────────────────────────────
    //
    // A SIBLING directory rather than `tests/e2e-react/visual/`, for the same
    // reason the perf tier is one: the `e2e-react` project's discovery is a
    // plain `testDir`, so a `visual/` subdirectory would be swept into it and
    // the functional tier's test count would change.
    //
    // Snapshots go to their own directory. It held the 22 React baselines apart
    // from the Angular tier's 11 while both existed; now it is simply where the
    // committed baselines live, and its name is why this project keeps its
    // `-react` suffix (see the header).
    {
      name: 'visual-react',
      testDir: './tests/e2e-react-visual',
      snapshotDir: './tests/__snapshots__/visual-react',
      snapshotPathTemplate: '{snapshotDir}/{testFileName}/{arg}{ext}',
      // ── The DPR pin ────────────────────────────────────────────────────────
      //
      // Every baseline in this tier is captured at ONE device pixel per CSS
      // pixel, stated here rather than inherited from whatever display the
      // developer is sitting at.
      //
      // What it prevents: the Angular visual tier's baselines were shot at
      // `devicePixelRatio: 2` and its runs report `1`, so `toHaveScreenshot`
      // fails on image SIZE before it compares a single pixel — a red tier that
      // says nothing about the UI (J-21, ledger Ruling 5). Nothing in that tier
      // pins a DPR anywhere, which is why the trap was available.
      //
      // Why `metadata` and not `use.deviceScaleFactor`: that option is applied
      // by `browser.newContext`, and this suite has no browser context — it
      // launches a real Electron whose windows come from
      // `packages/main/src/window.ts`. Setting it would type-check, do nothing,
      // and read as though the tier were pinned. `tests/e2e-react-visual/fixtures.ts`
      // reads this number, passes it to the launcher as Chromium's
      // `--force-device-scale-factor`, and then ASSERTS that the page agrees —
      // so the pin cannot rot into decoration.
      //
      // ── The scrollbar pin ──────────────────────────────────────────────────
      //
      // The second host variable this tier cannot afford to inherit. macOS's
      // `AppleShowScrollBars` default is `Automatic`, which the OS resolves from
      // the pointing device attached at the time: with a mouse plugged in the
      // app gets LEGACY scrollbars, which take 15 CSS px of layout width out of
      // every scrolling panel; without one it gets OVERLAY scrollbars, which
      // take none. The React renderer styles no scrollbars of its own, so that
      // is a 15px reflow of real content.
      //
      // Measured on this tier's committed baselines (captured in legacy mode):
      // in overlay mode 3 of 22 fail outright and a 4th passes only inside the
      // pixel tolerance. With the pin, 22 of 22 pass. Unpinned, which result a
      // developer gets is a fact about their desk, not about Joinery.
      //
      // `-AppleShowScrollBars Always` is a Cocoa NSArgumentDomain pair, applied
      // to the test process only — no `defaults write`, so nothing is mutated on
      // the host and nothing needs cleaning up if a run dies. That Electron
      // honours it was probed, not assumed; the numbers are in
      // `tests/helpers/electron-app.ts`'s `macScrollBarStyle` doc, and
      // `tests/e2e-react-visual/fixtures.ts` re-measures the gutter on every
      // launch so the pin cannot rot into decoration.
      metadata: { deviceScaleFactor: 1, macScrollBarStyle: 'Always' },
      // ── The comparison tolerance, sized to this tier's measured noise ──────
      //
      // The root `expect` block allows `maxDiffPixelRatio: 0.01` — on a
      // 1115x798 baseline that is 8,897 pixels, enough for a moved label or a
      // swapped icon to pass unnoticed. That number was written for the Angular
      // tier; this tier's measured drift is three orders of magnitude smaller.
      //
      // What it is sized from, worst measurement first:
      //
      //  - three independent full RE-CAPTURES byte-compared against the
      //    committed set drifted by at most **8 pixels** (64 of 66 image
      //    comparisons byte-identical; the two that moved were 2px and 8px of
      //    antialiasing on SVG and text edges);
      //  - a full comparison run of this tier with the pins in place and
      //    `maxDiffPixels: 0` passed **22 of 22** — i.e. zero pixels exceeded
      //    `threshold` on any baseline.
      //
      // 20 is 2.5x the worst number ever measured, and it is deliberately BELOW
      // the smallest real artefact this tier has actually caught: Monaco's
      // caret, a 2x20 = 40px rectangle that flipped between otherwise identical
      // captures during development. A budget that admitted the caret would
      // admit the class of defect the capture work spent its time killing.
      //
      // Flat pixels rather than a ratio on purpose: a ratio scales the
      // allowance with the size of the surface, so the big shots — the ones
      // with the most room to hide a regression — would get the loosest bound.
      // `threshold` stays at the root's 0.2, which is what decides whether a
      // pixel counts as different at all.
      //
      // `timeout` is restated rather than inherited because a project's
      // `expect` REPLACES the top-level one — Playwright resolves it with
      // `takeFirst(projectConfig.expect, config.expect, {})`, not a merge
      // (`playwright/lib/common/index.js`). Omitting it here would silently drop
      // every un-timed assertion in this tier from the 10s budget the specs were
      // written against to Playwright's 5s default. Dropping the root's
      // `maxDiffPixelRatio` is the same mechanism, and there it is the point.
      expect: {
        timeout: 10000,
        toHaveScreenshot: {
          maxDiffPixels: 20,
          threshold: 0.2,
        },
      },
    },
  ],
});
