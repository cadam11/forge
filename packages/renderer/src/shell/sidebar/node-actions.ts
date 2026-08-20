/**
 * What the explorer's context menus actually DO. Every export here has side effects — a store
 * write, an IPC call, a tab opening — and they are gathered in one non-component module so the
 * menu markup in `node-menu.tsx` reads as a list of labels and the effects are visible at their
 * call site (CLAUDE.md: "surface your side effects").
 *
 * Ported from the seven `get*ContextMenu` methods of `sidebar.component.ts:1041-1696`, whose
 * action closures were ~40 copies of the same four lines: check three fields are present, resolve
 * a schema, select the database, open a tab. Here the guard and the resolution happen once.
 *
 * ── Two Angular behaviours deliberately NOT ported ────────────────────────────────────────
 *
 * 1. **"Script … as CREATE/INSERT" no longer auto-executes.** `sidebar.component.ts:1292,1311,1332`
 *    passed `autoExecute = true` to `openQueryTab` for the table menu's three scripting rows, so
 *    asking for a CREATE TABLE script *ran* it. Only "Select Top 1000 Rows" executes on open now,
 *    which is what its own label promises and what the view/procedure/function menus already did.
 * 2. **Nothing here calls `router.navigate()`.** PLAN.md 0.1: the router had no outlet, so all ~30
 *    of those calls were no-ops. Tabs are the navigation model.
 */

import type { DatabaseEngine } from '@joinery/shared';
import { dropMainMetadataCaches, ipc } from '../../ipc';
import {
  connectionStore,
  selectDefaultDatabaseFor,
  selectProfileFor,
} from '../../state/connection';
import { diagnostics, notify } from '../../state/diagnostics';
import { explorerStore, selectNodeById, type TreeNode } from '../../state/explorer';
import {
  explorerPathToObject,
  serverNodeId,
  type ExplorerObjectTarget,
} from '../../state/explorer-path';
import { tabStore } from '../../state/tab';
import {
  defaultSchema,
  executeProcedure,
  qualifiedTable,
  scriptAsAlter,
  selectWithLimit,
} from './sql-text';

/** Rows a "Select Top …" opens with, and rows "Edit Top …" opens with. Carried over unchanged. */
export const SELECT_ROW_LIMIT = 1000;
export const EDIT_ROW_LIMIT = 200;

/** Definition types the object menus can script. Narrower than `string` on purpose. */
export type ScriptableObject = 'view' | 'function' | 'procedure';

/**
 * The engine a connection speaks. `mssql` when the profile is unknown, which is the fallback the
 * Angular `getEngine` used and the only engine whose delimiters are not a superset of the others'.
 */
export function engineFor(connectionId: string | undefined): DatabaseEngine {
  if (connectionId === undefined) return 'mssql';
  return selectProfileFor(connectionId)(connectionStore.getState())?.engine ?? 'mssql';
}

/**
 * The four fields every object action needs, or `null` when the node cannot supply them.
 *
 * One guard for ~40 call sites. The Angular closures each re-checked
 * `node.connectionId && node.databaseName && node.metadata` and then re-derived the schema with
 * the same three-way fallback, which is why the fallback drifted: two of them omitted
 * `node.schema` from the middle.
 */
export interface ObjectTarget {
  readonly connectionId: string;
  readonly databaseName: string;
  readonly schema: string;
  readonly name: string;
  readonly engine: DatabaseEngine;
}

export function objectTargetOf(node: TreeNode): ObjectTarget | null {
  const { connectionId, databaseName } = node;
  const name = node.metadata?.name ?? node.tableName;
  if (connectionId === undefined || databaseName === undefined || name === undefined) return null;
  const engine = engineFor(connectionId);
  return {
    connectionId,
    databaseName,
    schema: node.metadata?.schema || node.schema || defaultSchema(engine),
    name,
    engine,
  };
}

/** `schema.object`, quoted for the engine. */
export function referenceOf(target: ObjectTarget): string {
  return qualifiedTable(target.schema, target.name, target.engine);
}

/**
 * Open a query tab against a node's database, moving the sidebar's database picker with it.
 *
 * The `selectDatabase` call is the Angular behaviour and is load-bearing rather than cosmetic:
 * the footer's New Query / Backup actions read the selected database, so acting on a node under a
 * different database and leaving the picker behind would point them at the wrong one.
 */
export function openQueryForDatabase(
  connectionId: string,
  databaseName: string,
  sql?: string,
  autoExecute = false
): void {
  connectionStore.getState().selectDatabase(connectionId, databaseName);
  tabStore.getState().openQueryTab(connectionId, databaseName, sql, autoExecute);
}

/**
 * Open a query tab against a connection's *default* database — the server node's "New Query".
 *
 * `selectDefaultDatabaseFor` is the three-stage resolution from `state/connection.ts`: the
 * user's last selection, then the profile's configured default if it still exists, then the
 * first database the server returned. The Angular server menu instead hardcoded `'master'`
 * (`sidebar.component.ts:1070`), which is a SQL Server system database and does not exist on
 * PostgreSQL or MySQL — so the item opened a tab against a database that was not there.
 */
