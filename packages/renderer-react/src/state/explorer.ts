/**
 * The object-explorer tree: server → database → schema → folder → object → column/index/key.
 * Children are fetched lazily on expand and cached on the node, and every node update is an
 * immutable update with structural sharing so one node's spinner does not re-render the tree.
 *
 * Ported from `packages/renderer/src/app/core/state/explorer.state.ts`. Conventions:
 * `capabilities.ts`. Consumer: Task 8 (sidebar + tree).
 */

import { create } from 'zustand';
import type {
  ColumnInfo,
  ConstraintInfo,
  ForeignKeyInfo,
  IndexInfo,
  ObjectMetadata,
  TriggerInfo,
} from '@joinery/shared';
import { ipc } from '../ipc';
import { capabilitiesStore, selectCapabilitiesFor, type CapabilitiesStore } from './capabilities';
import { diagnostics, notify } from './diagnostics';
import { schemaFolderDefs, tableSubFolderDefs } from './explorer-folders';

export type NodeType =
  | 'server'
  | 'database'
  | 'schema'
  | 'folder'
  | 'table'
  | 'view'
  | 'procedure'
  | 'function'
  | 'columns_folder'
  | 'indexes_folder'
  | 'keys_folder'
  | 'constraints_folder'
  | 'triggers_folder'
  | 'column'
  | 'index'
  | 'foreign_key'
  | 'constraint'
  | 'trigger';

export interface TreeNode {
  id: string;
  name: string;
  type: NodeType;
  icon: string;
  path: string;
  children?: readonly TreeNode[];
  hasChildren: boolean;
  isExpanded: boolean;
  isLoading: boolean;
  metadata?: ObjectMetadata;
  connectionId?: string;
  databaseName?: string;
  schema?: string;
  tableName?: string;
  columnInfo?: ColumnInfo;
  indexInfo?: IndexInfo;
  foreignKeyInfo?: ForeignKeyInfo;
  constraintInfo?: ConstraintInfo;
  triggerInfo?: TriggerInfo;
}

/** Complete over `NodeType`, so a new node type cannot be added without an icon. */
const ICONS: Record<NodeType, string> = {
  server: 'dns',
  database: 'database-cylinder',
  schema: 'folder_special',
  folder: 'folder',
  table: 'table_chart',
  view: 'view_list',
  procedure: 'functions',
  function: 'calculate',
  columns_folder: 'view_column',
  indexes_folder: 'format_list_numbered',
  keys_folder: 'key',
  constraints_folder: 'check_circle',
  triggers_folder: 'bolt',
  column: 'view_column',
  index: 'format_list_numbered',
  foreign_key: 'link',
  constraint: 'check_circle',
  trigger: 'bolt',
};

function formatColumnType(col: ColumnInfo): string {
  const type = col.dataType;
  if (['varchar', 'nvarchar', 'char', 'nchar', 'binary', 'varbinary'].includes(type)) {
    return `${type}(${col.maxLength === -1 ? 'MAX' : col.maxLength})`;
  }
  if (['decimal', 'numeric'].includes(type)) {
    return `${type}(${col.precision},${col.scale})`;
  }
  return type;
}

