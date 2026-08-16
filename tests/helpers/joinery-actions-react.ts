/**
 * E2E interaction helpers for the **React** renderer (`packages/renderer-react`).
 *
 * A separate file from `joinery-actions.ts` on purpose, and not a shared
 * abstraction over both: the Angular helper is Material-coupled end to end
 * (`mat-form-field` filtered by `mat-label:text-is(…)`, `mat-dialog-container`,
 * `.mat-mdc-menu-panel [role="menuitem"]`, `.mat-mdc-snack-bar-container button`)
 * and PLAN.md Task 20 exists to delete it. Sharing would drag those locators
 * forward; the two files coexist for exactly as long as the two renderers do.
 *
 * Locator rules here, and they are the whole point:
 *
 *  - `data-testid` for anything this suite asserts on or drives;
 *  - ARIA roles and states where the platform already names the thing
 *    (`role="menuitem"`, `aria-level`, `aria-expanded`) — those are contracts,
 *    not implementation details;
 *  - **zero** structural classes, zero component-library internals, zero icon
 *    ligature text.
 *
 * The seeded database fixtures are shared with the Angular tier — they are
 * about the *container*, not the UI — so `TEST_PG` and `ensureJoineryTestSeeded`
 * are re-exported from the old helper rather than duplicated.
 */

import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import {
  withJoinery,
  type LaunchOptions,
  type LaunchedApp,
  type RendererTarget,
} from './electron-app';
import { TEST_PG, ensureJoineryTestSeeded } from './joinery-actions';

export { TEST_PG, ensureJoineryTestSeeded };

/** How long a real connect to the seeded container is allowed to take. */
const CONNECT_TIMEOUT_MS = 20_000;
/** Everything else: a store write plus a React commit. */
const UI_TIMEOUT_MS = 10_000;

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

// ── The connection editor (Task 9) ──────────────────────────────────────────
//
// This block replaces the interim `seedPostgresProfiles`, which wrote profiles
// straight through the preload bridge because no UI could author one yet. It is
// gone: every profile in this tier is now created the way a user creates one.
// What that buys is coverage of the dialog itself — the engine transform, the
// per-field validation, the keychain hand-off — none of which a bridge write
// exercised, and it removes the page reload the bridge path needed to get the
// renderer's profile list to notice.
//
// `getByLabel` throughout, with `exact: true`. The Field primitive emits a real
// `<label for>` (`renderer-react/src/ui/field.tsx`), which is the whole reason
// PLAN.md's Task 20 says `fillField` collapses to `getByLabel` — the Angular
// helper had to match `mat-form-field` filtered by `mat-label:text-is(…)`.
// `exact` matters: the default is a case-insensitive substring match, so a bare
// `getByLabel('Server')` also matches "Trust the server certificate" and
// `getByLabel('Password')` also matches "SSH password".

/** The connection editor dialog. */
export function connectionEditor(window: Page): Locator {
  return window.getByTestId('connection-editor');
}

/** The connection manager dialog. */
export function connectionManager(window: Page): Locator {
  return window.getByTestId('connection-manager');
}

/** Open the editor from the sidebar's header button — the always-available entry point. */
export async function openConnectionEditor(window: Page): Promise<Locator> {
  await window.getByTestId('sidebar-new-connection').click();
  const editor = connectionEditor(window);
  await expect(editor).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return editor;
}

/**
 * Pick an option from one of the editor's Radix selects.
 *
 * The listbox is portalled to the document body, so the option is located on the
 * page rather than inside the dialog. `role="option"` is an ARIA contract the
 * primitive guarantees, not an implementation detail.
 */
export async function selectEditorOption(
  window: Page,
  triggerTestId: string,
  optionLabel: string
): Promise<void> {
  await window.getByTestId(triggerTestId).click();
  const option = window.getByRole('option', { name: optionLabel, exact: true });
  await expect(option).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await option.click();
  await expect(option).toHaveCount(0, { timeout: UI_TIMEOUT_MS });
}

