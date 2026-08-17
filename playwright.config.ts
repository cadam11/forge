import { defineConfig } from '@playwright/test';

// Playwright + Electron config for the Joinery regression harness.
//
// Specs live under tests/e2e/. Each test launches its own Electron instance
// via tests/helpers/electron-app.ts.
//
// Four projects:
//   - e2e: functional E2E specs against the Angular renderer (anything under
//     tests/e2e/ that is not inside tests/e2e/visual/)
//   - visual: snapshot baselines (anything under tests/e2e/visual/)
//   - e2e-react: functional specs against the React renderer (tests/e2e-react/)
//   - visual-react: snapshot baselines for the React renderer, DPR-pinned
//     (tests/e2e-react-visual/)
//
// `pnpm run test:e2e` and `pnpm run test:visual` invoke the first two
// separately so the static report and live dashboard can show them as distinct
// tiers. The React tier runs as `pnpm exec playwright test --project=e2e-react`
// until it earns a script of its own (see the note on the project below).
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/reports/.cache/playwright-results',
  // Snapshots live outside .cache so they survive cache wipes and get committed.
  // Per-test-file directory keeps things tidy when there are many baselines.
  snapshotDir: './tests/__snapshots__/visual',
  snapshotPathTemplate: '{snapshotDir}/{testFileName}/{arg}{ext}',
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
    {
      name: 'e2e',
      // Anything under tests/e2e/ that's NOT inside the visual subdir.
      testIgnore: /tests\/e2e\/visual\//,
    },
    {
      name: 'visual',
      testMatch: /tests\/e2e\/visual\/.*\.spec\.ts$/,
    },
    // The React renderer's functional tier. A project-level `testDir` rather
    // than a testMatch under the shared one, so nothing about the `e2e`
    // project's discovery changes: tests/e2e-react/ is outside the top-level
    // testDir entirely and the Angular tier's 38 tests are the same 38.
    //
    // Every spec here pins itself to the React renderer through
    // `withJoineryReact` (tests/helpers/joinery-actions-react.ts), so this
    // project needs no env var to be correct — the env var
    // (JOINERY_E2E_RENDERER) exists for driving the *Angular* specs against
    // React in Task 20, which is the other direction.
    {
      name: 'e2e-react',
      testDir: './tests/e2e-react',
    },
    // ── The React renderer's visual tier ──────────────────────────────────────
    //
    // A SIBLING directory rather than `tests/e2e-react/visual/`, for the same
    // reason `e2e-react` is a sibling of `tests/e2e` rather than a testMatch
    // inside it: the `e2e-react` project's discovery is a plain `testDir`, so a
    // `visual/` subdirectory would be swept into it and the functional tier's
    // test count would change. Keeping the tree outside means nothing about the
    // two existing projects' discovery is edited at all — this project addition
    // is additive in the strict sense.
    //
    // Snapshots go to their own directory, so the Angular tier's 11 committed
    // PNGs (tests/__snapshots__/visual/) and these are never confused for one
    // another; the Angular tree is deleted with its tier at Task 24 and this one
    // survives.
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
      metadata: { deviceScaleFactor: 1 },
    },
  ],
});
