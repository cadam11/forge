import { Component, computed, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { ConnectionStateService } from '../../core/state/connection.state';
import { ExplorerStateService, TreeNode } from '../../core/state/explorer.state';
import { TabStateService } from '../../core/state/tab.state';
import { ContextMenuService, ContextMenuItem } from '../../core/services/context-menu.service';
import { keyHint } from '../../core/utils/platform';
import { ChatStateService } from '../../core/state/chat.state';
import { NotificationService } from '../../core/services/notification.service';
import { TablePropertiesService } from '../../core/services/table-properties.service';
import { firstValueFrom } from 'rxjs';
import { IpcService } from '../../core/services/ipc.service';
import { ConfirmDialogComponent } from '../../shared/components/dialog/confirm-dialog.component';
import { InputDialogComponent } from '../../shared/components/dialog/input-dialog.component';
import {
  BackupDialogComponent,
  BackupDialogData,
} from '../../shared/components/backup-dialog/backup-dialog.component';
import {
  RestoreDialogComponent,
  RestoreDialogData,
} from '../../shared/components/restore-dialog/restore-dialog.component';
import {
  RenameDatabaseDialogComponent,
  RenameDatabaseDialogData,
} from '../../shared/components/rename-database-dialog/rename-database-dialog.component';
import {
  CreateDatabaseDialogComponent,
  CreateDatabaseDialogData,
} from '../../shared/components/create-database-dialog/create-database-dialog.component';
import {
  ConnectionDialogComponent,
  ConnectionDialogData,
} from '../../shared/components/connection-dialog/connection-dialog.component';
import { ConnectionManagerDialogComponent } from '../../shared/components/connection-manager-dialog/connection-manager-dialog.component';
import type { DatabaseEngine } from '@mj-forge/shared';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatMenuModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    ConfirmDialogComponent,
    InputDialogComponent,
  ],
  template: `
    <div class="sidebar-container">
      <!-- Header (with padding for macOS traffic lights) -->
      <div class="sidebar-header">
        <div class="logo-area">
          <img class="app-icon" src="assets/icons/mj-logo.png" alt="MJ Forge" />
          <span class="logo">Forge</span>
        </div>
        <button
          mat-icon-button
          matTooltip="New Connection"
          aria-label="New Connection"
          (click)="openConnectionDialog()"
        >
          <mat-icon>add</mat-icon>
        </button>
      </div>

      <!-- Connection selector -->
      @if (connectionState.hasProfiles()) {
        <div class="connection-selector">
          <button mat-button [matMenuTriggerFor]="connectionMenu" class="connection-button">
            @if (getConnectionIconClass(focusedProfile())) {
              <i
                class="devicon-btn"
                [ngClass]="getConnectionIconClass(focusedProfile())!"
                [style.color]="focusedProfile()?.color"
              ></i>
            } @else {
              <mat-icon>{{
                connectionState.hasAnyConnection() ? 'cloud_done' : 'cloud_off'
              }}</mat-icon>
            }
            <span class="connection-name">
              {{ focusedProfile()?.name || 'Select Connection' }}
            </span>
            <mat-icon class="dropdown-icon">arrow_drop_down</mat-icon>
          </button>
          <mat-menu #connectionMenu="matMenu">
            @for (profile of connectionState.profiles(); track profile.id) {
              @if (connectionState.isConnected(profile.id)) {
                <button
                  mat-menu-item
                  (click)="selectConnection(profile.id)"
                  [class.active]="profile.id === connectionState.mostRecentConnectionId()"
                  matTooltip="Switch focus to this connection"
                >
                  @if (profile.id === connectionState.mostRecentConnectionId()) {
                    <mat-icon>check</mat-icon>
                  } @else {
                    <i
                      class="devicon-menu"
                      [ngClass]="getEngineIconClass(profile.engine)"
                      [style.color]="profile.color"
                    ></i>
                  }
                  <span>{{ profile.name }}</span>
                </button>
              } @else {
                <button
                  mat-menu-item
                  (click)="connectTo(profile.id)"
                  matTooltip="Open a connection to this server"
                >
                  <mat-icon>power</mat-icon>
                  <span>Connect: {{ profile.name }}</span>
                </button>
              }
            }
            <mat-divider />
            <button mat-menu-item (click)="openConnectionDialog()">
              <mat-icon>add</mat-icon>
              <span>New Connection</span>
            </button>
            <button mat-menu-item (click)="manageConnections()">
              <mat-icon>settings</mat-icon>
              <span>Manage Connections</span>
            </button>
            <mat-divider />
            <button
              mat-menu-item
              [disabled]="!connectionState.hasAnyConnection()"
              (click)="refresh()"
            >
              <mat-icon>refresh</mat-icon>
              <span>Refresh</span>
            </button>
          </mat-menu>
        </div>
      }

      <!-- Database selector -->
      @if (connectionState.hasAnyConnection()) {
        <div class="database-selector">
          <button
            mat-button
            [matMenuTriggerFor]="databaseMenu"
            class="database-button"
            aria-label="Select Database"
            [disabled]="connectionState.loadingDatabases()"
          >
            @if (connectionState.loadingDatabases()) {
              <mat-spinner diameter="16" />
            } @else {
              <i
                class="devicon-btn"
                [ngClass]="getEngineIconClass(focusedProfile()?.engine || 'mssql')"
                [style.color]="focusedProfile()?.color"
              ></i>
            }
            <span class="database-name">
              {{
                connectionState.loadingDatabases()
                  ? 'Loading...'
                  : focusedSelectedDatabase() || 'Select Database'
              }}
            </span>
            <mat-icon class="dropdown-icon">arrow_drop_down</mat-icon>
          </button>
          <mat-menu #databaseMenu="matMenu">
            @for (db of focusedDatabases(); track db.name) {
              <button
                mat-menu-item
                (click)="selectDatabase(db.name)"
                [class.active]="db.name === focusedSelectedDatabase()"
              >
                @if (db.name === focusedSelectedDatabase()) {
                  <mat-icon>check</mat-icon>
                } @else {
                  <i
                    class="devicon-menu"
                    [ngClass]="getEngineIconClass(focusedProfile()?.engine || 'mssql')"
                    [style.color]="focusedProfile()?.color"
                  ></i>
                }
                <span>{{ db.name }}</span>
              </button>
            }
            <mat-divider />
            <button mat-menu-item (click)="openCreateDatabaseDialog()">
              <mat-icon>add_circle</mat-icon>
              <span>New Database...</span>
            </button>
          </mat-menu>
        </div>
      }

      <mat-divider />

      <!-- Explorer tree -->
      <div class="explorer-tree">
        @if (!explorerState.hasNodes()) {
          <div class="empty-state">
            <mat-icon>cloud_off</mat-icon>
            <p>No connection</p>
            <button mat-stroked-button (click)="openConnectionDialog()">Connect to Server</button>
          </div>
        } @else if (explorerState.hasNodes()) {
          <div class="tree-container" role="tree" aria-label="Database Explorer">
            @for (node of explorerState.rootNodes(); track node.id) {
              <ng-container *ngTemplateOutlet="treeNode; context: { $implicit: node, level: 0 }" />
            }
          </div>
        } @else {
          <div class="loading-state">
            <mat-icon>hourglass_empty</mat-icon>
            <p>Loading...</p>
          </div>
        }
      </div>

      <!-- Tree node template -->
      <ng-template #treeNode let-node let-level="level">
        <div
          class="tree-item"
          role="treeitem"
          [attr.aria-expanded]="node.hasChildren ? node.isExpanded : null"
          [attr.aria-level]="level + 1"
          [attr.aria-label]="node.name + ' (' + node.type + ')'"
          [attr.aria-selected]="node.id === explorerState.selectedNodeId()"
          tabindex="0"
          [class.selected]="node.id === explorerState.selectedNodeId()"
          [style.padding-left.px]="level * 16 + 8"
          (click)="onNodeClick(node)"
          (dblclick)="onNodeDoubleClick(node)"
          (contextmenu)="onNodeRightClick(node, $event)"
          (keydown.enter)="onNodeDoubleClick(node)"
          (keydown.space)="onNodeClick(node); $event.preventDefault()"
        >
          @if (node.hasChildren) {
            <button class="expand-btn" (click)="toggleExpand(node, $event)">
              <mat-icon>{{
                node.isLoading ? 'sync' : node.isExpanded ? 'expand_more' : 'chevron_right'
              }}</mat-icon>
            </button>
          } @else {
            <span class="expand-placeholder"></span>
          }
          @if (node.type === 'server') {
            @if (
              getConnectionIconClass(connectionState.getProfile(node.connectionId!));
              as hostIcon
            ) {
              <i
                class="node-icon devicon-node"
                [ngClass]="hostIcon"
                [style.color]="getConnectionColor(node.connectionId)"
              ></i>
            } @else {
              <mat-icon
                class="node-icon icon-server"
                [style.color]="getConnectionColor(node.connectionId)"
                >dns</mat-icon
              >
            }
          } @else if (node.icon === 'database-cylinder') {
            <i
              class="node-icon devicon-node"
              [ngClass]="getEngineIconClass(getEngine(node.connectionId))"
              [style.color]="getConnectionColor(node.connectionId)"
            ></i>
          } @else {
            <mat-icon class="node-icon" [class]="'icon-' + node.type">{{ node.icon }}</mat-icon>
          }
          <span class="node-name">{{ node.name }}</span>
          @if (node.mjInfo?.isMJEnabled) {
            <img
              class="mj-icon"
              src="assets/icons/mj-logo.png"
              alt="MemberJunction"
              matTooltip="MemberJunction ({{ node.mjInfo.entityCount }} entities)"
            />
          }
        </div>
        @if (node.isExpanded && node.children) {
          @for (child of node.children; track child.id) {
            <ng-container
              *ngTemplateOutlet="treeNode; context: { $implicit: child, level: level + 1 }"
            />
          }
        }
      </ng-template>

      <!-- Quick actions -->
      <div class="quick-actions">
        <mat-divider />
        <div class="action-buttons">
          <button
            mat-icon-button
            matTooltip="New Query"
            aria-label="New Query"
            (click)="newQuery()"
            [disabled]="!connectionState.hasAnyConnection() || !focusedSelectedDatabase()"
          >
            <mat-icon>code</mat-icon>
          </button>
          <button
            mat-icon-button
            matTooltip="Refresh"
            aria-label="Refresh Explorer"
            (click)="refresh()"
            [disabled]="!connectionState.hasAnyConnection()"
          >
            <mat-icon>refresh</mat-icon>
          </button>
          <button
            mat-icon-button
            matTooltip="Backup Database"
            aria-label="Backup Database"
            (click)="openBackup()"
            [disabled]="!connectionState.hasAnyConnection() || !focusedSelectedDatabase()"
          >
            <mat-icon>backup</mat-icon>
          </button>
          <button
            mat-icon-button
            matTooltip="Restore Database"
            aria-label="Restore Database"
            (click)="openRestore()"
            [disabled]="!connectionState.hasAnyConnection()"
          >
            <mat-icon>restore</mat-icon>
          </button>
          <span class="action-spacer"></span>
          <button
            mat-icon-button
            class="ai-sidebar-btn"
            [class.active]="chatState.panelOpen()"
            [matTooltip]="chatState.panelOpen() ? 'Close AI Assistant' : 'Open AI Assistant'"
            aria-label="Toggle AI Assistant"
            (click)="chatState.togglePanel()"
          >
            <mat-icon>auto_awesome</mat-icon>
          </button>
        </div>
      </div>

      <!-- Dialogs -->
      <app-confirm-dialog #deleteDialog (confirmed)="onDeleteConfirmed()" />
      <app-input-dialog #renameDialog (confirmed)="onRenameConfirmed($event)" />
    </div>
  `,
  styles: [
    `
      .sidebar-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        padding-top: 38px; /* Space for macOS traffic lights */
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);
        -webkit-app-region: drag; /* Allow dragging window from header */
      }

      .sidebar-header button {
        -webkit-app-region: no-drag; /* Buttons should be clickable */
      }

      .logo-area {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .app-icon {
        width: 28px;
        height: 28px;
        object-fit: contain;
      }

      .logo {
        font-size: 18px;
        font-weight: 800;
        color: var(--text-primary);
        letter-spacing: 0.5px;
      }

      .connection-selector,
      .database-selector {
        padding: var(--spacing-xs) var(--spacing-sm);
      }

      .connection-button,
      .database-button {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        text-align: left;
        padding: var(--spacing-xs) var(--spacing-sm);
        color: var(--text-primary) !important;

        .mat-icon {
          margin-right: var(--spacing-sm);
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--text-secondary);
        }

        .devicon-btn {
          margin-right: var(--spacing-sm);
          font-size: 18px;
          width: 18px;
          height: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .connection-name,
        .database-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 500;
          font-size: var(--font-size-sm);
        }

        .dropdown-icon {
          margin-right: 0;
          margin-left: auto;
          color: var(--text-muted);
        }
      }

      /* Devicon icons inside tree nodes */
      .devicon-node {
        font-size: 16px;
        width: 16px;
        min-width: 16px;
        height: 16px;
        margin-right: var(--spacing-xs);
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      /* Devicon icons inside mat-menu-items */
      .devicon-menu {
        font-size: 18px;
        width: 24px;
        min-width: 24px;
        height: 24px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-right: 16px;
      }

      .explorer-tree {
        flex: 1;
        overflow: auto;
        padding: var(--spacing-xs) 0;
      }

      .empty-state,
      .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--text-muted);
        text-align: center;

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          margin-bottom: var(--spacing-md);
          opacity: 0.5;
        }

        p {
          margin-bottom: var(--spacing-md);
        }
      }

      .tree-container {
        font-size: var(--font-size-sm);
      }

      .tree-item {
        display: flex;
        align-items: center;
        padding: 4px 8px;
        cursor: pointer;
        user-select: none;
        outline: none;

        &:hover {
          background-color: var(--bg-hover);
        }

        &.selected {
          background-color: var(--bg-active);
        }

        &:focus-visible {
          outline: 2px solid var(--status-info);
          outline-offset: -2px;
          border-radius: var(--radius-sm);
        }
      }

      .expand-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        min-width: 16px;
        height: 16px;
        padding: 0;
        margin-right: 4px;
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }

        &:hover {
          color: var(--text-primary);
        }
      }

      .expand-placeholder {
        width: 16px;
        min-width: 16px;
        height: 16px;
        margin-right: 4px;
      }

      .node-icon {
        font-size: 16px;
        width: 16px;
        min-width: 16px;
        height: 16px;
        margin-right: var(--spacing-xs);
        flex-shrink: 0;

        &.icon-server {
          color: var(--status-info);
        }
        &.icon-database {
          color: var(--syntax-function);
        }
        &.icon-folder {
          color: var(--syntax-string);
        }
        &.icon-table {
          color: var(--syntax-type);
        }
        &.icon-view {
          color: var(--syntax-keyword);
        }
        &.icon-procedure,
        &.icon-function {
          color: var(--syntax-function);
        }
      }

      .node-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mj-icon {
        width: 14px;
        height: 14px;
        margin-left: var(--spacing-xs);
        flex-shrink: 0;
        opacity: 0.9;
        transition: opacity var(--transition-fast);

        &:hover {
          opacity: 1;
        }
      }

      .quick-actions {
        margin-top: auto;

        .action-buttons {
          display: flex;
          align-items: center;
          justify-content: space-around;
          padding: var(--spacing-sm);
        }
      }

      .action-spacer {
        width: 1px;
        height: 20px;
        background: var(--border-primary);
        flex-shrink: 0;
      }

      .ai-sidebar-btn {
        color: var(--text-secondary);
        transition:
          color var(--transition-fast),
          background-color var(--transition-fast);

        &:hover {
          color: var(--accent-primary);
        }

        &.active {
          color: var(--accent-primary);
          background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
        }
      }
    `,
  ],
})
export class SidebarComponent {
  @ViewChild('deleteDialog') deleteDialog!: ConfirmDialogComponent;
  @ViewChild('renameDialog') renameDialog!: InputDialogComponent;

