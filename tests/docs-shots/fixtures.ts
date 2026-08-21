/**
 * The documentation screenshot harness: what every capture in this directory gets before it may
 * take a picture, and where the picture goes.
 *
 * ── What this tier is, and what it is NOT ──────────────────────────────────────────────────────
 *
 * It is a **capture** tier, not a comparison tier. Nothing here calls `toHaveScreenshot`, nothing
 * here has a baseline, and nothing here can ever be answered with `--update-snapshots`. Each test
 * drives the real app to one surface and writes one PNG into `docs-site/src/assets/screenshots/`,
 * which is committed and consumed by the docs site through Astro's asset pipeline
 * (`plans/docs-site/PROPOSAL.md` §6.3).
 *
 * That distinction is why it is a separate Playwright project rather than more specs in
 * `visual-react`, and the DPR is the other half of the reason: the visual tier pins **1** so its
 * baselines compare (J-21's capture-at-2/compare-at-1 geometry trap), and the docs want **2** so
 * the images are crisp on retina. Same launcher, same helpers, opposite pins — so they cannot share
 * a project, and this tier writes to a directory the visual tier's baselines are not in.
 *
 * ── The five things pinned per launch, each asserted rather than requested ─────────────────────
 *
 *  1. **Device pixel ratio**, from `metadata.deviceScaleFactor`, via Chromium's
 *     `--force-device-scale-factor` — Playwright's own `use.deviceScaleFactor` is applied by
 *     `browser.newContext` and this suite has no browser context (see `electron-app.ts`).
 *  2. **macOS scroller style**, from `metadata.macScrollBarStyle`. Legacy scrollbars take 15 CSS px
 *     of layout width and overlay ones take none, and macOS resolves its default from the attached
 *     pointing device — so unpinned, every panel in every shot reflows by 15px depending on whose
 *     desk the capture ran on.
 *  3. **Content size**, from `metadata.contentWidth`/`contentHeight`. The app's own default is
 *     1400x900 (`packages/main/src/window.ts`) but it is clamped to the work area of whatever
 *     display is attached, so an unpinned window is a fact about the developer's monitor. Every
 *     full-window shot in this set would otherwise change shape between machines.
 *  4. **The status bar's version chip**, corrected to the version a packaged build reports. An
 *     unpackaged launch makes `app.getVersion()` answer with ELECTRON's version, so the shots said
 *     "Joinery v41.10.5" — see `pinVersionChip`.
 *  5. **Theme**, picked through the status bar's own menu. `system` resolves through Electron's
 *     `nativeTheme`, i.e. through the host's macOS appearance setting.
 *
 * Plus three guards at capture time that are about *content* rather than about geometry: nothing may
 * be showing a tooltip, nothing may be showing the Docker panel (see `assertNoDockerPanel` for why
 * that is the difference between a fixture-only shot and a picture of a laptop), and the version
 * chip must still read the pinned value.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  CONNECT_TIMEOUT_MS,
  UI_TIMEOUT_MS,
  withJoineryReact,
} from '../helpers/joinery-actions-react';
import type { LaunchedApp, MacScrollBarStyle } from '../helpers/electron-app';
import { DOCS_SHOTS, shotFileName, type DocsTheme } from './catalogue';
import { RECORDS_DIR, SHOTS_DIR, type ShotRecord } from './paths';

export { expect, test };
export type { DocsTheme };

// Playwright's TS loader emits CJS, so `__dirname` is available natively — the same reason
// `electron-app.ts` avoids `import.meta.url`.
const REPO_ROOT = join(__dirname, '..', '..');

/** The pixel geometry every shot in the set shares, as the project declares it. */
export interface ShotGeometry {
  readonly deviceScaleFactor: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
}

/**
 * Read one number out of the project's `metadata`, which Playwright types as `any`.
 *
 * Validated rather than trusted for the reason the visual tier's equivalent gives: a config typo
 * would otherwise reach `--force-device-scale-factor=undefined` and read as though the tier were
 * pinned.
 */
function pinnedNumber(key: string): number {
  const raw: unknown = test.info().project.metadata[key];
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    throw new Error(
      `[docs-shots] the docs-shots project must set metadata.${key} to a positive integer; ` +
        `got ${JSON.stringify(raw)}`
    );
  }
  return raw;
}

