/**
 * The explorer tree's right-click menus — seven of them, one per node type that has one.
 *
 * Replaces `sidebar.component.ts:1041-1696` (655 LOC of `ContextMenuItem[]` literals whose
 * `action` closures each re-derived the same target). Three things change beyond the framework:
 *
 * 1. **Capability gating is on the item, not in the handler.** The Angular menus offered
 *    Backup / Restore / New Database / Rename / Delete unconditionally and then, once clicked,
 *    called `notification.info('… is not supported on this server')` — five copies of that
 *    string (`:946,988,1711,1740,1770`). Here an unsupported action is a `disabled` item, so it
 *    is refused before the click on **both** the pointer and the keyboard path: Radix skips
 *    disabled items when arrow-keying and ignores Enter on them. A disabled item that only
 *    checked itself inside its handler would have been keyboard-clickable.
 * 2. **The target is a payload, never "the focused connection".** See `commands/registry.ts`'s
 *    Task 8 block: acting on a node under server A while a tab on server B has focus routed the
 *    operation to B, which is the bug class the Angular `overrideConnectionId` parameter existed
 *    to patch at each call site.
 * 3. **Right-click selects the row it opened on.** `onOpenAutoFocus` fires when the menu opens
 *    and only then, which is what makes it the right hook: the menu content is portalled and
 *    mounted on open, while this component's own element exists for every visible row.
 *
 * ── The eight not-yet-owned dispatches ────────────────────────────────────────────────────
 *
 * Backup, Restore, New Database, Rename, Delete, Properties, Edit Connection and Manage
 * Connections dispatch commands that Tasks 9 / 12 / 13 / 19 will handle. Until they do, the
 * dispatch warns in DEV naming the owning task (`commands/bus.ts:warnUnhandled`) and nothing
 * else happens. That is the designed state for a not-yet-shipped surface in this renderer, and
 * it is deliberately NOT patched here with a local placeholder dialog: the menu's final shape is
 * what those tasks need to find, and a second placeholder beside Task 7's three would be a second
 * thing to delete. The native menu's Backup / Restore / New Connection items keep Task 7's
 * placeholders, so no existing entry point regresses.
 */

import { useEffect } from 'react';
import {
  Code,
  DatabaseBackup,
  Eye,
  HardDriveDownload,
  Info,
  Network,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rows3,
  SquareTerminal,
  Trash2,
  Unplug,
} from 'lucide-react';

import type { EngineCapabilities } from '@joinery/shared';

import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '../../ui';
import { dispatchCommand } from '../../commands';
import { selectCapabilitiesFor, useCapabilitiesStore } from '../../state/capabilities';
import { explorerStore, type NodeType, type TreeNode } from '../../state/explorer';
import { keyHint } from '../../utils/platform';
import {
  EDIT_ROW_LIMIT,
  SELECT_ROW_LIMIT,
  disconnectConnection,
  objectTargetOf,
  openDefinitionScript,
  openProcedureCall,
  openQueryForConnection,
  openQueryForDatabase,
  openRelationships,
  openRowQuery,
  openSelectScript,
  openTableScript,
  refreshNode,
  showObjectProperties,
  type ObjectTarget,
} from './node-actions';
import { isSystemDatabase } from './sql-text';

/** The node types that have a menu. Everything else — columns, indexes, keys — has none. */
const TYPES_WITH_MENU: readonly NodeType[] = [
  'server',
  'database',
  'folder',
  'table',
  'view',
  'procedure',
  'function',
];

/**
 * Whether a node has a context menu at all.
 *
 * Exported and consulted by `explorer-tree.tsx` BEFORE this component is created, because the
 * `Tree` primitive keys "this row has no menu" on `renderContextMenu` returning `null` — an
 * element that renders nothing would still wrap the row in a menu root that swallows the
 * right-click.
 */
export function hasNodeMenu(node: TreeNode): boolean {
  return TYPES_WITH_MENU.includes(node.type);
}

export function NodeContextMenu({ node }: { readonly node: TreeNode }) {
  // A stable object per connection (`FULL_CAPABILITIES` when unknown), so this subscription only
  // fires when the connection's capabilities actually change.
  const capabilities = useCapabilitiesStore(selectCapabilitiesFor(node.connectionId));

  return (
    <ContextMenuContent data-testid="sidebar-node-menu">
      <SelectRowWhileMenuIsOpen nodeId={node.id} />
      <NodeMenuItems node={node} capabilities={capabilities} />
    </ContextMenuContent>
  );
}

/**
 * Selects the row the menu opened on. Renders nothing.
 *
 * A child of the menu *content* rather than an `onOpenChange` on the root, because this component
 * does not own the root — the `Tree` primitive creates one per visible row and hands us only the
 * content (`ui/tree.tsx`: `renderContextMenu`). Radix portals the content and mounts it only while
 * the menu is open, so "mounted" is exactly "open" here, which is what makes a mount effect the
 * right instrument. Radix's `ContextMenu.Content` has no `onOpenAutoFocus` — that prop is
 * `DropdownMenu`'s only.
 */
