/**
 * The object explorer: the Task 4 `explorerStore` rendered through the Task 6 `Tree` primitive.
 *
 * Replaces the recursive `<ng-template #treeNode>` at `sidebar.component.ts:236-294`, which
 * rendered **every** node of **every** expanded branch on every change-detection pass. A SQL
 * Server instance with 400 databases flattens to five figures of rows; this tree mounts the ~24
 * in view (`ui/tree.tsx`, "Virtualized from row one").
 *
 * ── Lazy, and lazy at exactly one place ───────────────────────────────────────────────────
 *
 * Children arrive only when a node is expanded: `onExpandedChange` calls
 * `explorerStore.expandNode`, which fetches through `src/ipc` and caches the result on the node
 * (CLAUDE.md's "lazy-load tree nodes on expand"). Nothing here fetches, prefetches or walks
 * ahead — the store's `children === undefined` IS the "not loaded" state and the primitive's
 * `hasChildren` prop is what makes an unfetched node expandable anyway.
 *
 * ── Two places the Angular semantics are deliberately not reproduced ──────────────────────
 *
 * 1. **A single click no longer toggles expansion.** `onNodeClick` selected *and* toggled
 *    (`:869-875`) while `onNodeDoubleClick` toggled again (`:877-881`), so a double-click on a
 *    folder toggled twice and appeared to do nothing. Here a click selects, the twisty or a
 *    double-click expands, and Enter activates — the model the `Tree` primitive documents.
 * 2. **Expansion is read from `node.isExpanded`, not from `expandedNodeIds`.** The store keeps
 *    both, and they can disagree: `refreshNode` sets `isExpanded: true` without touching the id
 *    set (`state/explorer.ts:625`), and `renameDatabaseNodeLocal` clears the flag while leaving
 *    the id in place. The per-node flag is the one every store action maintains, so it is the one
 *    this reads. (`expandedNodeIds` is still the right thing for Task 5 persistence, which needs
 *    a flat set.)
 */

