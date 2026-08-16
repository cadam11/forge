/**
 * Electron launch helper for E2E tests.
 *
 * Spins up the built Joinery app via Playwright's Electron driver, waits for
 * the renderer to load, and returns the app + first window. Each test should
 * call `launchJoinery()` and `await app.close()` (or use the helper's
 * `withJoinery` form for guaranteed teardown).
 *
 * Requires `pnpm run build` to have produced packages/main/dist/index.js and
 * the target renderer's dist/browser/index.html.
 *
 * ── Two renderers, one main process ────────────────────────────────────────
 *
 * The React rewrite (`packages/renderer-react`) coexists with the Angular
 * renderer until the cutover task. `renderer` selects which one a launch
 * shows, defaulting to `angular` (or `$JOINERY_E2E_RENDERER`) so the existing
 * functional tier is bit-for-bit unaffected — that default IS the coexistence
 * invariant.
 *
 * `packages/main/src/window.ts:114` hard-codes the Angular index path and the
 * main process is out of scope for the rewrite tasks, so the React target is
 * reached by re-pointing the already-created BrowserWindow at the React
 * index after launch. That is a test-only redirect, and it is sound because
 * the preload script is attached to the *window* (`window.ts:63`), not to the
 * document: the bridge re-installs itself on the new page exactly as it does
 * on the first one. The alternative — an env var read by `window.ts` — would
 * put test wiring in the shipped main process.
 */

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Playwright's TS loader emits CJS, so `__dirname` is available natively.
// Avoiding `import.meta.url` keeps this helper loadable from playwright specs.
const REPO_ROOT = join(__dirname, '..', '..');
const MAIN_ENTRY = join(REPO_ROOT, 'packages', 'main', 'dist', 'index.js');

/** Which renderer package a launch should show. */
export type RendererTarget = 'angular' | 'react';

const RENDERER_INDEXES: Record<RendererTarget, string> = {
  angular: join(REPO_ROOT, 'packages', 'renderer', 'dist', 'browser', 'index.html'),
  react: join(REPO_ROOT, 'packages', 'renderer-react', 'dist', 'browser', 'index.html'),
};

/**
 * The faces each renderer actually paints with, forced before any assertion —
 * see the `document.fonts.load` block below for why passively awaiting
 * `document.fonts.ready` is not enough.
 *
 * The lists differ and MUST differ: the React renderer ships the brand faces
 * (Archivo / Instrument Sans / IBM Plex Mono, `renderer-react/src/styles/theme.css`)
 * and no Material Icons font at all — it uses lucide SVGs. Forcing `Inter` and
 * `"Material Icons"` there would resolve against nothing, silently succeed, and
 * let a shot flip between a fallback render and a real one.
 */
const RENDERER_FONTS: Record<RendererTarget, readonly string[]> = {
  angular: [
    '400 1em Inter',
    '500 1em Inter',
    '600 1em Inter',
    '700 1em Inter',
    '400 1em "JetBrains Mono"',
    '500 1em "JetBrains Mono"',
    '24px "Material Icons"',
  ],
  react: [
    '400 1em "Instrument Sans Variable"',
    '500 1em "Instrument Sans Variable"',
    '800 1em "Archivo Variable"',
    '400 1em "IBM Plex Mono"',
    '500 1em "IBM Plex Mono"',
  ],
};

/**
 * The target for this launch: the explicit option, then the env var, then
 * Angular. An unrecognised env value throws rather than silently falling back —
 * a typo that quietly ran the wrong renderer would make a green suite meaningless.
 */
export function resolveRendererTarget(explicit?: RendererTarget): RendererTarget {
  const raw = explicit ?? process.env.JOINERY_E2E_RENDERER ?? 'angular';
  if (raw !== 'angular' && raw !== 'react') {
    throw new Error(
      `[electron-app] JOINERY_E2E_RENDERER must be "angular" or "react", got ${JSON.stringify(raw)}`
    );
  }
  return raw;
}

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
  /** Per-launch userData dir (isolated tmp). Cleaned up by withJoinery. */
  userDataDir: string;
  /** Which renderer this launch is showing. */
  renderer: RendererTarget;
}

export interface LaunchOptions {
  /**
   * Extra env vars to merge over the default Joinery launch env. Useful
   * for tests that need to perturb the host (e.g. restricting PATH so
   * the CLI dep probe fails and the missing-tools view renders).
   */
  envOverrides?: Record<string, string>;
  /** Renderer package to show. Defaults to `$JOINERY_E2E_RENDERER`, then `angular`. */
  renderer?: RendererTarget;
}