  readonly connectionState = inject(ConnectionStateService);
  readonly explorerState = inject(ExplorerStateService);
  private readonly tabState = inject(TabStateService);
  private readonly router = inject(Router);
  private readonly contextMenu = inject(ContextMenuService);
  private readonly notification = inject(NotificationService);
  private readonly tableProperties = inject(TablePropertiesService);
  readonly chatState = inject(ChatStateService);
  private readonly ipc = inject(IpcService);
  private readonly dialog = inject(MatDialog);

  // State for pending database operations. The delete/rename dialogs are
  // async (open dialog, wait for confirm event), so we stash both the
  // target database and the connection it lives on. Without the
  // connectionId stash, onDeleteConfirmed() falls back to
  // mostRecentConnectionId() — the focused query tab — which is wrong
  // when the user right-clicked a database under a *different* server.
  private pendingDeleteDatabase: string | null = null;
  private pendingDeleteConnectionId: string | null = null;
  private pendingRenameDatabase: string | null = null;

  // Sidebar UI accessors anchor to the most-recently-used connection — the
  // focused query tab's connection if one is focused, falling back to the
  // last-touched connection (or most-recently-added if we have no history).
  // mostRecentConnectionId() is null only when zero connections are open.
  readonly focusedProfile = computed(() =>
    this.connectionState.profileFor(this.connectionState.mostRecentConnectionId())
  );
  readonly focusedDatabases = computed(() =>
    this.connectionState.databasesFor(this.connectionState.mostRecentConnectionId())
  );
  readonly focusedSelectedDatabase = computed(() =>
    this.connectionState.selectedDatabaseFor(this.connectionState.mostRecentConnectionId())
  );

