/**
 * Result snapshots: the pin/label/compare history behind the query pane's result-history panel.
 * Every action is a main-process call plus a local list patch — the patch is what lets the panel
 * update without refetching the whole list after a pin or a label.
 *
 * Ported from `packages/renderer/src/app/core/state/query-results.state.ts`. Conventions:
 * `capabilities.ts`. Consumer: Task 14 (result history + inline diff).
 */

import { create } from 'zustand';
import type {
  DiffOptions,
  PurgeOptions,
  PurgeResult,
  QueryResult,
  QueryResultHistoryFilter,
  QueryResultSnapshot,
  ResultDiff,
  ResultHistorySortOptions,
  ResultStorageStats,
} from '@joinery/shared';
import { ipc, isIpcAvailable } from '../ipc';
import { diagnostics, notify } from './diagnostics';

export interface QueryResultsStoreState {
  readonly snapshots: readonly QueryResultSnapshot[];
  readonly loading: boolean;
  readonly stats: ResultStorageStats | null;
  readonly selectedIds: readonly string[];
  readonly currentDiff: ResultDiff | null;
  readonly comparingIds: { baseId: string; compareId: string } | null;

  readonly loadSnapshotsForTab: (tabId: string) => Promise<readonly QueryResultSnapshot[]>;
  readonly loadSnapshots: (
    filter?: QueryResultHistoryFilter,
    sort?: ResultHistorySortOptions
  ) => Promise<void>;
  readonly saveSnapshot: (
    tabId: string,
    sql: string,
    connectionId: string,
    database: string,
    result: QueryResult
  ) => Promise<QueryResultSnapshot | null>;
  readonly getSnapshot: (id: string) => Promise<QueryResultSnapshot | null>;
  readonly deleteSnapshot: (id: string) => Promise<boolean>;
  readonly deleteSnapshots: (ids: readonly string[]) => Promise<number>;
  readonly deleteSelected: () => Promise<number>;
  readonly pinSnapshot: (id: string) => Promise<boolean>;
  readonly unpinSnapshot: (id: string) => Promise<boolean>;
  readonly togglePin: (id: string) => Promise<boolean>;
  readonly labelSnapshot: (id: string, label: string) => Promise<boolean>;
  readonly loadStats: () => Promise<void>;
  readonly purge: (options: PurgeOptions) => Promise<PurgeResult | null>;
  readonly compareSnapshots: (
    baseId: string,
    compareId: string,
    options?: DiffOptions
  ) => Promise<ResultDiff | null>;
  readonly compareSelected: (options?: DiffOptions) => Promise<ResultDiff | null>;
  readonly clearDiff: () => void;

  readonly selectSnapshot: (id: string) => void;
  readonly deselectSnapshot: (id: string) => void;
  readonly toggleSelection: (id: string) => void;
  readonly clearSelection: () => void;
  readonly selectAll: () => void;
}

export type QueryResultsStore = ReturnType<typeof createQueryResultsStore>;

