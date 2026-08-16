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
 * Fill the open editor for the seeded MySQL container.
 *
 * Engine first, for the same load-bearing reason `fillPostgresForm` documents: `applyEngineChange`
 * rewrites the port and the username.
 */
export async function fillMysqlForm(window: Page, profileName: string): Promise<void> {
  const editor = connectionEditor(window);

  await selectEditorOption(window, 'connection-engine', 'MySQL');
  await editor.getByLabel('Connection name', { exact: true }).fill(profileName);
  await editor.getByLabel('Server', { exact: true }).fill(TEST_MYSQL.host);
  await editor.getByLabel('Port', { exact: true }).fill(String(TEST_MYSQL.port));
  await editor.getByLabel('Username', { exact: true }).fill(TEST_MYSQL.user);
  await editor.getByLabel('Password', { exact: true }).fill(TEST_MYSQL.password);
  await editor.getByLabel('Default database', { exact: true }).fill(TEST_MYSQL.database);
  // The dev MySQL image does not speak TLS, and Joinery defaults to encrypt-on.
  await editor.getByLabel('Encrypt the connection', { exact: true }).uncheck();
}

/** Create one MySQL profile and connect with it, through the editor's own Connect button. */
export async function createAndConnectMysql(window: Page, profileName: string): Promise<void> {
  await openConnectionEditor(window);
  await fillMysqlForm(window, profileName);
  await connectionEditor(window).getByTestId('connection-connect').click();
  await expect(connectionEditor(window)).toBeHidden({ timeout: CONNECT_TIMEOUT_MS });

  const row = serverRow(window, profileName);
  await expect(row).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: CONNECT_TIMEOUT_MS });
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

// ── The backup wizard (Task 12) ─────────────────────────────────────────────
//
// One dialog for the whole flow, including the server file browser: that step is a
// body swap rather than a nested modal (PLAN.md §2.9), so there is exactly one
// `backup-dialog` on screen at every point and no locator here has to disambiguate.
//
// Everything the dialog says, it says INLINE — J-42: a toast raised while a modal is
// open is visible but inert, because Radix disables pointer events outside the dialog.
// So the assertions below are on `backup-progress` / `backup-success` / `backup-error`,
// never on a sonner toast, and `dismissToasts` is deliberately not used in this block
// (it refuses to run with a dialog open, by its own precondition).

/** How long a real dump of the seeded fixture database is allowed to take. */
const BACKUP_TIMEOUT_MS = 120_000;

/** The wizard. One per flow, whichever step it is showing. */
export function backupDialog(window: Page): Locator {
  return window.getByTestId('backup-dialog');
}

/**
 * Open the wizard from the sidebar's footer action — the entry point that needs no context menu
 * and is disabled until a database is selected, so reaching it also proves the selection landed.
 *
 * Waits for the **form**, not just for the dialog: on PG and MySQL the dialog opens on a
 * host-tool probe (`backup-tools-checking`), and a caller that filled the path field as soon as
 * the dialog appeared would race it.
 */
export async function openBackupDialog(window: Page): Promise<Locator> {
  await window.getByTestId('sidebar-backup').click();
  const dialog = backupDialog(window);
  await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(dialog.getByTestId('backup-path')).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return dialog;
}

/** Open the wizard from a database node's context menu, which carries its own target. */
export async function openBackupDialogFromNode(
  window: Page,
  databaseName: string
): Promise<Locator> {
  const menu = await openNodeMenu(window, databaseName);
  await menu.getByTestId('sidebar-menu-backup').click();
  const dialog = backupDialog(window);
  await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return dialog;
}

/**
 * Fill the destination and run the backup, returning once it has reached a terminal state.
 *
 * The wait is on the inline success panel and its **path readout**, which is the dialog's own
 * statement of what it wrote — the Angular spec waited on a snackbar, which is the thing J-42
 * makes unreliable above a modal.
 */
export async function runBackupTo(window: Page, destination: string): Promise<void> {
  const dialog = backupDialog(window);
  const path = dialog.getByTestId('backup-path');
  await path.fill(destination);
  await expect(path).toHaveValue(destination);

  await dialog.getByTestId('backup-start').click();
  // The stream is inline and it is the only "it started" signal there is.
  await expect(dialog.getByTestId('backup-progress')).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(dialog.getByTestId('backup-success')).toBeVisible({ timeout: BACKUP_TIMEOUT_MS });
  await expect(dialog.getByTestId('backup-success-path')).toHaveText(destination);
}