/**
 * The scroller style, which may only be `Always`.
 *
 * Same reasoning as the visual tier's: the per-launch guard below knows exactly one expectation —
 * that a scrolling container has a non-zero scrollbar gutter — so a project pinning `WhenScrolling`
 * or `Automatic` would run with a guard asserting the opposite of what it asked for.
 */
function pinnedScrollBarStyle(): MacScrollBarStyle {
  const raw: unknown = test.info().project.metadata['macScrollBarStyle'];
  if (raw !== 'Always') {
    throw new Error(
      `[docs-shots] the docs-shots project must set metadata.macScrollBarStyle to "Always"; ` +
        `got ${JSON.stringify(raw)}`
    );
  }
  return raw;
}

/** The geometry this project declares, validated. */
export function shotGeometry(): ShotGeometry {
  return {
    deviceScaleFactor: pinnedNumber('deviceScaleFactor'),
    contentWidth: pinnedNumber('contentWidth'),
    contentHeight: pinnedNumber('contentHeight'),
  };
}

/**
 * Measure how many CSS pixels a scrolling container loses to its scrollbar, in this window.
 *
 * Lifted in behaviour from `tests/e2e-react-visual/fixtures.ts` — the probe is an iframe, whose
 * document inherits no author CSS, so the number is a fact about the platform rather than about
 * whatever `::-webkit-scrollbar` rules the renderer might grow. String form keeps the DOM lib out
 * of a file the tests tsconfig compiles as node.
 */
async function scrollBarGutterPx(window: Page): Promise<number> {
  const measured: unknown = await window.evaluate(`(async () => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;top:-9999px;width:200px;height:200px;border:0;';
    frame.srcdoc = '<!doctype html><body style="margin:0">' +
      '<div id="probe" style="width:100px;height:100px;overflow:scroll">' +
      '<div style="width:300px;height:300px"></div></div>';
    const loaded = new Promise(resolve => { frame.onload = resolve; });
    document.body.appendChild(frame);
    await loaded;
    const probe = frame.contentDocument && frame.contentDocument.getElementById('probe');
    if (!probe) {
      frame.remove();
      throw new Error('[docs-shots] the scrollbar probe iframe did not render');
    }
    const gutter = probe.offsetWidth - probe.clientWidth;
    frame.remove();
    return gutter;
  })()`);
  if (typeof measured !== 'number' || !Number.isFinite(measured)) {
    throw new Error(`[docs-shots] the scrollbar probe returned ${JSON.stringify(measured)}`);
  }
  return measured;
}

/**
 * Resize the window's *content* area to the pinned geometry, and prove the renderer agrees.
 *
 * `setContentSize` rather than `setSize` because the shot is of the web contents: the OS title bar
 * is not in the picture (Playwright screenshots the page, not the frame), so sizing the frame would
 * make the captured height depend on the title bar's height.
 *
 * The assertion is on `innerWidth`/`innerHeight` — Electron's sizes are in DIP and the renderer's
 * are in CSS pixels, and `--force-device-scale-factor` is exactly the kind of switch that could make
 * those two disagree. Asserted, a disagreement fails here with both numbers named rather than
 * silently producing a set of shots at a size nobody chose.
 */
async function pinContentSize(
  launched: LaunchedApp,
  geometry: ShotGeometry
): Promise<{ width: number; height: number }> {
  await launched.app.evaluate(
    ({ BrowserWindow }, size) => {
      const [window] = BrowserWindow.getAllWindows();
      if (window === undefined) throw new Error('no BrowserWindow to size');
      window.setContentSize(size.width, size.height);
    },
    { width: geometry.contentWidth, height: geometry.contentHeight }
  );

  // The resize is asynchronous on macOS (the window server acknowledges it), so this converges
  // rather than reading once. Bounded by `toPass`'s own timeout, per the house rule on loops.
  await expect(async () => {
    const inner: unknown = await launched.window.evaluate('[innerWidth, innerHeight]');
    expect(inner).toEqual([geometry.contentWidth, geometry.contentHeight]);
  }).toPass({ timeout: UI_TIMEOUT_MS, intervals: [50, 100, 250, 500] });

  return { width: geometry.contentWidth, height: geometry.contentHeight };
}