function SelectRowWhileMenuIsOpen({ nodeId }: { readonly nodeId: string }) {
  useEffect(() => {
    explorerStore.getState().selectNode(nodeId);
  }, [nodeId]);
  return null;
}

interface MenuProps {
  readonly node: TreeNode;
  readonly capabilities: EngineCapabilities;
}

/** The dispatch table. One arm per type in `TYPES_WITH_MENU`. */
function NodeMenuItems({ node, capabilities }: MenuProps) {
  switch (node.type) {
    case 'server':
      return <ServerMenu node={node} capabilities={capabilities} />;
    case 'database':
      return <DatabaseMenu node={node} capabilities={capabilities} />;
    case 'folder':
      return <RefreshItem node={node} />;
    case 'table':
      return <TableMenu node={node} capabilities={capabilities} />;
    case 'view':
      return <ViewMenu node={node} />;
    case 'procedure':
      return <RoutineMenu node={node} objectType="procedure" />;
    case 'function':
      return <RoutineMenu node={node} objectType="function" />;
    default:
      return null;
  }
}

/** Every menu ends with this. */
function RefreshItem({ node }: { readonly node: TreeNode }) {
  return (
    <ContextMenuItem
      icon={RefreshCw}
      data-testid="sidebar-menu-refresh"
      onSelect={() => refreshNode(node.id)}
    >
      Refresh
    </ContextMenuItem>
  );
}

function ServerMenu({ node, capabilities }: MenuProps) {
  const connectionId = node.connectionId;
  if (connectionId === undefined) return null;

  return (
    <>
      {/* Resolves the connection's default database. The Angular version hardcoded `'master'`
          (`:1070`), which does not exist on PostgreSQL or MySQL. */}
      <ContextMenuItem
        icon={Code}
        data-testid="sidebar-menu-new-query"
        onSelect={() => openQueryForConnection(connectionId)}
      >
        New Query
      </ContextMenuItem>
      <ContextMenuItem
        icon={Plus}
        disabled={!capabilities.supportsDatabaseManagement}
        data-testid="sidebar-menu-new-database"
        onSelect={() => dispatchCommand('create-database-on-server', { connectionId })}
      >
        New Database…
      </ContextMenuItem>
      <ContextMenuSeparator />
      {/* Restoring a backup CREATES its target, so it belongs at the server level where no
          database has been picked yet — the Angular comment at `:1090-1092` makes the same case. */}
      <ContextMenuItem
        icon={HardDriveDownload}
        disabled={!capabilities.supportsBackupRestore}
        data-testid="sidebar-menu-restore"
        onSelect={() => dispatchCommand('restore-database', { connectionId })}
      >
        Restore Database…
      </ContextMenuItem>
      <ContextMenuSeparator />
      <RefreshItem node={node} />
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={Pencil}
        data-testid="sidebar-menu-edit-connection"
        onSelect={() => dispatchCommand('edit-connection', { connectionId })}
      >
        Edit Connection…
      </ContextMenuItem>
      <ContextMenuItem
        icon={Unplug}
        data-testid="sidebar-menu-disconnect"
        onSelect={() => disconnectConnection(connectionId)}
      >
        Disconnect
      </ContextMenuItem>
    </>
  );
}

function DatabaseMenu({ node, capabilities }: MenuProps) {
  const { connectionId, databaseName } = node;
  if (connectionId === undefined || databaseName === undefined) return null;
  const target = { connectionId, databaseName };
  // A system database cannot be renamed or dropped whatever the engine says, so the two reasons
  // are combined rather than checked in sequence — a disabled item has one state, not two.
  const manageable = capabilities.supportsDatabaseManagement && !isSystemDatabase(databaseName);

  return (
    <>
      <ContextMenuItem
        icon={Code}
        shortcut={keyHint('N')}
        data-testid="sidebar-menu-new-query"
        onSelect={() => openQueryForDatabase(connectionId, databaseName)}
      >
        New Query
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={DatabaseBackup}
        disabled={!capabilities.supportsBackupRestore}
        data-testid="sidebar-menu-backup"
        onSelect={() => dispatchCommand('backup-database', target)}
      >
        Backup Database…
      </ContextMenuItem>
      <ContextMenuItem
        icon={HardDriveDownload}
        disabled={!capabilities.supportsBackupRestore}
        data-testid="sidebar-menu-restore"
        onSelect={() => dispatchCommand('restore-database', target)}
      >
        Restore Database…
      </ContextMenuItem>
      <ContextMenuSeparator />
      <RefreshItem node={node} />
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={Pencil}
        disabled={!manageable}
        data-testid="sidebar-menu-rename-database"
        onSelect={() => dispatchCommand('rename-database', target)}
      >
        Rename…
      </ContextMenuItem>
      <ContextMenuItem
        icon={Trash2}
        disabled={!manageable}
        data-testid="sidebar-menu-delete-database"
        onSelect={() => dispatchCommand('delete-database', target)}
      >
        Delete…
      </ContextMenuItem>
    </>
  );
}

