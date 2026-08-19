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
 * Five caches, in fact, and all five are asserted here at the level a user sees them: the explorer
 * tree, the database picker, the ERD's built-diagram cache — including the same-name collision, the
 * assertion this file used to say it could not make — and, through both of the last two, the MAIN
 * process's per-connection metadata caches. A rename additionally re-points the query tab that was open
 * on the old name.
 *
 * ── The correction: main's caches ARE renderer-reachable ─────────────────────────────────────
 *
 * An earlier version of this header claimed the same-name proof "cannot pass at this level", because
 * `MetadataService.listTables` caches on `tables:${connectionId}:${database}` with "no
 * renderer-reachable invalidation" — so a `CREATE TABLE` typed into a query tab stayed invisible to
 * every metadata reader and there was no way to build a non-empty diagram to go stale.
 *
 * The premise was false. `EXPLORER.REFRESH_NODE` calls `metadataService.invalidateConnection`
 * (`packages/main/src/ipc/explorer.ipc.ts:113-123`) and has been on the preload bridge all along —
 * it was simply DEAD CODE that neither renderer ever called. It is called now, by the create/rename
 * fan-out and by both of the sidebar's Refresh affordances
 * (`packages/renderer-react/src/ipc/main-metadata-cache.ts`), so a Refresh finally means what it says
 * and `serves no stale diagram…` below is the discriminating proof, at this tier, of both halves.
 *
 * The exact-cache-key version of the ERD assertion stays in
 * `packages/renderer-react/src/features/databases/database-dialogs.spec.tsx`, where the keys can be read
 * directly. What remains on J-64 is the part no renderer can do: the automatic signal that turns a DDL
 * statement main has just executed into an invalidation nobody had to ask for.
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

import { expect, test, type Page } from '@playwright/test';
import {
  closeTabTitled,
  connectFromSidebar,
  createDatabaseFromSidebar,
  disconnectServer,
  dropDatabasesMatching,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  erdNode,
  executeQuery,
  expandTreeRow,
  openPalette,
  refreshSidebar,
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
    // The stronger same-name-collision assertion is the test that follows this one.
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

  test('serves no stale diagram for a name that has been recreated', async () => {
    /**
     * The discriminating proof, and it needs BOTH halves of the fan-out to hold:
     *
     *  1. `Refresh` drops main's metadata caches, or the `CREATE TABLE` below stays invisible and the
     *     diagram at step 4 is empty — nothing goes stale and the test proves nothing;
     *  2. the create fan-out drops the ERD cache for the new name AND main's list caches, or the
     *     diagram at step 8 is the one built at step 4: a picture of a table that no longer exists.
     *
     * The name is freed **outside Joinery**, with the server disconnected first so no pool is holding
     * the database open. That is deliberate on both counts: it is the one change the fan-out cannot
     * see (J-64's remaining half), and the app's own rename/delete paths would themselves invalidate,
     * leaving nothing stale to catch. `DROP DATABASE` is also not reachable through the UI until 19b.
     */
    const probe = probeName('reuse');

    await withJoineryReact(async ({ window }) => {
      await connect(window);
      await expandTreeRow(window, PROFILE);
      await createDatabaseFromSidebar(window, PROFILE, probe);
      await expect(treeRow(window, probe)).toBeVisible({ timeout: 20_000 });

      // 1–2. a table, created the ordinary way: typed into a query tab.
      await selectDatabase(window, probe);
      await typeSql(window, 'create table probe_t (id int primary key)');
      await executeQuery(window);

      // 3. Refresh. This is the call that was missing: main cached the empty table list when the query
      //    tab's completion prefetch read it, and only `EXPLORER.REFRESH_NODE` drops it.
      await refreshSidebar(window);

      //    And the refresh's own observable proof, which is also step 4's precondition: the table is
      //    now in the tree, so main's list for this database has been re-read. `refreshSidebar` has no
      //    busy state to await (see its comment) — it used to end in a `waitForTimeout(1_000)`, which
      //    this replaces with the bounded assertion the sleep was standing in for. Without a gate here
      //    the diagram request below can go out before the cache drop lands, and the empty diagram it
      //    would then cache makes step 4 fail for a reason that has nothing to do with staleness.
      await expandTreeRow(window, probe);
      await expandTreeRow(window, 'public');
      await expandTreeRow(window, 'Tables');
      await expect(treeRow(window, 'probe_t')).toBeVisible({ timeout: 20_000 });

      // 4. so the diagram can see the table — and caching a NON-EMPTY diagram under this name is the
      //    whole point of the steps above.
      await openDatabaseDiagram(window);
      await expect(erdNode(window, 'public.probe_t')).toHaveCount(1, { timeout: 30_000 });

      // 5. CLOSE that ERD tab, and the reason is a finding rather than tidiness: `useErdSchema` keeps
      //    its resolved diagram in component state keyed by connection + database name, and both are
      //    unchanged by a recreate — so a tab left OPEN on this database goes on rendering the old
      //    diagram even with every cache correctly dropped underneath it. Nothing in the fan-out can
      //    reach a mounted panel's state; see the fix report. Closing it makes step 8 a real cache read.
      await selectDatabase(window, 'joinery_test');
      await openDatabaseDiagram(window);
      await closeTabTitled(window, `ERD: ${probe}`);

      // 6–7. the name goes away with Joinery not even connected to that server.
      await disconnectServer(window, PROFILE);
      await dropDatabasesMatching(probe);
      await connectFromSidebar(window, PROFILE);

      // Reconnecting does NOT re-read: `closePool` leaves `MetadataService` alone, so the database
      // list is still the one main cached before the drop. Refresh again — the same wiring as step 3
      // on a different cache, and without it the dialog below refuses the name as already taken.
      await refreshSidebar(window);
      await expect(treeRow(window, probe)).toHaveCount(0, { timeout: 20_000 });

      // 8. a NEW, empty database under the old name. The stale diagram must not survive it.
      await createDatabaseFromSidebar(window, PROFILE, probe);
      await expect(treeRow(window, probe)).toBeVisible({ timeout: 20_000 });
      await selectDatabase(window, probe);

      await openDatabaseDiagram(window);
      await expect(window.getByTestId('erd-toolbar')).toContainText(probe);
      await expect(erdNode(window, 'public.probe_t')).toHaveCount(0);
      await expect(window.getByTestId('erd-empty')).toBeVisible({ timeout: 30_000 });
    });
  });
});
