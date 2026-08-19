/**
 * Launching the React renderer, and the three things every other module in this directory needs:
 * the two timeout budgets, the exact-match text matcher, and the native-menu channel.
 *
 * ── Why this directory exists ────────────────────────────────────────────────
 *
 * `tests/helpers/joinery-actions-react.ts` accreted one section per Phase B task and reached 1,737
 * lines. Task 20 split it here, one module per surface family, and left that file as a barrel so no
 * spec's imports had to move — which is what makes the split provably behaviour-preserving: the
 * suite that was green before the split is byte-identical after it.
 *
 * ── Locator rules, and they are the whole point ──────────────────────────────
 *
 *  - `data-testid` for anything this suite asserts on or drives;
 *  - ARIA roles and states where the platform already names the thing (`role="menuitem"`,
 *    `aria-level`, `aria-expanded`) — those are contracts, not implementation details;
 *  - **zero** structural classes, zero component-library internals, zero icon ligature text —
 *    except the three documented vendor exemptions (Monaco, AG Grid, Dockview), each of which is
 *    confined to the one module that owns that surface and carries its own rationale.
 *
 * The seeded database fixtures below — `TEST_PG` and `ensureJoineryTestSeeded` — are about the
 * *container*, not the UI. They lived in `tests/helpers/joinery-actions.ts` while that file existed
 * and moved here unchanged at Task 24, when the Angular tier and its Material-coupled helper were
 * deleted.
 */

import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { Client as PgClient } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  withJoinery,
  type LaunchOptions,
  type LaunchedApp,
  type RendererTarget,
} from '../electron-app';

// Test PG container connection details (matches docker-compose.test.yml).
export const TEST_PG = {
  host: '127.0.0.1',
  port: 15432,
  user: 'joinery',
  password: 'joinery',
  database: 'joinery_test',
} as const;

/**
 * Idempotently seed the default `joinery_test` database with the synthetic
 * schema + data so functional / visual specs that connect via the UI find
 * a populated database. The integration tier uses isolated per-test DBs
 * via `withFreshDatabase` and never touches `joinery_test`.
 *
 * Two distinct schemas are seeded:
 *   - `public.*` — synthetic e-commerce (products / customers / orders /
 *     order_items). Used by everyday spec/visual tests.
 *   - `app_meta.*` — minimal app-metadata shape (user / application / entity)
 *     in a non-public schema. Used by the cross-schema-query regression
 *     tests; row counts chosen to match the legacy 31-suite expectations
 *     (11 applications, 24 entities).
 *
 * Each schema's presence is checked independently so adding either to an
 * existing seeded database doesn't redo the other.
 */
export async function ensureJoineryTestSeeded(): Promise<void> {
  const client = new PgClient({ ...TEST_PG });
  await client.connect();
  try {
    const fixturesRoot = join(__dirname, '..', '..', 'fixtures', 'postgres');

    // Public e-commerce schema.
    const ecomSeeded = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products'"
    );
    if (!(ecomSeeded.rowCount && ecomSeeded.rowCount > 0)) {
      await client.query(readFileSync(join(fixturesRoot, 'schema.sql'), 'utf8'));
      await client.query(readFileSync(join(fixturesRoot, 'seed.sql'), 'utf8'));
    }

    // app_meta schema.
    const appMetaSeeded = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'app_meta' AND table_name = 'entity'"
    );
    if (!(appMetaSeeded.rowCount && appMetaSeeded.rowCount > 0)) {
      await client.query(readFileSync(join(fixturesRoot, 'app-meta-schema.sql'), 'utf8'));
      await client.query(readFileSync(join(fixturesRoot, 'app-meta-seed.sql'), 'utf8'));
    }
  } finally {
    await client.end();
  }
}

/** How long a real connect to the seeded container is allowed to take. */
export const CONNECT_TIMEOUT_MS = 20_000;
/** Everything else: a store write plus a React commit. */
export const UI_TIMEOUT_MS = 10_000;

/**
 * The seeded MySQL container, mirroring `TEST_PG`.
 *
 * Declared here rather than imported from `db-fixtures.ts` for the reason `TEST_PG`'s own comment
 * gives: that module is the integration tier's, and this tier only needs the four connection facts.
 * The values match `TEST_CONNECTIONS.mysql` there.
 */
export const TEST_MYSQL = {
  host: '127.0.0.1',
  port: 13306,
  user: 'root',
  password: 'joinery',
  database: 'joinery_test',
} as const;

/**
 * An anchored regex for `filter({ hasText })`, so a filter means "is this text" and not
 * "contains this text".
 *
 * Playwright's `hasText` is a case-insensitive **substring** match on a string, and a whole class
 * of this suite's frailty lived there: `treeRow(window, 'orders')` also matched an
 * `orders_archive` row, `selectDatabase(window, 'joinery_test')` also matched a
 * `joinery_test_copy` menu item, and a `.first()` at the end of the chain turned the ambiguity into
 * a silently wrong target rather than an error. A `RegExp` `hasText` is matched against the
 * element's text instead, so anchoring it is exact.
 *
 * The escape covers the characters a database or profile name may legally contain (`.` and `$` most
 * of all) — an unescaped `.` would make the anchors decorative.
 */