/** The missing-CLI-tools remediation view. Three of its testids are the legacy ones, verbatim. */
export function missingCliTools(window: Page): Locator {
  return window.getByTestId('missing-cli-tools');
}

/**
 * The server file browser, once a wizard's Choose… button has swapped it in.
 *
 * One component, two hosts: the backup wizard opens it in `mode="save"` and the restore wizard in
 * `mode="open"`, so the testid stays `backup-file-browser` in both — it names the component, not the
 * flow. `restore.spec.ts` drives it through this locator.
 */
export function serverFileBrowser(window: Page): Locator {
  return window.getByTestId('backup-file-browser');
}

// ── The restore wizard (Task 13) ────────────────────────────────────────────
//
// Restore is the one workflow in Joinery that destroys data, and the Angular
// dialog it replaces had no confirmation at all. That is why there are two
// separate run helpers below rather than one with a flag: `runRestoreIntoNew`
// asserts the confirmation is NOT asked for, and `runRestoreOver` walks it.
// A single helper that shrugged either way would hide the distinction the
// wizard exists to make.

/** How long a real restore of the seeded fixture database is allowed to take. */
const RESTORE_TIMEOUT_MS = 120_000;

/** The wizard. One per flow, whichever step it is showing. */
export function restoreDialog(window: Page): Locator {
  return window.getByTestId('restore-dialog');
}

/**
 * Open the wizard from the sidebar's footer action.
 *
 * Unlike the backup twin this needs no database selected — a restore creates its target, which is why
 * the sidebar enables it at the server level. Waits for the **form**, not just the dialog: on PG and
 * MySQL the dialog opens on a host-tool probe and a caller that filled the path field as soon as the
 * dialog appeared would race it.
 */
export async function openRestoreDialog(window: Page): Promise<Locator> {
  await window.getByTestId('sidebar-restore').click();
  const dialog = restoreDialog(window);
  await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(dialog.getByTestId('restore-path')).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return dialog;
}

/** Open the wizard from a database node's context menu, which carries its own target. */
export async function openRestoreDialogFromNode(
  window: Page,
  databaseName: string
): Promise<Locator> {
  const menu = await openNodeMenu(window, databaseName);
  await menu.getByTestId('sidebar-menu-restore').click();
  const dialog = restoreDialog(window);
  await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(dialog.getByTestId('restore-path')).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return dialog;
}

/** Fill the source and the target name, leaving the wizard ready to submit. */
export async function fillRestoreForm(
  window: Page,
  archivePath: string,
  targetDatabase: string
): Promise<void> {
  const dialog = restoreDialog(window);
  const path = dialog.getByTestId('restore-path');
  await path.fill(archivePath);
  await expect(path).toHaveValue(archivePath);

  const name = dialog.getByTestId('restore-target-name');
  await name.fill(targetDatabase);
  await expect(name).toHaveValue(targetDatabase);
}

/**
 * Restore into a database the server has never heard of, and return once it has succeeded.
 *
 * **Asserts that no confirmation was demanded.** Extra ceremony for a safe action is how users learn
 * to click through the dangerous one, so "the safe path is one button" is a property worth pinning.
 */
export async function runRestoreIntoNew(
  window: Page,
  archivePath: string,
  targetDatabase: string
): Promise<void> {
  const dialog = restoreDialog(window);
  await fillRestoreForm(window, archivePath, targetDatabase);

  // The label is the signal that no confirmation is coming — the testid is the same either way, on
  // purpose, so this is an assertion about the flow rather than about a selector.
  await expect(dialog.getByTestId('restore-submit')).toHaveText(/Start restore/);
  await dialog.getByTestId('restore-submit').click();

  await expect(dialog.getByTestId('restore-confirm')).toHaveCount(0);
  await expect(dialog.getByTestId('restore-success')).toBeVisible({
    timeout: RESTORE_TIMEOUT_MS,
  });
  await expect(dialog.getByTestId('restore-success-target')).toHaveText(targetDatabase);
}

