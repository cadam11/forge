import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  QueryResultSnapshot,
  QueryResultHistoryFilter,
  ResultHistorySortOptions,
  PurgeOptions,
  PurgeResult,
  ResultStorageStats,
  ResultDiff,
  DiffOptions,
  QueryResult,
} from '@forgedb/shared';
import { IpcService } from '../services/ipc.service';
import { NotificationService } from '../services/notification.service';
import { firstValueFrom } from 'rxjs';

export interface QueryResultsState {
  snapshots: QueryResultSnapshot[];
  loading: boolean;
  stats: ResultStorageStats | null;
  selectedSnapshotIds: string[];
  currentDiff: ResultDiff | null;
  comparingIds: { baseId: string; compareId: string } | null;
}

@Injectable({ providedIn: 'root' })
export class QueryResultsStateService {
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);

  // State signals
  private readonly _snapshots = signal<QueryResultSnapshot[]>([]);
  private readonly _loading = signal(false);
  private readonly _stats = signal<ResultStorageStats | null>(null);
  private readonly _selectedIds = signal<string[]>([]);
  private readonly _currentDiff = signal<ResultDiff | null>(null);
  private readonly _comparingIds = signal<{ baseId: string; compareId: string } | null>(null);

  // Public readonly signals
  readonly snapshots = this._snapshots.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly stats = this._stats.asReadonly();
  readonly selectedIds = this._selectedIds.asReadonly();
  readonly currentDiff = this._currentDiff.asReadonly();
  readonly comparingIds = this._comparingIds.asReadonly();

  // Computed signals
  readonly hasSnapshots = computed(() => this._snapshots().length > 0);
  readonly selectedSnapshots = computed(() => {
    const ids = new Set(this._selectedIds());
    return this._snapshots().filter(s => ids.has(s.id));
  });
  readonly selectedCount = computed(() => this._selectedIds().length);
  readonly canCompare = computed(() => this._selectedIds().length === 2);
  readonly pinnedSnapshots = computed(() => this._snapshots().filter(s => s.isPinned));
  readonly totalStorageSize = computed(() => this._stats()?.totalSizeBytes ?? 0);

  /**
   * Load snapshots for a specific tab
   */
  async loadSnapshotsForTab(tabId: string): Promise<QueryResultSnapshot[]> {
    if (!this.ipc.isAvailable) return [];

    try {
      this._loading.set(true);
      const snapshots = await firstValueFrom(this.ipc.getResultSnapshots({ tabId }));
      this._snapshots.set(snapshots);
      return snapshots;
    } catch (error) {
      console.error('Failed to load snapshots:', error);
      return [];
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Load all snapshots with optional filtering and sorting
   */
  async loadSnapshots(
    filter?: QueryResultHistoryFilter,
    sort?: ResultHistorySortOptions
  ): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      this._loading.set(true);
      const snapshots = await firstValueFrom(this.ipc.getResultSnapshots(filter, sort));
      this._snapshots.set(snapshots);
    } catch (error) {
      this.notification.error('Failed to load result history');
      console.error('Failed to load snapshots:', error);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Save a new result snapshot
   */
  async saveSnapshot(
    tabId: string,
    sql: string,
    connectionId: string,
    database: string,
    result: QueryResult
  ): Promise<QueryResultSnapshot | null> {
    if (!this.ipc.isAvailable) return null;

    try {
      const snapshot = await firstValueFrom(
        this.ipc.saveResultSnapshot(tabId, sql, connectionId, database, result)
      );
      // Add to beginning of list
      this._snapshots.update(snapshots => [snapshot, ...snapshots]);
      return snapshot;
    } catch (error) {
      console.error('Failed to save result snapshot:', error);
      return null;
    }
  }

  /**
   * Get a single snapshot by ID
   */
  async getSnapshot(id: string): Promise<QueryResultSnapshot | null> {
    if (!this.ipc.isAvailable) return null;

    try {
      return await firstValueFrom(this.ipc.getResultSnapshot(id));
    } catch (error) {
      console.error('Failed to get snapshot:', error);
      return null;
    }
  }

  /**
   * Delete a single snapshot
   */
  async deleteSnapshot(id: string): Promise<boolean> {
    if (!this.ipc.isAvailable) return false;

    try {
      const result = await firstValueFrom(this.ipc.deleteResultSnapshot(id));
      if (result) {
        this._snapshots.update(snapshots => snapshots.filter(s => s.id !== id));
        this._selectedIds.update(ids => ids.filter(i => i !== id));
      }
      return result;
    } catch (error) {
      this.notification.error('Failed to delete snapshot');
      console.error('Failed to delete snapshot:', error);
      return false;
    }
  }

  /**
   * Delete multiple snapshots
   */
  async deleteSnapshots(ids: string[]): Promise<number> {
    if (!this.ipc.isAvailable) return 0;

    try {
      const count = await firstValueFrom(this.ipc.deleteResultSnapshots(ids));
      if (count > 0) {
        const idSet = new Set(ids);
        this._snapshots.update(snapshots => snapshots.filter(s => !idSet.has(s.id)));
        this._selectedIds.update(selected => selected.filter(id => !idSet.has(id)));
        this.notification.success(`Deleted ${count} snapshot${count > 1 ? 's' : ''}`);
      }
      return count;
    } catch (error) {
      this.notification.error('Failed to delete snapshots');
      console.error('Failed to delete snapshots:', error);
      return 0;
    }
  }

  /**
   * Delete selected snapshots
   */
  async deleteSelected(): Promise<number> {
    return this.deleteSnapshots(this._selectedIds());
  }

  /**
   * Pin a snapshot
   */
  async pinSnapshot(id: string): Promise<boolean> {
    if (!this.ipc.isAvailable) return false;

    try {
      const result = await firstValueFrom(this.ipc.pinResultSnapshot(id));
      if (result) {
        this._snapshots.update(snapshots =>
          snapshots.map(s => (s.id === id ? { ...s, isPinned: true } : s))
        );
      }
      return result;
    } catch (error) {
      this.notification.error('Failed to pin snapshot');
      console.error('Failed to pin snapshot:', error);
      return false;
    }
  }

  /**
   * Unpin a snapshot
   */
  async unpinSnapshot(id: string): Promise<boolean> {
    if (!this.ipc.isAvailable) return false;

    try {
      const result = await firstValueFrom(this.ipc.unpinResultSnapshot(id));
      if (result) {
        this._snapshots.update(snapshots =>
          snapshots.map(s => (s.id === id ? { ...s, isPinned: false } : s))
        );
      }
      return result;
    } catch (error) {
      this.notification.error('Failed to unpin snapshot');
      console.error('Failed to unpin snapshot:', error);
      return false;
    }
  }

  /**
   * Toggle pin state
   */
  async togglePin(id: string): Promise<boolean> {
    const snapshot = this._snapshots().find(s => s.id === id);
    if (!snapshot) return false;
    return snapshot.isPinned ? this.unpinSnapshot(id) : this.pinSnapshot(id);
  }

  /**
   * Label a snapshot
   */
  async labelSnapshot(id: string, label: string): Promise<boolean> {
    if (!this.ipc.isAvailable) return false;

    try {
      const result = await firstValueFrom(this.ipc.labelResultSnapshot(id, label));
      if (result) {
        this._snapshots.update(snapshots =>
          snapshots.map(s => (s.id === id ? { ...s, label: label || undefined } : s))
        );
      }
      return result;
    } catch (error) {
      this.notification.error('Failed to label snapshot');
      console.error('Failed to label snapshot:', error);
      return false;
    }
  }

  /**
   * Load storage statistics
   */
  async loadStats(): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      const stats = await firstValueFrom(this.ipc.getResultStorageStats());
      this._stats.set(stats);
    } catch (error) {
      console.error('Failed to load storage stats:', error);
    }
  }

  /**
   * Purge snapshots
   */
  async purge(options: PurgeOptions): Promise<PurgeResult | null> {
    if (!this.ipc.isAvailable) return null;

    try {
      const result = await firstValueFrom(this.ipc.purgeResultSnapshots(options));
      if (result.deletedCount > 0) {
        this.notification.success(
          `Deleted ${result.deletedCount} snapshot${result.deletedCount > 1 ? 's' : ''}`
        );
        // Reload snapshots and stats
        await this.loadSnapshots();
        await this.loadStats();
      }
      return result;
    } catch (error) {
      this.notification.error('Failed to purge snapshots');
      console.error('Failed to purge snapshots:', error);
      return null;
    }
  }

  /**
   * Compare two snapshots
   */
  async compareSnapshots(
    baseId: string,
    compareId: string,
    options?: DiffOptions
  ): Promise<ResultDiff | null> {
    if (!this.ipc.isAvailable) return null;

    try {
      this._comparingIds.set({ baseId, compareId });
      const diff = await firstValueFrom(
        this.ipc.compareResultSnapshots(baseId, compareId, options)
      );
      this._currentDiff.set(diff);
      return diff;
    } catch (error) {
      this.notification.error('Failed to compare snapshots');
      console.error('Failed to compare snapshots:', error);
      return null;
    }
  }

  /**
   * Compare selected snapshots (must have exactly 2 selected)
   */
  async compareSelected(options?: DiffOptions): Promise<ResultDiff | null> {
    const ids = this._selectedIds();
    if (ids.length !== 2) {
      this.notification.error('Select exactly 2 snapshots to compare');
      return null;
    }
    return this.compareSnapshots(ids[0], ids[1], options);
  }

  /**
   * Clear current diff
   */
  clearDiff(): void {
    this._currentDiff.set(null);
    this._comparingIds.set(null);
  }

  // Selection management
  selectSnapshot(id: string): void {
    this._selectedIds.update(ids => [...ids, id]);
  }

  deselectSnapshot(id: string): void {
    this._selectedIds.update(ids => ids.filter(i => i !== id));
  }

  toggleSelection(id: string): void {
    const ids = this._selectedIds();
    if (ids.includes(id)) {
      this.deselectSnapshot(id);
    } else {
      this.selectSnapshot(id);
    }
  }

  isSelected(id: string): boolean {
    return this._selectedIds().includes(id);
  }

  clearSelection(): void {
    this._selectedIds.set([]);
  }

  selectAll(): void {
    this._selectedIds.set(this._snapshots().map(s => s.id));
  }
}
