/**
 * Electron launch helper for E2E tests.
 *
 * Spins up the built Forge app via Playwright's Electron driver, waits for
 * the renderer to load, and returns the app + first window. Each test should
 * call `launchForge()` and `await app.close()` (or use the helper's
 * `withForge` form for guaranteed teardown).
 *
 * Requires `pnpm run build` to have produced packages/main/dist/index.js and
 * packages/renderer/dist/browser/index.html.
 */

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Playwright's TS loader emits CJS, so `__dirname` is available natively.
// Avoiding `import.meta.url` keeps this helper loadable from playwright specs.
const REPO_ROOT = join(__dirname, '..', '..');
const MAIN_ENTRY = join(REPO_ROOT, 'packages', 'main', 'dist', 'index.js');
const RENDERER_INDEX = join(REPO_ROOT, 'packages', 'renderer', 'dist', 'browser', 'index.html');

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
  /** Per-launch userData dir (isolated tmp). Cleaned up by withForge. */
  userDataDir: string;
}

export interface LaunchOptions {
  /**
   * Extra env vars to merge over the default Forge launch env. Useful
   * for tests that need to perturb the host (e.g. restricting PATH so
   * the CLI dep probe fails and the missing-tools view renders).
   */
  envOverrides?: Record<string, string>;
}

export async function launchForge(options: LaunchOptions = {}): Promise<LaunchedApp> {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(
      `[electron-app] expected built main process at ${MAIN_ENTRY}. ` +
        `Run \`pnpm run build\` first.`
    );
  }
  if (!existsSync(RENDERER_INDEX)) {
    throw new Error(
      `[electron-app] expected renderer build at ${RENDERER_INDEX}. ` +
        `Run \`pnpm run build\` first.`
    );
  }

  // Isolated user-data dir per launch so any profiles / settings created
  // during a test never leak into the next launch (which would shift the
  // welcome screen baseline once a saved profile starts showing up there).
  // The --user-data-dir flag is honored by Electron and routes both
  // electron-store and the keychain credential namespace into the temp dir.
  const userDataDir = mkdtempSync(join(tmpdir(), 'forge-test-userdata-'));

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      // FORGE_TEST signals the main process to skip non-essential startup
      // (currently: keep the window hidden so it doesn't flash during tests).
      FORGE_TEST: '1',
      // Force production mode so the main process loads the built renderer
      // from disk instead of trying to connect to localhost:4200.
      NODE_ENV: 'production',
      // Surface main-process console output so test failures around IPC /
      // connection / keytar are diagnosable.
      ELECTRON_ENABLE_LOGGING: '1',
      // Per-test overrides land last so they win over the defaults.
      ...(options.envOverrides ?? {}),
    },
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  // Self-hosted fonts load async (font-display: swap), so screenshots can
  // race font loading and visual baselines flip between fallback-font and
  // Inter renders. Passively watching document.fonts.status is NOT enough —
  // it reads "loaded" before any text has even requested a face. Force
  // every face the UI uses to load, then await completion. String form
  // keeps this file free of the DOM lib (tests tsconfig targets node).
  await window.evaluate(`(async () => {
    await Promise.all([
      document.fonts.load('400 1em Inter'),
      document.fonts.load('500 1em Inter'),
      document.fonts.load('600 1em Inter'),
      document.fonts.load('700 1em Inter'),
      document.fonts.load('400 1em "JetBrains Mono"'),
      document.fonts.load('500 1em "JetBrains Mono"'),
      document.fonts.load('24px "Material Icons"'),
    ]);
    await document.fonts.ready;
  })()`);
  return { app, window, userDataDir };
}

/**
 * Convenience wrapper that guarantees teardown even if the test body throws.
 *
 * `optionsOrFn` keeps the original 1-arg form (`withForge(fn)`) working
 * while letting newer tests pass launch options too: `withForge({
 * envOverrides }, fn)`.
 */
export async function withForge<T>(fn: (launched: LaunchedApp) => Promise<T>): Promise<T>;
export async function withForge<T>(
  options: LaunchOptions,
  fn: (launched: LaunchedApp) => Promise<T>
): Promise<T>;
export async function withForge<T>(
  optionsOrFn: LaunchOptions | ((launched: LaunchedApp) => Promise<T>),
  maybeFn?: (launched: LaunchedApp) => Promise<T>
): Promise<T> {
  const [options, fn]: [LaunchOptions, (launched: LaunchedApp) => Promise<T>] =
    typeof optionsOrFn === 'function' ? [{}, optionsOrFn] : [optionsOrFn, maybeFn!];
  const launched = await launchForge(options);
  try {
    return await fn(launched);
  } finally {
    try {
      await launched.app.close();
    } catch (err) {
      console.error('[electron-app] failed to close Forge cleanly:', err);
    }
    try {
      rmSync(launched.userDataDir, { recursive: true, force: true });
    } catch (err) {
      console.error('[electron-app] failed to clean userData dir:', err);
    }
  }
}