export function createQueryResultsStore() {
  return create<QueryResultsStoreState>()((set, get) => {
    /** Patch one snapshot in place, leaving every other entry's identity alone. */
    const patchSnapshot = (id: string, updates: Partial<QueryResultSnapshot>): void =>
      set(state => ({
        snapshots: state.snapshots.map(s => (s.id === id ? { ...s, ...updates } : s)),
      }));

    return {
      snapshots: [],
      loading: false,
      stats: null,
      selectedIds: [],
      currentDiff: null,
      comparingIds: null,

      loadSnapshotsForTab: async tabId => {
        if (!isIpcAvailable()) return [];
        try {
          set({ loading: true });
          const snapshots = await ipc().queryResults.getSnapshots({ tabId });
          set({ snapshots });
          return snapshots;
        } catch (error) {
          diagnostics.error('failed to load snapshots', error);
          return [];
        } finally {
          set({ loading: false });
        }
      },

      loadSnapshots: async (filter, sort) => {
        if (!isIpcAvailable()) return;
        try {
          set({ loading: true });
          set({ snapshots: await ipc().queryResults.getSnapshots(filter, sort) });
        } catch (error) {
          notify.error('Failed to load result history');
          diagnostics.error('failed to load snapshots', error);
        } finally {
          set({ loading: false });
        }
      },

      saveSnapshot: async (tabId, sql, connectionId, database, result) => {
        if (!isIpcAvailable()) return null;
        try {
          const snapshot = await ipc().queryResults.saveSnapshot(
            tabId,
            sql,
            connectionId,
            database,
            result
          );
          // Newest first, matching the panel's sort.
          set(state => ({ snapshots: [snapshot, ...state.snapshots] }));
          return snapshot;
        } catch (error) {
          diagnostics.error('failed to save result snapshot', error);
          return null;
        }
      },

      getSnapshot: async id => {
        if (!isIpcAvailable()) return null;
        try {
          return await ipc().queryResults.getSnapshot(id);
        } catch (error) {
          diagnostics.error('failed to get snapshot', error);
          return null;
        }
      },

      deleteSnapshot: async id => {
        if (!isIpcAvailable()) return false;
        try {
          const result = await ipc().queryResults.deleteSnapshot(id);
          if (result) {
            set(state => ({
              snapshots: state.snapshots.filter(s => s.id !== id),
              selectedIds: state.selectedIds.filter(i => i !== id),
            }));
          }
          return result;
        } catch (error) {
          notify.error('Failed to delete snapshot');
          diagnostics.error('failed to delete snapshot', error);
          return false;
        }
      },

      deleteSnapshots: async ids => {
        if (!isIpcAvailable()) return 0;
        try {
          const count = await ipc().queryResults.deleteSnapshots([...ids]);
          if (count > 0) {
            const removed = new Set(ids);
            set(state => ({
              snapshots: state.snapshots.filter(s => !removed.has(s.id)),
              selectedIds: state.selectedIds.filter(id => !removed.has(id)),
            }));
            notify.success(`Deleted ${count} snapshot${count > 1 ? 's' : ''}`);
          }
          return count;
        } catch (error) {
          notify.error('Failed to delete snapshots');
          diagnostics.error('failed to delete snapshots', error);
          return 0;
        }
      },

      deleteSelected: () => get().deleteSnapshots(get().selectedIds),

      pinSnapshot: async id => {
        if (!isIpcAvailable()) return false;
        try {
          const result = await ipc().queryResults.pinSnapshot(id);
          if (result) patchSnapshot(id, { isPinned: true });
          return result;
        } catch (error) {
          notify.error('Failed to pin snapshot');
          diagnostics.error('failed to pin snapshot', error);
          return false;
        }
      },

      unpinSnapshot: async id => {
        if (!isIpcAvailable()) return false;
        try {
          const result = await ipc().queryResults.unpinSnapshot(id);
          if (result) patchSnapshot(id, { isPinned: false });
          return result;
        } catch (error) {
          notify.error('Failed to unpin snapshot');
          diagnostics.error('failed to unpin snapshot', error);
          return false;
        }
      },

      togglePin: async id => {
        const snapshot = get().snapshots.find(s => s.id === id);
        if (!snapshot) return false;
        return snapshot.isPinned ? get().unpinSnapshot(id) : get().pinSnapshot(id);
      },

      labelSnapshot: async (id, label) => {
        if (!isIpcAvailable()) return false;
        try {
          const result = await ipc().queryResults.labelSnapshot(id, label);
          // An empty label clears the field rather than storing '' — the panel renders
          // `label ?? sql`, and an empty string is not "no label".
          if (result) patchSnapshot(id, { label: label || undefined });
          return result;
        } catch (error) {
          notify.error('Failed to label snapshot');
          diagnostics.error('failed to label snapshot', error);
          return false;
        }
      },

      loadStats: async () => {
        if (!isIpcAvailable()) return;
        try {
          set({ stats: await ipc().queryResults.getStorageStats() });
        } catch (error) {
          diagnostics.error('failed to load storage stats', error);
        }
      },

      purge: async options => {
        if (!isIpcAvailable()) return null;
        try {
          const result = await ipc().queryResults.purge(options);
          if (result.deletedCount > 0) {
            notify.success(
              `Deleted ${result.deletedCount} snapshot${result.deletedCount > 1 ? 's' : ''}`
            );
            // A purge can touch anything, so re-read rather than patch.
            await get().loadSnapshots();
            await get().loadStats();
          }
          return result;
        } catch (error) {
          notify.error('Failed to purge snapshots');
          diagnostics.error('failed to purge snapshots', error);
          return null;
        }
      },

      compareSnapshots: async (baseId, compareId, options) => {
        if (!isIpcAvailable()) return null;
        try {
          set({ comparingIds: { baseId, compareId } });
          const diff = await ipc().queryResults.compareSnapshots(baseId, compareId, options);
          set({ currentDiff: diff });
          return diff;
        } catch (error) {
          notify.error('Failed to compare snapshots');
          diagnostics.error('failed to compare snapshots', error);
          return null;
        }
      },

      compareSelected: async options => {
        const ids = get().selectedIds;
        const [baseId, compareId] = ids;
        if (ids.length !== 2 || baseId === undefined || compareId === undefined) {
          notify.error('Select exactly 2 snapshots to compare');
          return null;
        }
        return get().compareSnapshots(baseId, compareId, options);
      },

      clearDiff: () => set({ currentDiff: null, comparingIds: null }),

      selectSnapshot: id => set(state => ({ selectedIds: [...state.selectedIds, id] })),
      deselectSnapshot: id =>
        set(state => ({ selectedIds: state.selectedIds.filter(i => i !== id) })),
      toggleSelection: id => {
        if (get().selectedIds.includes(id)) {
          get().deselectSnapshot(id);
        } else {
          get().selectSnapshot(id);
        }
      },
      clearSelection: () => set({ selectedIds: [] }),
      selectAll: () => set(state => ({ selectedIds: state.snapshots.map(s => s.id) })),
    };
  });
}

