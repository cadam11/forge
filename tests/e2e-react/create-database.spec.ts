/**
 * Creating and renaming a database, and the invalidation fan-out that follows.
 *
 * ── What this spec is really proving ────────────────────────────────────────────────────────
 *
 * Not "the dialog calls the bridge" — the unit spec does that against a double. The claim here is that
 * **four independent caches agree afterwards**, which is the thing the Angular renderer got wrong: it
 * reloaded its own database list and left the ERD component's built diagram alone, so a diagram of a
 * name that had changed underneath it kept being served.
 *
 * Three of the four caches are asserted here, at the level a user sees them: the explorer tree, the
 * database picker, and the ERD (a newly created database is reachable as a diagram and draws nothing).
 * A rename additionally re-points the query tab that was open on the old name.
 *
 * ── Why the fourth — the ERD cache's same-name collision — is a UNIT test ────────────────────
 *
 * The discriminating version of that proof needs a database with a table in it, renamed out of the way,
 * and then a NEW empty database created under the same name; a stale cache entry then draws a table that
 * does not exist. It was built that way first and **it cannot pass at this level**, for a reason that is
 * a finding rather than a flake:
 *
 *   `MetadataService.listTables` caches on `tables:${connectionId}:${database}` with no
 *   renderer-reachable invalidation (`packages/main/src/services/sql/metadata.ts:160`). The query tab
 *   that creates the table has already populated that cache with the empty answer — its Monaco
 *   completion prefetch reads it on mount — so `CREATE TABLE` through a query tab is invisible to every
 *   metadata reader in the app until the process restarts. Verified against the container: the table is
 *   there in `pg_tables` and the ERD still draws nothing.
 *
 * So the exact-cache-key version of the assertion lives in
 * `packages/renderer-react/src/features/databases/database-dialogs.spec.tsx`, where the ERD cache can be
 * seeded and read directly, and the main-side cache is filed with J-64 — which is the ticket for the
 * `database:changed` signal that would fix both halves.
 *
 * ── Cleanup ────────────────────────────────────────────────────────────────────────────────
 *
 * These tests CREATE real databases in the shared test container and cannot drop them through the UI
 * (the delete dialog is Task 19b), so `dropDatabasesMatching` does it directly, before AND after the
 * file. Leaving them behind is not cosmetic: the explorer tree is virtualized, so ten extra databases
 * under the server node push the rows below it out of the rendered window and
 * `multi-connection-disconnect.spec.ts` stops finding its third server. That failure is what earned the
 * cleanup.
 */

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  connectFromSidebar,
  createDatabaseFromSidebar,
  dropDatabasesMatching,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  erdNode,
  expandTreeRow,
  openPalette,
  renameDatabaseFromSidebar,
  runPaletteCommand,
  selectDatabase,
  treeRow,
  typeSql,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Test PG';
/** Every database this file creates carries it, so the cleanup can find them all. */
const PROBE_PREFIX = 'rr19a_';

/** A name no other run can be holding. Lower-case: PostgreSQL folds unquoted identifiers. */
function probeName(suffix: string): string {
  return `${PROBE_PREFIX}${suffix}_${Date.now().toString(36)}`;
}

/** Connect and point the workbench at the seeded database. */
async function connect(window: Page): Promise<void> {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, 'joinery_test');
  await dismissToasts(window);
}

/** The whole-database diagram of whatever database is selected, through the palette. */
async function openDatabaseDiagram(window: Page): Promise<void> {
  await openPalette(window);
  await runPaletteCommand(window, 'command:open-erd');
  await expect(window.getByTestId('panel-erd')).toBeVisible({ timeout: 20_000 });
  await expect(window.getByTestId('erd-loading')).toBeHidden({ timeout: 30_000 });
}

test.beforeAll(ensureJoineryTestSeeded);
// Before AND after: a run that was killed mid-way leaves databases behind, and the next run must not
// inherit them — see `dropDatabasesMatching` for what they break.
test.beforeAll(() => dropDatabasesMatching(PROBE_PREFIX));
test.afterAll(() => dropDatabasesMatching(PROBE_PREFIX));

