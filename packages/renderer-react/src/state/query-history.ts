/**
 * Query history: the persisted list of executed statements, the filter applied to it, and the
 * derived roll-ups the history dialog offers as filter options.
 *
 * Ported from `packages/renderer/src/app/core/state/query-history.state.ts`. Conventions:
 * `capabilities.ts`. Consumers: Task 16 (the query-history dialog), Task 10 (the toolbar entry).
 *
 * Unlike its neighbours this store never guarded on bridge availability, and that is preserved:
 * every action reports its own failure and leaves the list empty, which is the same observable
 * behaviour a browser-mode guard would produce.
 */

import { create } from 'zustand';
import type { QueryHistoryEntry, QueryHistoryFilter } from '@joinery/shared';
import { ipc } from '../ipc';
import { diagnostics } from './diagnostics';

const DEFAULT_FILTER: QueryHistoryFilter = { limit: 100 };

export interface QueryHistoryStoreState {
  readonly entries: readonly QueryHistoryEntry[];
  readonly loading: boolean;
  readonly filter: QueryHistoryFilter;

  readonly loadHistory: (filter?: QueryHistoryFilter) => Promise<void>;
  readonly setFilter: (filter: Partial<QueryHistoryFilter>) => Promise<void>;
  readonly clearHistory: () => Promise<void>;
  readonly deleteEntry: (id: string) => Promise<boolean>;
  readonly search: (searchText: string) => Promise<void>;
  readonly filterByConnection: (connectionId: string | undefined) => Promise<void>;
  readonly filterByDatabase: (database: string | undefined) => Promise<void>;
  readonly filterBySuccess: (successOnly: boolean | undefined) => Promise<void>;
  readonly resetFilters: () => Promise<void>;
}

export type QueryHistoryStore = ReturnType<typeof createQueryHistoryStore>;

export function createQueryHistoryStore() {
  return create<QueryHistoryStoreState>()((set, get) => ({
    entries: [],
    loading: false,
    filter: DEFAULT_FILTER,

    loadHistory: async filter => {
      set(filter ? { loading: true, filter } : { loading: true });
      try {
        set({ entries: (await ipc().query.getHistory(get().filter)) || [] });
      } catch (error) {
        diagnostics.error('failed to load query history', error);
        set({ entries: [] });
      } finally {
        set({ loading: false });
      }
    },

    setFilter: async filter => {
      set(state => ({ filter: { ...state.filter, ...filter } }));
      await get().loadHistory();
    },

    clearHistory: async () => {
      try {
        await ipc().query.clearHistory();
        set({ entries: [] });
      } catch (error) {
        // Rethrown, unlike every other action here: the caller is a destructive confirmation
        // dialog that must not close on a failed clear.
        diagnostics.error('failed to clear query history', error);
        throw error;
      }
    },

    deleteEntry: async id => {
      try {
        const result = await ipc().query.deleteHistoryEntry(id);
        if (result) {
          set(state => ({ entries: state.entries.filter(e => e.id !== id) }));
        }
        return result ?? false;
      } catch (error) {
        diagnostics.error('failed to delete history entry', error);
        return false;
      }
    },

    search: searchText => get().setFilter({ searchText: searchText || undefined }),
    filterByConnection: connectionId => get().setFilter({ connectionId }),
    filterByDatabase: database => get().setFilter({ database }),
    filterBySuccess: successOnly => get().setFilter({ successOnly }),

    resetFilters: async () => {
      set({ filter: DEFAULT_FILTER });
      await get().loadHistory();
    },
  }));
}

export const queryHistoryStore = createQueryHistoryStore();
export const useQueryHistoryStore = queryHistoryStore;

type EntriesSlice = Pick<QueryHistoryStoreState, 'entries'>;

export function selectHistoryCount(state: EntriesSlice): number {
  return state.entries.length;
}

/** Fresh array — subscribe with `useShallow`. */
export function selectRecentEntries(state: EntriesSlice): readonly QueryHistoryEntry[] {
  return state.entries.slice(0, 10);
}

/** Fresh array — subscribe with `useShallow`. */
export function selectSuccessfulQueries(state: EntriesSlice): readonly QueryHistoryEntry[] {
  return state.entries.filter(e => e.success);
}

/** Fresh array — subscribe with `useShallow`. */
export function selectFailedQueries(state: EntriesSlice): readonly QueryHistoryEntry[] {
  return state.entries.filter(e => !e.success);
}

/** Fresh array of fresh objects — `useShallow` will NOT help; memoize at the call site. */
export function selectUniqueConnections(
  state: EntriesSlice
): readonly { id: string; name: string }[] {
  const connections = new Map<string, string>();
  for (const entry of state.entries) {
    if (!connections.has(entry.connectionId)) {
      connections.set(entry.connectionId, entry.connectionName);
    }
  }
  return Array.from(connections.entries()).map(([id, name]) => ({ id, name }));
}

/** Fresh array — subscribe with `useShallow`. */
export function selectUniqueDatabases(state: EntriesSlice): readonly string[] {
  return Array.from(new Set(state.entries.map(e => e.database))).sort();
}
