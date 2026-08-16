/**
 * What must be re-read after a database is created or renamed — the fan-out J-64 asks for, as much of
 * it as the renderer can honestly do.
 *
 * ── Why a module, and not three lines inside each dialog ────────────────────────────────────
 *
 * The state that goes stale when a database appears or changes its name is spread across four owners,
 * and none of them can see the others:
 *
 *  | owner                        | what goes stale                                              |
 *  | ---------------------------- | ------------------------------------------------------------ |
 *  | `connectionStore`            | `databasesByConnection` — the sidebar picker and every        |
 *  |                              | "default database" resolution read it                         |
 *  | `explorerStore`              | the server node's children, and the renamed node's own id     |
 *  | `features/erd`'s cache       | up to 8 built diagrams, keyed by connection + database        |
 *  | the TanStack cache           | `explorer.getChildren` / `listSchemas` / `database.list`      |
 *
 * The Angular renderer invalidated **none** of them: `sidebar.component.ts` reloaded its own database
 * list after a create and left the ERD component's `nodes()` field alone, so re-opening a diagram of a
 * dropped-and-recreated database showed the old tables. Splitting this across the two dialogs would
 * have produced two versions of the list that disagree, which is the same failure one step later.
 *
 * ── What only the main process could do better (the J-64 note) ───────────────────────────────
 *
 * Everything below is **this window's** state. Three limits follow, and they are the ticket rather than
 * bugs in this file:
 *
 *  1. **A second window would not hear about it.** There is no `database.onChanged` event on the
 *     bridge, so a create in one window leaves another window's picker and diagram cache stale until
 *     something else refreshes them.
 *  2. **A change made outside Joinery is invisible.** `CREATE DATABASE` typed into a query tab — which
 *     is a perfectly ordinary thing to do — goes through `query.execute` and produces no signal at all.
 *     Only main sees both paths.
 *  3. **The main-process caches are untouched.** `MetadataService` and the connection pools hold their
 *     own per-database state; the renderer cannot reach either.
 *
 * A main-side `database:changed` broadcast would close all three at once, which is exactly what J-64
 * describes. Until it exists, this is the honest reach.
 */

import { forgetErdForDatabase } from '../erd';
import { connectionStore } from '../../state/connection';
import { diagnostics } from '../../state/diagnostics';
import { explorerStore } from '../../state/explorer';
import { tabStore } from '../../state/tab';

/** The TanStack half, injected so this module holds no `ipcKeys` of its own (the Task 4 fence). */
export interface DatabaseCacheInvalidator {
  readonly namespace: (namespace: 'database' | 'explorer') => Promise<void>;
}

/**
 * A database now exists on `connectionId` that did not a moment ago.
 *
 * The ERD cache is dropped for the NEW name even though it is new: a name that was just created may
 * have belonged to a database that was dropped earlier in the same session, and a cached diagram of
 * that one is the worst possible answer — a picture of tables the user is about to be told are there.
 */
export async function invalidateAfterDatabaseCreate(
  connectionId: string,
  databaseName: string,
  cache: DatabaseCacheInvalidator
): Promise<void> {
  // Optimistic first, authoritative second: the node appears immediately, and the reload that follows
  // is what corrects it if the server disagrees.
  explorerStore.getState().addDatabaseNodeLocal(connectionId, databaseName);
  forgetErdForDatabase(connectionId, databaseName);

  await Promise.all([cache.namespace('database'), cache.namespace('explorer')]);
  await refreshFromServer(connectionId);
}

/**
 * `oldName` on `connectionId` is now `newName`.
 *
 * Four things move, and the tab re-pointing is the one that is a decision rather than bookkeeping: a
 * query tab open on the old name is open on the same database, so it follows the rename instead of
 * being closed or left pointing at a name the server no longer knows. Closing it would throw away
 * unsaved SQL for a change that did not affect the SQL at all.
 */
export async function invalidateAfterDatabaseRename(
  connectionId: string,
  oldName: string,
  newName: string,
  cache: DatabaseCacheInvalidator
): Promise<void> {
  connectionStore.getState().renameDatabaseLocal(connectionId, oldName, newName);
  explorerStore.getState().renameDatabaseNodeLocal(connectionId, oldName, newName);

  // Both names: the old one's diagrams describe a database that has gone, and the new one's may be a
  // previous tenant of that name. See `forgetErdForDatabase`.
  forgetErdForDatabase(connectionId, oldName);
  forgetErdForDatabase(connectionId, newName);

  repointTabs(connectionId, oldName, newName);

  await Promise.all([cache.namespace('database'), cache.namespace('explorer')]);
  await refreshFromServer(connectionId);
}

/** Every database-bound tab on the old name follows it to the new one. */
function repointTabs(connectionId: string, oldName: string, newName: string): void {
  const tabs = tabStore.getState().tabs;
  for (const tab of tabs) {
    if (tab.connectionId !== connectionId || tab.databaseName !== oldName) continue;
    tabStore.getState().updateTab(tab.id, { databaseName: newName });
  }
}

/**
 * Re-read the database list and the server's children from the server itself.
 *
 * Errors are logged rather than raised: the operation the user asked for has already succeeded, and a
 * refresh that fails must not be reported as a failed create. The optimistic local edits above are
 * still in place, so the tree and the picker are correct even when this half does not land.
 */
async function refreshFromServer(connectionId: string): Promise<void> {
  try {
    await connectionStore.getState().loadDatabases(connectionId);
    const serverNode = explorerStore
      .getState()
      .rootNodes.find(node => node.type === 'server' && node.connectionId === connectionId);
    if (serverNode !== undefined) {
      await explorerStore.getState().refreshNode(serverNode.id);
    }
  } catch (error) {
    diagnostics.error('failed to refresh the explorer after a database change', error);
  }
}