/**
 * No documentation shot may contain the Docker panel.
 *
 * ── The defect this exists to prevent, which has a precedent in this repo ─────────────────────
 *
 * J-23: the eight PNGs under `docs/screenshots/` were deleted rather than rebranded because
 * `home-screen-*.png` published an internal Azure SQL hostname on the repo's front page. Capturing
 * from `tests/helpers/db-fixtures.ts` fixes the connection profiles structurally — every host,
 * database, schema and row in this set comes from the fixture. One surface is not fixed by that,
 * because it does not read Joinery's state at all: **the Docker panel lists every database
 * container on the host**. `services/docker/detector.ts` filters `listContainers({ all: true })` by
 * IMAGE name, not by compose project, so it names the developer's own containers — stopped ones
 * included. The visual tier captured that panel, inspected it, and pulled the baseline for exactly
 * this reason (`tests/e2e-react-visual/overlays.spec.ts` header: `mjpg`, `some-postgres`,
 * `sql-cert-fts`), and this machine's list is longer still.
 *
 * The catalogue therefore declares no Docker-panel shot. This is the structural half of that
 * decision: a panel left open by a spec that used it to reach something else would put the same
 * names into whatever picture came next, and it would do so silently. Checked at every capture, in
 * the same family as the tooltip check beside it.
 *
 * ── What this does NOT make deterministic, stated rather than papered over ────────────────────
 *
 * The status bar's pip and the welcome panel's Docker card render a COUNT over that same host-wide
 * list ("Docker: 4 of 9 database containers running"). A count names nobody and leaks nothing, but
 * it is a fact about the machine that captured the shot, so the two hero shots that show it will
 * differ on a different developer's laptop. Making it reproducible needs a deterministic container
 * source behind `docker.detect` — a change under `packages/`, which this task does not own. Named
 * here and in the report rather than left to be discovered.
 */
async function assertNoDockerPanel(page: Page, name: string): Promise<void> {
  await expect(
    page.getByTestId('docker-panel'),
    `the Docker panel was open when ${name} was captured — it lists every database container on ` +
      `the host, including the developer's own, which is why no shot in this set contains it`
  ).toHaveCount(0, { timeout: UI_TIMEOUT_MS });
}

/**
 * Pick a theme from the status bar's own theme menu, and leave nothing focused or hovered behind.
 *
 * Lifted in behaviour from the visual tier, including its two hard-won details: the menu's exit is
 * waited for (a shot with a dropdown over it is not a shot of the surface), and the trigger is
 * blurred in a converging loop because Radix's focus-restore and the menu's exit animation are not
 * ordered against each other — a single `blur()` that lands first is simply undone, and Radix's
 * tooltip opens on FOCUS as well as on hover, so the result is "Theme: Ink" floating over the
 * bottom-right corner of every shot that reaches that far down.
 */
async function pinTheme(window: Page, theme: DocsTheme): Promise<void> {
  const trigger = window.getByTestId('status-theme-trigger');
  await trigger.click();
  await window.getByTestId(`status-theme-${theme}`).click();
  await expect(window.locator('html')).toHaveAttribute('data-theme', theme, {
    timeout: UI_TIMEOUT_MS,
  });
  await expect(window.getByTestId('status-theme-menu')).toBeHidden({ timeout: UI_TIMEOUT_MS });
  await window.mouse.move(0, 0);

  await expect(async () => {
    await trigger.blur();
    await expect(trigger).not.toBeFocused({ timeout: 500 });
    await expect(window.locator('[role="tooltip"]:visible')).toHaveCount(0, { timeout: 500 });
  }).toPass({ timeout: UI_TIMEOUT_MS, intervals: [50, 100, 250, 500] });
}

/** A bounded wait, so every step of the teardown below has a stated maximum. */
function afterMs(milliseconds: number): Promise<'timeout'> {
  return new Promise(resolve => setTimeout(() => resolve('timeout'), milliseconds));
}

/** How long each stage of the teardown may take. Small: nothing here has work worth waiting for. */
const ASK_TO_EXIT_MS = 3_000;
const EXIT_GRACE_MS = 3_000;
const KILL_GRACE_MS = 5_000;