/**
 * Fill the open editor for the seeded PostgreSQL container.
 *
 * The engine goes first and that ordering is load-bearing: switching it rewrites
 * the port and the username (`form-model.ts:applyEngineChange`), so filling
 * those first would have them overwritten.
 */
export async function fillPostgresForm(window: Page, profileName: string): Promise<void> {
  const editor = connectionEditor(window);

  await selectEditorOption(window, 'connection-engine', 'PostgreSQL');
  await editor.getByLabel('Connection name', { exact: true }).fill(profileName);
  await editor.getByLabel('Server', { exact: true }).fill(TEST_PG.host);
  await editor.getByLabel('Port', { exact: true }).fill(String(TEST_PG.port));
  await editor.getByLabel('Username', { exact: true }).fill(TEST_PG.user);
  await editor.getByLabel('Password', { exact: true }).fill(TEST_PG.password);
  await editor.getByLabel('Default database', { exact: true }).fill(TEST_PG.database);
  // The stock dev PG image does not speak SSL, and Joinery defaults to encrypt-on.
  await editor.getByLabel('Encrypt the connection', { exact: true }).uncheck();
}

/** Press Test and wait for the dialog to stop being busy. Returns the failure panel's locator. */
export async function testConnectionInEditor(window: Page): Promise<Locator> {
  const editor = connectionEditor(window);
  await editor.getByTestId('connection-test').click();
  // The button carries a spinner while the call is out; it is back to its label when the result
  // (success toast, or the inline panel) has landed.
  await expect(editor.getByTestId('connection-test')).toHaveText('Test', {
    timeout: CONNECT_TIMEOUT_MS,
  });
  return editor.getByTestId('connection-test-result');
}

/**
 * Save the open editor and wait for the profile to reach the sidebar.
 *
 * No page reload, unlike the bridge path this replaced: `connectionStore.saveProfile` reloads the
 * profile list itself, so the picker appears on the same commit.
 */
export async function saveConnectionEditor(window: Page): Promise<void> {
  await connectionEditor(window).getByTestId('connection-save').click();
  await expect(connectionEditor(window)).toBeHidden({ timeout: UI_TIMEOUT_MS });
  await expect(window.getByTestId('sidebar-connection-trigger')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  });
}

/** Create one PostgreSQL profile end to end through the editor. */
export async function createPostgresProfile(window: Page, profileName: string): Promise<void> {
  await openConnectionEditor(window);
  await fillPostgresForm(window, profileName);
  await saveConnectionEditor(window);
}

/** Create several, in order. Each one is a full open-fill-save pass. */
export async function createPostgresProfiles(
  window: Page,
  profileNames: readonly string[]
): Promise<void> {
  for (const profileName of profileNames) {
    await createPostgresProfile(window, profileName);
  }
}

/**
 * Create a profile and connect with it in one pass, using the editor's own Connect button — the
 * shortest real path from an empty app to a live connection.
 *
 * Waits for the expansion as well as for the row, for the reason `connectFromSidebar` documents.
 */
export async function createAndConnectPostgres(window: Page, profileName: string): Promise<void> {
  await openConnectionEditor(window);
  await fillPostgresForm(window, profileName);
  await connectionEditor(window).getByTestId('connection-connect').click();
  await expect(connectionEditor(window)).toBeHidden({ timeout: CONNECT_TIMEOUT_MS });

  const row = serverRow(window, profileName);
  await expect(row).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: CONNECT_TIMEOUT_MS });
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

/** Opens the sidebar's connection menu and returns it. */
export async function openConnectionMenu(window: Page): Promise<Locator> {
  await window.getByTestId('sidebar-connection-trigger').click();
  const menu = window.getByTestId('sidebar-connection-menu');
  await expect(menu).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return menu;
}

/**
 * Connect a seeded profile through the sidebar's own connection menu — the
 * real user path — and wait for its server node to be in the tree AND open.
 *
 * Waiting for the expansion, not just for the row, is deliberate: connecting
 * expands the new server node (`shell/sidebar/node-actions.ts:connectProfile`,
 * ported from `sidebar.component.ts:829-838`), so a caller that returned as
 * soon as the row appeared would race that expansion and a following
 * `expandTreeRow` could toggle the node shut instead of open.
 */
