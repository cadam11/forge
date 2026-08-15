/**
 * Query History Service
 *
 * Convenience service that wraps QueryHistoryStateService and provides
 * dialog-opening capabilities. Serves as the single entry point for
 * query history operations in the renderer process.
 *
 * History entries are automatically recorded by the main process on each
 * query execution (see packages/main/src/ipc/query.ipc.ts). This service
 * provides search, retrieval, and the ability to open the history dialog.
 */

import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import type { QueryHistoryEntry } from '@joinery/shared';
import { QueryHistoryStateService } from '../state/query-history.state';
import { TabStateService } from '../state/tab.state';
import { ConnectionStateService } from '../state/connection.state';
import { NotificationService } from './notification.service';
import { QueryHistoryDialogComponent } from '../../shared/components/query-history-dialog/query-history-dialog.component';

export interface QueryHistoryDialogResult {
  action: 'load' | 'execute';
  entry: QueryHistoryEntry;
}

@Injectable({ providedIn: 'root' })
export class QueryHistoryService {
  private readonly historyState = inject(QueryHistoryStateService);
  private readonly dialog = inject(MatDialog);
  private readonly tabState = inject(TabStateService);
  private readonly connectionState = inject(ConnectionStateService);
  private readonly notification = inject(NotificationService);

  /** Expose state signals for consumers */
  readonly entries = this.historyState.entries;
  readonly loading = this.historyState.loading;
  readonly count = this.historyState.count;
  readonly recentEntries = this.historyState.recentEntries;

  /**
   * Load history entries from main process storage
   */
  async loadHistory(): Promise<void> {
    await this.historyState.loadHistory();
  }

  /**
   * Search history by text
   */
  async searchHistory(term: string): Promise<void> {
    await this.historyState.search(term);
  }

  /**
   * Clear all history entries
   */
  async clearHistory(): Promise<void> {
    await this.historyState.clearHistory();
  }

  /**
   * Delete a single history entry
   */
  async deleteEntry(id: string): Promise<boolean> {
    return this.historyState.deleteEntry(id);
  }

  /**
   * Open a history entry in a new query tab
   */
  openInNewTab(entry: QueryHistoryEntry): void {
    const connectionId = this.connectionState.focusedConnectionId();
    const database = entry.database || this.connectionState.selectedDatabaseFor(connectionId);

    if (!connectionId) {
      this.notification.warning('No active connection');
      return;
    }

    this.tabState.openQueryTab(connectionId, database || 'master', entry.sql);
    this.notification.info('Query loaded in new tab');
  }

  /**
   * Open a history entry in a new tab and execute immediately
   */
  executeFromHistory(entry: QueryHistoryEntry): void {
    const connectionId = this.connectionState.focusedConnectionId();
    const database = entry.database || this.connectionState.selectedDatabaseFor(connectionId);

    if (!connectionId) {
      this.notification.warning('No active connection');
      return;
    }

    this.tabState.openQueryTab(connectionId, database || 'master', entry.sql, true);
  }

  /**
   * Open the query history dialog.
   */
  async openHistoryDialog(): Promise<void> {
    // Ensure history is loaded before opening dialog
    await this.loadHistory();

    const dialogRef = this.dialog.open(QueryHistoryDialogComponent, {
      width: '720px',
      maxHeight: '80vh',
      panelClass: 'query-history-dialog-panel',
      autoFocus: false,
    });

    dialogRef.afterClosed().subscribe((result: QueryHistoryDialogResult | undefined) => {
      if (!result) return;

      if (result.action === 'execute') {
        this.executeFromHistory(result.entry);
      } else {
        this.openInNewTab(result.entry);
      }
    });
  }
}