export const queryResultsStore = createQueryResultsStore();
export const useQueryResultsStore = queryResultsStore;

export function selectHasSnapshots(state: Pick<QueryResultsStoreState, 'snapshots'>): boolean {
  return state.snapshots.length > 0;
}

/** Fresh array — subscribe with `useShallow`. */
export function selectSelectedSnapshots(
  state: Pick<QueryResultsStoreState, 'snapshots' | 'selectedIds'>
): readonly QueryResultSnapshot[] {
  const ids = new Set(state.selectedIds);
  return state.snapshots.filter(s => ids.has(s.id));
}

export function selectSelectedCount(state: Pick<QueryResultsStoreState, 'selectedIds'>): number {
  return state.selectedIds.length;
}

export function selectCanCompare(state: Pick<QueryResultsStoreState, 'selectedIds'>): boolean {
  return state.selectedIds.length === 2;
}

/** Fresh array — subscribe with `useShallow`. */
export function selectPinnedSnapshots(
  state: Pick<QueryResultsStoreState, 'snapshots'>
): readonly QueryResultSnapshot[] {
  return state.snapshots.filter(s => s.isPinned);
}

export function selectTotalStorageSize(state: Pick<QueryResultsStoreState, 'stats'>): number {
  return state.stats?.totalSizeBytes ?? 0;
}

/** Selection membership, for a row that must not re-render when another row is selected. */
export function selectIsSnapshotSelected(id: string) {
  return (state: Pick<QueryResultsStoreState, 'selectedIds'>): boolean =>
    state.selectedIds.includes(id);
}
