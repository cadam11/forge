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
import { Client as PgClient } from 'pg';
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
 * The suggest widget, **re-triggered until one of its rows matches `text`**.
 *
 * Monaco computes a completion list once per trigger and does not recompute it when a provider's
 * metadata arrives afterwards, so a widget opened before `sqlIntellisense.loadMetadata` has answered
 * shows keywords and snippets and stays that way. `suggestions()` alone therefore races the prefetch —
 * it passed reliably in isolation and failed roughly one run in three inside the full tier, where the
 * container is under load from the specs before it.
 *
 * Bounded on purpose (`ATTEMPTS`): the widget is closed and re-opened up to that many times, and the
 * final `expect` is what reports the failure if the metadata never arrives, rather than the loop
 * exhausting silently.
 */
export async function suggestionsContaining(window: Page, text: string): Promise<Locator> {
  const ATTEMPTS = 5;
  let rows = await suggestions(window);

  for (let attempt = 1; attempt < ATTEMPTS; attempt += 1) {
    if ((await rows.filter({ hasText: text }).count()) > 0) return rows;
    await window.keyboard.press('Escape');
    await expect(queryEditor(window).locator('.suggest-widget.visible')).toBeHidden({
      timeout: UI_TIMEOUT_MS,
    });
    rows = await suggestions(window);
  }

  await expect(rows.filter({ hasText: text })).not.toHaveCount(0, { timeout: UI_TIMEOUT_MS });
  return rows;
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

// ── The palette, the object search, the snippet library and the cheatsheet (Task 16) ────────
//
// Four surfaces, four testid prefixes: `palette-*`, `objsearch-*`, `snippets-*`, `shortcuts-*`.
// All four are the same `CommandOverlay` shape (`ui/command-overlay.tsx`), which is why the
// helpers below are parameterised over the prefix rather than written four times.
//
// **Every one of them is opened by a keystroke the RENDERER owns** — ⌘K/⇧⌘P, ⌘P, ⌥⌘S — chosen
// because no `menu.ts` accelerator has them (`commands/catalogue.ts`, and a unit test pins the
// no-collision rule). So `keyboard.press` here is the real user path, not a shortcut around the
// UI. The cheatsheet is the exception: Help ▸ Keyboard Shortcuts is a menu item, so it arrives
// through `sendMenuCommand` like the settings panel does.

/** The prefixes the four overlays use. */
export type OverlayPrefix = 'palette' | 'objsearch' | 'snippets';

/** One of the overlays, if it is open. */
export function overlay(window: Page, prefix: OverlayPrefix): Locator {
  return window.getByTestId(`${prefix}-overlay`);
}

/** Every rendered row of one overlay. */
export function overlayRows(window: Page, prefix: OverlayPrefix): Locator {
  return window.getByTestId(`${prefix}-row`);
}

/** Types into an overlay's search box and waits for the row count to settle. */
export async function filterOverlay(
  window: Page,
  prefix: OverlayPrefix,
  text: string
): Promise<void> {
  const input = window.getByTestId(`${prefix}-input`);
  await input.fill(text);
  await expect(input).toHaveValue(text, { timeout: UI_TIMEOUT_MS });
}

/** Closes whichever overlay is open, the way Escape does. */
export async function closeOverlay(window: Page, prefix: OverlayPrefix): Promise<void> {
  await window.keyboard.press('Escape');
  await expect(overlay(window, prefix)).toBeHidden({ timeout: UI_TIMEOUT_MS });
}

/** Opens the command palette with ⌘K and waits for its rows. */
export async function openPalette(window: Page): Promise<Locator> {
  await window.keyboard.press('ControlOrMeta+k');
  const surface = overlay(window, 'palette');
  await expect(surface).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(overlayRows(window, 'palette').first()).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return surface;
}

/** One palette row, addressed by the command id or action id behind it. */
export function paletteRow(window: Page, key: string): Locator {
  return window
    .getByTestId('palette-row')
    .filter({ has: window.locator(`[data-palette-key="${key}"]`) });
}

/**
 * Runs a palette entry by its key, and waits for the palette to have closed.
 *
 * Keyed rather than by label because the key is the command id: a test that says
 * `runPaletteCommand(window, 'command:toggle-sidebar')` is naming the thing whose handler it
 * expects to fire, which is the property this whole surface exists to guarantee.
 */
export async function runPaletteCommand(window: Page, key: string): Promise<void> {
  const row = paletteRow(window, key);
  await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await row.click();
  await expect(overlay(window, 'palette')).toBeHidden({ timeout: UI_TIMEOUT_MS });
}

/** What the palette says about one row: `ready`, `unowned` or `unavailable`. */
export async function paletteRowState(window: Page, key: string): Promise<string | null> {
  return window.locator(`[data-palette-key="${key}"]`).getAttribute('data-palette-state');
}

/** Opens the object search with ⌘P and waits for the loaded object list. */
export async function openObjectSearch(window: Page): Promise<Locator> {
  await window.keyboard.press('ControlOrMeta+p');
  const surface = overlay(window, 'objsearch');
  await expect(surface).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(overlayRows(window, 'objsearch').first()).toBeVisible({
    timeout: CONNECT_TIMEOUT_MS,
  });
  return surface;
}

/** One object-search row, addressed by the qualified name it shows. */
export function objectSearchRow(window: Page, qualifiedName: string): Locator {
  return window.getByTestId('objsearch-row').filter({
    has: window.getByTestId('objsearch-row-name').getByText(qualifiedName, { exact: true }),
  });
}

/** Opens the snippet library with ⌥⌘S. Tolerant of an empty library, which renders no rows. */
export async function openSnippets(window: Page): Promise<Locator> {
  await window.keyboard.press('Alt+ControlOrMeta+s');
  const surface = overlay(window, 'snippets');
  await expect(surface).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return surface;
}

/** One snippet row, addressed by its name. */
export function snippetRow(window: Page, name: string): Locator {
  return window
    .getByTestId('snippets-row')
    .filter({ has: window.getByTestId('snippets-row-name').getByText(name, { exact: true }) });
}

/** Saves a new snippet through the library's own form, and waits for the row to appear. */
export async function createSnippet(
  window: Page,
  values: { readonly name: string; readonly tags?: string; readonly sql?: string }
): Promise<void> {
  await window.getByTestId('snippets-new').click();
  await expect(window.getByTestId('snippets-form')).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await window.getByTestId('snippets-form-name').fill(values.name);
  if (values.tags !== undefined) await window.getByTestId('snippets-form-tags').fill(values.tags);
  if (values.sql !== undefined) await window.getByTestId('snippets-form-sql').fill(values.sql);
  await window.getByTestId('snippets-form-save').click();
  await expect(window.getByTestId('snippets-form')).toBeHidden({ timeout: UI_TIMEOUT_MS });
  await expect(snippetRow(window, values.name)).toBeVisible({ timeout: UI_TIMEOUT_MS });
}

/** Opens the keyboard cheatsheet the way Help ▸ Keyboard Shortcuts does. */
export async function openShortcuts(app: ElectronApplication, window: Page): Promise<Locator> {
  await sendMenuCommand(app, 'menu:show-shortcuts');
  const dialog = window.getByTestId('shortcuts-dialog');
  await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return dialog;
}

// ── The AI assistant: the side panel, the chat tab, the conversation list (Task 17) ──────────
//
// One surface, mounted twice (`renderer-react/src/features/chat/chat-surface.tsx`), so every helper
// below takes the ROOT it should look inside: `chatPanel(window)` or `chatTab(window)`. That is not
// tidiness — the panel and the tab hold independent store instances, and a helper that searched the
// whole document would happily assert one tab's transcript against the other's, which is the exact
// property `chat.spec.ts` exists to check.
//
// **No test in this tier calls an LLM.** The conversation CRUD, the transcript and the tool catalogue
// are all main-process IPC (`chat:*`, backed by `<userData>/chat-history/*.json`), so everything here
// is real except the model — and with no API key configured the surface's job is to say so, which is
// itself one of the assertions.

/** The side panel, if it is open. */
export function chatPanel(window: Page): Locator {
  return window.getByTestId('chat-panel');
}

/** A chat tab's surface, if one is mounted. */
export function chatTab(window: Page): Locator {
  return window.getByTestId('chat-tab');
}

/** Opens the assistant from the status bar (the same wire ⇧⌘I uses) and waits for it. */
export async function openChatPanel(window: Page): Promise<Locator> {
  await window.getByTestId('status-chat-toggle').click();
  const panel = chatPanel(window);
  await expect(panel).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return panel;
}

/** Closes the assistant from its own header button. */
export async function closeChatPanel(window: Page): Promise<void> {
  await chatPanel(window).getByTestId('chat-panel-close').click();
  await expect(chatPanel(window)).toBeHidden({ timeout: UI_TIMEOUT_MS });
}

/**
 * Expands one surface's conversation list, and does nothing when it is already expanded.
 *
 * Idempotent on purpose rather than a plain click: `conversationsExpanded` lives in the store, so a
 * panel that was closed with its list open re-opens with it open — and a helper that toggled blindly
 * would collapse it and then wait for something it had just hidden.
 */
export async function openChatConversations(root: Locator): Promise<Locator> {
  const list = root.getByTestId('chat-conversations');
  if (!(await list.isVisible())) {
    await root.getByTestId('chat-conversations-toggle').click();
  }
  await expect(list).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return list;
}

/** One conversation row, by the title it shows. */
export function chatConversationRow(root: Locator, title: string): Locator {
  return root.getByTestId('chat-conversation').filter({ hasText: title });
}

/** The title in a surface's header — which conversation that instance is looking at. */
export function chatTitle(root: Locator): Locator {
  return root.getByTestId('chat-title');
}

/** Creates a conversation through the header's + button and waits for the store to adopt it. */
export async function createChatConversation(root: Locator): Promise<void> {
  const before = await root.getByTestId('chat-conversation').count();
  await root.getByTestId('chat-new-conversation').click();
  // The list is only visible when expanded; when it is, the new row has to appear in it.
  if (await root.getByTestId('chat-conversations').isVisible()) {
    await expect(root.getByTestId('chat-conversation')).toHaveCount(before + 1, {
      timeout: UI_TIMEOUT_MS,
    });
  }
  await expect(chatTitle(root)).toHaveText('New Chat', { timeout: UI_TIMEOUT_MS });
}

/** Renames a conversation in its own row, the way the pencil does. */
export async function renameChatConversation(
  root: Locator,
  from: string,
  to: string
): Promise<void> {
  const row = chatConversationRow(root, from);
  await row.getByTestId('chat-conversation-rename').click();
  const input = root.getByTestId('chat-conversation-rename-input');
  await expect(input).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await input.fill(to);
  await input.press('Enter');
  await expect(chatConversationRow(root, to)).toBeVisible({ timeout: UI_TIMEOUT_MS });
}

/**
 * Deletes a conversation. TWO clicks, because the row arms before it destroys — a whole transcript has
 * no undo, and the second click is what an accidental first one never gets.
 */
export async function deleteChatConversation(root: Locator, title: string): Promise<void> {
  const row = chatConversationRow(root, title);
  await row.getByTestId('chat-conversation-delete').click();
  await row.getByTestId('chat-conversation-delete-confirm').click();
  await expect(chatConversationRow(root, title)).toHaveCount(0, { timeout: UI_TIMEOUT_MS });
}

// ── The ERD tab (Task 18) ─────────────────────────────────────────────────────────────────────────
//
// The diagram is SVG, so nothing here is a `getByRole` or a `getByText`: every locator keys on the
// `data-erd-*` attributes the canvas writes, which are the only stable handles on a `<g>` whose
// position is a layout result.

/** The ERD tab's panel. */
export function erdPanel(window: Page): Locator {
  return window.getByTestId('panel-erd');
}

/** The pan/zoom surface inside it. */
export function erdCanvas(window: Page): Locator {
  return window.getByTestId('erd-canvas');
}

/** Every table box currently in the DOM. Culled nodes are genuinely absent — that is the point. */
export function erdNodes(window: Page): Locator {
  return window.getByTestId('erd-node');
}

/** One table box, by its `schema.table` id. */
export function erdNode(window: Page, nodeId: string): Locator {
  return window.locator(`[data-testid="erd-node"][data-erd-node-id="${nodeId}"]`);
}

/** One FK edge, by the pair of tables it joins. */
export function erdEdge(window: Page, sourceNodeId: string, targetNodeId: string): Locator {
  return window.locator(
    `[data-testid="erd-edge"][data-erd-edge-source="${sourceNodeId}"][data-erd-edge-target="${targetNodeId}"]`
  );
}

/** The diagram's own transform, as the content group carries it. `null` before the first paint. */
export async function erdTransform(window: Page): Promise<string | null> {
  return erdCanvas(window).locator('svg > g').first().getAttribute('transform');
}

/** The zoom readout in the toolbar, e.g. `"120%"`. */
export async function erdZoomLevel(window: Page): Promise<string> {
  return (await erdPanel(window).getByTestId('erd-zoom-level').textContent()) ?? '';
}

/**
 * "Show Relationships" on a table node, and the wait for the diagram to have finished loading.
 *
 * The wait is on a NODE rather than on the canvas: the canvas mounts as soon as the schema resolves,
 * and a spec that asserted on it could pass against a diagram that had drawn nothing.
 */
export async function openRelationships(window: Page, tableLabel: string): Promise<Locator> {
  const menu = await openNodeMenu(window, tableLabel);
  await menu.getByTestId('sidebar-menu-relationships').click();
  await expect(erdPanel(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(erdNodes(window).first()).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return erdPanel(window);
}

/** The details rail, which opens when a table is selected. */
export function erdDetails(window: Page): Locator {
  return window.getByTestId('erd-details');
}

// ── Task 19a: welcome, query history, database management, object detail ─────
//
// Five testid prefixes, one per surface: `welcome-*`, `query-history-*`,
// `create-database-*` / `rename-database-*` / `database-*` (the shared name
// dialog), `object-*`, and `ai-setup-*`.

/** The welcome tab. Present from launch unless the user dismissed it. */
export function welcomePanel(window: Page): Locator {
  return window.getByTestId('panel-welcome');
}

/**
 * Shows the welcome tab and waits for it, whether or not it is already open.
 *
 * Through the palette rather than by clicking a tab: the tab may have been closed
 * in this session, and `show-welcome` is the command that re-opens it either way.
 */
export async function openWelcome(window: Page): Promise<Locator> {
  if ((await welcomePanel(window).count()) === 0) {
    await openPalette(window);
    await runPaletteCommand(window, 'command:show-welcome');
  }
  await expect(welcomePanel(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return welcomePanel(window);
}

/** The query-history dialog. */
export function queryHistoryDialog(window: Page): Locator {
  return window.getByTestId('query-history-dialog');
}

/**
 * Opens the history through the NATIVE MENU channel, which is how ⇧⌘H reaches it.
 *
 * `sendMenuCommand`, not a keystroke: Electron's menu accelerators are not
 * reachable from CDP-injected keys, so the channel is the only honest route —
 * the same choice `query-editor.spec.ts` makes for Execute Selection.
 */
export async function openQueryHistory(app: ElectronApplication, window: Page): Promise<Locator> {
  await sendMenuCommand(app, 'menu:query-history');
  await expect(queryHistoryDialog(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return queryHistoryDialog(window);
}

/** Every row currently listed in the history. */
export function historyEntryRows(window: Page): Locator {
  return queryHistoryDialog(window).getByTestId('query-history-row');
}

/** The history row whose statement contains `sql`. */
export function historyEntryRow(window: Page, sql: string): Locator {
  return historyEntryRows(window).filter({ hasText: sql });
}

/** Narrows the history, and waits for the debounced round trip to land. */
export async function searchQueryHistory(window: Page, term: string): Promise<void> {
  await queryHistoryDialog(window).getByTestId('query-history-search').fill(term);
  // The dialog debounces by 200ms before it asks the main process; the observable
  // proof is the count line, which is derived from the answer.
  await expect(queryHistoryDialog(window).getByTestId('query-history-count')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  });
  await window.waitForTimeout(400);
}

/**
 * Closes a workspace tab by the title on it.
 *
 * By `aria-label`, not by testid: the close button's testid carries the tab's generated id, which no
 * spec can know. The label is `Close ${tab.title}` (`shell/workspace/panel-tab.tsx`).
 */
export async function closeTabTitled(window: Page, title: string): Promise<void> {
  const close = window.getByLabel(`Close ${title}`);
  await expect(close).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await close.click();
  await expect(close).toBeHidden({ timeout: UI_TIMEOUT_MS });
}

/**
 * The sidebar's Refresh button, awaited to the point where its effects have landed.
 *
 * There is no spinner to wait on — `refreshFocused` is two awaited round trips with no busy state of
 * its own — so the wait is on the button being clickable again plus a short settle. Callers assert the
 * thing that should have changed, which is the honest signal.
 */
export async function refreshSidebar(window: Page): Promise<void> {
  const button = window.getByTestId('sidebar-refresh');
  await expect(button).toBeEnabled({ timeout: UI_TIMEOUT_MS });
  await button.click();
  await window.waitForTimeout(1_000);
}

/**
 * The shared create/rename name dialog: type a name and submit.
 *
 * One helper for both, because `DatabaseNameDialog` is one component — the two
 * dialogs differ by their outer testid, which the caller has already located.
 */
export async function submitDatabaseName(window: Page, name: string): Promise<void> {
  const field = window.getByTestId('database-name-input');
  await field.fill(name);
  const submit = window.getByTestId('database-dialog-submit');
  await expect(submit).toBeEnabled({ timeout: UI_TIMEOUT_MS });
  await submit.click();
}

/**
 * Creates a database from the sidebar's server context menu.
 *
 * Waits for the dialog to CLOSE, which is the operation's own completion signal:
 * `DatabaseNameDialog` closes only when the submit resolved with no error, and the
 * host awaits the whole invalidation fan-out before that resolves.
 */
export async function createDatabaseFromSidebar(
  window: Page,
  serverLabel: string,
  name: string
): Promise<void> {
  const menu = await openNodeMenu(window, serverLabel);
  await menu.getByTestId('sidebar-menu-new-database').click();
  await expect(window.getByTestId('create-database-dialog')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  });
  await submitDatabaseName(window, name);
  await expect(window.getByTestId('create-database-dialog')).toBeHidden({
    timeout: CONNECT_TIMEOUT_MS,
  });
}

/** Renames a database from its own context menu, and waits for the dialog to close. */
export async function renameDatabaseFromSidebar(
  window: Page,
  databaseLabel: string,
  newName: string
): Promise<void> {
  const menu = await openNodeMenu(window, databaseLabel);
  await menu.getByTestId('sidebar-menu-rename-database').click();
  await expect(window.getByTestId('rename-database-dialog')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  });
  await submitDatabaseName(window, newName);
  await expect(window.getByTestId('rename-database-dialog')).toBeHidden({
    timeout: CONNECT_TIMEOUT_MS,
  });
}

/** The object detail tab. */
export function objectPanel(window: Page): Locator {
  return window.getByTestId('panel-object');
}

/**
 * Double-clicks an object in the tree and waits for its detail tab to have real
 * rows in it.
 *
 * The wait is on a ROW, not on the panel: the panel mounts as soon as the tab
 * exists, so a spec that stopped there could pass against four empty tables.
 */
export async function openObjectDetail(window: Page, label: string): Promise<Locator> {
  await treeRow(window, label).dblclick();
  await expect(objectPanel(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(objectDetailRows(window).first()).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });
  return objectPanel(window);
}

/** Every row of whichever object section is on screen. */
export function objectDetailRows(window: Page): Locator {
  return objectPanel(window).getByTestId('object-detail-row');
}

/** Switches the object tab to one of its four sections and waits for it. */
export async function openObjectSection(
  window: Page,
  section: 'columns' | 'indexes' | 'keys' | 'definition'
): Promise<void> {
  await objectPanel(window).getByTestId(`object-tab-${section}`).click();
  await expect(objectPanel(window).getByTestId(`object-tab-${section}`)).toHaveAttribute(
    'data-state',
    'active',
    { timeout: UI_TIMEOUT_MS }
  );
}

/** The cells of one object row, as text. */
export async function objectRowCells(row: Locator): Promise<string[]> {
  return row.locator('td').allTextContents();
}

/** The AI setup dialog. */
export function aiSetupDialog(window: Page): Locator {
  return window.getByTestId('ai-setup-dialog');
}

/** Opens the AI setup dialog through the palette, which is one of its three producers. */
export async function openAiSetup(window: Page): Promise<Locator> {
  await openPalette(window);
  await runPaletteCommand(window, 'command:open-ai-setup');
  await expect(aiSetupDialog(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return aiSetupDialog(window);
}

/**
 * Drops every database on the seeded PostgreSQL container whose name starts with `prefix`.
 *
 * The database-management specs create real databases and cannot delete them through the UI (the delete
 * dialog is Task 19b's), and leaving them behind is not neutral: the explorer tree is virtualized, so ten
 * extra databases under the server node push the rows below it out of the rendered window and an
 * unrelated spec that looks for a third server stops finding it. That is a real failure this suite hit
 * once, which is why the cleanup is a helper rather than a note in a comment.
 *
 * `WITH (FORCE)` because the app under test may have left a pooled session on the database it was last
 * pointed at; without it `DROP DATABASE` refuses and the cleanup silently does nothing.
 */
export async function dropDatabasesMatching(prefix: string): Promise<void> {
  const client = new PgClient({ ...TEST_PG });
  await client.connect();
  try {
    const found = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [`${prefix}%`]
    );
    for (const row of found.rows) {
      // The name comes from `pg_database`, so it is an existing identifier rather than user input; it is
      // still quoted, because a database created by a spec may legally contain characters that need it.
      await client.query(
        `DROP DATABASE IF EXISTS "${row.datname.replace(/"/g, '""')}" WITH (FORCE)`
      );
    }
  } finally {
    await client.end();
  }
}

// ── Task 19b: execution plan, AI analysis, schema comparison, Docker, tours ─────────────────

/** The plan tab in the results pane. Only present once a plan has been asked for. */
export function planTab(window: Page): Locator {
  return window.getByTestId('query-results-tab-plan');
}

/** The plan tree. */
export function executionPlan(window: Page): Locator {
  return window.getByTestId('execution-plan');
}

/** One row per operator, root first. */
export function planNodes(window: Page): Locator {
  return window.getByTestId('plan-node');
}

/**
 * Press the toolbar's plan button and wait for the tree.
 *
 * PostgreSQL and MySQL answer with an EXPLAIN and never run the statement, so there is no gate to
 * clear here. SQL Server does run it and raises the `actual-plan` confirmation — a spec that wants
 * that path presses the button itself and confirms.
 */
export async function showExecutionPlan(window: Page): Promise<Locator> {
  await window.getByTestId('query-execution-plan').click();
  await expect(planTab(window)).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });
  await expect(executionPlan(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return executionPlan(window);
}

/** The operator names in the plan, in the order they are drawn. */
export async function planNodeTypes(window: Page): Promise<string[]> {
  return planNodes(window).locator('[data-testid="plan-node-type"]').allTextContents();
}

/**
 * Select the Analysis tab and return the results pane.
 *
 * The PANE rather than `ai-analysis`, because that testid belongs to the asking surface and the three
 * degrades (no provider, AI switched off, nothing run) replace it entirely — a helper that waited for it
 * would only work on a machine with an API key.
 */
export async function openAnalysisTab(window: Page): Promise<Locator> {
  await window.getByTestId('query-results-tab-analysis').click();
  const pane = window.getByTestId('query-results');
  await expect(pane).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return pane;
}

/**
 * Open the command palette with **⇧⌘P** rather than ⌘K.
 *
 * ⌘K does not reach the renderer while Monaco has focus: Monaco binds it as a chord prefix and swallows
 * it, so `openPalette` (which presses ⌘K) cannot be used from inside a query editor. Recorded as J-73 —
 * a user typing SQL cannot open the palette with the shortcut the palette advertises. This helper uses
 * the alternate binding the palette also accepts (`command-palette.tsx:85`).
 */
export async function openPaletteFromEditor(window: Page): Promise<Locator> {
  await window.keyboard.press('ControlOrMeta+Shift+p');
  const surface = overlay(window, 'palette');
  await expect(surface).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(overlayRows(window, 'palette').first()).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return surface;
}

/** The schema-comparison dialog. */
export function schemaDiffDialog(window: Page): Locator {
  return window.getByTestId('schema-diff-dialog');
}

/** Open it through the palette — its only entry point in the Angular renderer, and still one here. */
export async function openSchemaDiff(window: Page): Promise<Locator> {
  await openPalette(window);
  await runPaletteCommand(window, 'command:open-schema-diff');
  await expect(schemaDiffDialog(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return schemaDiffDialog(window);
}

/** Open it from a database node, which is Task 19b's new contextual entry point. */
export async function openSchemaDiffFromNode(window: Page, databaseName: string): Promise<Locator> {
  const menu = await openNodeMenu(window, databaseName);
  await menu.getByTestId('sidebar-menu-compare-schemas').click();
  await expect(schemaDiffDialog(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return schemaDiffDialog(window);
}

/** Pick one side of the comparison. The two selects are Radix, so the option is a listbox row. */
export async function selectDiffDatabase(
  window: Page,
  side: 'source' | 'target',
  databaseName: string
): Promise<void> {
  await window.getByTestId(`schema-diff-${side}`).click();
  await window.getByRole('option', { name: databaseName, exact: true }).click();
}

/** The status bar's Docker pip. */
export function dockerPip(window: Page): Locator {
  return window.getByTestId('status-docker-toggle');
}

/** The Docker panel, in its popover. */
export function dockerPanel(window: Page): Locator {
  return window.getByTestId('docker-panel');
}

/** Open the panel from the pip, and wait for it to have settled out of `checking`. */
export async function openDockerPanel(window: Page): Promise<Locator> {
  await expect(dockerPip(window)).not.toHaveAttribute('data-docker-state', 'checking', {
    timeout: CONNECT_TIMEOUT_MS,
  });
  await dockerPip(window).click();
  await expect(dockerPanel(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return dockerPanel(window);
}

/**
 * Close it by pressing the pip again.
 *
 * NOT Escape, and the reason is a real Radix property rather than a test convenience: `Popover` is
 * non-modal (`ui/popover.tsx` — the workbench underneath has to stay usable), so it does not move focus
 * into its content on open and its Escape handling needs focus to be inside. A test that has just clicked
 * the trigger, or run a palette command, has focus outside — so Escape there would be asserting nothing
 * about the panel. `docker-panel.spec.ts` covers the Escape path separately, from inside.
 */
export async function closeDockerPanel(window: Page): Promise<void> {
  await dockerPip(window).click();
  await expect(dockerPanel(window)).toBeHidden({ timeout: UI_TIMEOUT_MS });
}

/** One container row, addressed by the name Docker gave it. */
export function dockerContainerRow(window: Page, name: string): Locator {
  return window.locator(`[data-testid="docker-container"][data-container-name="${name}"]`);
}

/** The names the panel is listing. */
export async function dockerContainerNames(window: Page): Promise<string[]> {
  return window
    .getByTestId('docker-container')
    .evaluateAll(rows => rows.map(row => row.getAttribute('data-container-name') ?? ''));
}

/** The tour spotlight overlay. */
export function tourOverlay(window: Page): Locator {
  return window.getByTestId('tour-overlay');
}

/** Start the guided tour through the palette and wait for its first step. */
export async function startTour(window: Page): Promise<Locator> {
  await openPalette(window);
  await runPaletteCommand(window, 'command:start-tour');
  await expect(tourOverlay(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return tourOverlay(window);
}

/** The tour's step counter, as `[current, total]`. */
export async function tourStep(window: Page): Promise<[number, number]> {
  const text = (await window.getByTestId('tour-tooltip').textContent()) ?? '';
  const match = /(\d+) of (\d+)/.exec(text);
  return [Number(match?.[1] ?? 0), Number(match?.[2] ?? 0)];
}
