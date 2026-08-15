import { defineConfig } from '@playwright/test';

// Playwright + Electron config for the Joinery regression harness.
//
// Specs live under tests/e2e/. Each test launches its own Electron instance
// via tests/helpers/electron-app.ts.
//
// Two projects:
//   - e2e: functional E2E specs (anything not under tests/e2e/visual/)
//   - visual: snapshot baselines (anything under tests/e2e/visual/)
//
// `pnpm run test:e2e` and `pnpm run test:visual` invoke the projects separately
// so the static report and live dashboard can show them as distinct tiers.
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
  ],
});