/**
 * Restore over a database that already exists, walking the confirmation.
 *
 * The confirmation is the target's name, typed exactly. This helper types it — the spec's job is to
 * prove the button is refused *before* it does.
 */
export async function runRestoreOver(
  window: Page,
  archivePath: string,
  targetDatabase: string,
  options: { readonly overwrite?: boolean } = {}
): Promise<void> {
  const dialog = restoreDialog(window);
  await fillRestoreForm(window, archivePath, targetDatabase);
  if (options.overwrite === true) await dialog.getByTestId('restore-overwrite').check();

  await expect(dialog.getByTestId('restore-submit')).toHaveText(/Review the restore/);
  await dialog.getByTestId('restore-submit').click();
  await expect(dialog.getByTestId('restore-confirm')).toBeVisible({ timeout: UI_TIMEOUT_MS });

  await dialog.getByTestId('restore-confirm-input').fill(targetDatabase);
  await dialog.getByTestId('restore-confirm-start').click();

  await expect(dialog.getByTestId('restore-success')).toBeVisible({
    timeout: RESTORE_TIMEOUT_MS,
  });
  await expect(dialog.getByTestId('restore-success-target')).toHaveText(targetDatabase);
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

// ── The query tab's sub-panels (Task 14) ────────────────────────────────────
//
// Three surfaces, three testid prefixes: `rowdetail-*` for the row-detail rail,
// `history-*` for the result-history tab and its inline diff, `chip-*` for the
// connection chip. The grid's own rows are still located structurally, under the
// vendor exemption — a double-click on a row is the rail's entry point and AG
// Grid is what owns the row element.

/** The row-detail rail, if it is open. */
export function rowDetailPanel(window: Page): Locator {
  return window.getByTestId('rowdetail-panel');
}

/**
 * Double-clicks a row, addressed by its DISPLAYED index, and waits for the rail.
 *
 * Double-click rather than click: a single click in this grid starts a text
 * selection or ticks a checkbox, so the rail deliberately does not claim it (see
 * `results-grid.tsx`'s `openRow`).
 */
export async function openRowDetail(window: Page, displayedIndex: number): Promise<Locator> {
  await resultsGrid(window)
    .locator(`.ag-grid-scrolling-container .ag-row[row-index="${displayedIndex}"]`)
    .locator('.ag-cell')
    .first()
    .dblclick();
  await expect(rowDetailPanel(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return rowDetailPanel(window);
}

/** One field of the inspected row, addressed by column name. */
export function rowDetailField(window: Page, column: string): Locator {
  return rowDetailPanel(window).locator(`[data-testid="rowdetail-field"][data-field="${column}"]`);
}

/** Every field's column name, in order. */
export async function rowDetailFields(window: Page): Promise<string[]> {
  const fields = await rowDetailPanel(window)
    .locator('[data-testid="rowdetail-field"]')
    .evaluateAll(elements => elements.map(element => element.getAttribute('data-field') ?? ''));
  return fields;
}

/**
 * Follows a foreign key: clicks the FK link on `column` and waits for the
 * referenced row's preview to have loaded (its own fields, not the spinner).
 */
export async function previewForeignKey(window: Page, column: string): Promise<Locator> {
  await rowDetailField(window, column).getByTestId('rowdetail-fk-link').click();
  const preview = rowDetailPanel(window).getByTestId('rowdetail-fk-preview');
  await expect(preview).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(preview.getByTestId('rowdetail-fk-target')).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return preview;
}

/** Switches the results pane to the History tab and waits for the panel. */
export async function openResultHistory(window: Page): Promise<Locator> {
  await window.getByTestId('query-results-tab-history').click();
  const panel = window.getByTestId('history-panel');
  await expect(panel).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return panel;
}

/** Every snapshot row in the history list. */
export function historyRows(window: Page): Locator {
  return window.getByTestId('history-row');
}

/**
 * Captures the result on screen as a pinned snapshot and waits for it to appear.
 *
 * Pinned is what makes it addressable: the main process auto-saves every execute
 * too (`query.ipc.ts:59-78`), so `[data-pinned="true"]` is how a spec names the
 * snapshots it created rather than the ones that appeared on their own.
 */
export async function captureResult(window: Page, expectedPinned: number): Promise<void> {
  await window.getByTestId('history-capture').click();
  await expect(historyRows(window).and(window.locator('[data-pinned="true"]'))).toHaveCount(
    expectedPinned,
    { timeout: UI_TIMEOUT_MS }
  );
}

/** The pinned snapshots, which are the ones a spec captured itself. */
export function pinnedHistoryRows(window: Page): Locator {
  return historyRows(window).and(window.locator('[data-pinned="true"]'));
}

// ── The settings panel (Task 15) ────────────────────────────────────────────
//
// One prefix, `settings-*`, and one entry point: the panel is opened by the
// `menu:open-settings` channel, which is what ⌘, sends. There is no button for
// it in the app chrome, so `sendMenuCommand` is not a shortcut around the UI
// here — it IS the UI.
//
// Every control is located by testid and every value is read back through the
// consumer rather than through the control, because that is the whole point of
// this surface's tests (J-44): a toggle that flips and changes nothing is the
// defect, so asserting the toggle flipped proves nothing.

/** The four groups, which are Radix tabs — an inactive one is not in the DOM. */
export type SettingsGroup = 'appearance' | 'editor' | 'query' | 'grid';

/** The panel, if it is open. */
export function settingsDialog(window: Page): Locator {
  return window.getByTestId('settings-dialog');
}

/** Opens the panel the way ⌘, does, and waits for it. */
export async function openSettings(app: ElectronApplication, window: Page): Promise<Locator> {
  await sendMenuCommand(app, 'menu:open-settings');
  const dialog = settingsDialog(window);
  await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return dialog;
}

/** Switches to one of the four groups and waits for its controls to be in the DOM. */
export async function openSettingsGroup(window: Page, group: SettingsGroup): Promise<Locator> {
  await window.getByTestId(`settings-tab-${group}`).click();
  const groupElement = window.getByTestId(`settings-group-${group}`);
  await expect(groupElement).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return groupElement;
}

/** Closes the panel with Escape, which is Radix's own dismissal. */
export async function closeSettings(window: Page): Promise<void> {
  await window.keyboard.press('Escape');
  await expect(settingsDialog(window)).toBeHidden({ timeout: UI_TIMEOUT_MS });
}

/**
 * Picks one of the three theme states in the panel and waits for the DOM to have adopted it.
 *
 * The wait is on `[data-theme]`, not on the radio: the settings store is the single writer of that
 * attribute, and the resolved value is the only observable proof the change landed. `system` resolves
 * through Electron's `nativeTheme`, so this returns the resolved value rather than asserting one.
 */
export async function setTheme(
  window: Page,
  preference: 'system' | 'light' | 'dark'
): Promise<string> {
  await window.getByTestId(`settings-theme-${preference}`).check();
  if (preference !== 'system') {
    await expect(window.locator('html')).toHaveAttribute('data-theme', preference, {
      timeout: UI_TIMEOUT_MS,
    });
    return preference;
  }
  // Whatever the OS says. Never the literal `system` — see `state/settings.ts`.
  await expect(window.locator('html')).toHaveAttribute('data-theme', /^(dark|light)$/, {
    timeout: UI_TIMEOUT_MS,
  });
  return (await window.locator('html').getAttribute('data-theme')) ?? '';
}

/** What the store has actually written to `<html>`. */
export async function resolvedTheme(window: Page): Promise<string | null> {
  return window.locator('html').getAttribute('data-theme');
}

/**
 * Sets a numeric setting and commits it with Enter.
 *
 * `NumberSetting` holds a draft and commits on blur or Enter rather than on every keystroke — a field
 * that committed per character would resize every open editor while the user was still typing, and
 * would clamp their next keystroke against a value they never chose. So `fill` alone changes nothing,
 * and pressing Enter is part of the interaction rather than a workaround for it.
 */
export async function setNumberSetting(window: Page, testId: string, value: number): Promise<void> {
  const field = window.getByTestId(testId);
  await field.fill(String(value));
  await field.press('Enter');
  await expect(field).toHaveValue(String(value), { timeout: UI_TIMEOUT_MS });
}

/** Sets a switch to an explicit state. Idempotent, so a spec can state what it wants. */
export async function setToggleSetting(
  window: Page,
  testId: string,
  checked: boolean
): Promise<void> {
  const toggle = window.getByTestId(testId);
  if (checked) await toggle.check();
  else await toggle.uncheck();
}
