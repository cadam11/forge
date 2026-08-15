import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { TabStateService } from '../../core/state/tab.state';
import { IpcService } from '../../core/services/ipc.service';
import { NotificationService } from '../../core/services/notification.service';
import type { ColumnInfo, IndexInfo } from '@forgedb/shared';

@Component({
  selector: 'app-explorer',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatTableModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="explorer-container">
      @if (activeTab(); as tab) {
        @if (tab.type === 'object' && tab.metadata) {
          <div class="object-details">
            <div class="object-header">
              <mat-icon>{{ getObjectIcon(tab.metadata['objectType']) }}</mat-icon>
              <div class="object-info">
                <h2>{{ tab.title }}</h2>
                <span class="object-type">{{ tab.metadata['objectType'] }}</span>
              </div>
              <div class="header-actions">
                <button mat-icon-button matTooltip="Script as CREATE" (click)="scriptCreate()">
                  <mat-icon>code</mat-icon>
                </button>
                <button mat-icon-button matTooltip="Refresh" (click)="refresh()">
                  <mat-icon>refresh</mat-icon>
                </button>
              </div>
            </div>

            @if (loading()) {
              <div class="loading-state">
                <mat-spinner diameter="32"></mat-spinner>
                <p>Loading object details...</p>
              </div>
            } @else {
              <mat-tab-group>
                <mat-tab label="Columns ({{ columns().length }})">
                  <div class="tab-content">
                    @if (columns().length) {
                      <table mat-table [dataSource]="columns()" class="columns-table">
                        <ng-container matColumnDef="name">
                          <th mat-header-cell *matHeaderCellDef>Name</th>
                          <td mat-cell *matCellDef="let col">{{ col.name }}</td>
                        </ng-container>
                        <ng-container matColumnDef="dataType">
                          <th mat-header-cell *matHeaderCellDef>Data Type</th>
                          <td mat-cell *matCellDef="let col">{{ col.dataType }}</td>
                        </ng-container>
                        <ng-container matColumnDef="nullable">
                          <th mat-header-cell *matHeaderCellDef>Nullable</th>
                          <td mat-cell *matCellDef="let col">
                            <mat-icon>{{ col.isNullable ? 'check' : 'close' }}</mat-icon>
                          </td>
                        </ng-container>
                        <ng-container matColumnDef="primaryKey">
                          <th mat-header-cell *matHeaderCellDef>PK</th>
                          <td mat-cell *matCellDef="let col">
                            @if (col.isPrimaryKey) {
                              <mat-icon class="pk-icon">key</mat-icon>
                            }
                          </td>
                        </ng-container>
                        <ng-container matColumnDef="default">
                          <th mat-header-cell *matHeaderCellDef>Default</th>
                          <td mat-cell *matCellDef="let col">{{ col.defaultValue || '' }}</td>
                        </ng-container>
                        <tr mat-header-row *matHeaderRowDef="columnDisplayedColumns"></tr>
                        <tr mat-row *matRowDef="let row; columns: columnDisplayedColumns"></tr>
                      </table>
                    } @else {
                      <div class="empty-state">
                        <mat-icon>view_column</mat-icon>
                        <p>No columns found</p>
                      </div>
                    }
                  </div>
                </mat-tab>

                <mat-tab label="Indexes ({{ indexes().length }})">
                  <div class="tab-content">
                    @if (indexes().length) {
                      <table mat-table [dataSource]="indexes()" class="indexes-table">
                        <ng-container matColumnDef="name">
                          <th mat-header-cell *matHeaderCellDef>Name</th>
                          <td mat-cell *matCellDef="let idx">{{ idx.name }}</td>
                        </ng-container>
                        <ng-container matColumnDef="type">
                          <th mat-header-cell *matHeaderCellDef>Type</th>
                          <td mat-cell *matCellDef="let idx">{{ idx.type }}</td>
                        </ng-container>
                        <ng-container matColumnDef="columns">
                          <th mat-header-cell *matHeaderCellDef>Columns</th>
                          <td mat-cell *matCellDef="let idx">{{ idx.columns?.join(', ') }}</td>
                        </ng-container>
                        <ng-container matColumnDef="unique">
                          <th mat-header-cell *matHeaderCellDef>Unique</th>
                          <td mat-cell *matCellDef="let idx">
                            <mat-icon>{{ idx.isUnique ? 'check' : 'close' }}</mat-icon>
                          </td>
                        </ng-container>
                        <tr mat-header-row *matHeaderRowDef="indexDisplayedColumns"></tr>
                        <tr mat-row *matRowDef="let row; columns: indexDisplayedColumns"></tr>
                      </table>
                    } @else {
                      <div class="empty-state">
                        <mat-icon>format_list_numbered</mat-icon>
                        <p>No indexes</p>
                      </div>
                    }
                  </div>
                </mat-tab>

                <mat-tab label="Definition">
                  <div class="tab-content">
                    @if (definition()) {
                      <pre class="sql-definition">{{ definition() }}</pre>
                    } @else {
                      <div class="empty-state">
                        <mat-icon>code</mat-icon>
                        <p>
                          No definition available for tables. Available for views, procedures, and
                          functions.
                        </p>
                      </div>
                    }
                  </div>
                </mat-tab>
              </mat-tab-group>
            }
          </div>
        } @else {
          <div class="no-selection">
            <mat-icon>info</mat-icon>
            <h2>Object Explorer</h2>
            <p>Select an object from the sidebar to view its details</p>
          </div>
        }
      } @else {
        <div class="no-selection">
          <mat-icon>info</mat-icon>
          <h2>Object Explorer</h2>
          <p>Select an object from the sidebar to view its details</p>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .explorer-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .object-details {
        height: 100%;
        display: flex;
        flex-direction: column;
      }

      .object-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);

        > mat-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;
          color: var(--status-info);
        }

        .object-info {
          flex: 1;

          h2 {
            font-size: var(--font-size-lg);
            font-weight: 600;
            margin: 0;
          }

          .object-type {
            font-size: var(--font-size-sm);
            color: var(--text-secondary);
            text-transform: capitalize;
          }
        }

        .header-actions {
          display: flex;
          gap: var(--spacing-xs);
        }
      }

      mat-tab-group {
        flex: 1;
        overflow: hidden;
      }

      .tab-content {
        padding: var(--spacing-md);
        height: 100%;
        overflow: auto;
      }

      .columns-table,
      .indexes-table {
        width: 100%;
        background-color: var(--bg-secondary);

        th.mat-header-cell {
          color: var(--text-secondary);
          font-weight: 600;
        }

        td.mat-cell {
          font-family: var(--font-mono);
          font-size: var(--font-size-sm);
        }

        .pk-icon {
          font-size: 16px;
          color: var(--syntax-function);
        }
      }

      .sql-definition {
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        background-color: var(--bg-secondary);
        padding: var(--spacing-md);
        border-radius: var(--radius-md);
        overflow: auto;
        white-space: pre-wrap;
        color: var(--text-primary);
        margin: 0;
      }

      .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: var(--spacing-md);
        color: var(--text-secondary);
      }

      .no-selection,
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-muted);
        text-align: center;

        mat-icon {
          font-size: 64px;
          width: 64px;
          height: 64px;
          opacity: 0.5;
          margin-bottom: var(--spacing-md);
        }

        h2 {
          font-size: var(--font-size-xl);
          margin: 0 0 var(--spacing-sm);
        }

        p {
          margin: 0;
          max-width: 300px;
        }
      }

      .empty-state {
        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
        }
      }
    `,
  ],
})
export class ExplorerComponent {
  private readonly tabState = inject(TabStateService);
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);

  readonly activeTab = this.tabState.activeTab;
  readonly columnDisplayedColumns = ['name', 'dataType', 'nullable', 'primaryKey', 'default'];
  readonly indexDisplayedColumns = ['name', 'type', 'columns', 'unique'];

  readonly loading = signal(false);
  readonly columns = signal<ColumnInfo[]>([]);
  readonly indexes = signal<IndexInfo[]>([]);
  readonly definition = signal<string | null>(null);

  private loadedTabId: string | null = null;

  constructor() {
    // Watch for active tab changes and load details when an object tab becomes active
    effect(() => {
      const tab = this.activeTab();
      if (tab?.type === 'object' && tab.metadata && tab.id !== this.loadedTabId) {
        this.loadedTabId = tab.id;
        this.loadObjectDetails(
          tab.connectionId!,
          tab.databaseName!,
          tab.metadata['objectName'] as string,
          tab.metadata['objectType'] as string
        );
      }
    });
  }

  private async loadObjectDetails(
    connectionId: string,
    databaseName: string,
    objectName: string,
    objectType: string
  ): Promise<void> {
    this.loading.set(true);
    this.columns.set([]);
    this.indexes.set([]);
    this.definition.set(null);

    // Determine schema from tab metadata or parse from objectName
    const tab = this.activeTab();
    let schema = (tab?.metadata?.['schema'] as string) || 'dbo';
    let name = objectName;
    if (objectName.includes('.')) {
      const parts = objectName.split('.');
      schema = parts[0].replace(/[[\]]/g, '');
      name = parts[1].replace(/[[\]]/g, '');
    }

    try {
      // Load columns and indexes in parallel for tables/views
      const isTableOrView = ['table', 'view'].includes(objectType.toLowerCase());

      if (isTableOrView) {
        const [cols, idxs] = await Promise.all([
          firstValueFrom(this.ipc.getTableColumns(connectionId, databaseName, schema, name)).catch(
            () => []
          ),
          firstValueFrom(this.ipc.getTableIndexes(connectionId, databaseName, schema, name)).catch(
            () => []
          ),
        ]);
        this.columns.set(cols);
        this.indexes.set(idxs);
      }

      // Load definition for views, procedures, functions
      if (objectType.toLowerCase() !== 'table') {
        try {
          const def = await firstValueFrom(
            this.ipc.getDefinition(connectionId, databaseName, objectType, name, schema)
          );
          this.definition.set(def?.definition || null);
        } catch {
          // No definition available
        }
      }
    } catch {
      this.notification.error('Failed to load object details');
    } finally {
      this.loading.set(false);
    }
  }

  async scriptCreate(): Promise<void> {
    const tab = this.activeTab();
    if (!tab?.connectionId || !tab.databaseName || !tab.metadata) return;

    const objectName = tab.metadata['objectName'] as string;

    try {
      let schema = (tab.metadata['schema'] as string) || 'dbo';
      let name = objectName;
      if (objectName.includes('.')) {
        const parts = objectName.split('.');
        schema = parts[0].replace(/[[\]]/g, '');
        name = parts[1].replace(/[[\]]/g, '');
      }

      const script = await firstValueFrom(
        this.ipc.scriptTableCreate(tab.connectionId, tab.databaseName, schema, name)
      );

      // Open in a new query tab
      this.tabState.openQueryTab(tab.connectionId, tab.databaseName, script);
    } catch {
      this.notification.error('Failed to generate CREATE script');
    }
  }

  refresh(): void {
    this.loadedTabId = null; // Force reload
    const tab = this.activeTab();
    if (tab?.type === 'object' && tab.metadata) {
      this.loadedTabId = tab.id;
      this.loadObjectDetails(
        tab.connectionId!,
        tab.databaseName!,
        tab.metadata['objectName'] as string,
        tab.metadata['objectType'] as string
      );
    }
  }

  getObjectIcon(objectType: unknown): string {
    const icons: Record<string, string> = {
      table: 'table_chart',
      view: 'view_list',
      procedure: 'functions',
      function: 'calculate',
    };
    return icons[String(objectType).toLowerCase()] || 'description';
  }
}