/**
 * End the app's process, within a stated bound, so the launcher's `close()` has nothing to wait for.
 *
 * ── The defect this works around, with the measurement ─────────────────────────────────────────
 *
 * `withJoinery`'s teardown is `await launched.app.close()`, and on a loaded machine that call can
 * hang **indefinitely**. Measured across the capture runs done for J-99 Phase 3 on a host whose load
 * average sat between 120 and 220 for the whole session: more than a dozen tests blew their timeout,
 * and the Playwright trace for each shows the same shape — every action including the screenshot
 * completed, then `Close context` never returned. So the picture was taken and the test went red
 * anyway, which for a capture tier is the worst of both.
 *
 * The general fix belongs in `tests/helpers/electron-app.ts`, and that is a shared helper three
 * other tiers launch through — out of scope here, and written up in the J-99 Phase 3 report as its
 * own ticket. What this tier can do without touching anyone else's launcher is stop *needing* the
 * graceful path, because it has nothing to shut down gracefully: the user-data directory is a
 * `mkdtemp` deleted seconds later, no shot writes app state worth flushing, and the fixture
 * containers cope with an abrupt disconnect (every tier already loses apps this way when a run is
 * interrupted).
 *
 * ── Three stages, each bounded, ending in a guarantee ──────────────────────────────────────────
 *
 *  1. **Ask.** `app.exit(0)` inside the main process. `setTimeout(…, 0)` rather than calling it
 *     inline is load-bearing: `evaluate` has to return before the process dies, or the call itself
 *     is what hangs. Raced against `ASK_TO_EXIT_MS`, because a wedged main process cannot answer.
 *  2. **Wait.** For the child process to actually exit, bounded by `EXIT_GRACE_MS`.
 *  3. **Kill.** `SIGKILL` if it is still alive. This is the stage that makes the whole thing a
 *     guarantee rather than a hope — the first version of this helper only did stage 1, and a run
 *     under load still lost tests, because an `evaluate` that never returns leaves the same hang
 *     behind it. Playwright's own worker teardown kills the same process the same way.
 *
 * Failures are reported, not swallowed — `console` is the only channel a Playwright fixture has at
 * this point, and throwing here would replace whatever the test actually failed with.
 */
async function endAppProcess(launched: LaunchedApp): Promise<void> {
  const child = launched.app.process();
  const hasExited = (): boolean => child.exitCode !== null || child.signalCode !== null;
  const exited = new Promise<void>(resolve => {
    if (hasExited()) return resolve();
    child.once('exit', () => resolve());
  });

  await Promise.race([
    launched.app
      .evaluate(({ app }) => {
        setTimeout(() => app.exit(0), 0);
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console -- no logger and no test context left at teardown.
        console.error('[docs-shots] the app would not take an exit request:', err);
      }),
    afterMs(ASK_TO_EXIT_MS),
  ]);

  await Promise.race([exited, afterMs(EXIT_GRACE_MS)]);
  if (hasExited()) return;

  // eslint-disable-next-line no-console -- the same channel; this is a fact worth seeing in a log.
  console.error('[docs-shots] the app did not exit on request; killing it so close() can return');
  child.kill('SIGKILL');
  const outcome = await Promise.race([exited, afterMs(KILL_GRACE_MS)]);
  if (outcome === 'timeout') {
    // eslint-disable-next-line no-console -- nothing else can be done here, but it must be visible.
    console.error(
      '[docs-shots] the app survived SIGKILL; close() will hang and the test will fail'
    );
  }
}

/**
 * The version string the app *should* be showing, read from the same `package.json` the manifest's
 * `appVersion` is read from.
 *
 * One source, two consumers, so the sidecar and the picture cannot disagree — which they did before
 * this existed (manifest `0.5.0`, image `v41.10.5`).
 */
function packageVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  const version =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { version?: unknown }).version
      : undefined;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('[docs-shots] the root package.json has no string `version`');
  }
  return version;
}

/** What the status bar's version segment must read in every shot that contains it. */
export function expectedVersionChip(): string {
  return `Joinery v${packageVersion()}`;
}

