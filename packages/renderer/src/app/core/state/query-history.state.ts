/**
 * Query History State Service
 * Manages query history state for the application
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { QueryHistoryEntry, QueryHistoryFilter } from '@forgedb/shared';
import { IpcService } from '../services/ipc.service';

@Injectable({ providedIn: 'root' })
export class QueryHistoryStateService {
  private readonly ipc = inject(IpcService);

  // State signals
  private readonly _entries = signal<QueryHistoryEntry[]>([]);
  private readonly _loading = signal(false);
  private readonly _filter = signal<QueryHistoryFilter>({ limit: 100 });

  // Public computed values
  readonly entries = this._entries.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly filter = this._filter.asReadonly();

  // Computed: filtered count
  readonly count = computed(() => this._entries().length);

  // Computed: recent entries (last 10)
  readonly recentEntries = computed(() => this._entries().slice(0, 10));

  // Computed: successful queries only
  readonly successfulQueries = computed(() => this._entries().filter(e => e.success));

  // Computed: failed queries only
  readonly failedQueries = computed(() => this._entries().filter(e => !e.success));

  // Computed: unique connections in history
  readonly uniqueConnections = computed(() => {
    const connections = new Map<string, string>();
    for (const entry of this._entries()) {
      if (!connections.has(entry.connectionId)) {
        connections.set(entry.connectionId, entry.connectionName);
      }
    }
    return Array.from(connections.entries()).map(([id, name]) => ({ id, name }));
  });

  // Computed: unique databases in history
  readonly uniqueDatabases = computed(() => {
    const databases = new Set<string>();
    for (const entry of this._entries()) {
      databases.add(entry.database);
    }
    return Array.from(databases).sort();
  });

  /**
   * Load query history from the main process
   */
  async loadHistory(filter?: QueryHistoryFilter): Promise<void> {
    this._loading.set(true);

    if (filter) {
      this._filter.set(filter);
    }

    try {
      const entries = await firstValueFrom(this.ipc.getQueryHistory(this._filter()));
      this._entries.set(entries || []);
    } catch (error) {
      console.error('Failed to load query history:', error);
      this._entries.set([]);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Update filter and reload
   */
  async setFilter(filter: Partial<QueryHistoryFilter>): Promise<void> {
    this._filter.update(current => ({ ...current, ...filter }));
    await this.loadHistory();
  }

  /**
   * Clear all history
   */
  async clearHistory(): Promise<void> {
    try {
      await firstValueFrom(this.ipc.clearQueryHistory());
      this._entries.set([]);
    } catch (error) {
      console.error('Failed to clear query history:', error);
      throw error;
    }
  }

  /**
   * Delete a single history entry
   */
  async deleteEntry(id: string): Promise<boolean> {
    try {
      const result = await firstValueFrom(this.ipc.deleteQueryHistoryEntry(id));
      if (result) {
        this._entries.update(entries => entries.filter(e => e.id !== id));
      }
      return result ?? false;
    } catch (error) {
      console.error('Failed to delete history entry:', error);
      return false;
    }
  }

  /**
   * Search history
   */
  async search(searchText: string): Promise<void> {
    await this.setFilter({ searchText: searchText || undefined });
  }

  /**
   * Filter by connection
   */
  async filterByConnection(connectionId: string | undefined): Promise<void> {
    await this.setFilter({ connectionId });
  }

  /**
   * Filter by database
   */
  async filterByDatabase(database: string | undefined): Promise<void> {
    await this.setFilter({ database });
  }

  /**
   * Filter by success/failure
   */
  async filterBySuccess(successOnly: boolean | undefined): Promise<void> {
    await this.setFilter({ successOnly });
  }

  /**
   * Reset all filters
   */
  async resetFilters(): Promise<void> {
    this._filter.set({ limit: 100 });
    await this.loadHistory();
  }
}