  /** Get devicon CSS class for the connection host (cloud provider or docker) */
  getConnectionIconClass(profile?: { server?: string; isDocker?: boolean } | null): string | null {
    if (!profile) return null;
    if (profile.isDocker) return 'devicon-docker-plain';
    const s = profile.server?.toLowerCase();
    if (!s) return null;
    if (s.endsWith('amazonaws.com')) return 'devicon-amazonwebservices-plain';
    if (s.endsWith('windows.net')) return 'devicon-azure-plain';
    return null;
  }

  /** Get devicon CSS class for a database engine (no `colored` — color comes from connection profile) */
  getEngineIconClass(engine: DatabaseEngine): string {
    switch (engine) {
      case 'mysql':
        return 'devicon-mysql-original';
      case 'postgresql':
        return 'devicon-postgresql-plain';
      case 'mssql':
        return 'devicon-azuresqldatabase-plain';
    }
  }

  /** Get the connection color for a given connectionId, falling back to null */
  getConnectionColor(connectionId?: string): string | null {
    if (!connectionId) return null;
    const profile = this.connectionState.getProfile(connectionId);
    return profile?.color || null;
  }

  /** Get the database engine for a connection, defaulting to mssql */
  getEngine(connectionId?: string): DatabaseEngine {
    if (connectionId) {
      const profile = this.connectionState.getProfile(connectionId);
      if (profile) return profile.engine;
    }
    return this.focusedProfile()?.engine || 'mssql';
  }