import { useCallback, useMemo, type RefObject } from 'react';
import {
  Columns3,
  Database,
  Eye,
  Folder,
  FolderTree,
  KeyRound,
  Link2,
  ListOrdered,
  Server,
  ShieldCheck,
  Sigma,
  SquareTerminal,
  Table,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { Button, EmptyState, Tree, type TreeHandle, type TreeNode as UiTreeNode } from '../../ui';
import { dispatchCommand } from '../../commands';
import {
  explorerStore,
  useExplorerStore,
  type NodeType,
  type TreeNode as ExplorerNode,
} from '../../state/explorer';
import { openObjectDetail } from './node-actions';
import { NodeContextMenu, hasNodeMenu } from './node-menu';

/**
 * Complete over `NodeType`, exactly as the store's own ligature map is, so a new node type
 * cannot be added without choosing a glyph. lucide, per HOUSE-RULES §6 — the store's `icon`
 * field holds Material Icons ligature names and is left alone for the Angular renderer's benefit
 * until cutover.
 */
const NODE_ICONS: Record<NodeType, LucideIcon> = {
  server: Server,
  database: Database,
  schema: FolderTree,
  folder: Folder,
  table: Table,
  view: Eye,
  procedure: SquareTerminal,
  function: Sigma,
  columns_folder: Columns3,
  indexes_folder: ListOrdered,
  keys_folder: KeyRound,
  constraints_folder: ShieldCheck,
  triggers_folder: Zap,
  column: Columns3,
  index: ListOrdered,
  foreign_key: Link2,
  constraint: ShieldCheck,
  trigger: Zap,
};

/**
 * The folder-ish types whose loaded child count is worth putting in the row's trailing metadata
 * slot. Deliberately not every type: a count next to a table name would be read as a row count,
 * which this is not.
 */
const COUNTED_TYPES: readonly NodeType[] = [
  'folder',
  'columns_folder',
  'indexes_folder',
  'keys_folder',
  'constraints_folder',
  'triggers_folder',
];

/**
 * A primary- or foreign-key column earns its own glyph, which is the one piece of the Angular
 * icon logic worth keeping (`:351`): in a list of forty columns the key is what the eye is
 * looking for.
 */
function iconFor(node: ExplorerNode): LucideIcon {
  if (node.columnInfo?.isPrimaryKey === true || node.indexInfo?.isPrimaryKey === true) {
    return KeyRound;
  }
  if (node.columnInfo?.isForeignKey === true) return Link2;
  return NODE_ICONS[node.type];
}

/**
 * The node types that ARE a database object — the ones an activation should open a detail tab for
 * rather than expand. Everything else in `NodeType` is structure (a server, a database, a schema,
 * one of the folders) or a detail row inside an object.
 */
const OBJECT_TYPES: readonly NodeType[] = ['table', 'view', 'procedure', 'function'];

/** Hard cap on how deep the mapping walks. The deepest real path is 6 levels; see `ui/tree.tsx`. */
const MAX_DEPTH = 32;

interface MappedTree {
  readonly nodes: readonly UiTreeNode[];
  readonly expandedIds: ReadonlySet<string>;
  readonly loadingIds: ReadonlySet<string>;
  /** Explorer nodes by id, so a row's context menu can be built from the real node. */
  readonly byId: ReadonlyMap<string, ExplorerNode>;
}

/**
 * Store nodes → primitive nodes, in one pass that also collects the two id sets and the lookup
 * the context menus need. One walk rather than four: the tree is the only thing being read and
 * it can be five figures long.
 *
 * Exported for its unit test — the lazy contract (`children` stays `undefined` until the store
 * has them, while `hasChildren` is already true) is the property worth pinning.
 */
export function mapExplorerTree(rootNodes: readonly ExplorerNode[]): MappedTree {
  const expandedIds = new Set<string>();
  const loadingIds = new Set<string>();
  const byId = new Map<string, ExplorerNode>();

  const visit = (node: ExplorerNode, depth: number): UiTreeNode => {
    byId.set(node.id, node);
    if (node.isExpanded) expandedIds.add(node.id);
    if (node.isLoading) loadingIds.add(node.id);

    // `undefined` children mean "not fetched" to the primitive, which is the whole lazy
    // contract; an empty array means "fetched and empty" and renders as expanded-and-bare.
    const children =
      node.children === undefined || depth + 1 >= MAX_DEPTH
        ? undefined
        : node.children.map(child => visit(child, depth + 1));

    return {
      id: node.id,
      label: node.name,
      icon: iconFor(node),
      hasChildren: node.hasChildren,
      children,
      meta:
        children !== undefined && COUNTED_TYPES.includes(node.type)
          ? String(children.length)
          : undefined,
    };
  };

  return {
    nodes: rootNodes.map(node => visit(node, 0)),
    expandedIds,
    loadingIds,
    byId,
  };
}

export interface ExplorerTreeProps {
  /** Owned by `Sidebar`, which uses it to reveal a server node from the connection menu. */
  readonly treeRef: RefObject<TreeHandle | null>;
}

export function ExplorerTree({ treeRef }: ExplorerTreeProps) {
  const rootNodes = useExplorerStore(state => state.rootNodes);
  const selectedNodeId = useExplorerStore(state => state.selectedNodeId);

  const { nodes, expandedIds, loadingIds, byId } = useMemo(
    () => mapExplorerTree(rootNodes),
    [rootNodes]
  );

  const handleExpandedChange = useCallback((id: string, expanded: boolean) => {
    const explorer = explorerStore.getState();
    if (expanded) {
      void explorer.expandNode(id);
      return;
    }
    explorer.collapseNode(id);
  }, []);

  const handleSelect = useCallback((node: UiTreeNode) => {
    explorerStore.getState().selectNode(node.id);
  }, []);

  /**
   * Enter or double-click: a database object opens its detail tab, anything structural toggles.
   *
   * The split is on the node's *type*, not on whether it has children, and that is the fix for a
   * real Angular gap: `onNodeDoubleClick` returned early for any `hasChildren` node
   * (`sidebar.component.ts:878-881`) and a table always has children (its Columns / Indexes /
   * Keys / Constraints / Triggers folders), so double-clicking a **table** — the commonest thing a
   * user would try — only toggled it, and the object tab was reachable only for views, procedures
   * and functions. A table is still an object you want to inspect.
   */
  const handleActivate = useCallback(
    (uiNode: UiTreeNode) => {
      const node = byId.get(uiNode.id);
      if (node === undefined) return;
      if (OBJECT_TYPES.includes(node.type) && node.metadata !== undefined) {
        openObjectDetail(node);
        return;
      }
      if (node.hasChildren) explorerStore.getState().toggleNode(node.id);
    },
    [byId]
  );

  const renderContextMenu = useCallback(
    (uiNode: UiTreeNode) => {
      const node = byId.get(uiNode.id);
      if (node === undefined || !hasNodeMenu(node)) return null;
      return <NodeContextMenu node={node} />;
    },
    [byId]
  );

  if (nodes.length === 0) {
    return (
      <div className="flex min-h-0 grow items-center justify-center" data-testid="sidebar-empty">
        <EmptyState
          size="sm"
          icon={Database}
          title="No connections open"
          description="Connect to a server to browse its databases, schemas and objects."
          action={
            <Button
              size="sm"
              data-testid="sidebar-empty-connect"
              onClick={() => dispatchCommand('open-connection-dialog')}
            >
              Connect to a server
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <Tree
      ref={treeRef}
      aria-label="Database explorer"
      data-testid="sidebar-tree"
      className="grow py-1"
      nodes={nodes}
      expandedIds={expandedIds}
      loadingIds={loadingIds}
      selectedId={selectedNodeId ?? undefined}
      onExpandedChange={handleExpandedChange}
      onSelect={handleSelect}
      onActivate={handleActivate}
      renderContextMenu={renderContextMenu}
    />
  );
}
