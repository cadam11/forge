/**
 * The explorer tree, its context menus, and the database-management dialogs those menus open.
 *
 * Every row locator here is **exact-match on the row's label span** (`tree-row-label`,
 * `shell/sidebar/explorer-tree.tsx`), via `exactly()`. That is Task 20's fix for the frailty the
 * brief names: the previous `filter({ hasText: label }).first()` was a substring match, so a tree
 * holding both `orders` and `orders_archive` had two candidates and `.first()` picked whichever the
 * virtualizer happened to render higher. The label span is the right anchor rather than the row,
 * because the row also contains the child-count readout.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { CONNECT_TIMEOUT_MS, UI_TIMEOUT_MS, exactly } from './app';

/** Every rendered tree row. The tree is virtualized, so this is rows *in view*. */
export function treeRows(window: Page): Locator {
  return window.getByTestId('sidebar-tree').getByTestId('tree-row');
}

/** The label span of a row, matched exactly. The building block of every row locator here. */
function labelExactly(window: Page, label: string): Locator {
  return window.getByTestId('tree-row-label').filter({ hasText: exactly(label) });
}

/**
 * One tree row by its visible label, matched exactly.
 *
 * **No `.first()`, deliberately.** Exact matching removes the substring class of ambiguity
 * (`orders` no longer also means `orders_archive`) but not all of it: the tree is a FLAT list of rows
 * and this locator is not scoped to a schema, so two genuinely identical labels under different
 * parents — `public.Tables` and `app_meta.Tables` with both schemas expanded — would still both
 * match. A trailing `.first()` would then pick whichever the virtualizer rendered higher and the
 * test would drive the wrong row in silence. Without it, Playwright's strict mode raises
 * "resolved to 2 elements" and names the ambiguity instead.
 *
 * Scoping by schema is not offered because it cannot be done honestly here: parentage is expressed
 * as `aria-level` on a flat, virtualized list, so "the `orders` under `app_meta`" is a scan between
 * two sibling boundaries whose rows may not all be mounted. A spec that needs it should expand one
 * parent at a time, which is what every spec in the tier does today.
 */
export function treeRow(window: Page, label: string): Locator {
  return treeRows(window).filter({ has: labelExactly(window, label) });
}

/**
 * A *server* row, i.e. a root of the explorer forest.
 *
 * `aria-level="1"` rather than a node-id prefix: the tree's depth is an ARIA
 * contract the primitive guarantees, while the explorer store's id scheme
 * (`server-<connectionId>`) is its private business. The Angular spec keyed on
 * `aria-label*="(server)"`, which was the same idea via a string it built for
 * screen readers.
 *
 * Strict, for the reason `treeRow` documents — and here the ambiguity would be worse than a wrong
 * row: two servers sharing a profile name means the connection editor let a duplicate through, which
 * `connection.spec.ts` › `refuses a save that would duplicate a profile name` exists to prevent. An
 * error naming two matches is the right way to hear about that.
 */
export function serverRow(window: Page, profileName: string): Locator {
  return serverRows(window).filter({ has: labelExactly(window, profileName) });
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

/**
 * Presses the sidebar's Refresh button.
 *
 * **The caller must assert the effect it wanted.** `refreshFocused` (`node-actions.ts:365`) is
 * `dropMainCaches` then `loadDatabases` then `refreshNode`, fired as a floating promise from an
 * `onClick` with no busy flag anywhere in it — so there is no spinner, no `aria-busy`, and no store
 * field that says "refreshing". Nothing in the UI can be waited on.
 *
 * Task 20 deleted the `waitForTimeout(1_000)` that used to stand in for that, rather than replacing
 * it with a different guess: a fixed sleep is simultaneously too long for an idle machine and too
 * short for a loaded one, and it made the helper LOOK like it had waited for something. The honest
 * bounded wait is the caller's own `expect` on the thing the refresh was supposed to change, which
 * polls — and every caller in this tier has one.
 */
export async function refreshSidebar(window: Page): Promise<void> {
  const button = window.getByTestId('sidebar-refresh');
  await expect(button).toBeEnabled({ timeout: UI_TIMEOUT_MS });
  await button.click();
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