export async function connectFromSidebar(window: Page, profileName: string): Promise<void> {
  const menu = await openConnectionMenu(window);
  await menu
    .getByTestId('sidebar-connection-connect')
    .filter({ hasText: profileName })
    .first()
    .click();

  const row = serverRow(window, profileName);
  await expect(row).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: CONNECT_TIMEOUT_MS });
}

/** Pick a database from the sidebar's database picker. */
export async function selectDatabase(window: Page, databaseName: string): Promise<void> {
  await window.getByTestId('sidebar-database-trigger').click();
  const menu = window.getByTestId('sidebar-database-menu');
  await expect(menu).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await menu.getByTestId('sidebar-database-item').filter({ hasText: databaseName }).first().click();
  await expect(menu).toBeHidden({ timeout: UI_TIMEOUT_MS });
}

/** Every rendered tree row. The tree is virtualized, so this is rows *in view*. */
export function treeRows(window: Page): Locator {
  return window.getByTestId('sidebar-tree').getByTestId('tree-row');
}

/** One tree row by its visible label. */
export function treeRow(window: Page, label: string): Locator {
  return treeRows(window).filter({ hasText: label }).first();
}

/**
 * A *server* row, i.e. a root of the explorer forest.
 *
 * `aria-level="1"` rather than a node-id prefix: the tree's depth is an ARIA
 * contract the primitive guarantees, while the explorer store's id scheme
 * (`server-<connectionId>`) is its private business. The Angular spec keyed on
 * `aria-label*="(server)"`, which was the same idea via a string it built for
 * screen readers.
 */
export function serverRow(window: Page, profileName: string): Locator {
  return serverRows(window).filter({ hasText: profileName }).first();
}

/** All server rows. Used by the multi-connection spec's "the others survived" assertions. */
export function serverRows(window: Page): Locator {
  return window.getByTestId('sidebar-tree').locator('[data-testid="tree-row"][aria-level="1"]');
}

/**
 * Expand a row by clicking its twisty and wait for the expansion to land.
 *
 * The twisty specifically, not the row: this renderer separates selection from
 * expansion (a click selects, the twisty or a double-click expands), which the
 * Angular sidebar conflated — its click handler both selected AND toggled, so a
 * double-click toggled twice and did nothing.
 */
export async function expandTreeRow(window: Page, label: string): Promise<void> {
  const row = treeRow(window, label);
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS });
  // Idempotent: a server node is already open when `connectFromSidebar` returns, and a twisty
  // click on an open node collapses it.
  if ((await row.getAttribute('aria-expanded')) === 'true') return;
  await row.getByTestId('tree-row-twisty').click();
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: UI_TIMEOUT_MS });
}

/** Right-click a row and return its context menu. */
export async function openNodeMenu(window: Page, label: string): Promise<Locator> {
  const row = treeRow(window, label);
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await row.click({ button: 'right' });
  const menu = window.getByTestId('sidebar-node-menu');
  await expect(menu).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return menu;
}

/** Right-click a server row and choose Disconnect. */
export async function disconnectServer(window: Page, profileName: string): Promise<void> {
  const row = serverRow(window, profileName);
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await row.click({ button: 'right' });
  const menu = window.getByTestId('sidebar-node-menu');
  await expect(menu).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await menu.getByTestId('sidebar-menu-disconnect').click();
  await expect(menu).toBeHidden({ timeout: UI_TIMEOUT_MS });
}

// ── The query tab (Task 10) ─────────────────────────────────────────────────
//
// Monaco is a vendor surface, so it is located structurally — `.view-lines`,
// `.suggest-widget`, `.mtk*` — which is the one exemption PLAN.md's test-hook
// rule grants ("Vendor internals (`.monaco-editor`, `.ag-*`, Dockview's classes)
// may be located structurally"). Everything Joinery owns around it has a
// `query-*` testid.

