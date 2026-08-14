import { Component, input, output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import type { ResultDiff, RowDiff } from '@forgedb/shared';

type ViewMode = 'side-by-side' | 'unified';

@Component({
  selector: 'app-result-diff-viewer',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatTooltipModule,
    MatChipsModule,
  ],
  template: `
    <div class="diff-viewer">
      <!-- Header -->
      <div class="diff-header">
        <div class="diff-title">
          <mat-icon>compare_arrows</mat-icon>
          <span>Result Comparison</span>
        </div>
        <div class="diff-controls">
          <mat-button-toggle-group [value]="viewMode()" (change)="viewMode.set($event.value)">
            <mat-button-toggle value="side-by-side" matTooltip="Side by Side">
              <mat-icon>view_column</mat-icon>
            </mat-button-toggle>
            <mat-button-toggle value="unified" matTooltip="Unified View">
              <mat-icon>view_stream</mat-icon>
            </mat-button-toggle>
          </mat-button-toggle-group>
          <button mat-icon-button matTooltip="Close" (click)="close.emit()">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      </div>

      <!-- Summary -->
      <div class="diff-summary">
        <div class="summary-stats">
          <mat-chip-set>
            @if (diff()?.summary?.addedRows) {
              <mat-chip class="chip-added">
                <mat-icon>add</mat-icon>
                {{ diff()!.summary.addedRows }} added
              </mat-chip>
            }
            @if (diff()?.summary?.removedRows) {
              <mat-chip class="chip-removed">
                <mat-icon>remove</mat-icon>
                {{ diff()!.summary.removedRows }} removed
              </mat-chip>
            }
            @if (diff()?.summary?.modifiedRows) {
              <mat-chip class="chip-modified">
                <mat-icon>edit</mat-icon>
                {{ diff()!.summary.modifiedRows }} modified
              </mat-chip>
            }
            @if (diff()?.summary?.unchangedRows) {
              <mat-chip class="chip-unchanged">
                {{ diff()!.summary.unchangedRows }} unchanged
              </mat-chip>
            }
          </mat-chip-set>
        </div>
        <div class="summary-meta">
          @if (diff()?.metadata) {
            <span class="meta-item">
              Base: {{ formatDate(diff()!.metadata.baseSnapshot.executedAt) }} ({{
                diff()!.metadata.baseSnapshot.rowCount
              }}
              rows)
            </span>
            <span class="meta-separator">vs</span>
            <span class="meta-item">
              Compare: {{ formatDate(diff()!.metadata.compareSnapshot.executedAt) }} ({{
                diff()!.metadata.compareSnapshot.rowCount
              }}
              rows)
            </span>
          }
        </div>
      </div>

      <!-- Schema Changes -->
      @if (hasSchemaChanges()) {
        <div class="schema-changes">
          <div class="section-header">
            <mat-icon>schema</mat-icon>
            <span>Schema Changes</span>
          </div>
          <div class="schema-list">
            @for (col of diff()?.schemaDiff?.addedColumns || []; track col) {
              <span class="schema-item added">+ {{ col }}</span>
            }
            @for (col of diff()?.schemaDiff?.removedColumns || []; track col) {
              <span class="schema-item removed">- {{ col }}</span>
            }
            @for (col of diff()?.schemaDiff?.modifiedColumns || []; track col.name) {
              <span class="schema-item modified">
                ~ {{ col.name }}: {{ col.baseType }} → {{ col.compareType }}
              </span>
            }
          </div>
        </div>
      }

      <!-- Row Diffs -->
      <div class="diff-content" [class.side-by-side]="viewMode() === 'side-by-side'">
        @if (viewMode() === 'side-by-side') {
          <div class="diff-pane base-pane">
            <div class="pane-header">Base Result</div>
            <div class="pane-content">
              @for (row of filteredRows(); track row.rowIndex) {
                <div class="diff-row" [class]="row.type">
                  <div class="row-marker">
                    @switch (row.type) {
                      @case ('removed') {
                        <mat-icon>remove</mat-icon>
                      }
                      @case ('modified') {
                        <mat-icon>edit</mat-icon>
                      }
                      @default {
                        <span class="line-num">{{ row.rowIndex + 1 }}</span>
                      }
                    }
                  </div>
                  <div class="row-content">
                    @if (row.baseRow) {
                      @for (entry of objectEntries(row.baseRow); track entry[0]) {
                        <span class="cell" [class.changed]="isCellChanged(row, entry[0])">
                          <span class="cell-name">{{ entry[0] }}:</span>
                          <span class="cell-value">{{ formatValue(entry[1]) }}</span>
                        </span>
                      }
                    }
                  </div>
                </div>
              }
            </div>
          </div>
          <div class="diff-pane compare-pane">
            <div class="pane-header">Compare Result</div>
            <div class="pane-content">
              @for (row of filteredRows(); track row.rowIndex) {
                <div class="diff-row" [class]="row.type">
                  <div class="row-marker">
                    @switch (row.type) {
                      @case ('added') {
                        <mat-icon>add</mat-icon>
                      }
                      @case ('modified') {
                        <mat-icon>edit</mat-icon>
                      }
                      @default {
                        <span class="line-num">{{ row.rowIndex + 1 }}</span>
                      }
                    }
                  </div>
                  <div class="row-content">
                    @if (row.compareRow) {
                      @for (entry of objectEntries(row.compareRow); track entry[0]) {
                        <span class="cell" [class.changed]="isCellChanged(row, entry[0])">
                          <span class="cell-name">{{ entry[0] }}:</span>
                          <span class="cell-value">{{ formatValue(entry[1]) }}</span>
                        </span>
                      }
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        } @else {
          <!-- Unified View -->
          <div class="unified-content">
            @for (row of filteredRows(); track row.rowIndex) {
              <div class="diff-row unified" [class]="row.type">
                <div class="row-marker">
                  @switch (row.type) {
                    @case ('added') {
                      <mat-icon class="icon-added">add</mat-icon>
                    }
                    @case ('removed') {
                      <mat-icon class="icon-removed">remove</mat-icon>
                    }
                    @case ('modified') {
                      <mat-icon class="icon-modified">edit</mat-icon>
                    }
                    @default {
                      <span class="line-num">{{ row.rowIndex + 1 }}</span>
                    }
                  }
                </div>
                <div class="row-content">
                  @if (row.type === 'modified' && row.cellChanges) {
                    <div class="cell-changes">
                      @for (change of row.cellChanges; track change.column) {
                        <div class="cell-change">
                          <span class="change-column">{{ change.column }}:</span>
                          <span class="change-old">{{ formatValue(change.baseValue) }}</span>
                          <mat-icon>arrow_forward</mat-icon>
                          <span class="change-new">{{ formatValue(change.compareValue) }}</span>
                        </div>
                      }
                    </div>
                  } @else if (row.type === 'added' && row.compareRow) {
                    @for (entry of objectEntries(row.compareRow); track entry[0]) {
                      <span class="cell added">
                        <span class="cell-name">{{ entry[0] }}:</span>
                        <span class="cell-value">{{ formatValue(entry[1]) }}</span>
                      </span>
                    }
                  } @else if (row.type === 'removed' && row.baseRow) {
                    @for (entry of objectEntries(row.baseRow); track entry[0]) {
                      <span class="cell removed">
                        <span class="cell-name">{{ entry[0] }}:</span>
                        <span class="cell-value">{{ formatValue(entry[1]) }}</span>
                      </span>
                    }
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Footer -->
      <div class="diff-footer">
        <span class="diff-time">
          Comparison took {{ diff()?.metadata?.comparisonTimeMs || 0 }}ms
        </span>
        <div class="footer-actions">
          <button mat-button (click)="exportDiff()">
            <mat-icon>download</mat-icon>
            Export Diff
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .diff-viewer {
        display: flex;
        flex-direction: column;
        height: 100%;
        background-color: var(--bg-primary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      .diff-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-secondary);
        border-bottom: 1px solid var(--border-primary);

        .diff-title {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          font-weight: 500;

          mat-icon {
            color: var(--accent-primary);
          }
        }

        .diff-controls {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
        }
      }

      .diff-summary {
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);

        .summary-stats {
          margin-bottom: var(--spacing-xs);

          mat-chip-set {
            display: flex;
            gap: var(--spacing-xs);
          }

          mat-chip {
            font-size: var(--font-size-xs);
            min-height: 24px;

            mat-icon {
              font-size: 14px;
              width: 14px;
              height: 14px;
              margin-right: 4px;
            }
          }

          .chip-added {
            --mdc-chip-label-text-color: var(--status-success);
            --mdc-chip-elevated-container-color: rgba(var(--status-success-rgb), 0.1);
          }

          .chip-removed {
            --mdc-chip-label-text-color: var(--status-error);
            --mdc-chip-elevated-container-color: rgba(var(--status-error-rgb), 0.1);
          }

          .chip-modified {
            --mdc-chip-label-text-color: var(--status-warning);
            --mdc-chip-elevated-container-color: rgba(var(--status-warning-rgb), 0.1);
          }

          .chip-unchanged {
            --mdc-chip-label-text-color: var(--text-secondary);
          }
        }

        .summary-meta {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          font-size: var(--font-size-xs);
          color: var(--text-secondary);

          .meta-separator {
            color: var(--text-muted);
          }
        }
      }

      .schema-changes {
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);

        .section-header {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          font-size: var(--font-size-sm);
          font-weight: 500;
          margin-bottom: var(--spacing-xs);

          mat-icon {
            font-size: 16px;
            width: 16px;
            height: 16px;
          }
        }

        .schema-list {
          display: flex;
          flex-wrap: wrap;
          gap: var(--spacing-xs);
        }

        .schema-item {
          font-family: var(--font-mono);
          font-size: var(--font-size-xs);
          padding: 2px 8px;
          border-radius: var(--radius-sm);

          &.added {
            background-color: rgba(var(--status-success-rgb), 0.15);
            color: var(--status-success);
          }

          &.removed {
            background-color: rgba(var(--status-error-rgb), 0.15);
            color: var(--status-error);
          }

          &.modified {
            background-color: rgba(var(--status-warning-rgb), 0.15);
            color: var(--status-warning);
          }
        }
      }

      .diff-content {
        flex: 1;
        overflow: auto;

        &.side-by-side {
          display: grid;
          grid-template-columns: 1fr 1fr;
        }
      }

      .diff-pane {
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--border-primary);

        &:last-child {
          border-right: none;
        }

        .pane-header {
          padding: var(--spacing-xs) var(--spacing-sm);
          font-size: var(--font-size-xs);
          font-weight: 500;
          background-color: var(--bg-secondary);
          border-bottom: 1px solid var(--border-primary);
          text-align: center;
        }

        .pane-content {
          flex: 1;
          overflow: auto;
        }
      }

      .diff-row {
        display: flex;
        align-items: flex-start;
        padding: var(--spacing-xs) var(--spacing-sm);
        border-bottom: 1px solid var(--border-subtle);
        font-size: var(--font-size-xs);
        font-family: var(--font-mono);

        &.added {
          background-color: rgba(var(--status-success-rgb), 0.08);
        }

        &.removed {
          background-color: rgba(var(--status-error-rgb), 0.08);
        }

        &.modified {
          background-color: rgba(var(--status-warning-rgb), 0.08);
        }

        .row-marker {
          width: 24px;
          min-width: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);

          mat-icon {
            font-size: 14px;
            width: 14px;
            height: 14px;
          }

          .line-num {
            font-size: 10px;
          }
        }

        .row-content {
          flex: 1;
          display: flex;
          flex-wrap: wrap;
          gap: var(--spacing-xs);
        }

        .cell {
          display: inline-flex;
          gap: 4px;

          .cell-name {
            color: var(--text-secondary);
          }

          .cell-value {
            color: var(--text-primary);
          }

          &.changed {
            background-color: rgba(var(--status-warning-rgb), 0.2);
            padding: 0 4px;
            border-radius: 2px;
          }

          &.added {
            color: var(--status-success);
          }

          &.removed {
            color: var(--status-error);
            text-decoration: line-through;
          }
        }
      }

      .unified-content {
        .cell-changes {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .cell-change {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);

          .change-column {
            color: var(--text-secondary);
            min-width: 80px;
          }

          .change-old {
            color: var(--status-error);
            text-decoration: line-through;
          }

          .change-new {
            color: var(--status-success);
          }

          mat-icon {
            font-size: 12px;
            width: 12px;
            height: 12px;
            color: var(--text-muted);
          }
        }
      }

      .icon-added {
        color: var(--status-success);
      }
      .icon-removed {
        color: var(--status-error);
      }
      .icon-modified {
        color: var(--status-warning);
      }

      .diff-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-xs) var(--spacing-md);
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);

        .diff-time {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
        }
      }
    `,
  ],
})
export class ResultDiffViewerComponent {
  readonly diff = input.required<ResultDiff>();
  readonly close = output<void>();

  readonly viewMode = signal<ViewMode>('unified');

  readonly hasSchemaChanges = computed(() => {
    const schema = this.diff()?.schemaDiff;
    if (!schema) return false;
    return (
      schema.addedColumns.length > 0 ||
      schema.removedColumns.length > 0 ||
      schema.modifiedColumns.length > 0
    );
  });

  readonly filteredRows = computed(() => {
    const rows = this.diff()?.rowDiffs || [];
    // Filter out unchanged rows for cleaner display
    return rows.filter(r => r.type !== 'unchanged');
  });

  objectEntries(obj: Record<string, unknown>): [string, unknown][] {
    return Object.entries(obj || {});
  }

  isCellChanged(row: RowDiff, column: string): boolean {
    if (row.type !== 'modified' || !row.cellChanges) return false;
    return row.cellChanges.some(c => c.column === column);
  }

  formatValue(value: unknown): string {
    if (value === null) return 'NULL';
    if (value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString();
  }

  exportDiff(): void {
    const diffData = this.diff();
    if (!diffData) return;

    const blob = new Blob([JSON.stringify(diffData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diff-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