export async function launchJoinery(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const renderer = resolveRendererTarget(options.renderer);
  const rendererIndex = RENDERER_INDEXES[renderer];

  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(
      `[electron-app] expected built main process at ${MAIN_ENTRY}. ` +
        `Run \`pnpm run build\` first.`
    );
  }
  if (!existsSync(rendererIndex)) {
    throw new Error(
      `[electron-app] expected the ${renderer} renderer build at ${rendererIndex}. ` +
        `Run \`pnpm run build\` first.`
    );
  }

  // Isolated user-data dir per launch so any profiles / settings created
  // during a test never leak into the next launch (which would shift the
  // welcome screen baseline once a saved profile starts showing up there).
  // The --user-data-dir flag is honored by Electron and routes both
  // electron-store and the keychain credential namespace into the temp dir.
  const userDataDir = mkdtempSync(join(tmpdir(), 'joinery-test-userdata-'));

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      // JOINERY_TEST signals the main process to skip non-essential startup
      // (currently: keep the window hidden so it doesn't flash during tests).
      JOINERY_TEST: '1',
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

  // The React redirect. Only for that target, so the Angular path is the same
  // sequence of calls it always was.
  if (renderer === 'react') {
    await redirectToReactRenderer(app, window, rendererIndex);
  }

  await forceFonts(window, renderer);
  return { app, window, userDataDir, renderer };
}

/**
 * Re-points the live BrowserWindow at the React renderer's index.
 *
 * Two things about this are the result of measurement rather than taste:
 *
 *  - **`loadFile`'s promise is deliberately not awaited.** Superseding a navigation makes the
 *    previous one fail with `ERR_ABORTED (-3)`, and Electron delivers that failure to the *new*
 *    `loadFile` call's own listener — so awaiting it rejected with "loading '…/packages/renderer/
 *    dist/browser/index.html'", i.e. the URL we were navigating away from. The successful arrival
 *    is waited for below instead, which is the honest signal anyway.
 *  - **The wait is on the URL, not on a load state.** `waitForLoadState` resolves against whatever
 *    document is current, including the Angular one, so it can pass before the redirect has
 *    happened at all.
 */
async function redirectToReactRenderer(
  app: ElectronApplication,
  window: Page,
  rendererIndex: string
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, indexPath: string) => {
    const [target] = BrowserWindow.getAllWindows();
    if (!target) {
      throw new Error('[electron-app] no BrowserWindow to re-point at the React renderer');
    }
    void target.loadFile(indexPath).catch(() => undefined);
  }, rendererIndex);

  await window.waitForURL(/renderer-react\/dist\/browser\/index\.html$/, { timeout: 30_000 });
  await window.waitForLoadState('domcontentloaded');
}

/**
 * Self-hosted fonts load async (font-display: swap), so screenshots can race
 * font loading and visual baselines flip between fallback-font and real
 * renders. Passively watching document.fonts.status is NOT enough — it reads
 * "loaded" before any text has even requested a face. Force every face the
 * target renderer uses, then await completion.
 *
 * String form keeps this file free of the DOM lib (the tests tsconfig targets
 * node), which is also why the face list is interpolated rather than passed as
 * an argument.
 */
export async function forceFonts(window: Page, renderer: RendererTarget): Promise<void> {
  const loads = RENDERER_FONTS[renderer]
    .map(face => `document.fonts.load(${JSON.stringify(face)})`)
    .join(',\n      ');
  await window.evaluate(`(async () => {
    await Promise.all([
      ${loads},
    ]);
    await document.fonts.ready;
  })()`);
}

/**
 * Convenience wrapper that guarantees teardown even if the test body throws.
 *
 * `optionsOrFn` keeps the original 1-arg form (`withJoinery(fn)`) working
 * while letting newer tests pass launch options too: `withJoinery({
 * envOverrides }, fn)`.
 */
export async function withJoinery<T>(fn: (launched: LaunchedApp) => Promise<T>): Promise<T>;
export async function withJoinery<T>(
  options: LaunchOptions,
  fn: (launched: LaunchedApp) => Promise<T>
): Promise<T>;
export async function withJoinery<T>(
  optionsOrFn: LaunchOptions | ((launched: LaunchedApp) => Promise<T>),
  maybeFn?: (launched: LaunchedApp) => Promise<T>
): Promise<T> {
  const [options, fn]: [LaunchOptions, (launched: LaunchedApp) => Promise<T>] =
    typeof optionsOrFn === 'function' ? [{}, optionsOrFn] : [optionsOrFn, maybeFn!];
  const launched = await launchJoinery(options);
  try {
    return await fn(launched);
  } finally {
    try {
      await launched.app.close();
    } catch (err) {
      console.error('[electron-app] failed to close Joinery cleanly:', err);
    }
    try {
      rmSync(launched.userDataDir, { recursive: true, force: true });
    } catch (err) {
      console.error('[electron-app] failed to clean userData dir:', err);
    }
  }
}