function findNodeById(nodes: readonly TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Immutable update with structural sharing: only the path from root to the target node is
 * cloned, so every untouched subtree keeps its identity and a keyed tree re-renders one branch
 * rather than all of them.
 */
function updateNodeInTree(
  nodes: readonly TreeNode[],
  nodeId: string,
  updates: Partial<TreeNode>
): readonly TreeNode[] {
  let changed = false;
  const next = nodes.map(node => {
    if (node.id === nodeId) {
      changed = true;
      return { ...node, ...updates };
    }
    if (node.children) {
      const newChildren = updateNodeInTree(node.children, nodeId, updates);
      if (newChildren !== node.children) {
        changed = true;
        return { ...node, children: newChildren };
      }
    }
    return node;
  });
  return changed ? next : nodes;
}

/** Replace one server node's direct children, leaving every other root untouched. */
function mapServerChildren(
  nodes: readonly TreeNode[],
  serverId: string,
  fn: (children: readonly TreeNode[]) => readonly TreeNode[] | null
): readonly TreeNode[] {
  let changed = false;
  const next = nodes.map(node => {
    if (node.id !== serverId || !node.children) return node;
    const children = fn(node.children);
    if (children === null) return node;
    changed = true;
    return { ...node, children };
  });
  return changed ? next : nodes;
}

export interface ExplorerStoreState {
  readonly rootNodes: readonly TreeNode[];
  readonly selectedNodeId: string | null;
  readonly expandedNodeIds: ReadonlySet<string>;

  readonly addServerNode: (connectionId: string, serverName: string) => void;
  readonly removeServerNode: (connectionId: string) => void;

  readonly addDatabaseNodeLocal: (connectionId: string, databaseName: string) => void;
  readonly removeDatabaseNodeLocal: (connectionId: string, databaseName: string) => void;
  readonly renameDatabaseNodeLocal: (
    connectionId: string,
    oldName: string,
    newName: string
  ) => void;

  readonly expandNode: (nodeId: string) => Promise<void>;
  readonly collapseNode: (nodeId: string) => void;
  readonly toggleNode: (nodeId: string) => void;
  readonly selectNode: (nodeId: string | null) => void;
  readonly refreshNode: (nodeId: string) => Promise<void>;
  readonly clear: () => void;
}

export interface ExplorerStoreDeps {
  readonly capabilities: CapabilitiesStore;
}

export type ExplorerStore = ReturnType<typeof createExplorerStore>;

export function createExplorerStore(deps: ExplorerStoreDeps) {
  // The concurrent-expand guard. A closure Set rather than store state because nothing renders
  // it — the per-node spinner is `node.isLoading`, which IS in the tree. Angular kept it in a
  // signal it never exposed; here that would just be a write nobody reads.
  const loadingNodeIds = new Set<string>();

  return create<ExplorerStoreState>()((set, get) => {
    const updateNode = (nodeId: string, updates: Partial<TreeNode>): void => {
      set(state => ({ rootNodes: updateNodeInTree(state.rootNodes, nodeId, updates) }));
    };

    const capabilitiesFor = (connectionId: string | undefined) =>
      selectCapabilitiesFor(connectionId)(deps.capabilities.getState());

    const databaseNode = (connectionId: string, databaseName: string): TreeNode => ({
      id: `db-${connectionId}-${databaseName}`,
      name: databaseName,
      type: 'database',
      icon: ICONS.database,
      path: databaseName,
      hasChildren: true,
      isExpanded: false,
      isLoading: false,
      connectionId,
      databaseName,
    });

    const loadDatabases = async (node: TreeNode): Promise<TreeNode[]> => {
      const connectionId = node.connectionId;
      if (!connectionId) return [];
      const databases = await ipc().database.list(connectionId);
      return databases.map(db => ({
        ...databaseNode(connectionId, db.name),
        metadata: { name: db.name, type: 'database', schema: '' } as ObjectMetadata,
      }));
    };

    const loadSchemas = async (node: TreeNode): Promise<TreeNode[]> => {
      const { connectionId, databaseName } = node;
      if (!connectionId || !databaseName) return [];
      // The generic children handler with path='schemas' — same call the Angular tree made.
      const schemas = await ipc().explorer.getChildren(connectionId, databaseName, 'schemas');
      return schemas.map(schema => ({
        id: `schema-${connectionId}-${databaseName}-${schema.name}`,
        name: schema.name,
        type: 'schema' as const,
        icon: ICONS.schema,
        path: schema.name,
        hasChildren: true,
        isExpanded: false,
        isLoading: false,
        connectionId,
        databaseName,
        schema: schema.name,
      }));
    };

    const schemaFolders = (
      connectionId: string,
      databaseName: string,
      schema: string
    ): TreeNode[] =>
      schemaFolderDefs(capabilitiesFor(connectionId)).map(folder => ({
        id: `folder-${connectionId}-${databaseName}-${schema}-${folder.type}`,
        name: folder.name,
        type: 'folder' as const,
        icon: folder.icon,
        path: folder.type,
        hasChildren: true,
        isExpanded: false,
        isLoading: false,
        connectionId,
        databaseName,
        schema,
      }));

    const tableSubFolders = (node: TreeNode): TreeNode[] =>
      tableSubFolderDefs(capabilitiesFor(node.connectionId)).map(folder => {
        const type = folder.type as NodeType;
        return {
          id: `${node.id}-${type}`,
          name: folder.name,
          type,
          icon: ICONS[type] || 'folder',
          path: `${node.path}/${type}`,
          hasChildren: true,
          isExpanded: false,
          isLoading: false,
          connectionId: node.connectionId,
          databaseName: node.databaseName,
          schema: node.schema,
          tableName: node.tableName,
        };
      });

    const metadataToNode = (metadata: ObjectMetadata, parent: TreeNode): TreeNode => {
      const type = metadata.type.toLowerCase() as NodeType;
      return {
        id: `obj-${parent.connectionId}-${parent.databaseName}-${metadata.schema}.${metadata.name}`,
        // Just the name — the tree is already grouped by schema.
        name: metadata.name,
        type,
        icon: ICONS[type] || 'description',
        path: `${parent.path}/${metadata.schema}.${metadata.name}`,
        // Only tables carry sub-nodes (columns, indexes, keys, constraints, triggers).
        hasChildren: type === 'table',
        isExpanded: false,
        isLoading: false,
        connectionId: parent.connectionId,
        databaseName: parent.databaseName,
        schema: metadata.schema,
        tableName: metadata.name,
        metadata,
      };
    };

    const leafNode = (
      node: TreeNode,
      idSuffix: string,
      name: string,
      type: NodeType,
      icon: string,
      pathSegment: string
    ): TreeNode => ({
      id: `${node.id}-${idSuffix}`,
      name,
      type,
      icon,
      path: `${node.path}/${pathSegment}`,
      hasChildren: false,
      isExpanded: false,
      isLoading: false,
      connectionId: node.connectionId,
      databaseName: node.databaseName,
      schema: node.schema,
      tableName: node.tableName,
    });

    /**
     * The five table-detail loads. Each needs the same four-field guard, so they take the
     * already-narrowed tuple rather than re-checking it.
     */
    interface TableTarget {
      readonly connectionId: string;
      readonly databaseName: string;
      readonly schema: string;
      readonly tableName: string;
    }

    const tableTarget = (node: TreeNode): TableTarget | null => {
      const { connectionId, databaseName, schema, tableName } = node;
      if (!connectionId || !databaseName || !schema || !tableName) return null;
      return { connectionId, databaseName, schema, tableName };
    };

    const loadColumns = async (node: TreeNode, t: TableTarget): Promise<TreeNode[]> => {
      const columns = await ipc().explorer.getTableColumns(
        t.connectionId,
        t.databaseName,
        t.schema,
        t.tableName
      );
      return columns.map(col => {
        const nullable = col.isNullable ? 'NULL' : 'NOT NULL';
        const pk = col.isPrimaryKey ? ' (PK)' : '';
        const fk = col.isForeignKey ? ' (FK)' : '';
        const icon = col.isPrimaryKey ? 'key' : col.isForeignKey ? 'link' : ICONS.column;
        return {
          ...leafNode(
            node,
            `col-${col.name}`,
            `${col.name} (${formatColumnType(col)}, ${nullable})${pk}${fk}`,
            'column',
            icon,
            col.name
          ),
          columnInfo: col,
        };
      });
    };

    const loadIndexes = async (node: TreeNode, t: TableTarget): Promise<TreeNode[]> => {
      const indexes = await ipc().explorer.getTableIndexes(
        t.connectionId,
        t.databaseName,
        t.schema,
        t.tableName
      );
      return indexes.map(idx => {
        const typeDisplay = idx.isPrimaryKey ? 'Primary Key' : idx.isUnique ? 'Unique' : idx.type;
        return {
          ...leafNode(
            node,
            `idx-${idx.name}`,
            `${idx.name} (${typeDisplay}) [${idx.columns.join(', ')}]`,
            'index',
            idx.isPrimaryKey ? 'key' : ICONS.index,
            idx.name
          ),
          indexInfo: idx,
        };
      });
    };

    const loadForeignKeys = async (node: TreeNode, t: TableTarget): Promise<TreeNode[]> => {
      const keys = await ipc().explorer.getTableKeys(
        t.connectionId,
        t.databaseName,
        t.schema,
        t.tableName
      );
      return keys.map(fk => ({
        ...leafNode(
          node,
          `fk-${fk.name}`,
          `${fk.name} → ${fk.referencedSchema}.${fk.referencedTable}`,
          'foreign_key',
          ICONS.foreign_key,
          fk.name
        ),
        foreignKeyInfo: fk,
      }));
    };

    const loadConstraints = async (node: TreeNode, t: TableTarget): Promise<TreeNode[]> => {
      const constraints = await ipc().explorer.getTableConstraints(
        t.connectionId,
        t.databaseName,
        t.schema,
        t.tableName
      );
      return constraints.map(con => ({
        ...leafNode(
          node,
          `con-${con.name}`,
          `${con.name} (${con.type.replace('_', ' ').toUpperCase()})`,
          'constraint',
          ICONS.constraint,
          con.name
        ),
        constraintInfo: con,
      }));
    };

    const loadTriggers = async (node: TreeNode, t: TableTarget): Promise<TreeNode[]> => {
      const triggers = await ipc().explorer.getTableTriggers(
        t.connectionId,
        t.databaseName,
        t.schema,
        t.tableName
      );
      return triggers.map(trg => ({
        ...leafNode(
          node,
          `trg-${trg.name}`,
          `${trg.name}${trg.isEnabled ? '' : ' (Disabled)'}`,
          'trigger',
          ICONS.trigger,
          trg.name
        ),
        triggerInfo: trg,
      }));
    };

    const loadFolderObjects = async (node: TreeNode): Promise<TreeNode[]> => {
      const { connectionId, databaseName, schema } = node;
      if (!connectionId || !databaseName || !schema) return [];
      const objects = await ipc().explorer.getChildren(connectionId, databaseName, node.path);
      // The handler answers for the whole database; the folder belongs to one schema.
      return objects.filter(obj => obj.schema === schema).map(obj => metadataToNode(obj, node));
    };

    const loadChildren = async (node: TreeNode): Promise<TreeNode[]> => {
      if (!node.connectionId) return [];

      switch (node.type) {
        case 'server':
          return loadDatabases(node);
        case 'database':
          return node.databaseName ? loadSchemas(node) : [];
        case 'schema':
          return node.databaseName && node.schema
            ? schemaFolders(node.connectionId, node.databaseName, node.schema)
            : [];
        case 'folder':
          return loadFolderObjects(node);
        default:
          break;
      }

      const target = tableTarget(node);
      if (!target) return [];

      switch (node.type) {
        case 'table':
          return tableSubFolders(node);
        case 'columns_folder':
          return loadColumns(node, target);
        case 'indexes_folder':
          return loadIndexes(node, target);
        case 'keys_folder':
          return loadForeignKeys(node, target);
        case 'constraints_folder':
          return loadConstraints(node, target);
        case 'triggers_folder':
          return loadTriggers(node, target);
        default:
          return [];
      }
    };

    return {
      rootNodes: [],
      selectedNodeId: null,
      expandedNodeIds: new Set<string>(),

      addServerNode: (connectionId, serverName) => {
        const node: TreeNode = {
          id: `server-${connectionId}`,
          name: serverName,
          type: 'server',
          icon: ICONS.server,
          path: '',
          hasChildren: true,
          isExpanded: false,
          isLoading: false,
          connectionId,
        };
        set(state => {
          const index = state.rootNodes.findIndex(n => n.connectionId === connectionId);
          if (index === -1) return { rootNodes: [...state.rootNodes, node] };
          const rootNodes = [...state.rootNodes];
          rootNodes[index] = node;
          return { rootNodes };
        });
      },

      removeServerNode: connectionId =>
        set(state => ({
          rootNodes: state.rootNodes.filter(n => n.connectionId !== connectionId),
        })),

      /*
       * The three local mutators below let a successful CRUD call update the tree without an IPC
       * re-fetch. All idempotent, and all no-ops when the server node has not loaded its children
       * yet — in that case the next expand fetches the new state anyway, so there is nothing
       * stale to fix.
       */
      addDatabaseNodeLocal: (connectionId, databaseName) =>
        set(state => ({
          rootNodes: mapServerChildren(state.rootNodes, `server-${connectionId}`, children =>
            children.some(c => c.databaseName === databaseName)
              ? null
              : [...children, databaseNode(connectionId, databaseName)]
          ),
        })),

      removeDatabaseNodeLocal: (connectionId, databaseName) =>
        set(state => ({
          rootNodes: mapServerChildren(state.rootNodes, `server-${connectionId}`, children =>
            children.some(c => c.databaseName === databaseName)
              ? children.filter(c => c.databaseName !== databaseName)
              : null
          ),
        })),

      renameDatabaseNodeLocal: (connectionId, oldName, newName) =>
        set(state => ({
          rootNodes: mapServerChildren(state.rootNodes, `server-${connectionId}`, children =>
            children.some(c => c.databaseName === oldName)
              ? children.map(c =>
                  c.databaseName === oldName
                    ? {
                        ...c,
                        id: `db-${connectionId}-${newName}`,
                        name: newName,
                        databaseName: newName,
                        path: newName,
                        // Schemas/tables under the old name are stale; the next expand refetches.
                        children: undefined,
                        isExpanded: false,
                      }
                    : c
                )
              : null
          ),
        })),

      expandNode: async nodeId => {
        const node = findNodeById(get().rootNodes, nodeId);
        if (!node || !node.hasChildren) return;
        // Already open with children in hand.
        if (node.isExpanded && node.children && node.children.length > 0) return;
        // Concurrent expand (double-click).
        if (loadingNodeIds.has(nodeId)) return;

        loadingNodeIds.add(nodeId);
        updateNode(nodeId, { isLoading: true });
        try {
          const children = await loadChildren(node);
          updateNode(nodeId, { children, isExpanded: true, isLoading: false });
          set(state => ({ expandedNodeIds: new Set(state.expandedNodeIds).add(nodeId) }));
        } catch (error) {
          notify.error('Failed to load items');
          diagnostics.error('failed to expand node', error);
          updateNode(nodeId, { isLoading: false });
        } finally {
          loadingNodeIds.delete(nodeId);
        }
      },

      collapseNode: nodeId => {
        updateNode(nodeId, { isExpanded: false });
        set(state => {
          if (!state.expandedNodeIds.has(nodeId)) return state;
          const expandedNodeIds = new Set(state.expandedNodeIds);
          expandedNodeIds.delete(nodeId);
          return { expandedNodeIds };
        });
      },

      toggleNode: nodeId => {
        const node = findNodeById(get().rootNodes, nodeId);
        if (!node) return;
        if (node.isExpanded) {
          get().collapseNode(nodeId);
        } else {
          void get().expandNode(nodeId);
        }
      },

      selectNode: nodeId => set({ selectedNodeId: nodeId }),

      refreshNode: async nodeId => {
        const node = findNodeById(get().rootNodes, nodeId);
        if (!node) return;

        updateNode(nodeId, { isLoading: true, children: undefined });
        try {
          const children = await loadChildren(node);
          updateNode(nodeId, { children, isExpanded: true, isLoading: false });
        } catch (error) {
          notify.error('Failed to refresh');
          diagnostics.error('failed to refresh node', error);
          updateNode(nodeId, { isLoading: false });
        }
      },

      clear: () => {
        loadingNodeIds.clear();
        set({ rootNodes: [], selectedNodeId: null, expandedNodeIds: new Set() });
      },
    };
  });
}

export const explorerStore = createExplorerStore({ capabilities: capabilitiesStore });
export const useExplorerStore = explorerStore;

export function selectSelectedNode(state: ExplorerStoreState): TreeNode | null {
  const id = state.selectedNodeId;
  if (!id) return null;
  return findNodeById(state.rootNodes, id);
}

export function selectHasNodes(state: ExplorerStoreState): boolean {
  return state.rootNodes.length > 0;
}

/** Exported for the sidebar, which needs to resolve a node id from a context-menu event. */
export function selectNodeById(nodeId: string) {
  return (state: ExplorerStoreState): TreeNode | null => findNodeById(state.rootNodes, nodeId);
}