  /** Quote an identifier appropriately for the database engine */
  private quoteId(name: string, engine: DatabaseEngine): string {
    switch (engine) {
      case 'mysql':
        return '`' + name.replace(/`/g, '``') + '`';
      case 'postgresql':
        return '"' + name.replace(/"/g, '""') + '"';
      default:
        return '[' + name.replace(/]/g, ']]') + ']';
    }
  }

  /** Build a qualified table reference (schema.table) for the given engine */
  private qualifiedTable(schema: string, table: string, engine: DatabaseEngine): string {
    if (engine === 'mysql') {
      return this.quoteId(table, engine);
    }
    return `${this.quoteId(schema, engine)}.${this.quoteId(table, engine)}`;
  }

  /** Get the default schema name for the given engine */
  private defaultSchema(engine: DatabaseEngine): string {
    switch (engine) {
      case 'postgresql':
        return 'public';
      case 'mysql':
        return '';
      default:
        return 'dbo';
    }
  }

  /** Generate a SELECT with row limit appropriate for the engine */
  private selectWithLimit(tableRef: string, limit: number, engine: DatabaseEngine): string {
    if (engine === 'mssql') {
      return `SELECT TOP ${limit} * FROM ${tableRef}`;
    }
    return `SELECT * FROM ${tableRef} LIMIT ${limit}`;
  }

  openConnectionDialog(): void {
    this.dialog.open(ConnectionDialogComponent, {
      data: {} as ConnectionDialogData,
      width: '540px',
      maxHeight: '90vh',
    });
  }

  manageConnections(): void {
    this.dialog.open(ConnectionManagerDialogComponent, {
      width: '560px',
      maxHeight: '90vh',
    });
  }

  async connectTo(profileId: string): Promise<void> {
    const success = await this.connectionState.connect(profileId);
    if (success) {
      const profile = this.connectionState.getProfile(profileId);
      if (profile) {
        this.explorerState.addServerNode(profileId, profile.name);
        this.explorerState.expandNode(`server-${profileId}`);
      }
    }
  }

  /**
   * Focus navigator for the sidebar connection dropdown. Highlights the
   * matching server node in the tree (the multi-connection store) and, when
   * the user has no query tab targeting this connection yet, opens a fresh
   * one against the connection's last-used database. Per spec Decision 4
   * this MUST NOT mutate connection state — focus follows the resulting
   * tab activation, not a direct write to a global signal.
   */
  selectConnection(connectionId: string): void {
    const serverNodeId = `server-${connectionId}`;
    this.explorerState.expandNode(serverNodeId);
    this.explorerState.selectNode(serverNodeId);

    const hasTab = this.tabState.tabs().some(t => t.connectionId === connectionId);
    if (hasTab) return;

    const lastDb = this.connectionState.selectedDatabaseFor(connectionId);
    if (!lastDb) return;
    this.tabState.openQueryTab(connectionId, lastDb);
    this.router.navigate(['/query']);
  }

  selectDatabase(name: string): void {
    const focusId = this.connectionState.mostRecentConnectionId();
    if (focusId) {
      this.connectionState.selectDatabase(focusId, name);
    }
  }

  onNodeClick(node: TreeNode): void {
    this.explorerState.selectNode(node.id);
    // Also toggle expansion when clicking anywhere on a folder/expandable node
    if (node.hasChildren) {
      this.explorerState.toggleNode(node.id);
    }
  }

  onNodeDoubleClick(node: TreeNode): void {
    if (node.hasChildren) {
      this.explorerState.toggleNode(node.id);
      return;
    }

    if (!node.connectionId || !node.databaseName || !node.metadata) return;

    // MJ entity: open SELECT TOP 1000 query
    if (node.type === 'mj_entity') {
      const schema = node.metadata.schema || '__mj';
      const baseTable = (node as TreeNode & { tableName?: string }).tableName || node.metadata.name;
      const sql = `SELECT TOP 1000 * FROM [${schema}].[${baseTable}]`;
      this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
      this.router.navigate(['/query']);
      return;
    }

    // MJ saved query: open query SQL in editor
    if (node.type === 'mj_query' && node.metadata.definition) {
      this.tabState.openQueryTab(node.connectionId, node.databaseName, node.metadata.definition);
      this.router.navigate(['/query']);
      return;
    }

    // Standard database objects: open object details tab
    this.tabState.openObjectTab(
      node.connectionId,
      node.databaseName,
      node.metadata.name,
      node.metadata.type,
      node.metadata.schema || node.schema || this.defaultSchema(this.getEngine(node.connectionId))
    );
    this.router.navigate(['/explorer']);
  }

  toggleExpand(node: TreeNode, event: Event): void {
    event.stopPropagation();
    this.explorerState.toggleNode(node.id);
  }

  newQuery(): void {
    const connectionId = this.connectionState.mostRecentConnectionId();
    if (!connectionId) return;
    const databaseName = this.connectionState.defaultDatabaseFor(connectionId);
    if (!databaseName) return;
    this.tabState.openQueryTab(connectionId, databaseName, undefined, false, false);
    this.router.navigate(['/query']);
  }

  async refresh(): Promise<void> {
    const focusId = this.connectionState.mostRecentConnectionId();
    if (focusId) {
      await this.connectionState.loadDatabases(focusId);
    }
    const selectedNode = this.explorerState.selectedNodeId();
    if (selectedNode) {
      await this.explorerState.refreshNode(selectedNode);
    }
  }

  /** Check if the focused connection's engine supports a feature */
  engineSupports(feature: 'backupRestore' | 'serverFileBrowsing' | 'extendedProperties'): boolean {
    const engine = this.focusedProfile()?.engine;
    if (!engine || engine === 'mssql') return true; // MSSQL supports all
    // MySQL supports backup/restore via mysqldump CLI
    if (feature === 'backupRestore' && engine === 'mysql') return true;
    return false; // PG/MySQL don't support server file browsing or extended properties
  }

  openBackup(databaseName?: string, overrideConnectionId?: string): void {
    // Prefer the connectionId of the right-clicked node (when invoked
    // from the database-context-menu) so backup targets *that* server.
    // The mostRecent fallback is only correct for the toolbar button,
    // which has no node context.
    const connectionId = overrideConnectionId ?? this.connectionState.mostRecentConnectionId();
    const dbName = databaseName || this.focusedSelectedDatabase();

    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    // Backup works for all engines — MSSQL uses BACKUP DATABASE, PG uses pg_dump

    if (!dbName) {
      this.notification.error('Please select a database first');
      return;
    }

    const dialogData: BackupDialogData = {
      connectionId,
      databaseName: dbName,
      engine: this.focusedProfile()?.engine,
    };

    const dialogRef = this.dialog.open(BackupDialogComponent, {
      data: dialogData,
      width: '520px',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.success) {
        // Optionally refresh or show additional notification
      }
    });
  }