export function openQueryForConnection(connectionId: string): void {
  const databaseName = selectDefaultDatabaseFor(connectionId)(connectionStore.getState());
  if (databaseName === null) {
    notify.warning('This connection has no databases to query.');
    return;
  }
  openQueryForDatabase(connectionId, databaseName);
}

/** "Select Top 1000 Rows" / "Edit Top 200 Rows". Only the first executes on open. */
export function openRowQuery(target: ObjectTarget, limit: number): void {
  const sql = selectWithLimit(referenceOf(target), limit, target.engine);
  openQueryForDatabase(target.connectionId, target.databaseName, sql, limit === SELECT_ROW_LIMIT);
}

/** "Script … as SELECT". */
export function openSelectScript(target: ObjectTarget): void {
  openQueryForDatabase(
    target.connectionId,
    target.databaseName,
    `SELECT * FROM ${referenceOf(target)}`
  );
}

/** "Execute Stored Procedure…" — the call statement, not the execution. */
export function openProcedureCall(target: ObjectTarget): void {
  openQueryForDatabase(
    target.connectionId,
    target.databaseName,
    executeProcedure(referenceOf(target), target.engine)
  );
}

/** "Script Table as CREATE" / "as INSERT". Both are main-process generators. */
export async function openTableScript(
  target: ObjectTarget,
  kind: 'create' | 'insert'
): Promise<void> {
  try {
    const explorer = ipc().explorer;
    // Called through the namespace rather than a hoisted reference: preload's members are plain
    // functions today, but a bound method extracted from the bridge would lose its receiver.
    const sql =
      kind === 'create'
        ? await explorer.scriptTableAsCreate(
            target.connectionId,
            target.databaseName,
            target.schema,
            target.name
          )
        : await explorer.scriptTableAsInsert(
            target.connectionId,
            target.databaseName,
            target.schema,
            target.name
          );
    openQueryForDatabase(target.connectionId, target.databaseName, sql);
  } catch (error) {
    // The Angular version reported this to the user and dropped the cause on the floor
    // (`catch (err)` with an unused binding). Both halves matter: the toast is for the user, the
    // diagnostic is what makes a failing generator debuggable from the Output panel.
    notify.error(`Failed to generate the ${kind.toUpperCase()} script`);
    diagnostics.error(`failed to script a table as ${kind}`, error);
  }
}

/** "Script View/Function/Procedure as CREATE" / "as ALTER". */
export async function openDefinitionScript(
  target: ObjectTarget,
  objectType: ScriptableObject,
  mode: 'create' | 'alter'
): Promise<void> {
  try {
    const result = await ipc().explorer.getDefinition(
      target.connectionId,
      target.databaseName,
      target.schema,
      target.name,
      objectType
    );
    const definition = result.definition || `-- ${objectType} definition not available`;
    const sql =
      mode === 'create' ? definition : scriptAsAlter(definition, ALTER_KEYWORDS[objectType]);
    openQueryForDatabase(target.connectionId, target.databaseName, sql);
  } catch (error) {
    notify.error(`Failed to get the ${objectType} definition`);
    diagnostics.error(`failed to read a ${objectType} definition`, error);
  }
}

const ALTER_KEYWORDS: Record<ScriptableObject, 'VIEW' | 'FUNCTION' | 'PROCEDURE'> = {
  view: 'VIEW',
  function: 'FUNCTION',
  procedure: 'PROCEDURE',
};

/** Double-click / Enter on an object node: its detail tab. */
export function openObjectDetail(node: TreeNode): void {
  const target = objectTargetOf(node);
  if (target === null || node.metadata === undefined) return;
  tabStore
    .getState()
    .openObjectTab(
      target.connectionId,
      target.databaseName,
      target.name,
      node.metadata.type,
      target.schema
    );
}

/** "Show Relationships". */
export function openRelationships(target: ObjectTarget): void {
  connectionStore.getState().selectDatabase(target.connectionId, target.databaseName);
  tabStore
    .getState()
    .openErdTab(target.connectionId, target.databaseName, target.name, target.schema);
}

/**
 * Expand the explorer down to one object and select it. Returns the object's node id once it is in
 * the tree, or `null` when the walk could not get there.
 *
 * Task 16's object search is the producer (`reveal-explorer-node`), and the split is deliberate: this
 * function does the *store* half — four lazy expands, each an IPC round trip — and the caller does
 * the *view* half, scrolling the row into a virtualized list through the `TreeHandle` only the
 * sidebar holds. Reporting the id back rather than scrolling here is what keeps this module free of
 * React refs.
 *
 * The loop is bounded by the path, which `explorerPathToObject` fixes at five ids; the last one is
 * the object itself and is never expanded. A missing ancestor is not an error — a server that is not
 * connected, or a schema the user cannot see, simply has no node — so the walk stops and says so
 * rather than throwing into a keystroke handler. `expandNode` reports its own IPC failures.
 */
