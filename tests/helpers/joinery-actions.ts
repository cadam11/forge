/**
 * Shared E2E + visual interaction helpers.
 *
 * Wraps the multi-step user flows that several specs need: connecting to
 * the seeded test PostgreSQL container, selecting a database, opening a
 * new query tab, typing into Monaco, executing a query.
 *
 * All functions are deliberately tolerant of "this thing was already done"
 * states (e.g., a snackbar that already auto-dismissed) so tests can
 * compose them freely.
 */

import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { Client as PgClient } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
 * schema + data so visual / functional specs that connect via the UI find
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
    const fixturesRoot = join(__dirname, '..', 'fixtures', 'postgres');

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

/**
 * Fill an Angular Material outlined form field by its visible label.
 * Material's label-to-input association doesn't satisfy Playwright's
 * getByLabel; we match the surrounding mat-form-field by its mat-label
 * text and target the input inside.
 */
export async function fillField(
  dialog: ReturnType<Page['locator']>,
  label: string,
  value: string
): Promise<void> {
  const field = dialog
    .locator('mat-form-field')
    .filter({ has: dialog.page().locator(`mat-label:text-is("${label}")`) })
    .first();
  await field.locator('input, textarea').fill(value);
}

/**
 * Open Joinery's New Connection dialog from the welcome screen (via the
 * welcome view's data-testid CTA hook), fill it
 * with the test PG container's credentials, click Connect, and wait for
 * the connected-state sidebar to appear. Dismisses the connect snackbar
 * before returning so visual captures aren't flaked by it.
 */
export async function connectToTestPostgres(window: Page): Promise<void> {
  await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
  await window.locator('[data-testid="welcome-new-connection"]').click();
  const dialog = window.locator('mat-dialog-container');
  await expect(dialog).toBeVisible({ timeout: 10000 });

  await dialog.locator('mat-select').first().click();
  await window.locator('mat-option').filter({ hasText: 'PostgreSQL' }).first().click();
  await window.waitForTimeout(300);

  await fillField(dialog, 'Connection Name', 'Test PG');
  await fillField(dialog, 'Server', TEST_PG.host);
  await fillField(dialog, 'Port', String(TEST_PG.port));
  await fillField(dialog, 'Username', TEST_PG.user);
  await fillField(dialog, 'Password', TEST_PG.password);
  await fillField(dialog, 'Default Database', TEST_PG.database);

  // Stock dev PG image doesn't speak SSL; Joinery defaults to encrypt-on.
  await dialog
    .locator('mat-checkbox')
    .filter({ hasText: 'Encrypt Connection' })
    .locator('input[type="checkbox"]')
    .uncheck({ force: true });

  await dialog.getByRole('button', { name: /^Connect$/ }).click();

  await expect(window.locator('app-sidebar .database-selector')).toBeVisible({ timeout: 20000 });
  await window.waitForTimeout(1500);

  // Auto-dismissing snackbar is a flake source for visual baselines.
  await window
    .locator('.mat-mdc-snack-bar-container button')
    .first()
    .click({ timeout: 2000 })
    .catch(() => {
      /* may have auto-dismissed */
    });
  await window.waitForTimeout(300);
}

/**
 * Pick the named database from the sidebar's database picker. The new
 * query tab won't open until a database is selected (newQuery() in
 * Joinery's MenuService short-circuits when selectedDatabase() is null).
 */
export async function selectDatabase(window: Page, dbName: string): Promise<void> {
  await window.locator('app-sidebar .database-selector button').first().click();
  await window
    .locator('.mat-mdc-menu-panel button, .mat-mdc-menu-panel [role="menuitem"]')
    .filter({ hasText: dbName })
    .first()
    .click();
  await window.waitForTimeout(800);
}

/**
 * Open a new query tab via the same IPC channel Joinery's macOS menu uses.
 * Waits for the freshly-mounted Monaco editor to be visible before returning.
 *
 * Important: every previously-opened query tab keeps its Monaco mount in the
 * DOM (Golden Layout just hides inactive tabs), so we filter to :visible to
 * target the editor in the active tab specifically.
 */
export async function openNewQueryTab(app: ElectronApplication, window: Page): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:new-query');
  });
  const editor = window.locator('.monaco-editor:visible').first();
  await expect(editor).toBeVisible({ timeout: 10000 });
  await window.waitForTimeout(500); // let Monaco finish painting
}

/**
 * Type SQL into the ACTIVE Monaco editor. Filtering by `:visible` is critical
 * — when multiple query tabs exist, every tab's Monaco mounts persist in the
 * DOM but only the active tab's is visible. Without the filter, .first()
 * would match the oldest (hidden) editor and the input would silently land
 * in the wrong tab.
 */
export async function typeInEditor(window: Page, sql: string): Promise<void> {
  const editor = window.locator('.monaco-editor:visible').first();
  await editor.click();
  await window.keyboard.type(sql);
  await window.waitForTimeout(300);
}

/**
 * Trigger query execution (⌘E — SSMS-style). Tolerates the first-run
 * "Execute Query?" confirm dialog by clicking through if it appears.
 */
export async function executeQuery(window: Page): Promise<void> {
  await window.keyboard.press('Meta+e');
  await window
    .getByRole('button', { name: /^Execute$/ })
    .click({ timeout: 3000 })
    .catch(() => {
      /* confirm may already be dismissed */
    });
}