/**
 * Correct the status bar's version chip to Joinery's real version.
 *
 * ── Why a documentation shot has to patch the DOM ──────────────────────────────────────────────
 *
 * `app.getVersion()` returns the version from the `package.json` beside Electron's app path. This
 * harness launches UNPACKAGED, with `args: [packages/main/dist/index.js]`, and that directory has no
 * `package.json` — so Electron falls back to reporting **its own** version, and the status bar reads
 * "Joinery v41.10.5". A packaged build reads `0.5.0` correctly, so the number in the image is an
 * artefact of how the tier launches the app and not something a user will ever see. Shipping it on
 * the landing page would be publishing a false fact about the product (review M1).
 *
 * The honest fix is in the launcher — point Electron at the repo root, whose `package.json` carries
 * both `"main"` and the real version — but that changes the launch for all four tiers and the
 * controller ruled it out of scope for this task. So the correction is tier-local and applied to the
 * one DOM node that renders it (`shell/status-bar.tsx`'s `status-version`, the only render site in
 * the renderer).
 *
 * ── Why it is safe to patch, and why it is checked rather than trusted ─────────────────────────
 *
 * The segment's text is a leaf React renders once, when the `app.getVersion` IPC resolves; React
 * does not rewrite a text node whose props have not changed, so the patch survives the re-renders
 * the footer does for the Docker pip. "Does not" is not "cannot", which is why `capture()` ASSERTS
 * the chip on every shot rather than assuming this held — the same pin-then-assert shape as the DPR,
 * the scroller style, the content size and the theme.
 *
 * Waits for the real value first: the segment reads the bare word "Joinery" until the IPC answers,
 * and patching before that would be overwritten by the answer.
 */
export async function pinVersionChip(window: Page): Promise<void> {
  const chip = window.getByTestId('status-version');
  await expect(chip).toHaveText(/^Joinery v\d/, { timeout: CONNECT_TIMEOUT_MS });
  await chip.evaluate((element, text) => {
    element.textContent = text;
  }, expectedVersionChip());
  await expect(chip).toHaveText(expectedVersionChip(), { timeout: UI_TIMEOUT_MS });
}

/**
 * Scroll every scrolling box inside `root` back to its top.
 *
 * `scrollIntoViewIfNeeded()` is not a substitute and was the bug this replaces (review M3): it
 * scrolls the MINIMUM distance to reveal the element, so an input ends up flush against the top edge
 * of the scroll box with its own `<label>` above the fold — which is how four Getting Started shots
 * came to open on a horizontally bisected "Connection name".
 *
 * Every box rather than a named one, because the scroll box is `ui/dialog.tsx`'s `DialogBody` and it
 * carries no testid; finding it by class would couple this tier to a Tailwind string. "Anything that
 * scrolls, back to zero" is the property the callers actually want, and it is stated directly.
 */
export async function scrollToTop(root: Locator): Promise<void> {
  await root.evaluate(element => {
    for (const node of [element, ...element.querySelectorAll('*')]) {
      if (node.scrollHeight > node.clientHeight) node.scrollTop = 0;
    }
  });
}

/**
 * Scroll `target`'s nearest scrolling ancestor so that `target`'s top edge is the frame's top edge.
 *
 * The deliberate counterpart to `scrollToTop`, for a shot whose subject is a section partway down a
 * long form — the SSH tunnel block of the connection editor. `scrollIntoViewIfNeeded()` is again the
 * wrong tool for the same reason: it moves the minimum distance, so the section lands wherever it
 * lands and the row above it gets sliced.
 */
export async function scrollToFrameTop(target: Locator): Promise<void> {
  await target.evaluate(element => {
    let box = element.parentElement;
    while (box !== null && box.scrollHeight <= box.clientHeight) box = box.parentElement;
    if (box === null) return;
    box.scrollTop += element.getBoundingClientRect().top - box.getBoundingClientRect().top;
  });
}

/**
 * Assert `inner` is drawn entirely inside `outer`'s box, so a shot of `outer` contains all of it.
 *
 * The check M3 asks for. A label whose top edge is above the scroll box is still "visible" to
 * Playwright — `toBeVisible` is about layout and opacity, not about clipping by an ancestor's
 * `overflow` — so a bisected label passes every assertion the tier had before this one.
 */
