/**
 * Query History Dialog Component
 *
 * A searchable dialog for browsing and reusing previously executed queries.
 * - Real-time filtering via search input
 * - Click to load in a new tab, double-click to execute immediately
 * - Shows SQL preview, database, timestamp, duration, and status
 * - Clear history button
 */

import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import type { QueryHistoryEntry } from '@joinery/shared';
import { QueryHistoryStateService } from '../../../core/state/query-history.state';
import type { QueryHistoryDialogResult } from '../../../core/services/query-history.service';

@Component({
  selector: 'app-query-history-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    MatDividerModule,
  ],
  template: `
    <div class="query-history-dialog">
      <div class="dialog-header">
        <div class="header-title">
          <mat-icon>history</mat-icon>
          <h2>Query History</h2>
        </div>
        <div class="header-actions">
          <span class="entry-count">{{ filteredEntries().length }} queries</span>
          <button
            mat-icon-button
            matTooltip="Clear all history"
            (click)="clearHistory()"
            [disabled]="historyState.count() === 0"
          >
            <mat-icon>delete_sweep</mat-icon>
          </button>
          <button mat-icon-button matTooltip="Close" (click)="close()">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      </div>

      <div class="search-container">
        <mat-form-field appearance="outline" class="search-field">
          <mat-icon matPrefix>search</mat-icon>
          <input
            #searchInput
            matInput
            placeholder="Search queries..."
            [(ngModel)]="searchText"
            (ngModelChange)="onSearchChange($event)"
          />
          @if (searchText) {
            <button mat-icon-button matSuffix (click)="clearSearch()">
              <mat-icon>clear</mat-icon>
            </button>
          }
        </mat-form-field>
      </div>

      <mat-divider />

      <div class="history-list" #historyList>
        @if (historyState.loading()) {
          <div class="empty-state">
            <mat-icon>hourglass_empty</mat-icon>
            <p>Loading history...</p>
          </div>
        } @else if (filteredEntries().length === 0) {
          <div class="empty-state">
            @if (searchText) {
              <mat-icon>search_off</mat-icon>
              <p>No queries match "{{ searchText }}"</p>
            } @else {
              <mat-icon>history</mat-icon>
              <p>No queries in history</p>
              <span class="hint">Execute a query to see it here</span>
            }
          </div>
        } @else {
          @for (entry of filteredEntries(); track entry.id; let i = $index) {
            <div
              class="history-entry"
              [class.selected]="selectedIndex() === i"
              [class.error]="!entry.success"
              (click)="selectEntry(i)"
              (dblclick)="executeEntry(entry)"
              (mouseenter)="selectedIndex.set(i)"
            >
              <div class="entry-status">
                @if (entry.success) {
                  <mat-icon class="status-icon success">check_circle</mat-icon>
                } @else {
                  <mat-icon class="status-icon error">error</mat-icon>
                }
              </div>

              <div class="entry-content">
                <pre class="entry-sql">{{ truncateSql(entry.sql) }}</pre>
                <div class="entry-meta">
                  <span class="meta-item database">
                    <mat-icon>storage</mat-icon>
                    {{ entry.database }}
                  </span>
                  <span class="meta-item timestamp">
                    <mat-icon>schedule</mat-icon>
                    {{ formatTime(entry.executedAt) }}
                  </span>
                  <span class="meta-item duration">
                    <mat-icon>timer</mat-icon>
                    {{ formatDuration(entry.executionTimeMs) }}
                  </span>
                  @if (entry.success && entry.rowCount !== undefined) {
                    <span class="meta-item rows">
                      <mat-icon>table_rows</mat-icon>
                      {{ entry.rowCount }} rows
                    </span>
                  }
                  @if (!entry.success && entry.error) {
                    <span class="meta-item error-text" [matTooltip]="entry.error">
                      {{ truncateError(entry.error) }}
                    </span>
                  }
                </div>
              </div>

              <div class="entry-actions">
                <button
                  mat-icon-button
                  matTooltip="Open in new tab"
                  (click)="loadEntry(entry); $event.stopPropagation()"
                >
                  <mat-icon>open_in_new</mat-icon>
                </button>
                <button
                  mat-icon-button
                  matTooltip="Execute immediately"
                  (click)="executeEntry(entry); $event.stopPropagation()"
                >
                  <mat-icon>play_arrow</mat-icon>
                </button>
              </div>
            </div>
          }
        }
      </div>

      <mat-divider />

      <div class="dialog-footer">
        <span class="footer-hint">Click to open in new tab, double-click to execute</span>
        <div class="footer-shortcuts">
          <kbd>Enter</kbd> open <kbd>Shift+Enter</kbd> execute <kbd>Esc</kbd> close
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .query-history-dialog {
        display: flex;
        flex-direction: column;
        max-height: 80vh;
      }

      .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--border-primary);

        .header-title {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);

          mat-icon {
            color: var(--accent-primary);
          }

          h2 {
            margin: 0;
            font-size: var(--font-size-lg);
            font-weight: 600;
          }
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
        }

        .entry-count {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          padding: 2px 8px;
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-full, 100px);
        }
      }

      .search-container {
        padding: var(--spacing-sm) var(--spacing-lg);
      }

      .search-field {
        width: 100%;

        ::ng-deep .mat-mdc-form-field-subscript-wrapper {
          display: none;
        }

        mat-icon[matPrefix] {
          color: var(--text-muted);
          margin-right: var(--spacing-xs);
        }
      }

      .history-list {
        flex: 1;
        overflow-y: auto;
        min-height: 200px;
        max-height: 50vh;
        padding: var(--spacing-xs);
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl) var(--spacing-md);
        color: var(--text-muted);

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          margin-bottom: var(--spacing-sm);
          opacity: 0.5;
        }

        p {
          margin: 0 0 var(--spacing-xs);
          font-size: var(--font-size-md);
        }

        .hint {
          font-size: var(--font-size-xs);
        }
      }

      .history-entry {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        margin-bottom: 2px;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background-color var(--transition-fast);
        border: 1px solid transparent;

        &:hover,
        &.selected {
          background-color: var(--bg-hover);
        }

        &.selected {
          border-color: var(--accent-primary);
        }

        &.error {
          .entry-sql {
            color: var(--text-secondary);
          }
        }

        .entry-actions {
          display: none;
          flex-shrink: 0;
        }

        &:hover .entry-actions {
          display: flex;
        }
      }

      .entry-status {
        flex-shrink: 0;
        padding-top: 2px;

        .status-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;

          &.success {
            color: var(--status-success, #4caf50);
          }

          &.error {
            color: var(--status-error, #f44336);
          }
        }
      }

      .entry-content {
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }

      .entry-sql {
        margin: 0;
        font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
        font-size: var(--font-size-sm, 12px);
        line-height: 1.4;
        color: var(--text-primary);
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 3.6em;
        overflow: hidden;
      }

      .entry-meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-xs);

        .meta-item {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          font-size: var(--font-size-xs, 11px);
          color: var(--text-secondary);

          mat-icon {
            font-size: 12px;
            width: 12px;
            height: 12px;
          }

          &.database {
            color: var(--accent-primary);
            font-weight: 500;
          }

          &.error-text {
            color: var(--status-error, #f44336);
          }
        }
      }

      .entry-actions {
        flex-shrink: 0;

        button {
          width: 28px;
          height: 28px;

          mat-icon {
            font-size: 16px;
            width: 16px;
            height: 16px;
          }
        }
      }

      .dialog-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-lg);
        background-color: var(--bg-tertiary);

        .footer-hint {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
        }

        .footer-shortcuts {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          font-size: var(--font-size-xs);
          color: var(--text-muted);

          kbd {
            padding: 1px 5px;
            font-family: inherit;
            font-size: 10px;
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-primary);
            border-radius: var(--radius-sm);
          }
        }
      }
    `,
  ],
})
export class QueryHistoryDialogComponent implements OnInit, OnDestroy {
  readonly historyState = inject(QueryHistoryStateService);
  private readonly dialogRef = inject(MatDialogRef<QueryHistoryDialogComponent>);

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;
  @ViewChild('historyList') historyListRef?: ElementRef<HTMLElement>;