/** The two row-browsing rows, shared by the table and view menus verbatim in Angular too. */
function RowItems({ target }: { readonly target: ObjectTarget }) {
  return (
    <>
      <ContextMenuItem
        icon={Rows3}
        data-testid="sidebar-menu-select-top"
        onSelect={() => openRowQuery(target, SELECT_ROW_LIMIT)}
      >
        Select Top {SELECT_ROW_LIMIT} Rows
      </ContextMenuItem>
      <ContextMenuItem
        icon={Pencil}
        data-testid="sidebar-menu-edit-top"
        onSelect={() => openRowQuery(target, EDIT_ROW_LIMIT)}
      >
        Edit Top {EDIT_ROW_LIMIT} Rows
      </ContextMenuItem>
    </>
  );
}

function PropertiesItem({
  target,
  objectType,
}: {
  readonly target: ObjectTarget;
  readonly objectType: string;
}) {
  return (
    // No shortcut hint. All four Angular copies of this item advertised `Alt+Enter`
    // (`sidebar.component.ts:1364,1492,1573,1675`) and **nothing in the app bound it** — not
    // `main/src/menu.ts`, not a renderer keydown handler. A hint for a binding that does not exist
    // is worse than no hint, so it is gone until something registers the accelerator.
    <ContextMenuItem
      icon={Info}
      data-testid="sidebar-menu-properties"
      onSelect={() => showObjectProperties(target, objectType)}
    >
      Properties…
    </ContextMenuItem>
  );
}

function TableMenu({ node }: MenuProps) {
  const target = objectTargetOf(node);
  if (target === null) return null;

  return (
    <>
      <RowItems target={target} />
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={Code}
        data-testid="sidebar-menu-script-create"
        onSelect={() => void openTableScript(target, 'create')}
      >
        Script Table as CREATE
      </ContextMenuItem>
      <ContextMenuItem
        icon={Code}
        data-testid="sidebar-menu-script-select"
        onSelect={() => openSelectScript(target)}
      >
        Script Table as SELECT
      </ContextMenuItem>
      <ContextMenuItem
        icon={Code}
        data-testid="sidebar-menu-script-insert"
        onSelect={() => void openTableScript(target, 'insert')}
      >
        Script Table as INSERT
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={Network}
        data-testid="sidebar-menu-relationships"
        onSelect={() => openRelationships(target)}
      >
        Show Relationships
      </ContextMenuItem>
      <PropertiesItem target={target} objectType="table" />
      <ContextMenuSeparator />
      <RefreshItem node={node} />
    </>
  );
}

function ViewMenu({ node }: { readonly node: TreeNode }) {
  const target = objectTargetOf(node);
  if (target === null) return null;

  return (
    <>
      <RowItems target={target} />
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={Eye}
        data-testid="sidebar-menu-script-create"
        onSelect={() => void openDefinitionScript(target, 'view', 'create')}
      >
        Script View as CREATE
      </ContextMenuItem>
      <ContextMenuItem
        icon={Eye}
        data-testid="sidebar-menu-script-alter"
        onSelect={() => void openDefinitionScript(target, 'view', 'alter')}
      >
        Script View as ALTER
      </ContextMenuItem>
      <ContextMenuItem
        icon={Code}
        data-testid="sidebar-menu-script-select"
        onSelect={() => openSelectScript(target)}
      >
        Script View as SELECT
      </ContextMenuItem>
      <ContextMenuSeparator />
      <PropertiesItem target={target} objectType="view" />
      <ContextMenuSeparator />
      <RefreshItem node={node} />
    </>
  );
}

/**
 * Stored procedures and functions. One component for both, because the Angular pair differed in
 * exactly two places: the procedure menu leads with "Execute Stored Procedure…" and the labels
 * name the object type. Everything else — CREATE, ALTER, Properties, Refresh — was duplicated.
 */
function RoutineMenu({
  node,
  objectType,
}: {
  readonly node: TreeNode;
  readonly objectType: 'procedure' | 'function';
}) {
  const target = objectTargetOf(node);
  if (target === null) return null;
  const label = objectType === 'procedure' ? 'Procedure' : 'Function';

  return (
    <>
      {objectType === 'procedure' ? (
        <>
          <ContextMenuItem
            icon={Play}
            data-testid="sidebar-menu-execute"
            onSelect={() => openProcedureCall(target)}
          >
            Execute Stored Procedure…
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      ) : null}
      <ContextMenuItem
        icon={SquareTerminal}
        data-testid="sidebar-menu-script-create"
        onSelect={() => void openDefinitionScript(target, objectType, 'create')}
      >
        Script {label} as CREATE
      </ContextMenuItem>
      <ContextMenuItem
        icon={SquareTerminal}
        data-testid="sidebar-menu-script-alter"
        onSelect={() => void openDefinitionScript(target, objectType, 'alter')}
      >
        Script {label} as ALTER
      </ContextMenuItem>
      <ContextMenuSeparator />
      <PropertiesItem target={target} objectType={objectType} />
      <ContextMenuSeparator />
      <RefreshItem node={node} />
    </>
  );
}