export async function assertFullyFramed(
  inner: Locator,
  outer: Locator,
  what: string
): Promise<void> {
  const innerBox = await inner.boundingBox();
  const outerBox = await outer.boundingBox();
  expect(innerBox, `${what}: the element to frame has no box`).not.toBeNull();
  expect(outerBox, `${what}: the frame has no box`).not.toBeNull();
  if (innerBox === null || outerBox === null) return;
  expect(
    innerBox.y >= outerBox.y && innerBox.y + innerBox.height <= outerBox.y + outerBox.height,
    `${what}: it spans y ${innerBox.y}..${innerBox.y + innerBox.height} but the frame is ` +
      `${outerBox.y}..${outerBox.y + outerBox.height}, so the shot would cut it`
  ).toBe(true);
}

/**
 * Let `root` lay out at its full content height, so a shot of it is the whole thing.
 *
 * For a dialog whose content is taller than the window, every scroll position cuts something at one
 * edge or the other — and `ai-setup-dark` cut a toggle switch horizontally through its middle, which
 * reads as a rendering bug rather than as a scroll affordance (review m6). Scrolling cannot fix that
 * when the box is already at `scrollTop: 0`; there is simply more content than frame.
 *
 * So the constraint is lifted for the capture. Playwright's element screenshot captures an element
 * taller than the viewport in full, and the result is the picture the page actually wants: header,
 * every section, footer. Asserted afterwards — if anything still scrolls, the shot would still be
 * cut and the test says so instead of producing one.
 */
export async function expandToContent(root: Locator): Promise<void> {
  await root.evaluate(element => {
    const boxes = [element, ...element.querySelectorAll('*')];
    for (const node of boxes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node !== element && node.scrollHeight <= node.clientHeight) continue;
      node.style.maxHeight = 'none';
      node.style.height = 'auto';
      if (node !== element) node.style.overflow = 'visible';
    }
  });

  const stillScrolling: unknown = await root.evaluate(
    element =>
      [element, ...element.querySelectorAll('*')].filter(
        node => node.scrollHeight > node.clientHeight
      ).length
  );
  expect(
    stillScrolling,
    'a box inside this surface still scrolls after the height constraint was lifted, so the shot ' +
      'would still be cut off'
  ).toBe(0);
}

/** The launch knobs a docs shot may need. A subset of `LaunchOptions`, so the pins stay this tier's. */
export interface DocsLaunchOptions {
  /** Extra env for the launch — `missing-cli-tools` needs a `PATH` without the backup binaries. */
  readonly envOverrides?: Record<string, string>;
  /** Files written into the launch's isolated user-data dir before Electron starts. */
  readonly seedUserData?: (userDataDir: string) => void;
}

/**
 * Launch the app with everything this tier pins, prove each pin landed, then run the body.
 *
 * Order matters and is not arbitrary: geometry before content (a resize reflows every panel), the
 * version chip once the status bar has answered, and the theme pin last so the body starts from a UI
 * at rest — its final act is to leave nothing focused and no tooltip up.
 *
 * The `finally` is the teardown workaround documented on `endAppProcess`, and it runs on the
 * failure path too: a test that threw still leaves a process the launcher has to close.
 */
export async function withDocsApp(
  theme: DocsTheme,
  body: (launched: LaunchedApp) => Promise<void>,
  launch: DocsLaunchOptions = {}
): Promise<void> {
  const geometry = shotGeometry();
  const macScrollBarStyle = pinnedScrollBarStyle();

  await withJoineryReact(
    {
      deviceScaleFactor: geometry.deviceScaleFactor,
      macScrollBarStyle,
      ...(launch.envOverrides === undefined ? {} : { envOverrides: launch.envOverrides }),
      ...(launch.seedUserData === undefined ? {} : { seedUserData: launch.seedUserData }),
    },
    async launched => {
      const dpr = await launched.window.evaluate('window.devicePixelRatio');
      expect(
        dpr,
        '--force-device-scale-factor was not honoured — the docs shots would be captured at the ' +
          'display DPR rather than at the retina ratio the docs site is built for'
      ).toBe(geometry.deviceScaleFactor);

      const gutter = await scrollBarGutterPx(launched.window);
      expect(
        gutter,
        `-AppleShowScrollBars ${macScrollBarStyle} was not honoured: a scrolling container lost ` +
          `${gutter}px to its scrollbar, i.e. this launch has macOS OVERLAY scrollbars. Every ` +
          `panel in every shot reflows by 15px between the two modes`
      ).toBeGreaterThan(0);

      await pinContentSize(launched, geometry);
      await pinVersionChip(launched.window);
      await pinTheme(launched.window, theme);
      try {
        await body(launched);
      } finally {
        await endAppProcess(launched);
      }
    }
  );
}