export function exactly(text: string): RegExp {
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
}

/**
 * Which renderer every `withJoineryReact` launch in the current test actually showed.
 *
 * Recorded from `LaunchedApp.renderer` — the value the launcher resolved, not the one this file
 * asked for — so it is evidence rather than a restatement of the request. `tests/e2e-react/fixtures.ts`
 * asserts it after every test: all `react`, and at least one, which is what turns "a stray
 * `withJoinery` silently tested Angular" into a failure. A spec that bypasses this helper records
 * nothing and fails the "at least one" half.
 */
let launchedRendererLog: RendererTarget[] = [];

/** The renderers launched since the last reset. Read by the project fixture. */
export function launchedRenderers(): readonly RendererTarget[] {
  return launchedRendererLog;
}

/** Clears the log. Called by the project fixture before each test. */
export function resetLaunchedRenderers(): void {
  launchedRendererLog = [];
}

/**
 * `withJoinery`, pinned to the React renderer, so a spec under `tests/e2e-react/`
 * cannot accidentally run against Angular when `$JOINERY_E2E_RENDERER` is unset.
 */
export async function withJoineryReact<T>(fn: (launched: LaunchedApp) => Promise<T>): Promise<T>;
export async function withJoineryReact<T>(
  options: Omit<LaunchOptions, 'renderer'>,
  fn: (launched: LaunchedApp) => Promise<T>
): Promise<T>;
export async function withJoineryReact<T>(
  optionsOrFn: Omit<LaunchOptions, 'renderer'> | ((launched: LaunchedApp) => Promise<T>),
  maybeFn?: (launched: LaunchedApp) => Promise<T>
): Promise<T> {
  const [options, fn] =
    typeof optionsOrFn === 'function'
      ? [{}, optionsOrFn]
      : [optionsOrFn, maybeFn as (launched: LaunchedApp) => Promise<T>];

  return withJoinery({ ...options, renderer: 'react' }, async launched => {
    launchedRendererLog.push(launched.renderer);
    await waitForShell(launched.window);
    return fn(launched);
  });
}

/**
 * The boot gate: `AppShell` renders the startup screen until the stores are
 * hydrated (`renderer-react/src/shell/boot.ts`), so `app-shell` appearing is
 * the earliest moment any other locator means anything.
 */
export async function waitForShell(window: Page): Promise<void> {
  await expect(window.getByTestId('app-shell')).toBeVisible({ timeout: 20_000 });
  await expect(window.getByTestId('sidebar')).toBeVisible({ timeout: UI_TIMEOUT_MS });
}

/**
 * Dismiss every visible toast, so nothing overlaps the surface under assertion.
 *
 * Sonner stacks bottom-right and auto-dismisses after a few seconds; a save followed immediately by
 * an assertion on the status bar can race that. Bounded at ten so a toast that refuses to close fails
 * the loop's own cap rather than spinning.
 *
 * **Only callable with no modal dialog open**, and the assertion below enforces it rather than
 * letting the call hang for its full timeout. Radix sets `pointer-events: none` on `<body>` while a
 * modal is up and re-enables it only inside the dialog content, so a toast raised during a dialog is
 * visible (sonner's container sits far above the scrim's `z-40`) but inert until the dialog closes.
 * That is the correct modal contract — a modal blocks interaction with everything behind it — so this
 * helper states the precondition instead of working around it.
 */
export async function dismissToasts(window: Page): Promise<void> {
  await expect(
    window.locator('[role="dialog"]'),
    'dismissToasts cannot reach a toast while a modal dialog is open — close the dialog first'
  ).toHaveCount(0);

  const closeButton = window.locator('[data-sonner-toast] [data-close-button]').first();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!(await closeButton.isVisible())) return;
    await closeButton.click();
    await expect(closeButton).toBeHidden({ timeout: UI_TIMEOUT_MS });
  }
  throw new Error('[joinery-actions-react] more than ten toasts refused to dismiss');
}

/**
 * Fires one of the native menu's `menu:*` channels from the main process.
 *
 * The only way to reach a menu-only command from this tier. Electron menu
 * accelerators are handled by the native menu, which CDP-injected keystrokes
 * never reach, and `Menu.getApplicationMenu()` item clicks would exercise
 * `menu.ts`'s own wiring rather than the renderer's — that wiring is
 * `packages/main`'s and is covered there. What this drives is the renderer half:
 * the channel arrives, `shell/menu-bridge.tsx` maps it to a command id, and the
 * command bus delivers it. Which is exactly the path a user takes when they pick
 * Query ▸ Execute Selection.
 */
export async function sendMenuCommand(app: ElectronApplication, channel: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, name) => {
    const [window] = BrowserWindow.getAllWindows();
    if (window === undefined) throw new Error('no BrowserWindow to send a menu command to');
    window.webContents.send(name);
  }, channel);
}
