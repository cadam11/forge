import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import type {
  ObjectMetadata,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  ConstraintInfo,
  TriggerInfo,
  MJDatabaseInfo,
} from '@mj-forge/shared';
import { IpcService } from '../services/ipc.service';
import { NotificationService } from '../services/notification.service';
import { firstValueFrom } from 'rxjs';
import { CapabilitiesStore } from './capabilities.state';
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
  | 'trigger'
  // MJ-specific node types
  | 'mj_entities_folder'
  | 'mj_entity'
  | 'mj_queries_folder'
  | 'mj_query'
  | 'mj_audit_folder'
  | 'mj_changes_folder'
  | 'mj_errors_folder'
  | 'mj_applications_folder'
  | 'mj_application';

export interface TreeNode {
  id: string;
  name: string;
  type: NodeType;
  icon: string;
  path: string;
  children?: TreeNode[];
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
  /** MemberJunction database info - set when database is MJ-enabled */
  mjInfo?: MJDatabaseInfo;
}

@Injectable({ providedIn: 'root' })
export class ExplorerStateService {
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);
  private readonly capabilitiesStore = inject(CapabilitiesStore);

  private readonly _rootNodes = signal<TreeNode[]>([]);
  private readonly _selectedNodeId = signal<string | null>(null);
  private readonly _expandedNodeIds = signal<Set<string>>(new Set());
  private readonly _loadingNodeIds = signal<Set<string>>(new Set());

  // Public readonly
  readonly rootNodes = this._rootNodes.asReadonly();
  readonly selectedNodeId = this._selectedNodeId.asReadonly();
  readonly expandedNodeIds = this._expandedNodeIds.asReadonly();

  // Computed
  readonly selectedNode = computed(() => {
    const id = this._selectedNodeId();
    if (!id) return null;
    return this.findNodeById(this._rootNodes(), id);
  });

  readonly hasNodes = computed(() => this._rootNodes().length > 0);

  // Observables
  readonly rootNodes$ = toObservable(this.rootNodes);
  readonly selectedNode$ = toObservable(this.selectedNode);

  private readonly iconMap: Record<string, string> = {
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
    // MJ-specific icons
    mj_entities_folder: 'category',
    mj_entity: 'dataset',
    mj_queries_folder: 'bookmark',
    mj_query: 'code',
    mj_audit_folder: 'history',
    mj_changes_folder: 'change_history',
    mj_errors_folder: 'error',
    mj_applications_folder: 'apps',
    mj_application: 'app_shortcut',
  };

  addServerNode(connectionId: string, serverName: string): void {
    const node: TreeNode = {
      id: `server-${connectionId}`,
      name: serverName,
      type: 'server',
      icon: this.iconMap['server'],
      path: '',
      hasChildren: true,
      isExpanded: false,
      isLoading: false,
      connectionId,
    };

    this._rootNodes.update(nodes => {
      // Replace if exists, otherwise add
      const existing = nodes.findIndex(n => n.connectionId === connectionId);
      if (existing >= 0) {
        const updated = [...nodes];
        updated[existing] = node;
        return updated;
      }
      return [...nodes, node];
    });
  }

  removeServerNode(connectionId: string): void {
    this._rootNodes.update(nodes => nodes.filter(n => n.connectionId !== connectionId));
  }

  /**
   * Direct mutators for a server node's database children. Use these
   * from CRUD handlers when we know the operation succeeded — avoids
   * an IPC re-fetch via refreshNode(serverNode.id) and updates the
   * tree synchronously. All idempotent.
   *
   * Only mutate when the server node already has its children loaded
   * (the user expanded it). If children haven't been loaded yet, the
   * next expand will fetch from IPC and pick up the new state — no
   * stale-state risk.
   */
  addDatabaseNodeLocal(connectionId: string, databaseName: string): void {
    const serverId = `server-${connectionId}`;
    this._rootNodes.update(nodes =>
      this.mapNodes(nodes, node => {
        if (node.id !== serverId || !node.children) return node;
        if (node.children.some(c => c.databaseName === databaseName)) return node;
        const dbNode: TreeNode = {
          id: `db-${connectionId}-${databaseName}`,
          name: databaseName,
          type: 'database',
          icon: this.iconMap['database'],
          path: databaseName,
          hasChildren: true,
          isExpanded: false,
          isLoading: false,
          connectionId,
          databaseName,
        };
        return { ...node, children: [...node.children, dbNode] };
      })
    );
  }

  removeDatabaseNodeLocal(connectionId: string, databaseName: string): void {
    const serverId = `server-${connectionId}`;
    this._rootNodes.update(nodes =>
      this.mapNodes(nodes, node => {
        if (node.id !== serverId || !node.children) return node;
        if (!node.children.some(c => c.databaseName === databaseName)) return node;
        return {
          ...node,
          children: node.children.filter(c => c.databaseName !== databaseName),
        };
      })
    );
  }

  renameDatabaseNodeLocal(connectionId: string, oldName: string, newName: string): void {
    const serverId = `server-${connectionId}`;
    this._rootNodes.update(nodes =>
      this.mapNodes(nodes, node => {
        if (node.id !== serverId || !node.children) return node;
        if (!node.children.some(c => c.databaseName === oldName)) return node;
        return {
          ...node,
          children: node.children.map(c =>
            c.databaseName === oldName
              ? {
                  ...c,
                  id: `db-${connectionId}-${newName}`,
                  name: newName,
                  databaseName: newName,
                  path: newName,
                  // Drop loaded children — schemas/tables under the old
                  // name are stale; the next expand will fetch fresh.
                  children: undefined,
                  isExpanded: false,
                }
              : c
          ),
        };
      })
    );
  }

  /** Recursively transform every node via `fn`, reusing identity when possible. */
  private mapNodes(nodes: TreeNode[], fn: (n: TreeNode) => TreeNode): TreeNode[] {
    return nodes.map(n => fn(n));
  }

  async expandNode(nodeId: string): Promise<void> {
    const node = this.findNodeById(this._rootNodes(), nodeId);
    if (!node || !node.hasChildren) return;

    // Already expanded and has children loaded
    if (node.isExpanded && node.children && node.children.length > 0) {
      return;
    }

    // Guard against concurrent expand calls (e.g. double-click)
    if (this._loadingNodeIds().has(nodeId)) {
      return;
    }

    // Mark as loading
    this._loadingNodeIds.update(ids => new Set([...ids, nodeId]));
    this.updateNode(nodeId, { isLoading: true });

    try {
      const children = await this.loadChildren(node);
      this.updateNode(nodeId, {
        children,
        isExpanded: true,
        isLoading: false,
      });
      this._expandedNodeIds.update(ids => new Set([...ids, nodeId]));
    } catch (error) {
      this.notification.error('Failed to load items');
      console.error('Failed to expand node:', error);
      this.updateNode(nodeId, { isLoading: false });
    } finally {
      this._loadingNodeIds.update(ids => {
        const newIds = new Set(ids);
        newIds.delete(nodeId);
        return newIds;
      });
    }
  }

  collapseNode(nodeId: string): void {
    this.updateNode(nodeId, { isExpanded: false });
    this._expandedNodeIds.update(ids => {
      const newIds = new Set(ids);
      newIds.delete(nodeId);
      return newIds;
    });
  }

  toggleNode(nodeId: string): void {
    const node = this.findNodeById(this._rootNodes(), nodeId);
    if (!node) return;

    if (node.isExpanded) {
      this.collapseNode(nodeId);
    } else {
      this.expandNode(nodeId);
    }
  }

  selectNode(nodeId: string | null): void {
    this._selectedNodeId.set(nodeId);
  }

  async refreshNode(nodeId: string): Promise<void> {
    const node = this.findNodeById(this._rootNodes(), nodeId);
    if (!node) return;

    this.updateNode(nodeId, { isLoading: true, children: undefined });

    try {
      const children = await this.loadChildren(node);
      this.updateNode(nodeId, {
        children,
        isExpanded: true,
        isLoading: false,
      });
    } catch (error) {
      this.notification.error('Failed to refresh');
      console.error('Failed to refresh node:', error);
      this.updateNode(nodeId, { isLoading: false });
    }
  }

  clear(): void {
    this._rootNodes.set([]);
    this._selectedNodeId.set(null);
    this._expandedNodeIds.set(new Set());
    this._loadingNodeIds.set(new Set());
  }

  private async loadChildren(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId) return [];

    if (node.type === 'server') {
      // Load databases
      const databases = await firstValueFrom(this.ipc.listDatabases(node.connectionId));

      // Create database nodes (MJ detection happens at schema level)
      const dbNodes = databases.map(db => ({
        id: `db-${node.connectionId}-${db.name}`,
        name: db.name,
        type: 'database' as const,
        icon: this.iconMap['database'],
        path: db.name,
        hasChildren: true,
        isExpanded: false,
        isLoading: false,
        connectionId: node.connectionId,
        databaseName: db.name,
        metadata: {
          name: db.name,
          type: 'database',
          schema: '',
        } as ObjectMetadata,
      }));

      return dbNodes;
    }

    if (node.type === 'database' && node.databaseName) {
      // Load schemas for the database (filtered to exclude system schemas)
      return this.loadSchemas(node);
    }

    if (node.type === 'schema' && node.databaseName && node.schema) {
      // For __mj schema with MJ enabled, show MJ-specific folders
      if (node.schema === '__mj' && node.mjInfo?.isMJEnabled) {
        return this.getMJSchemaFolders(node);
      }
      // Return folder nodes for schema objects
      return this.getSchemaFolders(node.connectionId!, node.databaseName, node.schema);
    }

    if (node.type === 'folder' && node.databaseName && node.schema) {
      // Load objects from the folder, filtered by schema
      const objects = await firstValueFrom(
        this.ipc.getExplorerChildren(node.connectionId!, node.databaseName, node.path)
      );
      // Filter objects by schema
      const filteredObjects = objects.filter(obj => obj.schema === node.schema);
      return filteredObjects.map(obj => this.metadataToNode(obj, node));
    }

    // Table sub-folders
    if (node.type === 'table' && node.databaseName && node.schema && node.tableName) {
      return this.getTableSubFolders(node);
    }

    // Load columns for a table
    if (node.type === 'columns_folder' && node.databaseName && node.schema && node.tableName) {
      return this.loadColumns(node);
    }

    // Load indexes for a table
    if (node.type === 'indexes_folder' && node.databaseName && node.schema && node.tableName) {
      return this.loadIndexes(node);
    }

    // Load foreign keys for a table
    if (node.type === 'keys_folder' && node.databaseName && node.schema && node.tableName) {
      return this.loadForeignKeys(node);
    }

    // Load constraints for a table
    if (node.type === 'constraints_folder' && node.databaseName && node.schema && node.tableName) {
      return this.loadConstraints(node);
    }

    // Load triggers for a table
    if (node.type === 'triggers_folder' && node.databaseName && node.schema && node.tableName) {
      return this.loadTriggers(node);
    }

    // MJ-specific folder handlers
    if (node.type === 'mj_entities_folder' && node.databaseName) {
      return this.loadMJEntities(node);
    }

    if (node.type === 'mj_queries_folder' && node.databaseName) {
      return this.loadMJQueries(node);
    }

    if (node.type === 'mj_applications_folder' && node.databaseName) {
      return this.loadMJApplications(node);
    }

    // MJ Change History, Audit Logs, and Error Logs don't have children
    // They open query panels instead (handled by context menu)
    if (
      node.type === 'mj_changes_folder' ||
      node.type === 'mj_audit_folder' ||
      node.type === 'mj_errors_folder'
    ) {
      return [];
    }

    return [];
  }

  private getTableSubFolders(node: TreeNode): TreeNode[] {
    const folders = tableSubFolderDefs(this.capabilitiesStore.for(node.connectionId)).map(f => ({
      name: f.name,
      type: f.type as NodeType,
    }));

    return folders.map(folder => ({
      id: `${node.id}-${folder.type}`,
      name: folder.name,
      type: folder.type,
      icon: this.iconMap[folder.type] || 'folder',
      path: `${node.path}/${folder.type}`,
      hasChildren: true,
      isExpanded: false,
      isLoading: false,
      connectionId: node.connectionId,
      databaseName: node.databaseName,
      schema: node.schema,
      tableName: node.tableName,
    }));
  }

  private async loadColumns(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName || !node.schema || !node.tableName) {
      return [];
    }

    const columns = await firstValueFrom(
      this.ipc.getTableColumns(node.connectionId, node.databaseName, node.schema, node.tableName)
    );

    return columns.map(col => {
      const typeDisplay = this.formatColumnType(col);
      const nullable = col.isNullable ? 'NULL' : 'NOT NULL';
      const pkIndicator = col.isPrimaryKey ? ' (PK)' : '';
      const fkIndicator = col.isForeignKey ? ' (FK)' : '';

      return {
        id: `${node.id}-col-${col.name}`,
        name: `${col.name} (${typeDisplay}, ${nullable})${pkIndicator}${fkIndicator}`,
        type: 'column' as NodeType,
        icon: col.isPrimaryKey ? 'key' : col.isForeignKey ? 'link' : this.iconMap['column'],
        path: `${node.path}/${col.name}`,
        hasChildren: false,
        isExpanded: false,
        isLoading: false,
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        schema: node.schema,
        tableName: node.tableName,
        columnInfo: col,
      };
    });
  }

  private async loadIndexes(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName || !node.schema || !node.tableName) {
      return [];
    }

    const indexes = await firstValueFrom(
      this.ipc.getTableIndexes(node.connectionId, node.databaseName, node.schema, node.tableName)
    );

    return indexes.map(idx => {
      const typeDisplay = idx.isPrimaryKey ? 'Primary Key' : idx.isUnique ? 'Unique' : idx.type;
      const columnsDisplay = idx.columns.join(', ');

      return {
        id: `${node.id}-idx-${idx.name}`,
        name: `${idx.name} (${typeDisplay}) [${columnsDisplay}]`,
        type: 'index' as NodeType,
        icon: idx.isPrimaryKey ? 'key' : this.iconMap['index'],
        path: `${node.path}/${idx.name}`,
        hasChildren: false,
        isExpanded: false,
        isLoading: false,
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        schema: node.schema,
        tableName: node.tableName,
        indexInfo: idx,
      };
    });
  }

  private async loadForeignKeys(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName || !node.schema || !node.tableName) {
      return [];
    }

    const foreignKeys = await firstValueFrom(
      this.ipc.getTableKeys(node.connectionId, node.databaseName, node.schema, node.tableName)
    );

    return foreignKeys.map(fk => {
      const refDisplay = `${fk.referencedSchema}.${fk.referencedTable}`;

      return {
        id: `${node.id}-fk-${fk.name}`,
        name: `${fk.name} → ${refDisplay}`,
        type: 'foreign_key' as NodeType,
        icon: this.iconMap['foreign_key'],
        path: `${node.path}/${fk.name}`,
        hasChildren: false,
        isExpanded: false,
        isLoading: false,
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        schema: node.schema,
        tableName: node.tableName,
        foreignKeyInfo: fk,
      };
    });
  }

  private async loadConstraints(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName || !node.schema || !node.tableName) {
      return [];
    }

    const constraints = await firstValueFrom(
      this.ipc.getTableConstraints(
        node.connectionId,
        node.databaseName,
        node.schema,
        node.tableName
      )
    );

    return constraints.map(con => {
      const typeDisplay = con.type.replace('_', ' ').toUpperCase();

      return {
        id: `${node.id}-con-${con.name}`,
        name: `${con.name} (${typeDisplay})`,
        type: 'constraint' as NodeType,
        icon: this.iconMap['constraint'],
        path: `${node.path}/${con.name}`,
        hasChildren: false,
        isExpanded: false,
        isLoading: false,
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        schema: node.schema,
        tableName: node.tableName,
        constraintInfo: con,
      };
    });
  }

  private async loadTriggers(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName || !node.schema || !node.tableName) {
      return [];
    }

    const triggers = await firstValueFrom(
      this.ipc.getTableTriggers(node.connectionId, node.databaseName, node.schema, node.tableName)
    );

    return triggers.map(trg => {
      const statusDisplay = trg.isEnabled ? '' : ' (Disabled)';

      return {
        id: `${node.id}-trg-${trg.name}`,
        name: `${trg.name}${statusDisplay}`,
        type: 'trigger' as NodeType,
        icon: this.iconMap['trigger'],
        path: `${node.path}/${trg.name}`,
        hasChildren: false,
        isExpanded: false,
        isLoading: false,
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        schema: node.schema,
        tableName: node.tableName,
        triggerInfo: trg,
      };
    });
  }

  private formatColumnType(col: ColumnInfo): string {
    const type = col.dataType;
    if (['varchar', 'nvarchar', 'char', 'nchar', 'binary', 'varbinary'].includes(type)) {
      const len = col.maxLength === -1 ? 'MAX' : col.maxLength;
      return `${type}(${len})`;
    }
    if (['decimal', 'numeric'].includes(type)) {
      return `${type}(${col.precision},${col.scale})`;
    }
    return type;
  }

  private async loadSchemas(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName) return [];

    // Use existing GET_CHILDREN handler with path='schemas'
    const schemas = await firstValueFrom(
      this.ipc.getExplorerChildren(node.connectionId, node.databaseName, 'schemas')
    );

    // Detect MJ for __mj schema
    let mjInfo: MJDatabaseInfo | undefined;
    const hasMjSchema = schemas.some(s => s.name === '__mj');
    if (hasMjSchema) {
      try {
        mjInfo = await firstValueFrom(
          this.ipc.detectMJDatabase(node.connectionId, node.databaseName)
        );
      } catch {
        // MJ detection failed
      }
    }

    return schemas.map(schema => ({
      id: `schema-${node.connectionId}-${node.databaseName}-${schema.name}`,
      name: schema.name,
      type: 'schema' as NodeType,
      icon: this.iconMap['schema'],
      path: schema.name,
      hasChildren: true,
      isExpanded: false,
      isLoading: false,
      connectionId: node.connectionId,
      databaseName: node.databaseName,
      schema: schema.name,
      // Set mjInfo only on the __mj schema
      mjInfo: schema.name === '__mj' && mjInfo?.isMJEnabled ? mjInfo : undefined,
    }));
  }

  private getSchemaFolders(connectionId: string, databaseName: string, schema: string): TreeNode[] {
    const folders = schemaFolderDefs(this.capabilitiesStore.for(connectionId));

    return folders.map(folder => ({
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
  }

  /**
   * Get MJ-specific folders for the __mj schema
   */
  private getMJSchemaFolders(node: TreeNode): TreeNode[] {
    const folders = [
      {
        name: `Entities (${node.mjInfo?.entityCount || 0})`,
        type: 'mj_entities_folder' as NodeType,
        icon: this.iconMap['mj_entities_folder'],
      },
      {
        name: 'Saved Queries',
        type: 'mj_queries_folder' as NodeType,
        icon: this.iconMap['mj_queries_folder'],
      },
      {
        name: 'Applications',
        type: 'mj_applications_folder' as NodeType,
        icon: this.iconMap['mj_applications_folder'],
      },
      {
        name: 'Change History',
        type: 'mj_changes_folder' as NodeType,
        icon: this.iconMap['mj_changes_folder'],
      },
      {
        name: 'Audit Logs',
        type: 'mj_audit_folder' as NodeType,
        icon: this.iconMap['mj_audit_folder'],
      },
      {
        name: 'Error Logs',
        type: 'mj_errors_folder' as NodeType,
        icon: this.iconMap['mj_errors_folder'],
      },
      // Also include regular schema folders
      { name: 'Tables', type: 'folder' as NodeType, icon: 'table_chart', path: 'tables' },
      { name: 'Views', type: 'folder' as NodeType, icon: 'view_list', path: 'views' },
      {
        name: 'Stored Procedures',
        type: 'folder' as NodeType,
        icon: 'functions',
        path: 'procedures',
      },
    ];

    return folders.map(folder => {
      const folderPath = (folder as { path?: string }).path || folder.type;
      return {
        id: `mj-folder-${node.connectionId}-${node.databaseName}-${folderPath}`,
        name: folder.name,
        type: folder.type,
        icon: folder.icon,
        path: folderPath,
        hasChildren: true,
        isExpanded: false,
        isLoading: false,
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        schema: node.schema,
        mjInfo: node.mjInfo,
      };
    });
  }

  /**
   * Load MJ entities
   */
  private async loadMJEntities(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName) return [];

    const entities = await firstValueFrom(
      this.ipc.getMJEntities(node.connectionId, node.databaseName)
    );

    return entities.map(entity => ({
      id: `mj-entity-${node.connectionId}-${node.databaseName}-${entity.id}`,
      name: entity.name,
      type: 'mj_entity' as NodeType,
      icon: entity.isVirtual ? 'cloud' : this.iconMap['mj_entity'],
      path: `entities/${entity.id}`,
      hasChildren: false,
      isExpanded: false,
      isLoading: false,
      connectionId: node.connectionId,
      databaseName: node.databaseName,
      schema: entity.schemaName,
      tableName: entity.baseTable,
      metadata: {
        name: entity.name,
        type: 'mj_entity',
        schema: entity.schemaName,
      } as ObjectMetadata,
    }));
  }

  /**
   * Load MJ saved queries
   */
  private async loadMJQueries(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName) return [];

    const queries = await firstValueFrom(
      this.ipc.getMJSavedQueries(node.connectionId, node.databaseName)
    );

    return queries.map(query => ({
      id: `mj-query-${node.connectionId}-${node.databaseName}-${query.id}`,
      name: query.name,
      type: 'mj_query' as NodeType,
      icon: this.iconMap['mj_query'],
      path: `queries/${query.id}`,
      hasChildren: false,
      isExpanded: false,
      isLoading: false,
      connectionId: node.connectionId,
      databaseName: node.databaseName,
      metadata: {
        name: query.name,
        type: 'mj_query',
        schema: '__mj',
        definition: query.sql,
      } as ObjectMetadata,
    }));
  }

  /**
   * Load MJ applications
   */
  private async loadMJApplications(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName) return [];

    const applications = await firstValueFrom(
      this.ipc.getMJApplications(node.connectionId, node.databaseName)
    );

    return applications.map(app => ({
      id: `mj-app-${node.connectionId}-${node.databaseName}-${app.id}`,
      name: app.name,
      type: 'mj_application' as NodeType,
      icon: app.icon || this.iconMap['mj_application'],
      path: `applications/${app.id}`,
      hasChildren: false,
      isExpanded: false,
      isLoading: false,
      connectionId: node.connectionId,
      databaseName: node.databaseName,
      metadata: {
        name: app.name,
        type: 'mj_application',
        schema: '__mj',
      } as ObjectMetadata,
    }));
  }

  private metadataToNode(metadata: ObjectMetadata, parent: TreeNode): TreeNode {
    const type = metadata.type.toLowerCase() as NodeType;
    // Tables have sub-nodes for columns, indexes, etc.
    const hasChildren = type === 'table';

    return {
      id: `obj-${parent.connectionId}-${parent.databaseName}-${metadata.schema}.${metadata.name}`,
      // Just show the name since we're already grouped by schema
      name: metadata.name,
      type,
      icon: this.iconMap[type] || 'description',
      path: `${parent.path}/${metadata.schema}.${metadata.name}`,
      hasChildren,
      isExpanded: false,
      isLoading: false,
      connectionId: parent.connectionId,
      databaseName: parent.databaseName,
      schema: metadata.schema,
      tableName: metadata.name,
      metadata,
    };
  }

  private findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = this.findNodeById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  private updateNode(nodeId: string, updates: Partial<TreeNode>): void {
    this._rootNodes.update(nodes => this.updateNodeInTree(nodes, nodeId, updates));
  }

  private updateNodeInTree(
    nodes: TreeNode[],
    nodeId: string,
    updates: Partial<TreeNode>
  ): TreeNode[] {
    return nodes.map(node => {
      if (node.id === nodeId) {
        return { ...node, ...updates };
      }
      if (node.children) {
        return {
          ...node,
          children: this.updateNodeInTree(node.children, nodeId, updates),
        };
      }
      return node;
    });
  }
}
