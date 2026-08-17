/**
 * The connection editor, the connection manager, and the sidebar's two pickers.
 *
 * ── The editor ───────────────────────────────────────────────────────────────
 *
 * This block replaces the interim `seedPostgresProfiles`, which wrote profiles
 * straight through the preload bridge because no UI could author one yet. It is
 * gone: every profile in this tier is now created the way a user creates one.
 * What that buys is coverage of the dialog itself — the engine transform, the
 * per-field validation, the keychain hand-off — none of which a bridge write
 * exercised, and it removes the page reload the bridge path needed to get the
 * renderer's profile list to notice.
 *
 * `getByLabel` throughout, with `exact: true`. The Field primitive emits a real
 * `<label for>` (`renderer-react/src/ui/field.tsx`), which is the whole reason
 * PLAN.md's Task 20 says `fillField` collapses to `getByLabel` — the Angular
 * helper had to match `mat-form-field` filtered by `mat-label:text-is(…)`.
 * `exact` matters: the default is a case-insensitive substring match, so a bare
 * `getByLabel('Server')` also matches "Trust the server certificate" and
 * `getByLabel('Password')` also matches "SSH password".
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { CONNECT_TIMEOUT_MS, TEST_MYSQL, TEST_PG, UI_TIMEOUT_MS, exactly } from './app';
import { serverRow } from './explorer';

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
  await connectThroughEditor(window, profileName);
}

/** Create one MySQL profile and connect with it, through the editor's own Connect button. */
export async function createAndConnectMysql(window: Page, profileName: string): Promise<void> {
  await openConnectionEditor(window);
  await fillMysqlForm(window, profileName);
  await connectThroughEditor(window, profileName);
}

/**
 * Press the editor's Connect and wait for the connection to be live in the tree.
 *
 * Shared by the two `createAndConnect*` helpers, which differed only in which form they filled —
 * the wait after the click was duplicated verbatim in both before Task 20.
 */
async function connectThroughEditor(window: Page, profileName: string): Promise<void> {
  await connectionEditor(window).getByTestId('connection-connect').click();
  await expect(connectionEditor(window)).toBeHidden({ timeout: CONNECT_TIMEOUT_MS });

  const row = serverRow(window, profileName);
  await expect(row).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: CONNECT_TIMEOUT_MS });
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
 *
 * The menu item is matched on its WHOLE label (`Connect: <name>`,
 * `connection-picker.tsx:111`) rather than on a substring of it, so a menu holding both `PG-One` and
 * `PG-One-Replica` cannot resolve to the wrong entry.
 */
export async function connectFromSidebar(window: Page, profileName: string): Promise<void> {
  const menu = await openConnectionMenu(window);
  await menu
    .getByTestId('sidebar-connection-connect')
    .filter({ hasText: exactly(`Connect: ${profileName}`) })
    .click();

  const row = serverRow(window, profileName);
  await expect(row).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: CONNECT_TIMEOUT_MS });
}

/**
 * Pick a database from the sidebar's database picker.
 *
 * Exact-match on the item's label (`database-picker.tsx:83` renders `database.name` and nothing
 * else), because a substring match would let `joinery_test` select a `joinery_test_copy` row — the
 * database-management specs create exactly that kind of neighbour.
 */
export async function selectDatabase(window: Page, databaseName: string): Promise<void> {
  await window.getByTestId('sidebar-database-trigger').click();
  const menu = window.getByTestId('sidebar-database-menu');
  await expect(menu).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await menu
    .getByTestId('sidebar-database-item')
    .filter({ hasText: exactly(databaseName) })
    .click();
  await expect(menu).toBeHidden({ timeout: UI_TIMEOUT_MS });
}
