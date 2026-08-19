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
 *
 * ── The double boot: settled, with numbers (Task 20) ────────────────────────
 *
 * PLAN.md Task 20 trap (a) asked whether the double boot can be eliminated
 * without a `window.ts` change. **It cannot, and it is kept deliberately.**
 * What was measured and decided:
 *
 *  - **Cost: ~790ms per launch.** Timed launch-to-window with everything else
 *    equal: `react=1301ms`, `angular=510ms`. The tier launches an app per test,
 *    so at ~160 launches the redirect is roughly two minutes of a full run.
 *  - **Leakage: none, and it is now asserted rather than assumed.** The
 *    redirect fires immediately after `domcontentloaded`, before Angular's
 *    bootstrap reaches any of its own persistence writers. Probed on a fresh
 *    userData dir: `AppState.openTabs` is `[]`, `activeTabId` is `null`, and
 *    localStorage holds exactly one key — `joinery:theme-preference`, which is
 *    React's own theme mirror (`persistence/theme-mirror.ts:37`). Not one of
 *    Angular's six keys (`joinery:welcomeDismissed`, `joinery-settings`,
 *    `joinery:completed-tours`, `joinery-snippets`,
 *    `joinery-ctrl-e-execute-confirmed`, `joinery-flyway-placeholder-values`)
 *    was present. **`tests/e2e-react/shell.spec.ts` asserts this every run**,
 *    because the failure mode if the race were ever lost is quiet: React's
 *    one-shot legacy migration (`persistence/migration.ts`) would import
 *    Angular-authored keys as though a real user had left them.
 *  - **The one alternative that exists was rejected on evidence.**
 *    `window.ts:110` already honours an env var: `NODE_ENV=development` makes
 *    it `loadURL('http://localhost:4200')`, so serving the React build there
 *    would skip the Angular document entirely and cost nothing. It is worse.
 *    The renderer would then be loaded over `http://` instead of the `file://`
 *    it actually ships on, and several behaviours differ across exactly that
 *    line — the CSP (`default-src 'none'` over `file://` is why the results
 *    grid exports through IPC rather than a synthetic `<a download>`), relative
 *    asset resolution, and origin-scoped storage. A suite that tested the app
 *    under a loading mode it never ships in would be buying 790ms with the
 *    fidelity that is the entire point of an e2e tier.
 *
 * The guard that makes the redirect safe in the first place is the per-launch
 * `mkdtemp` userData dir below: whatever any boot writes goes to a directory
 * that is deleted in `withJoinery`'s `finally`.
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

/**
 * macOS's three scroller-style settings, spelled as Cocoa's `AppleShowScrollBars` preference does.
 *
 * `Always` is legacy (space-taking) scrollbars, `WhenScrolling` is overlay, and `Automatic` — the
 * system default — resolves to one of the two from the attached pointing device. See
 * `LaunchOptions.macScrollBarStyle` for why a test would pin it.
 */
export type MacScrollBarStyle = 'Always' | 'Automatic' | 'WhenScrolling';