  openRestore(databaseName?: string, overrideConnectionId?: string): void {
    // Server-node right-click can't rely on mostRecentConnectionId — the
    // user might be acting on a *different* connection than the focused
    // one. Honor an explicit override when supplied.
    const connectionId = overrideConnectionId ?? this.connectionState.mostRecentConnectionId();

    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    // Restore works for all engines — MSSQL uses RESTORE DATABASE, PG uses pg_restore

    const dialogData: RestoreDialogData = {
      connectionId,
      databaseName,
      engine: this.focusedProfile()?.engine,
    };

    const dialogRef = this.dialog.open(RestoreDialogComponent, {
      data: dialogData,
      width: '560px',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.success && result?.database) {
        // We know the target db exists post-restore — push it into the
        // local database list and tree directly. Idempotent if the db
        // was already there (overwrite-existing case).
        this.connectionState.addDatabaseLocal(connectionId, {
          name: result.database,
          state: 'online',
        });
        this.explorerState.addDatabaseNodeLocal(connectionId, result.database);
      } else if (result?.success) {
        // Success but no target name — fall back to a refetch.
        this.connectionState.loadDatabases(connectionId);
        const serverNode = this.explorerState
          .rootNodes()
          .find((n: TreeNode) => n.type === 'server' && n.connectionId === connectionId);
        if (serverNode) {
          this.explorerState.refreshNode(serverNode.id);
        }
      }
    });
  }

  onNodeRightClick(node: TreeNode, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    this.explorerState.selectNode(node.id);

    const items = this.getContextMenuItems(node);
    if (items.length > 0) {
      this.contextMenu.show(event, items, node);
    }
  }

  private getContextMenuItems(node: TreeNode): ContextMenuItem[] {
    switch (node.type) {
      case 'server':
        return this.getServerContextMenu(node);
      case 'database':
        return this.getDatabaseContextMenu(node);
      case 'folder':
        return this.getFolderContextMenu(node);
      case 'table':
        return this.getTableContextMenu(node);
      case 'view':
        return this.getViewContextMenu(node);
      case 'procedure':
        return this.getProcedureContextMenu(node);
      case 'function':
        return this.getFunctionContextMenu(node);
      // MJ-specific context menus
      case 'mj_entity':
        return this.getMJEntityContextMenu(node);
      case 'mj_query':
        return this.getMJQueryContextMenu(node);
      case 'mj_changes_folder':
        return this.getMJChangesFolderContextMenu(node);
      case 'mj_audit_folder':
        return this.getMJAuditFolderContextMenu(node);
      case 'mj_errors_folder':
        return this.getMJErrorsFolderContextMenu(node);
      default:
        return [];
    }
  }

  private getServerContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'new-query',
        label: 'New Query',
        icon: 'code',
        action: () => {
          if (node.connectionId) {
            this.tabState.openQueryTab(node.connectionId, 'master');
            this.router.navigate(['/query']);
          }
        },
      },
      {
        id: 'new-database',
        label: 'New Database...',
        icon: 'add_circle',
        action: () => {
          if (node.connectionId) {
            this._openCreateDatabaseDialog(node.connectionId);
          }
        },
      },
      { id: 'div1', label: '', divider: true },
      {
        id: 'restore',
        label: 'Restore Database...',
        icon: 'restore',
        // Restoring from a backup creates (or overwrites) a target
        // database — so it makes sense at the server level, where the
        // user hasn't picked a specific db yet, not just on existing dbs.
        action: () => {
          if (node.connectionId) {
            this.openRestore(undefined, node.connectionId);
          }
        },
      },
      { id: 'div2', label: '', divider: true },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
      { id: 'div3', label: '', divider: true },
      {
        id: 'edit-connection',
        label: 'Edit Connection...',
        icon: 'edit',
        action: () => {
          if (node.connectionId) {
            this.editConnection(node.connectionId);
          }
        },
      },
      {
        id: 'disconnect',
        label: 'Disconnect',
        icon: 'power_off',
        action: async () => {
          if (node.connectionId) {
            await this.connectionState.disconnect(node.connectionId);
          }
        },
      },
    ];
  }

  /**
   * Open the connection dialog pre-populated with an existing profile so
   * the user can fix typos / change creds without creating a duplicate.
   * Reachable from the sidebar tree's server-node right-click menu and
   * (eventually) any other "edit this connection" affordance.
   */
  editConnection(connectionId: string): void {
    const profile = this.connectionState.getProfile(connectionId);
    if (!profile) return;
    this.dialog.open(ConnectionDialogComponent, {
      data: { profile } as ConnectionDialogData,
      width: '540px',
      maxHeight: '90vh',
    });
  }

  private getDatabaseContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'new-query',
        label: 'New Query',
        icon: 'code',
        shortcut: keyHint('N'),
        action: () => {
          if (node.connectionId && node.databaseName) {
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName);
            this.router.navigate(['/query']);
          }
        },
      },
      { id: 'div1', label: '', divider: true },
      {
        id: 'backup',
        label: 'Backup Database...',
        icon: 'backup',
        action: () => {
          if (node.databaseName) {
            // Pass node.connectionId so backup runs against *this* server,
            // not the most-recently-used connection. Same routing class as
            // the Restore/Delete fixes.
            this.openBackup(node.databaseName, node.connectionId);
          }
        },
      },
      {
        id: 'restore',
        label: 'Restore Database...',
        icon: 'restore',
        action: () => {
          // Pass the node's connectionId so the restore targets *this*
          // server, not whichever connection happens to be the most-
          // recently-used. Without the explicit override, right-clicking
          // a database under server A while the focused tab points at
          // server B would silently route the restore to B and the
          // resulting db would land on the wrong server.
          this.openRestore(node.databaseName, node.connectionId);
        },
      },
      { id: 'div2', label: '', divider: true },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
      { id: 'div3', label: '', divider: true },
      {
        id: 'rename',
        label: 'Rename...',
        icon: 'edit',
        disabled:
          node.databaseName === 'master' ||
          node.databaseName === 'msdb' ||
          node.databaseName === 'model' ||
          node.databaseName === 'tempdb',
        action: () => {
          if (node.databaseName && node.connectionId) {
            this.openRenameDatabaseDialog(node.connectionId, node.databaseName);
          }
        },
      },
      {
        id: 'delete',
        label: 'Delete...',
        icon: 'delete',
        disabled:
          node.databaseName === 'master' ||
          node.databaseName === 'msdb' ||
          node.databaseName === 'model' ||
          node.databaseName === 'tempdb',
        action: () => {
          if (node.databaseName && node.connectionId) {
            this.openDeleteDialog(node.connectionId, node.databaseName);
          }
        },
      },
    ];
  }

  private getFolderContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  private getTableContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'select-top',
        label: 'Select Top 1000 Rows',
        icon: 'table_rows',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const engine = this.getEngine(node.connectionId);
            const schema = node.metadata.schema || this.defaultSchema(engine);
            const tableRef = this.qualifiedTable(schema, node.metadata.name, engine);
            const sql = this.selectWithLimit(tableRef, 1000, engine);
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
            this.router.navigate(['/query']);
          }
        },
      },
      {
        id: 'edit-top',
        label: 'Edit Top 200 Rows',
        icon: 'edit_note',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const engine = this.getEngine(node.connectionId);
            const schema = node.metadata.schema || this.defaultSchema(engine);
            const tableRef = this.qualifiedTable(schema, node.metadata.name, engine);
            const sql = this.selectWithLimit(tableRef, 200, engine);
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            this.router.navigate(['/query']);
          }
        },
      },
      { id: 'div1', label: '', divider: true },
      {
        id: 'script-create',
        label: 'Script Table as CREATE',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema =
                node.metadata.schema || this.defaultSchema(this.getEngine(node.connectionId));
              const sql = await window.forge.explorer.scriptTableAsCreate(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name
              );
              this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
              this.router.navigate(['/query']);
            } catch (err) {
              this.notification.error('Failed to generate CREATE script');
            }
          }
        },
      },
      {
        id: 'script-select',
        label: 'Script Table as SELECT',
        icon: 'code',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const engine = this.getEngine(node.connectionId);
            const schema = node.metadata.schema || this.defaultSchema(engine);
            const tableRef = this.qualifiedTable(schema, node.metadata.name, engine);
            const sql = `SELECT * FROM ${tableRef}`;
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
            this.router.navigate(['/query']);
          }
        },
      },
      {
        id: 'script-insert',
        label: 'Script Table as INSERT',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema =
                node.metadata.schema || this.defaultSchema(this.getEngine(node.connectionId));
              const sql = await window.forge.explorer.scriptTableAsInsert(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name
              );
              this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
              this.router.navigate(['/query']);
            } catch (err) {
              this.notification.error('Failed to generate INSERT script');
            }
          }
        },
      },
      { id: 'div2', label: '', divider: true },
      {
        id: 'show-relationships',
        label: 'Show Relationships',
        icon: 'account_tree',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const schema =
              node.metadata.schema || this.defaultSchema(this.getEngine(node.connectionId));
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openErdTab(
              node.connectionId,
              node.databaseName,
              node.metadata.name,
              schema
            );
            this.router.navigate(['/erd']);
          }
        },
      },
      {
        id: 'properties',
        label: 'Properties...',
        icon: 'info',
        shortcut: 'Alt+Enter',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            this.tableProperties.open({
              connectionId: node.connectionId,
              databaseName: node.databaseName,
              schema: node.metadata.schema || this.defaultSchema(this.getEngine(node.connectionId)),
              tableName: node.metadata.name,
            });
          }
        },
      },
      { id: 'div3', label: '', divider: true },
      {
        id: 'mj-change-history',
        label: 'View Change History (MJ)',
        icon: 'change_history',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const schema = node.metadata.schema || 'dbo';
            const tableName = node.metadata.name;
            const sql = `-- Change History for [${schema}].[${tableName}]
-- Note: Requires MemberJunction to be installed in this database
SELECT TOP 100
  rc.Type,
  rc.Source,
  rc.RecordID,
  rc.ChangesDescription,
  rc.Status,
  u.Name AS ChangedBy,
  rc.CreatedAt AS ChangedAt,
  rc.ChangesJSON
FROM [__mj].[RecordChange] rc
LEFT JOIN [__mj].[Entity] e ON rc.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON rc.UserID = u.ID
WHERE e.BaseTable = '${tableName}' AND e.SchemaName = '${schema}'
ORDER BY rc.CreatedAt DESC`;
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      {
        id: 'mj-audit-log',
        label: 'View Audit Log (MJ)',
        icon: 'history',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const schema = node.metadata.schema || 'dbo';
            const tableName = node.metadata.name;
            const sql = `-- Audit Log for [${schema}].[${tableName}]
-- Note: Requires MemberJunction to be installed in this database
SELECT TOP 100
  al.Status,
  alt.Name AS AuditType,
  al.RecordID,
  u.Name AS UserName,
  al.Description,
  al.CreatedAt AS AuditedAt
FROM [__mj].[AuditLog] al
LEFT JOIN [__mj].[AuditLogType] alt ON al.AuditLogTypeID = alt.ID
LEFT JOIN [__mj].[Entity] e ON al.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON al.UserID = u.ID
WHERE e.BaseTable = '${tableName}' AND e.SchemaName = '${schema}'
ORDER BY al.CreatedAt DESC`;
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      { id: 'div4', label: '', divider: true },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  private getViewContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'select-top',
        label: 'Select Top 1000 Rows',
        icon: 'table_rows',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const engine = this.getEngine(node.connectionId);
            const schema = node.metadata.schema || this.defaultSchema(engine);
            const tableRef = this.qualifiedTable(schema, node.metadata.name, engine);
            const sql = this.selectWithLimit(tableRef, 1000, engine);
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
            this.router.navigate(['/query']);
          }
        },
      },
      {
        id: 'edit-top',
        label: 'Edit Top 200 Rows',
        icon: 'edit_note',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const engine = this.getEngine(node.connectionId);
            const schema = node.metadata.schema || this.defaultSchema(engine);
            const tableRef = this.qualifiedTable(schema, node.metadata.name, engine);
            const sql = this.selectWithLimit(tableRef, 200, engine);
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            this.router.navigate(['/query']);
          }
        },
      },
      { id: 'div1', label: '', divider: true },
      {
        id: 'script-create',
        label: 'Script View as CREATE',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema =
                node.metadata.schema || this.defaultSchema(this.getEngine(node.connectionId));
              const result = await window.forge.explorer.getDefinition(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name,
                'view'
              );
              const sql = result.definition || '-- View definition not available';
              this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            } catch (err) {
              this.notification.error('Failed to get view definition');
            }
          }
        },
      },
      {
        id: 'script-alter',
        label: 'Script View as ALTER',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema =
                node.metadata.schema || this.defaultSchema(this.getEngine(node.connectionId));
              const result = await window.forge.explorer.getDefinition(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name,
                'view'
              );
              let sql = result.definition || '-- View definition not available';
              sql = sql.replace(/CREATE\s+VIEW\s+/i, 'ALTER VIEW ');
              this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            } catch (err) {
              this.notification.error('Failed to get view definition');
            }
          }
        },
      },
      {
        id: 'script-select',
        label: 'Script View as SELECT',
        icon: 'code',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const engine = this.getEngine(node.connectionId);
            const schema = node.metadata.schema || this.defaultSchema(engine);
            const tableRef = this.qualifiedTable(schema, node.metadata.name, engine);
            const sql = `SELECT * FROM ${tableRef}`;
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      { id: 'div2', label: '', divider: true },
      {
        id: 'properties',
        label: 'Properties...',
        icon: 'info',
        shortcut: 'Alt+Enter',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            this.tableProperties.open({
              connectionId: node.connectionId,
              databaseName: node.databaseName,
              schema: node.metadata.schema || this.defaultSchema(this.getEngine(node.connectionId)),
              tableName: node.metadata.name,
              objectType: 'view',
            });
          }
        },
      },
      { id: 'div3', label: '', divider: true },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  private getFunctionContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'script-create',
        label: 'Script Function as CREATE',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema =
                node.metadata.schema || this.defaultSchema(this.getEngine(node.connectionId));
              const result = await window.forge.explorer.getDefinition(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name,
                'function'
              );
              const sql = result.definition || '-- Function definition not available';
              this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            } catch (err) {
              this.notification.error('Failed to get function definition');
            }
          }
        },
      },
      {
        id: 'script-alter',
        label: 'Script Function as ALTER',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema =
                node.metadata.schema || this.defaultSchema(this.getEngine(node.connectionId));
              const result = await window.forge.explorer.getDefinition(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name,
                'function'
              );
              let sql = result.definition || '-- Function definition not available';
              sql = sql.replace(/CREATE\s+FUNCTION\s+/i, 'ALTER FUNCTION ');
              this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            } catch (err) {
              this.notification.error('Failed to get function definition');
            }
          }
        },
      },
      { id: 'div1', label: '', divider: true },
      {
        id: 'properties',
        label: 'Properties...',
        icon: 'info',
        shortcut: 'Alt+Enter',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            this.tableProperties.open({
              connectionId: node.connectionId,
              databaseName: node.databaseName,
              schema: node.metadata.schema || this.defaultSchema(this.getEngine(node.connectionId)),
              tableName: node.metadata.name,
              objectType: 'function',
            });
          }
        },
      },
      { id: 'div2', label: '', divider: true },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  private getProcedureContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'execute',
        label: 'Execute Stored Procedure...',
        icon: 'play_arrow',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const engine = this.getEngine(node.connectionId);
            const schema = node.metadata.schema || this.defaultSchema(engine);
            const procRef = this.qualifiedTable(schema, node.metadata.name, engine);
            const sql =
              engine === 'mysql'
                ? `CALL ${procRef}()`
                : engine === 'postgresql'
                  ? `CALL ${procRef}()`
                  : `EXEC ${procRef}`;
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      { id: 'div1', label: '', divider: true },
      {
        id: 'script-create',
        label: 'Script Procedure as CREATE',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema =
                node.metadata.schema || this.defaultSchema(this.getEngine(node.connectionId));
              const result = await window.forge.explorer.getDefinition(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name,
                'procedure'
              );
              const sql = result.definition || '-- Procedure definition not available';
              this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            } catch (err) {
              this.notification.error('Failed to get procedure definition');
            }
          }
        },
      },
      {
        id: 'script-alter',
        label: 'Script Procedure as ALTER',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema =
                node.metadata.schema || this.defaultSchema(this.getEngine(node.connectionId));
              const result = await window.forge.explorer.getDefinition(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name,
                'procedure'
              );
              let sql = result.definition || '-- Procedure definition not available';
              sql = sql.replace(/CREATE\s+(PROCEDURE|PROC)\s+/i, 'ALTER $1 ');
              this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            } catch (err) {
              this.notification.error('Failed to get procedure definition');
            }
          }
        },
      },
      { id: 'div2', label: '', divider: true },
      {
        id: 'properties',
        label: 'Properties...',
        icon: 'info',
        shortcut: 'Alt+Enter',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            this.tableProperties.open({
              connectionId: node.connectionId,
              databaseName: node.databaseName,
              schema: node.metadata.schema || this.defaultSchema(this.getEngine(node.connectionId)),
              tableName: node.metadata.name,
              objectType: 'procedure',
            });
          }
        },
      },
      { id: 'div3', label: '', divider: true },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  // MemberJunction context menus
  private getMJEntityContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'select-top',
        label: 'SELECT TOP 1000',
        icon: 'table_chart',
        action: () => {
          if (node.connectionId && node.databaseName && node.schema && node.tableName) {
            const engine = this.getEngine(node.connectionId);
            const tableRef = this.qualifiedTable(node.schema, node.tableName, engine);
            const sql = this.selectWithLimit(tableRef, 1000, engine);
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      {
        id: 'view-change-history',
        label: 'View Change History',
        icon: 'change_history',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const sql = `-- Change History for ${node.metadata.name}
SELECT TOP 100
  rc.Type,
  rc.Source,
  rc.ChangesDescription,
  rc.Status,
  u.Name AS ChangedBy,
  rc.CreatedAt AS ChangedAt,
  rc.ChangesJSON
FROM [__mj].[RecordChange] rc
LEFT JOIN [__mj].[Entity] e ON rc.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON rc.UserID = u.ID
WHERE e.Name = '${node.metadata.name}'
ORDER BY rc.CreatedAt DESC`;
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      {
        id: 'view-audit-log',
        label: 'View Audit Log',
        icon: 'history',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const sql = `-- Audit Log for ${node.metadata.name}
SELECT TOP 100
  al.Status,
  alt.Name AS AuditType,
  u.Name AS UserName,
  al.RecordID,
  al.Description,
  al.CreatedAt AS AuditedAt
FROM [__mj].[AuditLog] al
LEFT JOIN [__mj].[AuditLogType] alt ON al.AuditLogTypeID = alt.ID
LEFT JOIN [__mj].[Entity] e ON al.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON al.UserID = u.ID
WHERE e.Name = '${node.metadata.name}'
ORDER BY al.CreatedAt DESC`;
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      { id: 'div-erd', label: '', divider: true },
      {
        id: 'show-relationships',
        label: 'Show Relationships (ERD)',
        icon: 'account_tree',
        action: () => {
          if (node.connectionId && node.databaseName && node.schema && node.tableName) {
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openErdTab(
              node.connectionId,
              node.databaseName,
              node.tableName,
              node.schema
            );
            this.router.navigate(['/erd']);
          }
        },
      },
    ];
  }

  private getMJQueryContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'open-query',
        label: 'Open in New Tab',
        icon: 'code',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata?.definition) {
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(
              node.connectionId,
              node.databaseName,
              node.metadata.definition
            );
          }
        },
      },
    ];
  }

  private getMJChangesFolderContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'view-all-changes',
        label: 'View All Change History',
        icon: 'change_history',
        action: () => {
          if (node.connectionId && node.databaseName) {
            const sql = `-- All Recent Record Changes
SELECT TOP 200
  e.Name AS Entity,
  rc.RecordID,
  rc.Type,
  rc.Source,
  rc.ChangesDescription,
  rc.Status,
  u.Name AS ChangedBy,
  rc.CreatedAt AS ChangedAt
FROM [__mj].[RecordChange] rc
LEFT JOIN [__mj].[Entity] e ON rc.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON rc.UserID = u.ID
ORDER BY rc.CreatedAt DESC`;
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  private getMJAuditFolderContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'view-all-audits',
        label: 'View All Audit Logs',
        icon: 'history',
        action: () => {
          if (node.connectionId && node.databaseName) {
            const sql = `-- All Recent Audit Logs
SELECT TOP 200
  al.Status,
  alt.Name AS AuditType,
  e.Name AS Entity,
  al.RecordID,
  u.Name AS UserName,
  al.Description,
  al.CreatedAt AS AuditedAt
FROM [__mj].[AuditLog] al
LEFT JOIN [__mj].[AuditLogType] alt ON al.AuditLogTypeID = alt.ID
LEFT JOIN [__mj].[Entity] e ON al.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON al.UserID = u.ID
ORDER BY al.CreatedAt DESC`;
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  private getMJErrorsFolderContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'view-all-errors',
        label: 'View All Error Logs',
        icon: 'error',
        action: () => {
          if (node.connectionId && node.databaseName) {
            const sql = `-- All Recent Error Logs
SELECT TOP 200
  Code,
  Message,
  Category,
  Status,
  CreatedBy,
  __mj_CreatedAt AS CreatedAt,
  Details
FROM [__mj].[ErrorLog]
ORDER BY __mj_CreatedAt DESC`;
            this.connectionState.selectDatabase(node.connectionId!, node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  // Database create/rename/delete dialog methods
  /** Public wrapper – uses the focused connection when called from the database dropdown menu */
  openCreateDatabaseDialog(connectionId?: string): void {
    const connId = connectionId || this.connectionState.mostRecentConnectionId();
    if (!connId) {
      this.notification.error('No active connection');
      return;
    }
    this._openCreateDatabaseDialog(connId);
  }

  private _openCreateDatabaseDialog(connectionId: string): void {
    const dialogData: CreateDatabaseDialogData = {
      connectionId,
    };

    const dialogRef = this.dialog.open(CreateDatabaseDialogComponent, {
      data: dialogData,
      width: '450px',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.success && result.databaseName) {
        // Successful create → push the new db into local state directly.
        this.connectionState.addDatabaseLocal(connectionId, {
          name: result.databaseName,
          state: 'online',
        });
        this.explorerState.addDatabaseNodeLocal(connectionId, result.databaseName);
      }
    });
  }

  private openRenameDatabaseDialog(connectionId: string, databaseName: string): void {
    const dialogData: RenameDatabaseDialogData = {
      connectionId,
      databaseName,
    };

    const dialogRef = this.dialog.open(RenameDatabaseDialogComponent, {
      data: dialogData,
      width: '450px',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.success && result.newName) {
        // Successful rename → mutate state directly.
        this.connectionState.renameDatabaseLocal(connectionId, databaseName, result.newName);
        this.explorerState.renameDatabaseNodeLocal(connectionId, databaseName, result.newName);
        // If the renamed database was selected, update selection
        if (this.focusedSelectedDatabase() === databaseName) {
          this.connectionState.selectDatabase(connectionId, result.newName);
        }
      }
    });
  }

  private openDeleteDialog(connectionId: string, databaseName: string): void {
    this.pendingDeleteConnectionId = connectionId;
    this.pendingDeleteDatabase = databaseName;

    let message =
      `Are you sure you want to delete the database "${databaseName}"? ` +
      `This action cannot be undone and all data will be permanently lost.`;

    // Warn about active use that would otherwise block the drop and offer to
    // clear it as part of the delete — so the user doesn't have to hunt down
    // windows or restart the app.
    const openTabs = this.tabState.tabsUsingDatabase(connectionId, databaseName);
    const expanded = this.explorerState.expandedNodeIds().has(`db-${connectionId}-${databaseName}`);
    if (openTabs.length > 0 || expanded) {
      const parts: string[] = [];
      if (openTabs.length > 0) {
        parts.push(`${openTabs.length} open ${openTabs.length === 1 ? 'window' : 'windows'}`);
      }
      if (expanded) {
        parts.push('an expanded explorer node');
      }
      message +=
        `\n\nThis database is currently in use (${parts.join(' and ')}). ` +
        `Deleting will close ${openTabs.length > 0 ? 'those windows and ' : ''}` +
        `release the connection — no app restart needed.`;
    }

    this.deleteDialog.open({
      title: 'Delete Database',
      message,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      type: 'danger',
      confirmationInput: databaseName,
    });
  }

  async onRenameConfirmed(newName: string): Promise<void> {
    const oldName = this.pendingRenameDatabase;
    this.pendingRenameDatabase = null;

    if (!oldName) return;

    const connectionId = this.connectionState.mostRecentConnectionId();
    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    try {
      const result = await firstValueFrom(
        this.ipc.renameDatabase(connectionId, { currentName: oldName, newName })
      );

      if (result?.success) {
        this.notification.success(`Database renamed to "${newName}"`);
        // Refresh the database list
        await this.connectionState.loadDatabases(connectionId);
        // If the renamed database was selected, update selection
        if (this.focusedSelectedDatabase() === oldName) {
          this.connectionState.selectDatabase(connectionId, newName);
        }
        // Refresh explorer tree
        const serverNode = this.explorerState
          .rootNodes()
          .find((n: TreeNode) => n.type === 'server' && n.connectionId === connectionId);
        if (serverNode) {
          await this.explorerState.refreshNode(serverNode.id);
        }
      } else {
        this.notification.error(result?.error || 'Failed to rename database');
      }
    } catch (error) {
      this.notification.error(error instanceof Error ? error.message : 'Failed to rename database');
    }
  }

  async onDeleteConfirmed(): Promise<void> {
    const databaseName = this.pendingDeleteDatabase;
    const overrideConnectionId = this.pendingDeleteConnectionId;
    this.pendingDeleteDatabase = null;
    this.pendingDeleteConnectionId = null;

    if (!databaseName) return;

    // Prefer the connectionId stashed when the dialog was opened — that's
    // the server the user actually right-clicked on. Fall back to the
    // most-recent connection only if the call site didn't supply one
    // (older entry points / future refactors).
    const connectionId = overrideConnectionId ?? this.connectionState.mostRecentConnectionId();
    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    // Clear active use up-front so the drop can take exclusive access: close
    // any windows bound to this database and collapse its explorer node. The
    // main process also releases its own pool, so this needs no app restart.
    this.tabState.closeTabsForDatabase(connectionId, databaseName);
    this.explorerState.collapseNode(`db-${connectionId}-${databaseName}`);

    try {
      const result = await firstValueFrom(
        this.ipc.deleteDatabase(connectionId, { name: databaseName, closeConnections: true })
      );

      if (result?.success) {
        this.notification.success(`Database "${databaseName}" deleted`);
        // Successful delete → mutate state directly.
        this.connectionState.removeDatabaseLocal(connectionId, databaseName);
        this.explorerState.removeDatabaseNodeLocal(connectionId, databaseName);
        // If the deleted database was selected, clear selection.
        if (this.focusedSelectedDatabase() === databaseName) {
          this.connectionState.selectDatabase(connectionId, '');
        }
      } else {
        // Don't second-guess the error message. Surface it as-is and
        // refetch the list from the server — listDatabases is the
        // authoritative answer for "does this db exist", not the error
        // string of the failed DROP. If dd truly is gone, the refetch
        // removes it from the view; if dd exists and the DROP failed
        // for some other reason, the view stays accurate and the error
        // toast tells the user what actually went wrong.
        this.notification.error(result?.error || 'Failed to delete database');
        await this.connectionState.loadDatabases(connectionId);
        const serverNode = this.explorerState
          .rootNodes()
          .find((n: TreeNode) => n.type === 'server' && n.connectionId === connectionId);
        if (serverNode) {
          await this.explorerState.refreshNode(serverNode.id);
        }
      }
    } catch (error) {
      this.notification.error(error instanceof Error ? error.message : 'Failed to delete database');
    }
  }
}