  searchText = '';
  readonly selectedIndex = signal(0);

  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private keydownHandler!: (event: KeyboardEvent) => void;

  /** Local filtered entries computed from state + search text */
  private readonly _localSearchText = signal('');

  readonly filteredEntries = computed(() => {
    const entries = this.historyState.entries();
    const term = this._localSearchText().toLowerCase().trim();

    if (!term) return entries;

    return entries.filter(
      e =>
        e.sql.toLowerCase().includes(term) ||
        e.database.toLowerCase().includes(term) ||
        e.connectionName.toLowerCase().includes(term)
    );
  });

  ngOnInit(): void {
    // Focus search input after view renders
    setTimeout(() => {
      this.searchInput?.nativeElement?.focus();
    }, 100);

    // Register keyboard handler
    this.keydownHandler = (event: KeyboardEvent) => this.onKeyDown(event);
    document.addEventListener('keydown', this.keydownHandler, true);
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.keydownHandler, true);
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
  }

  onSearchChange(value: string): void {
    // Debounce the search for smooth typing
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = setTimeout(() => {
      this._localSearchText.set(value);
      this.selectedIndex.set(0);
      // Also trigger remote search for comprehensive results
      this.historyState.search(value);
    }, 200);
  }

  clearSearch(): void {
    this.searchText = '';
    this._localSearchText.set('');
    this.selectedIndex.set(0);
    this.historyState.loadHistory();
  }

  selectEntry(index: number): void {
    this.selectedIndex.set(index);
  }

  /** Single click: load query in new tab */
  loadEntry(entry: QueryHistoryEntry): void {
    const result: QueryHistoryDialogResult = { action: 'load', entry };
    this.dialogRef.close(result);
  }

  /** Double click: execute query immediately */
  executeEntry(entry: QueryHistoryEntry): void {
    const result: QueryHistoryDialogResult = { action: 'execute', entry };
    this.dialogRef.close(result);
  }

  async clearHistory(): Promise<void> {
    try {
      await this.historyState.clearHistory();
    } catch {
      // Handled by state service
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const entries = this.filteredEntries();

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.close();
        break;

      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.update(i => Math.min(i + 1, entries.length - 1));
        this.scrollSelectedIntoView();
        break;

      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.update(i => Math.max(i - 1, 0));
        this.scrollSelectedIntoView();
        break;

      case 'Enter': {
        event.preventDefault();
        const selected = entries[this.selectedIndex()];
        if (!selected) break;

        if (event.shiftKey) {
          this.executeEntry(selected);
        } else {
          this.loadEntry(selected);
        }
        break;
      }
    }
  }

  private scrollSelectedIntoView(): void {
    // Scroll the selected item into view after a brief delay for the DOM to update
    setTimeout(() => {
      const container = this.historyListRef?.nativeElement;
      const selected = container?.querySelector('.history-entry.selected');
      selected?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 10);
  }

  truncateSql(sql: string): string {
    const firstLine = sql.split('\n')[0].trim();
    const maxLength = 120;
    if (firstLine.length <= maxLength) return firstLine;
    return firstLine.substring(0, maxLength) + '...';
  }

  truncateError(error: string): string {
    const maxLength = 60;
    if (error.length <= maxLength) return error;
    return error.substring(0, maxLength) + '...';
  }

  formatTime(isoDate: string): string {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }
}