/**
 * Wait until both of the status bar's volatile readouts have arrived.
 *
 * Not for masking — this tier masks nothing, because a pink rectangle in a documentation image is
 * worse than the pixels it hides. It is a *settling* wait: `status-version` renders the word
 * "Joinery" until `app.getVersion` answers and "Joinery v0.5.0" afterwards, and the Docker pip
 * renders no count at all while its probe is in flight. A shot taken mid-flight shows a half-built
 * status bar, which is simply a wrong picture.
 */
export async function settleStatusBar(window: Page): Promise<void> {
  await expect(window.getByTestId('status-version')).toHaveText(/^Joinery v\d/, {
    timeout: CONNECT_TIMEOUT_MS,
  });
  await expect(window.getByTestId('status-docker-toggle')).not.toHaveAttribute(
    'data-docker-state',
    'checking',
    { timeout: CONNECT_TIMEOUT_MS }
  );
  await expect(window.getByTestId('status-docker-count')).toBeVisible({
    timeout: CONNECT_TIMEOUT_MS,
  });
}

/**
 * Drop focus to `<body>`, so nothing in a shot is focused because of how the state was built.
 *
 * Monaco draws its own caret as a `<div class="cursor">`, which Playwright's `caret: 'hide'` does
 * not reach — that option hides the native text caret. The visual tier measured the difference
 * exactly: a 2x20 rectangle appearing and disappearing between otherwise identical captures.
 * `locator.blur()` is not usable on Monaco's textarea (a 1px transparent input fails actionability),
 * so `document.activeElement` is blurred directly and the result asserted.
 *
 * ── Why it converges rather than firing once ───────────────────────────────────────────────────
 *
 * A single `blur()` is a RACE against Radix, and it cost this tier a red run: closing a
 * `Select`/`DropdownMenu` restores focus to its trigger, and that restore is an effect that is not
 * ordered against the caller — so a `blur()` that lands BEFORE it is simply undone, and the next
 * assertion reads `BUTTON` instead of `BODY`. The visual tier hit the identical shape in its theme
 * pin and solved it the identical way. Bounded by `toPass`'s own timeout, per the house rule on
 * loops; a focus that genuinely cannot be dropped still fails, with the tag name named.
 */
export async function blurFocus(window: Page): Promise<void> {
  await expect(async () => {
    await window.evaluate(
      'document.activeElement instanceof HTMLElement && document.activeElement.blur()'
    );
    expect(await window.evaluate('document.activeElement?.tagName')).toBe('BODY');
  }).toPass({ timeout: UI_TIMEOUT_MS, intervals: [50, 100, 250, 500] });
}

/**
 * Read a PNG's pixel dimensions out of its own header.
 *
 * "Every shot has the dimensions it had last run" is this tier's first determinism check, and until
 * now it was only checkable by re-deriving the numbers with an image tool. Recording them per file
 * makes the sidecar answer it — and gives Astro's `<Image>` the intrinsic size for free (review n8).
 *
 * The IHDR chunk is the first one in every PNG and its layout is fixed: an 8-byte signature, a
 * 4-byte length, the four bytes `IHDR`, then width and height as big-endian `uint32`. So this is 24
 * bytes of a file format that cannot change, not a parser.
 */
