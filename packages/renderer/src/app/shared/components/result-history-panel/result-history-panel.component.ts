import {
  Component,
  inject,
  input,
  output,
  signal,
  computed,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { LoadingComponent } from '../loading/loading.component';
import type { QueryResultSnapshot, ResultDiff } from '@mj-forge/shared';
import { QueryResultsStateService } from '../../../core/state/query-results.state';
import { SmartDatePipe } from '../../pipes/smart-date.pipe';

type SortField = 'executedAt' | 'totalRowCount' | 'executionTimeMs';
type SortOrder = 'asc' | 'desc';

@Component({
  selector: 'app-result-history-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatMenuModule,
    MatCheckboxModule,
    MatBadgeModule,
    MatDividerModule,
    LoadingComponent,
    SmartDatePipe,
  ],
  template: `
    <div
      class="history-panel"
      [class.expanded]="expanded() || embedded()"
      [class.embedded]="embedded()"
    >
      <!-- Header (only when not embedded) -->
      @if (!embedded()) {
        <div
          class="panel-header"
          tabindex="0"
          role="button"
          aria-label="Toggle result history"
          (click)="toggleExpanded()"
          (keydown.enter)="toggleExpanded()"
          (keydown.space)="toggleExpanded(); $event.preventDefault()"
        >
          <div class="header-left">
            <mat-icon>{{ expanded() ? 'expand_less' : 'expand_more' }}</mat-icon>
            <span class="header-title">Result History</span>
            @if (snapshots().length > 0) {
              <span class="count-badge">{{ snapshots().length }}</span>
            }
          </div>
          <div class="header-actions" (click)="$event.stopPropagation()">
            @if (resultsState.selectedCount() > 0) {
              <button
                mat-icon-button
                matTooltip="Compare Selected"
                [disabled]="!resultsState.canCompare()"
                (click)="compareSelected()"
              >
                <mat-icon>compare_arrows</mat-icon>
              </button>
              <button mat-icon-button matTooltip="Delete Selected" (click)="deleteSelected()">
                <mat-icon>delete</mat-icon>
              </button>
            }
            <button mat-icon-button [matMenuTriggerFor]="sortMenu" matTooltip="Sort">
              <mat-icon>sort</mat-icon>
            </button>
            <button mat-icon-button [matMenuTriggerFor]="moreMenu" matTooltip="More">
              <mat-icon>more_vert</mat-icon>
            </button>
          </div>
        </div>
      }

      <!-- Sort Menu -->
      <mat-menu #sortMenu="matMenu">
        <button mat-menu-item (click)="setSort('executedAt')">
          <mat-icon>{{
            sortField() === 'executedAt'
              ? sortOrder() === 'desc'
                ? 'arrow_downward'
                : 'arrow_upward'
              : ''
          }}</mat-icon>
          <span>Time</span>
        </button>
        <button mat-menu-item (click)="setSort('totalRowCount')">
          <mat-icon>{{
            sortField() === 'totalRowCount'
              ? sortOrder() === 'desc'
                ? 'arrow_downward'
                : 'arrow_upward'
              : ''
          }}</mat-icon>
          <span>Row Count</span>
        </button>
        <button mat-menu-item (click)="setSort('executionTimeMs')">
          <mat-icon>{{
            sortField() === 'executionTimeMs'
              ? sortOrder() === 'desc'
                ? 'arrow_downward'
                : 'arrow_upward'
              : ''
          }}</mat-icon>
          <span>Duration</span>
        </button>
      </mat-menu>

      <!-- More Menu -->
      <mat-menu #moreMenu="matMenu">
        <button mat-menu-item (click)="selectAll()">
          <mat-icon>select_all</mat-icon>
          <span>Select All</span>
        </button>
        <button mat-menu-item (click)="clearSelection()">
          <mat-icon>deselect</mat-icon>
          <span>Clear Selection</span>
        </button>
        <mat-divider></mat-divider>
        <button mat-menu-item (click)="purgeOld()">
          <mat-icon>auto_delete</mat-icon>
          <span>Purge Old Results</span>
        </button>
        <button mat-menu-item (click)="viewStorageStats()">
          <mat-icon>storage</mat-icon>
          <span>Storage Stats</span>
        </button>
      </mat-menu>

      <!-- Embedded toolbar -->
      @if (embedded()) {
        <div class="embedded-toolbar">
          @if (resultsState.selectedCount() > 0) {
            <button
              mat-icon-button
              matTooltip="Compare Selected"
              [disabled]="!resultsState.canCompare()"
              (click)="compareSelected()"
            >
              <mat-icon>compare_arrows</mat-icon>
            </button>
            <button mat-icon-button matTooltip="Delete Selected" (click)="deleteSelected()">
              <mat-icon>delete</mat-icon>
            </button>
          }
          <button mat-icon-button [matMenuTriggerFor]="sortMenu" matTooltip="Sort">
            <mat-icon>sort</mat-icon>
          </button>
          <button mat-icon-button [matMenuTriggerFor]="moreMenu" matTooltip="More">
            <mat-icon>more_vert</mat-icon>
          </button>
        </div>
      }

      <!-- Content -->
      @if (expanded() || embedded()) {
        <div class="panel-content">
          <!-- Comparison View -->
          @if (comparing()) {
            <div class="comparison-view">
              <div class="comparison-header">
                <mat-icon>compare_arrows</mat-icon>
                <span class="comparison-title">Comparison Results</span>
                <button mat-icon-button matTooltip="Close comparison" (click)="closeComparison()">
                  <mat-icon>close</mat-icon>
                </button>
              </div>

              @if (comparingInProgress()) {
                <div class="comparison-loading">
                  <app-loading
                    text="Comparing results..."
                    size="medium"
                    animation="pulse"
                  ></app-loading>
                </div>
              } @else if (comparisonResult()) {
                <div class="comparison-content">
                  <div class="comparison-snapshots">
                    <div class="comparison-snapshot base">
                      <span class="snapshot-label">Base</span>
                      <span class="snapshot-date">{{ formatCompareDate(comparisonBase()) }}</span>
                    </div>
                    <mat-icon class="compare-arrow">arrow_forward</mat-icon>
                    <div class="comparison-snapshot compare">
                      <span class="snapshot-label">Compare</span>
                      <span class="snapshot-date">{{
                        formatCompareDate(comparisonCompare())
                      }}</span>
                    </div>
                  </div>

                  <div class="diff-summary">
                    <div class="diff-section">
                      <h4>Row Changes</h4>
                      <div class="diff-stats">
                        <div class="diff-stat added">
                          <mat-icon>add_circle</mat-icon>
                          <span class="stat-value">{{
                            comparisonResult()!.summary.addedRows
                          }}</span>
                          <span class="stat-label">Added</span>
                        </div>
                        <div class="diff-stat removed">
                          <mat-icon>remove_circle</mat-icon>
                          <span class="stat-value">{{
                            comparisonResult()!.summary.removedRows
                          }}</span>
                          <span class="stat-label">Removed</span>
                        </div>
                        <div class="diff-stat modified">
                          <mat-icon>change_circle</mat-icon>
                          <span class="stat-value">{{
                            comparisonResult()!.summary.modifiedRows
                          }}</span>
                          <span class="stat-label">Modified</span>
                        </div>
                        <div class="diff-stat unchanged">
                          <mat-icon>check_circle</mat-icon>
                          <span class="stat-value">{{
                            comparisonResult()!.summary.unchangedRows
                          }}</span>
                          <span class="stat-label">Unchanged</span>
                        </div>
                      </div>
                    </div>

                    @if (hasSchemaChanges()) {
                      <div class="diff-section">
                        <h4>Schema Changes</h4>
                        <div class="schema-changes">
                          @if (comparisonResult()!.schemaDiff?.addedColumns?.length) {
                            <div class="schema-item added">
                              <mat-icon>add</mat-icon>
                              <span
                                >{{
                                  comparisonResult()!.schemaDiff!.addedColumns!.length
                                }}
                                column(s) added</span
                              >
                            </div>
                          }
                          @if (comparisonResult()!.schemaDiff?.removedColumns?.length) {
                            <div class="schema-item removed">
                              <mat-icon>remove</mat-icon>
                              <span
                                >{{
                                  comparisonResult()!.schemaDiff!.removedColumns!.length
                                }}
                                column(s) removed</span
                              >
                            </div>
                          }
                          @if (comparisonResult()!.schemaDiff?.modifiedColumns?.length) {
                            <div class="schema-item modified">
                              <mat-icon>edit</mat-icon>
                              <span
                                >{{
                                  comparisonResult()!.schemaDiff!.modifiedColumns!.length
                                }}
                                column(s) modified</span
                              >
                            </div>
                          }
                        </div>
                      </div>
                    }
                  </div>

                  <div class="comparison-actions">
                    <button mat-stroked-button (click)="closeComparison()">
                      <mat-icon>close</mat-icon>
                      Close
                    </button>
                  </div>
                </div>
              }
            </div>
          }

          @if (resultsState.loading()) {
            <div class="loading-state">
              <mat-spinner diameter="24"></mat-spinner>
              <span>Loading history...</span>
            </div>
          } @else if (snapshots().length === 0) {
            <div class="empty-state">
              <mat-icon>history</mat-icon>
              <p>No results saved yet</p>
              <span class="hint">Execute a query to save results</span>
            </div>
          } @else if (!comparing()) {
            <div class="snapshot-list">
              @for (snapshot of sortedSnapshots(); track snapshot.id; let i = $index) {
                <div
                  class="snapshot-item"
                  [class.selected]="resultsState.isSelected(snapshot.id)"
                  [class.pinned]="snapshot.isPinned"
                  [class.error]="!snapshot.success"
                  (click)="toggleSelection(snapshot.id)"
                >
                  <mat-checkbox
                    [checked]="resultsState.isSelected(snapshot.id)"
                    (click)="$event.stopPropagation()"
                    (change)="toggleSelection(snapshot.id)"
                  ></mat-checkbox>

                  <div
                    class="snapshot-info"
                    (click)="viewSnapshot(snapshot); $event.stopPropagation()"
                  >
                    <div class="snapshot-header">
                      @if (snapshot.label) {
                        <span class="snapshot-label">{{ snapshot.label }}</span>
                      }
                      <span class="snapshot-time">
                        {{ snapshot.executedAt | smartDate: getPreviousDate(i) }}
                      </span>
                      @if (snapshot.isPinned) {
                        <mat-icon class="pin-icon">push_pin</mat-icon>
                      }
                    </div>
                    <div class="snapshot-details">
                      @if (snapshot.success) {
                        <span class="row-count">{{ snapshot.totalRowCount | number }} rows</span>
                        <span class="separator">·</span>
                        <span class="duration">{{ snapshot.executionTimeMs }}ms</span>
                      } @else {
                        <span class="error-text">Error</span>
                      }
                    </div>
                    <div class="snapshot-sql">{{ truncateSql(snapshot.sql) }}</div>
                  </div>

                  <div class="snapshot-actions" (click)="$event.stopPropagation()">
                    <button
                      mat-icon-button
                      [matMenuTriggerFor]="itemMenu"
                      [matMenuTriggerData]="{ snapshot: snapshot }"
                    >
                      <mat-icon>more_vert</mat-icon>
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- Item Menu -->
      <mat-menu #itemMenu="matMenu">
        <ng-template matMenuContent let-snapshot="snapshot">
          <button mat-menu-item (click)="viewSnapshot(snapshot)">
            <mat-icon>visibility</mat-icon>
            <span>View Results</span>
          </button>
          <button mat-menu-item (click)="togglePin(snapshot)">
            <mat-icon>{{ snapshot.isPinned ? 'push_pin' : 'push_pin' }}</mat-icon>
            <span>{{ snapshot.isPinned ? 'Unpin' : 'Pin' }}</span>
          </button>
          <button mat-menu-item (click)="labelSnapshot(snapshot)">
            <mat-icon>label</mat-icon>
            <span>Add Label</span>
          </button>
          <button mat-menu-item (click)="copySql(snapshot)">
            <mat-icon>content_copy</mat-icon>
            <span>Copy SQL</span>
          </button>
          <mat-divider></mat-divider>
          <button mat-menu-item (click)="deleteSnapshot(snapshot)">
            <mat-icon>delete</mat-icon>
            <span>Delete</span>
          </button>
        </ng-template>
      </mat-menu>
    </div>
  `,
  styles: [
    `
      .history-panel {
        display: flex;
        flex-direction: column;
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);
        transition: max-height 0.2s ease;
        max-height: 40px;
        overflow: hidden;

        &.expanded {
          max-height: 300px;
        }

        &.embedded {
          border-top: none;
          max-height: none;
          height: 100%;
          background-color: transparent;
        }
      }

      .embedded-toolbar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: var(--spacing-xs) var(--spacing-sm);
        border-bottom: 1px solid var(--border-primary);
        gap: var(--spacing-xs);

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

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-xs) var(--spacing-md);
        cursor: pointer;
        user-select: none;
        min-height: 40px;

        &:hover {
          background-color: var(--bg-hover);
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
            color: var(--text-secondary);
          }

          .header-title {
            font-size: var(--font-size-sm);
            font-weight: 500;
          }

          .count-badge {
            background-color: var(--accent-primary);
            color: white;
            font-size: var(--font-size-xs);
            padding: 1px 6px;
            border-radius: 10px;
            min-width: 18px;
            text-align: center;
          }
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);

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
        padding: var(--spacing-sm);
      }

      .loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-lg);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        text-align: center;
        color: var(--text-secondary);

        mat-icon {
          font-size: 36px;
          width: 36px;
          height: 36px;
          opacity: 0.5;
          margin-bottom: var(--spacing-sm);
        }

        p {
          margin: 0;
          font-weight: 500;
        }

        .hint {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          margin-top: var(--spacing-xs);
        }
      }

      .snapshot-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .snapshot-item {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        border-radius: var(--radius-md);
        background-color: var(--bg-primary);
        border: 1px solid var(--border-primary);
        transition: background-color 0.15s ease;

        &:hover {
          background-color: var(--bg-hover);
        }

        &.selected {
          background-color: var(--selection-bg);
          border-color: var(--accent-primary);
        }

        &.pinned {
          border-left: 3px solid var(--status-info);
        }

        &.error {
          border-left: 3px solid var(--status-error);
        }

        mat-checkbox {
          margin-top: 2px;
        }
      }

      .snapshot-info {
        flex: 1;
        min-width: 0;
        cursor: pointer;

        .snapshot-header {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          margin-bottom: 2px;

          .snapshot-label {
            font-weight: 500;
            font-size: var(--font-size-sm);
            color: var(--text-primary);
          }

          .snapshot-time {
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
          }

          .pin-icon {
            font-size: 14px;
            width: 14px;
            height: 14px;
            color: var(--status-info);
          }
        }

        .snapshot-details {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          font-size: var(--font-size-xs);
          color: var(--text-secondary);

          .separator {
            opacity: 0.5;
          }

          .error-text {
            color: var(--status-error);
          }
        }

        .snapshot-sql {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          font-family: var(--font-mono);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-top: 2px;
        }
      }

      .snapshot-actions {
        button {
          width: 24px;
          height: 24px;
          line-height: 24px;

          mat-icon {
            font-size: 16px;
            width: 16px;
            height: 16px;
          }
        }
      }

      /* Comparison View Styles */
      .comparison-view {
        background-color: var(--bg-primary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        margin-bottom: var(--spacing-md);
        overflow: hidden;
      }

      .comparison-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-tertiary);
        border-bottom: 1px solid var(--border-primary);

        mat-icon {
          color: var(--status-info);
        }

        .comparison-title {
          flex: 1;
          font-weight: 500;
          font-size: var(--font-size-sm);
        }
      }

      .comparison-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
      }

      .comparison-content {
        padding: var(--spacing-md);
      }

      .comparison-snapshots {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-md);
        padding: var(--spacing-sm);
        background-color: var(--bg-secondary);
        border-radius: var(--radius-md);
      }

      .comparison-snapshot {
        text-align: center;

        .snapshot-label {
          display: block;
          font-size: var(--font-size-xs);
          font-weight: 600;
          text-transform: uppercase;
          margin-bottom: 2px;
        }

        .snapshot-date {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
        }

        &.base .snapshot-label {
          color: var(--status-info);
        }

        &.compare .snapshot-label {
          color: var(--accent-primary);
        }
      }

      .compare-arrow {
        color: var(--text-muted);
      }

      .diff-summary {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .diff-section {
        h4 {
          margin: 0 0 var(--spacing-sm);
          font-size: var(--font-size-sm);
          font-weight: 500;
          color: var(--text-secondary);
        }
      }

      .diff-stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--spacing-sm);
      }

      .diff-stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--spacing-sm);
        background-color: var(--bg-secondary);
        border-radius: var(--radius-md);

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          margin-bottom: 2px;
        }

        .stat-value {
          font-size: var(--font-size-lg);
          font-weight: 600;
        }

        .stat-label {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
        }

        &.added {
          mat-icon,
          .stat-value {
            color: var(--status-success);
          }
        }

        &.removed {
          mat-icon,
          .stat-value {
            color: var(--status-error);
          }
        }

        &.modified {
          mat-icon,
          .stat-value {
            color: var(--status-warning);
          }
        }

        &.unchanged {
          mat-icon,
          .stat-value {
            color: var(--text-secondary);
          }
        }
      }

      .schema-changes {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .schema-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }

        &.added {
          background-color: rgba(76, 175, 80, 0.1);
          color: var(--status-success);
        }

        &.removed {
          background-color: rgba(244, 67, 54, 0.1);
          color: var(--status-error);
        }

        &.modified {
          background-color: rgba(255, 152, 0, 0.1);
          color: var(--status-warning);
        }
      }

      .comparison-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--spacing-md);
        padding-top: var(--spacing-md);
        border-top: 1px solid var(--border-primary);
      }
    `,
  ],
})
export class ResultHistoryPanelComponent implements OnInit, OnDestroy {
  readonly resultsState = inject(QueryResultsStateService);

