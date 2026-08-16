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

import { expect, type Locator, type Page } from '@playwright/test';
import { forceFonts, withJoinery, type LaunchOptions, type LaunchedApp } from './electron-app';
import { TEST_PG, ensureJoineryTestSeeded } from './joinery-actions';

export { TEST_PG, ensureJoineryTestSeeded };

/** How long a real connect to the seeded container is allowed to take. */
const CONNECT_TIMEOUT_MS = 20_000;
/** Everything else: a store write plus a React commit. */
const UI_TIMEOUT_MS = 10_000;

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
 * One PostgreSQL profile pointing at the seeded test container, written
 * straight through the preload bridge.
 *
 * TODO(Task 9): replace with the UI path once the connection editor exists.
 * Task 9 owns that dialog; until it does, a UI-driven profile creation is
 * impossible in this renderer and the alternative is no live-database e2e
 * coverage at all for Task 8. The *connect* step below deliberately stays on
 * the real UI path, so what this shortcut skips is profile authoring only.
 *
 * The bridge write does not reach the renderer's profile list on its own —
 * `connectionStore.loadProfiles()` runs once, during boot — so the page is
 * reloaded afterwards and the boot re-reads what the main process now holds.
 */
export async function seedPostgresProfiles(
  window: Page,
  profileNames: readonly string[]
): Promise<void> {
  const created = await window.evaluate(
    async ({ names, pg }) => {
      // `globalThis`, not `window`: the outer `window` here is Playwright's Page
      // and would shadow the browser global, and the tests tsconfig has no DOM
      // lib to type the real one against. The cast names only what is used.
      const bridge = globalThis as unknown as {
        joinery: {
          connection: {
            save: (profile: Record<string, unknown>, password?: string) => Promise<{ id: string }>;
          };
        };
      };
      const ids: string[] = [];
      for (const name of names) {
        const saved = await bridge.joinery.connection.save(
          {
            // The main process assigns the real id; an empty string is what the
            // Angular renderer sent for a create too (`ipc.service.ts:474-481`).
            id: '',
            name,
            engine: 'postgresql',
            server: pg.host,
            port: pg.port,
            authenticationType: 'sql',
            username: pg.user,
            database: pg.database,
            // The stock dev PG image does not speak SSL.
            encrypt: false,
            trustServerCertificate: true,
            connectionTimeout: 15,
          },
          pg.password
        );
        ids.push(saved.id);
      }
      return ids;
    },
    { names: profileNames, pg: TEST_PG }
  );

  expect(created).toHaveLength(profileNames.length);

  await window.reload({ waitUntil: 'load' });
  await forceFonts(window, 'react');
  await waitForShell(window);
  await expect(window.getByTestId('sidebar-connection-trigger')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  });
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
