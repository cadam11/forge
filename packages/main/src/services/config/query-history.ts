/**
 * Query History Storage
 * Stores executed query history with metadata
 */

import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import type { QueryHistoryEntry, QueryHistoryFilter } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { createTrailingDebounce, type TrailingDebounce } from '../../utils/trailing-debounce';

interface QueryHistorySchema {
  entries: QueryHistoryEntry[];
  version: number;
}

const MAX_HISTORY_ENTRIES = 1000;
const PERSIST_DEBOUNCE_MS = 500;

export class QueryHistoryStore extends BaseSingleton {
  private store: Store<QueryHistorySchema>;
  /**
   * Source of truth at runtime. electron-store writes synchronously on the
   * main thread (full re-serialize per set), so per-execution writes are
   * debounced; index.ts flushes on before-quit.
   */
  private entries: QueryHistoryEntry[];
  private persist: TrailingDebounce;

  constructor() {
    super();
    this.store = new Store<QueryHistorySchema>({
      name: 'query-history',
      defaults: {
        entries: [],
        version: 1,
      },
    });
    this.entries = this.store.get('entries', []);
    this.persist = createTrailingDebounce(
      () => this.store.set('entries', this.entries),
      PERSIST_DEBOUNCE_MS
    );
  }

  /** Write any pending mutations to disk now. Called on app quit. */
  flush(): void {
    this.persist.flush();
  }

  /**
   * Add a query to history
   */
  add(entry: Omit<QueryHistoryEntry, 'id'>): QueryHistoryEntry {
    const newEntry: QueryHistoryEntry = {
      ...entry,
      id: uuidv4(),
    };

    // Add to beginning of array (most recent first)
    this.entries.unshift(newEntry);

    // Trim to max entries
    if (this.entries.length > MAX_HISTORY_ENTRIES) {
      this.entries.splice(MAX_HISTORY_ENTRIES);
    }

    this.persist.call();
    return newEntry;
  }

  /**
   * Get query history with optional filtering
   */
  getHistory(filter?: QueryHistoryFilter): QueryHistoryEntry[] {
    let entries = [...this.entries];

    if (filter) {
      if (filter.connectionId) {
        entries = entries.filter(e => e.connectionId === filter.connectionId);
      }

      if (filter.database) {
        entries = entries.filter(e => e.database.toLowerCase() === filter.database!.toLowerCase());
      }

      if (filter.searchText) {
        const searchLower = filter.searchText.toLowerCase();
        entries = entries.filter(
          e =>
            e.sql.toLowerCase().includes(searchLower) ||
            e.connectionName.toLowerCase().includes(searchLower) ||
            e.database.toLowerCase().includes(searchLower)
        );
      }

      if (filter.startDate) {
        const start = new Date(filter.startDate);
        entries = entries.filter(e => new Date(e.executedAt) >= start);
      }

      if (filter.endDate) {
        const end = new Date(filter.endDate);
        entries = entries.filter(e => new Date(e.executedAt) <= end);
      }

      if (filter.successOnly) {
        entries = entries.filter(e => e.success);
      }

      if (filter.limit && filter.limit > 0) {
        entries = entries.slice(0, filter.limit);
      }
    }

    return entries;
  }

  /**
   * Delete a single history entry
   */
  deleteEntry(id: string): boolean {
    const index = this.entries.findIndex(e => e.id === id);

    if (index === -1) {
      return false;
    }

    this.entries.splice(index, 1);
    this.persist.call();
    return true;
  }

  /**
   * Clear all history
   */
  clearAll(): void {
    this.entries = [];
    this.persist.call();
  }

  /**
   * Clear history for a specific connection
   */
  clearForConnection(connectionId: string): number {
    const before = this.entries.length;
    this.entries = this.entries.filter(e => e.connectionId !== connectionId);
    this.persist.call();
    return before - this.entries.length;
  }

  /**
   * Get unique databases from history
   */
  getUniqueDatabases(): string[] {
    const databases = new Set(this.entries.map(e => e.database));
    return Array.from(databases).sort();
  }

  /**
   * Get history count
   */
  getCount(): number {
    return this.entries.length;
  }
}