  // Inputs
  readonly tabId = input.required<string>();
  readonly connectionId = input<string>();
  readonly database = input<string>();
  readonly embedded = input<boolean>(false);

  // Outputs
  readonly viewResult = output<QueryResultSnapshot>();
  readonly compareResults = output<{ base: QueryResultSnapshot; compare: QueryResultSnapshot }>();

  // Local state
  readonly expanded = signal(false);
  readonly sortField = signal<SortField>('executedAt');
  readonly sortOrder = signal<SortOrder>('desc');

  // Comparison state
  readonly comparing = signal(false);
  readonly comparingInProgress = signal(false);
  readonly comparisonResult = signal<ResultDiff | null>(null);
  readonly comparisonBase = signal<QueryResultSnapshot | null>(null);
  readonly comparisonCompare = signal<QueryResultSnapshot | null>(null);

  // Computed
  readonly snapshots = computed(() => this.resultsState.snapshots());

  readonly hasSchemaChanges = computed(() => {
    const result = this.comparisonResult();
    if (!result?.schemaDiff) return false;
    return (
      (result.schemaDiff.addedColumns?.length ?? 0) > 0 ||
      (result.schemaDiff.removedColumns?.length ?? 0) > 0 ||
      (result.schemaDiff.modifiedColumns?.length ?? 0) > 0
    );
  });