function pngDimensions(path: string): { readonly width: number; readonly height: number } {
  const header = readFileSync(path).subarray(0, 24);
  const signature = header.subarray(0, 8).toString('latin1');
  if (signature !== '\x89PNG\r\n\x1a\n' || header.subarray(12, 16).toString('latin1') !== 'IHDR') {
    throw new Error(`[docs-shots] ${path} is not a PNG with a leading IHDR chunk`);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/**
 * Take one documentation shot, and record what it is.
 *
 * `Page | Locator` for the same reason the visual tier's `shoot` takes both: some surfaces are the
 * whole window (the workspace, where the frame IS the subject) and some are one element (a dialog,
 * where the scrim behind it is not).
 *
 * The name and theme are checked against `catalogue.ts` before anything is written. That is what
 * makes the manifest complete rather than hopeful: a spec that captures a name the catalogue does
 * not declare fails here, and a catalogue entry no spec captures fails in the manifest step.
 */
export async function capture(
  target: Page | Locator,
  name: string,
  theme: DocsTheme,
  surface: string
): Promise<void> {
  const declared = DOCS_SHOTS.find(shot => shot.name === name);
  if (declared === undefined) {
    throw new Error(
      `[docs-shots] ${name} is not declared in tests/docs-shots/catalogue.ts — every shot in the ` +
        `set is declared there so the manifest can be assembled from a checked list`
    );
  }
  if (!declared.themes.includes(theme)) {
    throw new Error(
      `[docs-shots] ${name} is declared for themes ${declared.themes.join(', ')}, not ${theme}`
    );
  }

  const page = 'reload' in target ? target : target.page();

  // ── Park the pointer before anything is measured ────────────────────────────────────────────
  //
  // Playwright's mouse has a position, and it is wherever the last `click()` left it — so a surface
  // that appears UNDER that position gets a hover state that has nothing to do with the surface.
  // Measured on the completion widget: `openQueryTab` clicks in the editor, the suggest widget opens
  // over the click point, and whichever row lands under it is drawn with the list's hover
  // background. Two captures in seven differed by 33,674 pixels for exactly that reason. Nothing in
  // this set is a picture of a hover state, so the pointer is moved out of the way of all of them.
  //
  // Before the tooltip check below rather than after: moving the pointer is itself something that
  // can open or close a tooltip, so the check has to see the resting state.
  await page.mouse.move(0, 0);

  // No tooltip may be up. The theme pin leaves focus on the status bar's theme trigger and Radix
  // opens tooltips on focus, so this is a reproducible artefact rather than a flaky one — which is
  // what makes it dangerous. `:visible` is load-bearing: Monaco keeps two hidden `role="tooltip"`
  // widgets mounted for the life of an editor.
  await expect(
    page.locator('[role="tooltip"]:visible'),
    `a tooltip was showing when ${name} was captured`
  ).toHaveCount(0, { timeout: UI_TIMEOUT_MS });

  await assertNoDockerPanel(page, name);

  // The version chip, wherever it is mounted — not only when it is in the frame. `pinVersionChip`
  // corrects a number that would otherwise be a false fact about the product on a public page (see
  // its own note), and a pin that is not asserted rots: this is what catches a spec that reloaded
  // the renderer, or a future contributor who deleted the patch. Checked on the PAGE rather than on
  // the captured element because an element shot of a dialog still comes from a window whose status
  // bar the next full-window shot will show.
  await expect(
    page.getByTestId('status-version'),
    `the status bar's version chip was not the pinned one when ${name} was captured — see ` +
      `pinVersionChip(); a launch that reloads the renderer has to re-apply it`
  ).toHaveText(expectedVersionChip(), { timeout: UI_TIMEOUT_MS });

  const geometry = shotGeometry();
  const file = shotFileName(name, theme);
  const path = join(SHOTS_DIR, file);
  mkdirSync(SHOTS_DIR, { recursive: true });

  // `scale: 'device'` is what makes the DPR pin reach the file: at 'css' the shot would be written
  // at one image pixel per CSS pixel and the retina render would be thrown away.
  //
  // One call, not a branch per union member: `Page` and `Locator` both have a `screenshot` that
  // accepts these options, so the narrowing that used to be here produced two identical statements.
  const shoot: Pick<Locator, 'screenshot'> | Pick<Page, 'screenshot'> = target;
  await shoot.screenshot({ path, animations: 'disabled', caret: 'hide', scale: 'device' });

  const dimensions = pngDimensions(path);
  const record: ShotRecord = {
    file,
    name,
    theme,
    surface,
    spec: relative(REPO_ROOT, test.info().file),
    viewport: { width: geometry.contentWidth, height: geometry.contentHeight },
    deviceScaleFactor: geometry.deviceScaleFactor,
    width: dimensions.width,
    height: dimensions.height,
    bytes: statSync(path).size,
  };
  mkdirSync(RECORDS_DIR, { recursive: true });
  writeFileSync(join(RECORDS_DIR, `${file}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}