const MAC_SCROLL_BAR_STYLES: readonly MacScrollBarStyle[] = [
  'Always',
  'Automatic',
  'WhenScrolling',
];

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
 *
 * **Re-verified against the shipped CSS at Task 20**, which is the check PLAN.md
 * asks for — a face list is only useful if every entry resolves:
 *
 *  - the three families are exactly the ones `theme.css:267-274` binds to
 *    `--font-display` / `--font-interface` / `--font-technical`, and the
 *    `@import`s at `theme.css:40-45` are what provide them;
 *  - `"Archivo Variable"` at 800 is real: `@fontsource-variable/archivo/wdth.css`
 *    declares `font-weight: 100 900` on that family, so the display weight the
 *    brand uses (Archivo Narrow ExtraBold, reproduced from the variable family)
 *    is inside the range rather than being synthesised;
 *  - IBM Plex Mono is a static family here, and only 400 and 500 are imported —
 *    which is why the list asks for those two and no others.
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
  /**
   * Pin the window's device pixel ratio, in device pixels per CSS pixel.
   *
   * **Omitted by default, and that is deliberate: the functional tiers launch exactly as they always
   * did.** Only the visual tier passes it (`tests/e2e-react-visual/fixtures.ts`), because only a
   * screenshot cares.
   *
   * ── The defect this exists to prevent (J-21, ledger Ruling 5) ──────────────────────────────
   *
   * The Angular visual tier is RED for two reasons, and the second one is not about pixels at all:
   * its baselines were captured on a display that reported `devicePixelRatio: 2`, so every PNG is
   * 2800×1800 for a 1400×900 window. A run whose window reports `1` produces a 1400×900 image, and
   * `toHaveScreenshot` compares SIZES before it compares content — so the tier fails with a
   * geometry mismatch on a machine where the UI is byte-identical, and the failure says nothing
   * about the UI. Nothing in that tier states a DPR anywhere, so which of the two a developer gets
   * is a property of the display they happen to be on.
   *
   * **Playwright's own `use.deviceScaleFactor` cannot fix it here.** That option is applied by
   * `browser.newContext`, and this suite has no browser context: `_electron.launch` starts a real
   * Electron whose windows are created by `packages/main/src/window.ts`. Setting it in the config
   * would type-check, do nothing, and read as though the tier were pinned. The honest lever is
   * Chromium's own `--force-device-scale-factor`, which Electron passes through to the compositor —
   * the same mechanism `--user-data-dir` above is honoured by. It scales rasterization only:
   * `BrowserWindow`'s width/height are CSS pixels either way, so the layout under test is unchanged
   * and only the image's pixel dimensions move.
   *
   * The visual tier asserts `window.devicePixelRatio` equals what it asked for, so a switch that
   * ever stopped being honoured fails there rather than silently re-introducing the trap.
   */
  deviceScaleFactor?: number;
  /**
   * Pin macOS's scroller style for this process, as the `AppleShowScrollBars` preference names it.
   *
   * **Omitted by default, exactly like `deviceScaleFactor` above: absent, the argv is byte-identical
   * to what it always was**, so the functional tiers launch as they always did. Only the visual tier
   * passes it, because only a screenshot cares.
   *
   * ── The defect this exists to prevent ─────────────────────────────────────────────────────────
   *
   * macOS has two scroller styles. *Legacy* scrollbars take layout space — a scrolling container is
   * 15 CSS px narrower inside than out — while *overlay* scrollbars float above the content and take
   * none. The React renderer ships no `::-webkit-scrollbar` rules, so the platform's choice is the
   * app's layout: every scrolling panel's content reflows by 15px between the two modes.
   *
   * The system default is `Automatic`, and macOS resolves *that* from the pointing device attached
   * at the time — plug in a mouse and it becomes legacy, unplug it and it becomes overlay. So which
   * mode a baseline is captured in, and which one it is later compared in, is a property of what was
   * on the developer's desk. Measured on this tier: baselines captured in legacy mode fail 3 of 22
   * outright in overlay mode, with a fourth passing only inside the pixel tolerance — a red tier that
   * says nothing about the UI, which is the same class of defect as the DPR trap above.
   *
   * ── Why argv, and the probe that says it is honoured ──────────────────────────────────────────
   *
   * Cocoa builds an `NSArgumentDomain` from the process's own argv: a `-key value` pair becomes a
   * `NSUserDefaults` entry for this process only, and it outranks every persisted domain. So this is
   * a *per-launch* pin that never touches the user's settings — no `defaults write`, nothing to clean
   * up, nothing that can leak into another app or survive a crashed run.
   *
   * That Electron/Chromium actually honours it was verified rather than assumed (throwaway probe,
   * measuring `offsetWidth - clientWidth` of a scrolling div inside a CSS-free iframe):
   *
   * | launch | scrollbar gutter |
   * | --- | --- |
   * | no pin (host resolves `Automatic`) | **0 px** (overlay) |
   * | `-AppleShowScrollBars Always` | **15 px** (legacy) |
   * | `-AppleShowScrollBars WhenScrolling` | 0 px |
   * | `-AppleShowScrollBars Automatic` | 0 px |
   *
   * The visual tier measures that same gutter after launch and asserts the mode it asked for, so an
   * Electron that stopped honouring the argument domain fails there instead of quietly re-arming the
   * trap. macOS-only by nature; the visual tier is macOS-only anyway (its fixture paths are POSIX
   * literals).
   *
   * The long-term structural alternative — styling the app's scrollbars so the platform mode stops
   * mattering — is a `packages/` change and is recorded in `plans/renderer-rewrite/PLAN.md`.
   */
  macScrollBarStyle?: MacScrollBarStyle;
}

export async function launchJoinery(options: LaunchOptions = {}): Promise<LaunchedApp> {
  // Argument preconditions first, before anything is created — a throw below the `mkdtemp` would
  // leak the user-data dir it had already made (Task 22 review, M1).
  //
  // Both checks are opt-in: an option that was not passed contributes no argv at all, so an
  // unpinned launch's command line is byte-identical to what it was before either existed.
  if (options.deviceScaleFactor !== undefined && !(options.deviceScaleFactor > 0)) {
    throw new Error(
      `[electron-app] deviceScaleFactor must be a positive number, got ${String(options.deviceScaleFactor)}`
    );
  }
  if (
    options.macScrollBarStyle !== undefined &&
    !MAC_SCROLL_BAR_STYLES.includes(options.macScrollBarStyle)
  ) {
    throw new Error(
      `[electron-app] macScrollBarStyle must be one of ${MAC_SCROLL_BAR_STYLES.join(', ')}, ` +
        `got ${JSON.stringify(options.macScrollBarStyle)}`
    );
  }

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

  // Both spreads are empty unless the caller asked, so an unpinned launch's argv is byte-identical
  // to what it was. See each option's own documentation for the defect it prevents.
  const scaleFactorArgs =
    options.deviceScaleFactor === undefined
      ? []
      : [`--force-device-scale-factor=${options.deviceScaleFactor}`];
  // A Cocoa `-key value` pair, not a Chromium `--switch`: it lands in this process's
  // NSArgumentDomain and is read from there by AppKit. Two argv entries, deliberately.
  const scrollBarArgs =
    options.macScrollBarStyle === undefined
      ? []
      : ['-AppleShowScrollBars', options.macScrollBarStyle];

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`, ...scaleFactorArgs, ...scrollBarArgs],
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