test.describe('Joinery (React) — create and rename database', () => {
  test('creates a database and shows it in the sidebar without a manual refresh', async () => {
    const name = probeName('create');

    await withJoineryReact(async ({ window }) => {
      await connect(window);
      await expandTreeRow(window, PROFILE);
      // It is not there before, which is what makes its appearance evidence.
      await expect(treeRow(window, name)).toHaveCount(0);

      await createDatabaseFromSidebar(window, PROFILE, name);

      // Fan-out 1: the explorer tree, with nobody pressing ⌘R.
      await expect(treeRow(window, name)).toBeVisible({ timeout: 20_000 });

      // Fan-out 2: the database picker, which reads `connectionStore.databasesByConnection` — a
      // different cache from the tree, and the one the Angular version refreshed by hand.
      await window.getByTestId('sidebar-database-trigger').click();
      const menu = window.getByTestId('sidebar-database-menu');
      await expect(menu).toBeVisible({ timeout: 10_000 });
      await expect(menu.getByTestId('sidebar-database-item').filter({ hasText: name })).toHaveCount(
        1
      );
      await window.keyboard.press('Escape');
    });
  });

  test('refuses a name the server already has, before the round trip', async () => {
    await withJoineryReact(async ({ window }) => {
      await connect(window);

      const menu = await (async () => {
        await expandTreeRow(window, PROFILE);
        await treeRow(window, PROFILE).click({ button: 'right' });
        const contextMenu = window.getByTestId('sidebar-node-menu');
        await expect(contextMenu).toBeVisible();
        return contextMenu;
      })();
      await menu.getByTestId('sidebar-menu-new-database').click();
      await expect(window.getByTestId('create-database-dialog')).toBeVisible();

      // `joinery_test` is in the picker's list, so the collision is caught here rather than by the
      // server — and the message names the database instead of greying the button with no reason.
      await window.getByTestId('database-name-input').fill('joinery_test');
      await expect(
        window.getByText('This server already has a database called joinery_test.')
      ).toBeVisible();
      await expect(window.getByTestId('database-dialog-submit')).toBeDisabled();

      // An unusable character says what is allowed.
      await window.getByTestId('database-name-input').fill('has a space');
      await expect(window.getByText(/letters, numbers and underscores/i)).toBeVisible();

      await window.getByTestId('database-dialog-cancel').click();
      await expect(window.getByTestId('create-database-dialog')).toBeHidden();
    });
  });

  test('renames a database and re-points the tab that was open on it', async () => {
    // Two INDEPENDENT names rather than `${before}_renamed`: Playwright's `hasText` is a substring
    // match, so a new name containing the old one makes "the old row is gone" unprovable.
    const before = probeName('rename_from');
    const after = probeName('rename_to');

    await withJoineryReact(async ({ window }) => {
      await connect(window);
      await expandTreeRow(window, PROFILE);
      await createDatabaseFromSidebar(window, PROFILE, before);
      await expect(treeRow(window, before)).toBeVisible({ timeout: 20_000 });

      // A query tab bound to the old name. After the rename it must follow, not be closed and not be
      // left pointing at a name the server no longer knows.
      await selectDatabase(window, before);
      await typeSql(window, 'select 1');
      await expect(window.getByTestId('query-context')).toContainText(before);

      await renameDatabaseFromSidebar(window, before, after);

      await expect(treeRow(window, after)).toBeVisible({ timeout: 20_000 });
      await expect(treeRow(window, before)).toHaveCount(0);
      // The tab, still open, still holding its SQL, now on the new name.
      await expect(window.getByTestId('query-context')).toContainText(after, { timeout: 20_000 });
      await expect(window.getByTestId('query-panel')).toBeVisible();
    });
  });

  test('makes a new database reachable as a diagram, and it draws nothing', async () => {
    // The ERD half of the fan-out at the level this tier can observe: the diagram opens on the database
    // that was created a moment ago (so the picker, the default-database resolution and the ERD's own
    // target all agree) and it is EMPTY, which is the truth about a database with no tables.
    //
    // The stronger same-name-collision assertion is a unit test — see this file's header for the
    // main-process cache that makes it unobservable from here.
    const probe = probeName('erd');

    await withJoineryReact(async ({ window }) => {
      await connect(window);
      await expandTreeRow(window, PROFILE);

      await createDatabaseFromSidebar(window, PROFILE, probe);
      await expect(treeRow(window, probe)).toBeVisible({ timeout: 20_000 });
      await selectDatabase(window, probe);

      await openDatabaseDiagram(window);
      await expect(window.getByTestId('erd-toolbar')).toContainText(probe);
      await expect(window.getByTestId('erd-empty')).toBeVisible({ timeout: 30_000 });
      await expect(window.getByTestId('erd-node')).toHaveCount(0);

      // And the seeded database still draws its tables, so "empty" above is a fact about the new
      // database rather than a broken diagram: the same code path, two answers. Named nodes rather than
      // a count — `joinery_test` has an `app_meta` schema as well as `public`, and the whole-database
      // diagram includes every schema.
      await selectDatabase(window, 'joinery_test');
      await openDatabaseDiagram(window);
      for (const table of ['products', 'customers', 'orders', 'order_items']) {
        await expect(erdNode(window, `public.${table}`)).toHaveCount(1, { timeout: 30_000 });
      }
    });
  });
});