  readonly sortedSnapshots = computed(() => {
    const snaps = [...this.snapshots()];
    const field = this.sortField();
    const order = this.sortOrder();

    snaps.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      if (field === 'executedAt') {
        aVal = new Date(a.executedAt).getTime();
        bVal = new Date(b.executedAt).getTime();
      } else {
        aVal = a[field];
        bVal = b[field];
      }

      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return order === 'asc' ? cmp : -cmp;
    });

    return snaps;
  });

  async ngOnInit(): Promise<void> {
    await this.loadSnapshots();
  }

  ngOnDestroy(): void {
    this.resultsState.clearSelection();
  }

  async loadSnapshots(): Promise<void> {
    await this.resultsState.loadSnapshotsForTab(this.tabId());
  }

  toggleExpanded(): void {
    this.expanded.update(v => !v);
  }

  setSort(field: SortField): void {
    if (this.sortField() === field) {
      this.sortOrder.update(order => (order === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortField.set(field);
      this.sortOrder.set('desc');
    }
  }

  toggleSelection(id: string): void {
    this.resultsState.toggleSelection(id);
  }

  selectAll(): void {
    this.resultsState.selectAll();
  }

  clearSelection(): void {
    this.resultsState.clearSelection();
  }

  viewSnapshot(snapshot: QueryResultSnapshot): void {
    this.viewResult.emit(snapshot);
  }

  async togglePin(snapshot: QueryResultSnapshot): Promise<void> {
    await this.resultsState.togglePin(snapshot.id);
  }

  async labelSnapshot(snapshot: QueryResultSnapshot): Promise<void> {
    const label = prompt('Enter a label for this result:', snapshot.label || '');
    if (label !== null) {
      await this.resultsState.labelSnapshot(snapshot.id, label);
    }
  }

  copySql(snapshot: QueryResultSnapshot): void {
    navigator.clipboard.writeText(snapshot.sql);
  }

  async deleteSnapshot(snapshot: QueryResultSnapshot): Promise<void> {
    if (confirm('Delete this result snapshot?')) {
      await this.resultsState.deleteSnapshot(snapshot.id);
    }
  }

  async deleteSelected(): Promise<void> {
    const count = this.resultsState.selectedCount();
    if (confirm(`Delete ${count} selected snapshot${count > 1 ? 's' : ''}?`)) {
      await this.resultsState.deleteSelected();
    }
  }

  async compareSelected(): Promise<void> {
    const selected = this.resultsState.selectedSnapshots();
    if (selected.length === 2) {
      // Perform comparison inline instead of emitting
      this.comparing.set(true);
      this.comparingInProgress.set(true);
      this.comparisonBase.set(selected[0]);
      this.comparisonCompare.set(selected[1]);
      this.comparisonResult.set(null);

      try {
        const diff = await this.resultsState.compareSnapshots(selected[0].id, selected[1].id);
        this.comparisonResult.set(diff);
      } finally {
        this.comparingInProgress.set(false);
      }
    }
  }

  closeComparison(): void {
    this.comparing.set(false);
    this.comparisonResult.set(null);
    this.comparisonBase.set(null);
    this.comparisonCompare.set(null);
    this.resultsState.clearDiff();
    this.resultsState.clearSelection();
  }

  formatCompareDate(snapshot: QueryResultSnapshot | null): string {
    if (!snapshot) return '';
    return new Date(snapshot.executedAt).toLocaleString();
  }

  async purgeOld(): Promise<void> {
    const days = prompt('Delete results older than how many days?', '30');
    if (days !== null) {
      const daysNum = parseInt(days, 10);
      if (!isNaN(daysNum) && daysNum > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysNum);
        await this.resultsState.purge({
          olderThan: cutoff.toISOString(),
          skipPinned: true,
        });
        await this.loadSnapshots();
      }
    }
  }

  async viewStorageStats(): Promise<void> {
    await this.resultsState.loadStats();
    const stats = this.resultsState.stats();
    if (stats) {
      const sizeInMB = (stats.totalSizeBytes / (1024 * 1024)).toFixed(2);
      alert(
        `Storage Statistics:\n\n` +
          `Total Snapshots: ${stats.totalSnapshots}\n` +
          `Total Size: ${sizeInMB} MB\n` +
          `Oldest: ${stats.oldestSnapshot ? new Date(stats.oldestSnapshot).toLocaleString() : 'N/A'}\n` +
          `Newest: ${stats.newestSnapshot ? new Date(stats.newestSnapshot).toLocaleString() : 'N/A'}`
      );
    }
  }

  getPreviousDate(index: number): string | null {
    const sorted = this.sortedSnapshots();
    if (index === 0) return null;
    return sorted[index - 1]?.executedAt || null;
  }

  truncateSql(sql: string): string {
    const trimmed = sql.trim().replace(/\s+/g, ' ');
    return trimmed.length > 100 ? trimmed.substring(0, 100) + '...' : trimmed;
  }
}