/** The editor's host element. Monaco's own DOM hangs off it. */
export function queryEditor(window: Page): Locator {
  return window.getByTestId('query-editor');
}

/**
 * Opens a query tab and waits for Monaco to have painted a line.
 *
 * Tolerant of a tab already being open, because connecting can open one itself
 * (`sidebar.tsx`'s `openQueryForConnection`) — and the sidebar's New Query button
 * deliberately refuses to open a SECOND tab for a connection that already has one.
 *
 * The wait is on `.view-lines`, not on the panel: the panel is behind a lazy
 * boundary (`shell/workspace/query-panel-host.tsx`), so `query-panel` appearing
 * means the chunk loaded and Monaco is still mounting.
 */
export async function openQueryTab(window: Page): Promise<Locator> {
  if ((await window.getByTestId('query-panel').count()) === 0) {
    await window.getByTestId('sidebar-new-query').click();
  }
  await expect(window.getByTestId('query-panel')).toBeVisible({ timeout: UI_TIMEOUT_MS });
  const editor = queryEditor(window);
  await expect(editor.locator('.view-lines')).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return editor;
}

/**
 * Types SQL into the editor, replacing whatever was there.
 *
 * `insertText` rather than `type`: Monaco's auto-indent and bracket completion
 * rewrite typed input, so a multi-line `type()` produces SQL that is not the SQL
 * the test asked for. `insertText` arrives as one input event, which Monaco
 * inserts verbatim.
 */
export async function typeSql(window: Page, sql: string): Promise<void> {
  const editor = await openQueryTab(window);
  await editor.locator('.view-lines').click();
  await window.keyboard.press('ControlOrMeta+a');
  await window.keyboard.insertText(sql);
  await expect(editor.locator('.view-lines')).toContainText(sql.split('\n')[0]?.trim() ?? '', {
    timeout: UI_TIMEOUT_MS,
  });
}

/**
 * What the editor is showing, with Monaco's rendering artefacts normalised.
 *
 * Monaco renders leading whitespace as `&nbsp;` and only renders the lines in
 * view, so this is "what the user can see", not "the document".
 */
export async function visibleSql(window: Page): Promise<string> {
  const lines = await queryEditor(window).locator('.view-line').allTextContents();
  return lines.map(line => line.replace(/\u00a0/g, ' ')).join('\n');
}

/**
 * Opens the suggest widget and returns its rows.
 *
 * `Control+Space` on every platform, because that is what Monaco binds
 * `editor.action.triggerSuggest` to on macOS as well. Triggering it explicitly
 * rather than relying on the provider's `' '` trigger character is deliberate:
 * `typeSql` uses `insertText`, which arrives as one input event and does not
 * necessarily run Monaco's per-character trigger logic.
 */
export async function suggestions(window: Page): Promise<Locator> {
  await window.keyboard.press('Control+Space');
  const widget = queryEditor(window).locator('.suggest-widget.visible');
  await expect(widget).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return widget.locator('.monaco-list-row');
}

/**
 * Runs the query from the toolbar and waits for the run to finish.
 *
 * "Finished" is the executing indicator being gone from the status bar, which is
 * the store's `running` map emptying — the same source of truth the toolbar's
 * disabled state reads.
 */
export async function executeQuery(window: Page): Promise<void> {
  await window.getByTestId('query-execute').click();
  await expect(window.getByTestId('status-executing')).toBeHidden({ timeout: CONNECT_TIMEOUT_MS });
}

