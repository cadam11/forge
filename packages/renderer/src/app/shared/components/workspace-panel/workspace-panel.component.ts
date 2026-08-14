import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { IpcService } from '../../../core/services/ipc.service';
import { TabStateService } from '../../../core/state/tab.state';
import { ConnectionStateService } from '../../../core/state/connection.state';
import { NotificationService } from '../../../core/services/notification.service';
import type { FileTreeNode, WorkspaceInfo } from '@forgedb/shared';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-workspace-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="workspace-panel">
      <div class="panel-header">
        <h3>Workspace</h3>
        <div class="header-actions">
          <button mat-icon-button matTooltip="Open Folder" (click)="openFolder()">
            <mat-icon>folder_open</mat-icon>
          </button>
          @if (workspace()) {
            <button mat-icon-button matTooltip="Refresh" (click)="refresh()">
              <mat-icon>refresh</mat-icon>
            </button>
            <button mat-icon-button matTooltip="New File" (click)="createNewFile()">
              <mat-icon>note_add</mat-icon>
            </button>
          }
        </div>
      </div>

      <div class="panel-content">
        @if (loading()) {
          <div class="loading-state">
            <mat-spinner diameter="24"></mat-spinner>
            <span>Loading...</span>
          </div>
        } @else if (!workspace()) {
          <div class="empty-state">
            <mat-icon>folder_off</mat-icon>
            <p>No folder open</p>
            <button mat-stroked-button (click)="openFolder()">Open Folder</button>
          </div>
        } @else {
          <div class="workspace-name">
            <mat-icon>folder</mat-icon>
            <span>{{ workspace()!.name }}</span>
          </div>
          <div class="file-tree">
            @for (node of workspace()!.files; track node.path) {
              <ng-container
                *ngTemplateOutlet="fileNode; context: { node: node, level: 0 }"
              ></ng-container>
            }
          </div>
        }
      </div>

      <!-- File node template -->
      <ng-template #fileNode let-node="node" let-level="level">
        <div
          class="tree-node"
          [class.is-directory]="node.type === 'directory'"
          [class.expanded]="isExpanded(node.path)"
          [style.padding-left.px]="level * 16 + 8"
          (click)="onNodeClick(node)"
          (contextmenu)="onContextMenu($event, node)"
        >
          @if (node.type === 'directory') {
            <mat-icon class="expand-icon">
              {{ isExpanded(node.path) ? 'expand_more' : 'chevron_right' }}
            </mat-icon>
            <mat-icon class="node-icon folder">folder</mat-icon>
          } @else {
            <mat-icon class="node-icon file">description</mat-icon>
          }
          <span class="node-name">{{ node.name }}</span>
        </div>

        @if (node.type === 'directory' && isExpanded(node.path) && node.children) {
          @for (child of node.children; track child.path) {
            <ng-container
              *ngTemplateOutlet="fileNode; context: { node: child, level: level + 1 }"
            ></ng-container>
          }
        }
      </ng-template>
    </div>
  `,
  styles: [
    `
      .workspace-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-xs) var(--spacing-sm);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);

        h3 {
          margin: 0;
          font-size: var(--font-size-sm);
          font-weight: 600;
          text-transform: uppercase;
          color: var(--text-secondary);
        }

        .header-actions {
          display: flex;
          gap: 2px;

          button {
            width: 28px;
            height: 28px;
            line-height: 28px;

            mat-icon {
              font-size: 18px;
              width: 18px;
              height: 18px;
            }
          }
        }
      }

      .panel-content {
        flex: 1;
        overflow-y: auto;
      }

      .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--text-muted);
        gap: var(--spacing-sm);
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        text-align: center;
        color: var(--text-muted);

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          opacity: 0.5;
          margin-bottom: var(--spacing-sm);
        }

        p {
          margin: 0 0 var(--spacing-md);
        }
      }

      .workspace-name {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        font-weight: 500;
        color: var(--text-primary);
        background-color: var(--bg-tertiary);
        border-bottom: 1px solid var(--border-primary);

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--status-info);
        }
      }

      .file-tree {
        padding: var(--spacing-xs) 0;
      }

      .tree-node {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: 4px var(--spacing-sm);
        cursor: pointer;
        user-select: none;
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }

        .expand-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          color: var(--text-muted);
        }

        .node-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;

          &.folder {
            color: var(--status-warning);
          }

          &.file {
            color: var(--text-secondary);
          }
        }

        .node-name {
          flex: 1;
          font-size: var(--font-size-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        &.is-directory .node-name {
          font-weight: 500;
        }
      }
    `,
  ],
})
export class WorkspacePanelComponent implements OnInit, OnDestroy {
  private readonly ipc = inject(IpcService);
  private readonly tabState = inject(TabStateService);
  private readonly connectionState = inject(ConnectionStateService);
  private readonly notification = inject(NotificationService);

  readonly workspace = signal<WorkspaceInfo | null>(null);
  readonly loading = signal(false);
  readonly expandedPaths = signal<Set<string>>(new Set());

  private fileChangeUnsubscribe?: () => void;

  ngOnInit(): void {
    // Listen for file changes
    if (this.ipc.isAvailable && window.forge?.workspace?.onFileChanged) {
      this.fileChangeUnsubscribe = window.forge.workspace.onFileChanged(() => {
        if (this.workspace()) {
          this.refresh();
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.fileChangeUnsubscribe?.();
  }

  async openFolder(): Promise<void> {
    if (!this.ipc.isAvailable) return;

    this.loading.set(true);
    try {
      const workspace = await firstValueFrom(this.ipc.openWorkspaceFolder(''));
      if (workspace) {
        this.workspace.set(workspace);
        // Expand first level by default
        const expanded = new Set<string>();
        for (const node of workspace.files) {
          if (node.type === 'directory') {
            expanded.add(node.path);
          }
        }
        this.expandedPaths.set(expanded);
      }
    } catch (error) {
      this.notification.error('Failed to open folder');
      console.error('Failed to open folder:', error);
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(): Promise<void> {
    const currentWorkspace = this.workspace();
    if (!currentWorkspace || !this.ipc.isAvailable) return;

    this.loading.set(true);
    try {
      const files = await firstValueFrom(this.ipc.getWorkspaceFiles(currentWorkspace.path));
      this.workspace.update(ws => (ws ? { ...ws, files } : null));
    } catch (error) {
      this.notification.error('Failed to refresh');
      console.error('Failed to refresh:', error);
    } finally {
      this.loading.set(false);
    }
  }

  isExpanded(path: string): boolean {
    return this.expandedPaths().has(path);
  }

  async onNodeClick(node: FileTreeNode): Promise<void> {
    if (node.type === 'directory') {
      // Toggle expand/collapse
      this.expandedPaths.update(paths => {
        const newPaths = new Set(paths);
        if (newPaths.has(node.path)) {
          newPaths.delete(node.path);
        } else {
          newPaths.add(node.path);
        }
        return newPaths;
      });
    } else {
      // Open file in query tab
      await this.openFile(node);
    }
  }

  async openFile(node: FileTreeNode): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      const content = await firstValueFrom(this.ipc.readWorkspaceFile(node.path));
      const connectionId = this.connectionState.focusedConnectionId();
      const database = this.connectionState.selectedDatabaseFor(connectionId);

      if (connectionId && database) {
        this.tabState.openQueryTab(connectionId, database, content, false);
      } else {
        // Open without connection
        this.tabState.openTab({
          type: 'query',
          title: node.name,
          icon: 'code',
          content,
          isDirty: false,
        });
      }
    } catch (error) {
      this.notification.error('Failed to open file');
      console.error('Failed to open file:', error);
    }
  }

  onContextMenu(event: MouseEvent, _node: FileTreeNode): void {
    event.preventDefault();
    // Could emit to context menu service
  }

  async createNewFile(): Promise<void> {
    const currentWorkspace = this.workspace();
    if (!currentWorkspace || !this.ipc.isAvailable) return;

    // For now, just create a new query tab
    const connectionId = this.connectionState.focusedConnectionId();
    const database = this.connectionState.selectedDatabaseFor(connectionId);

    if (connectionId && database) {
      this.tabState.openQueryTab(connectionId, database, '', false);
    } else {
      this.tabState.openTab({
        type: 'query',
        title: 'New Query',
        icon: 'code',
        content: '',
        isDirty: false,
      });
    }
  }
}