export async function revealObjectInExplorer(target: ExplorerObjectTarget): Promise<string | null> {
  const path = explorerPathToObject(target);
  if (path === null) return null;

  const explorer = explorerStore.getState();
  const objectId = path[path.length - 1] ?? null;

  for (const ancestorId of path.slice(0, -1)) {
    // Awaited one at a time: each expand's children are what the next id can be found in, so a
    // parallel walk would ask for a node that does not exist yet.
    await explorerStore.getState().expandNode(ancestorId);
  }

  if (objectId === null) return null;
  if (selectNodeById(objectId)(explorerStore.getState()) === null) {
    notify.warning(`Could not find ${target.schema}.${target.objectName} in the explorer.`);
    return null;
  }

  explorer.selectNode(objectId);
  return objectId;
}

/**
 * "Refresh" — every menu has one, and it is always this.
 *
 * Two halves, and the first one is new. `explorerStore.refreshNode` re-runs the READ; until now nothing
 * dropped what the read is served from, so `MetadataService`'s 60s list caches answered a Refresh with
 * the same rows the user was already looking at. `dropMainMetadataCaches` is the door that was on the
 * bridge all along (see `src/ipc/main-metadata-cache.ts`), and a Refresh is exactly what it is for.
 */
export function refreshNode(nodeId: string): void {
  void dropMainCachesForNode(nodeId).then(() => explorerStore.getState().refreshNode(nodeId));
}

/**
 * Drop main's caches for whatever connection `nodeId` belongs to, and report rather than raise.
 *
 * The database is the node's own where it has one and the connection's default otherwise — a server
 * node has no database and the invalidation is per-connection regardless, so this only decides which
 * list main re-warms on the way back. Never rejects: a Refresh whose second half still runs is worth
 * more than one that gives up because the re-warm found the database gone.
 */
async function dropMainCachesForNode(nodeId: string): Promise<void> {
  const node = selectNodeById(nodeId)(explorerStore.getState());
  const connectionId = node?.connectionId;
  if (connectionId === undefined) return;
  await dropMainCaches(connectionId, node?.databaseName);
}

/** The shared tail of both Refresh paths. `undefined` falls back to the connection's default database. */
async function dropMainCaches(connectionId: string, databaseName?: string): Promise<void> {
  const database =
    databaseName ?? selectDefaultDatabaseFor(connectionId)(connectionStore.getState());
  if (database === null) return;
  try {
    await dropMainMetadataCaches(connectionId, database);
  } catch (error) {
    diagnostics.warn('could not drop the main-process metadata caches', error);
  }
}

/** "Disconnect". Per-connection, never "the active one" — that was bug 1.5. */
export function disconnectConnection(connectionId: string): void {
  void connectionStore.getState().disconnect(connectionId);
}

/**
 * Connect a profile and put its server node in the tree, expanded.
 *
 * Ported from `sidebar.component.ts:829-838`. The expand is deliberately not awaited: the node
 * appears immediately with its own spinner, which is what `TreeNode.isLoading` is for.
 *
 * Returns whether the connection was established. The menus ignore it — a failure has already been
 * toasted by the store — but Task 9's connection editor needs it: it stays open on a failed connect
 * so the user can correct the form, which is what the Angular dialog's `connectNow` did.
 */
export async function connectProfile(profileId: string): Promise<boolean> {
  const connection = connectionStore.getState();
  const profile = selectProfileFor(profileId)(connection);
  if (profile === null) {
    notify.error('Connection profile not found');
    return false;
  }
  if (!(await connection.connect(profileId))) return false;
  explorerStore.getState().addServerNode(profileId, profile.name);
  void explorerStore.getState().expandNode(serverNodeId(profileId));
  return true;
}

/**
 * The sidebar's Refresh: the focused connection's database list, then whichever node is selected.
 *
 * Ported from `sidebar.component.ts:910-919`. Deliberately NOT the same as the Server ▸ Refresh
 * menu command, which also refreshes the server node itself (`shell-commands.tsx:refreshExplorer`,
 * three steps, from `menu.service.ts:356-386`) — the two were already different in Angular and
 * the difference is intentional: the toolbar button refreshes what you are looking at.
 */
export async function refreshFocused(): Promise<void> {
  const connection = connectionStore.getState();
  const connectionId = connection.mostRecentConnectionId();
  if (connectionId !== null) {
    // Before the reload, not after: `loadDatabases` reads through the caches being dropped.
    await dropMainCaches(connectionId);
    await connection.loadDatabases(connectionId);
  }
  const selectedNodeId = explorerStore.getState().selectedNodeId;
  if (selectedNodeId !== null) {
    await explorerStore.getState().refreshNode(selectedNodeId);
  }
}