// ── The results grid (Task 11) ──────────────────────────────────────────────
//
// AG Grid is a vendor surface, so its internals are located structurally —
// `.ag-row`, `.ag-header-cell`, `[col-id]` — which is the exemption PLAN.md's
// test-hook rule grants ("Vendor internals (`.monaco-editor`, `.ag-*`,
// Dockview's classes) may be located structurally"). Everything Joinery owns
// around the cells has a `results-*` testid.
//
// Two AG Grid 36 facts these helpers exist to hold in one place, both probed
// against the running app rather than read from the docs:
//
//  1. rows live in `.ag-grid-scrolling-container`, not the `.ag-center-cols-container`
//     of the v32-era DOM the Angular suite knew, and one row element carries
//     every cell including the pinned ones;
//  2. rows are ABSOLUTELY POSITIONED AND RECYCLED, so DOM order is not visual
//     order. `row-index` is the only honest ordering, which is why
//     `gridColumnValues` sorts by it. A spec that read `.ag-row` in DOM order
//     would conclude a visibly descending grid had not sorted.

/** The grid host. Joinery's element, not AG Grid's. */
export function resultsGrid(window: Page): Locator {
  return window.getByTestId('results-grid');
}

/** Every rendered row. The grid virtualizes, so this is rows *in view*. */
export function gridRows(window: Page): Locator {
  return resultsGrid(window).locator('.ag-grid-scrolling-container .ag-row');
}

/** The data column headers, in order — without the ordinal gutter or the checkbox column. */
export async function gridColumnHeaders(window: Page): Promise<string[]> {
  return resultsGrid(window)
    .locator(
      '.ag-header-row-column .ag-header-cell:not([col-id="rowNumber"]):not([col-id="ag-Grid-SelectionColumn"]) .ag-header-cell-text'
    )
    .allTextContents();
}

/**
 * One column's rendered values, in DISPLAYED order (see fact 2 above).
 *
 * Returns what the cells show, which is the formatted value — `NULL` for an absent one, a grouped
 * integer for a number. The raw values are what the clipboard carries; that is asserted separately.
 */
export async function gridColumnValues(window: Page, colId: string): Promise<string[]> {
  const rows = await gridRows(window).evaluateAll((elements, column) => {
    return elements
      .map(element => ({
        index: Number(element.getAttribute('row-index')),
        value: element.querySelector(`.ag-cell[col-id="${column}"]`)?.textContent ?? '',
      }))
      .sort((a, b) => a.index - b.index)
      .map(entry => entry.value);
  }, colId);
  return rows;
}

/** Click a column header once: unsorted → ascending → descending, as AG Grid cycles it. */
export async function sortGridColumn(window: Page, colId: string): Promise<void> {
  await resultsGrid(window)
    .locator(`.ag-header-row-column .ag-header-cell[col-id="${colId}"] .ag-header-cell-label`)
    .click();
}

/** What the grid says about a column's sort, through the ARIA contract rather than a class. */
export function gridSortState(window: Page, colId: string): Locator {
  return resultsGrid(window).locator(`.ag-header-row-column .ag-header-cell[col-id="${colId}"]`);
}

/**
 * Tick a row's checkbox, addressed by its DISPLAYED index.
 *
 * The input inside the wrapper is the hit target; clicking the cell around it does nothing.
 */
export async function selectGridRow(window: Page, displayedIndex: number): Promise<void> {
  await resultsGrid(window)
    .locator(`.ag-grid-scrolling-container .ag-row[row-index="${displayedIndex}"]`)
    .locator('.ag-cell[col-id="ag-Grid-SelectionColumn"] input')
    .click({ force: true });
}

/**
 * Press the toolbar's Copy button and return what landed on the system clipboard.
 *
 * Read through Electron's own `clipboard` module in the MAIN process rather than
 * `navigator.clipboard.readText()` in the page: the renderer's read requires a permission prompt
 * that a headless Electron never answers, while the main-process module is synchronous and needs no
 * permission. It is also the honest assertion — what is being checked is that the bytes reached the
 * *system* clipboard, which is where the user's next ⌘V reads from.
 */
export async function copyGridSelection(app: ElectronApplication, window: Page): Promise<string> {
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await window.getByTestId('results-copy').click();
  // The toast is the copy's own completion signal: the component only fires it once
  // `navigator.clipboard.writeText` has resolved.
  await expect(
    window.locator('[data-sonner-toast]').filter({ hasText: 'to clipboard' })
  ).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return app.evaluate(({ clipboard }) => clipboard.readText());
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
