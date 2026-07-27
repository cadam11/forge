/**
 * Query Results IPC Handlers
 * Handles persistence and comparison of query result snapshots
 */

import { IPC_CHANNELS } from '@mj-forge/shared';
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
} from '@mj-forge/shared';
import { QueryResultsStore } from '../services/config/query-results-store';
import { safeHandle } from './safe-handle';

export function registerQueryResultsHandlers(): void {
  // Resolved lazily inside each handler: the store's constructor reads the
  // entire snapshots file (can be tens of MB) synchronously, which must not
  // happen during startup registration.
  const resultsStore = () => QueryResultsStore.getInstance();

  // Save a query result snapshot
  safeHandle(
    IPC_CHANNELS.QUERY_RESULTS.SAVE_SNAPSHOT,
    async (
      _event,
      tabId: string,
      sql: string,
      connectionId: string,
      database: string,
      result: QueryResult
    ): Promise<QueryResultSnapshot> => {
      return resultsStore().saveSnapshot(tabId, sql, connectionId, database, result);
    }
  );

  // Get snapshots with optional filtering and sorting
  safeHandle(
    IPC_CHANNELS.QUERY_RESULTS.GET_SNAPSHOTS,
    async (
      _event,
      filter?: QueryResultHistoryFilter,
      sort?: ResultHistorySortOptions
    ): Promise<QueryResultSnapshot[]> => {
      return resultsStore().getSnapshots(filter, sort);
    }
  );

  // Get a single snapshot by ID
  safeHandle(
    IPC_CHANNELS.QUERY_RESULTS.GET_SNAPSHOT,
    async (_event, id: string): Promise<QueryResultSnapshot | null> => {
      return resultsStore().getSnapshot(id);
    }
  );

  // Delete a single snapshot
  safeHandle(
    IPC_CHANNELS.QUERY_RESULTS.DELETE_SNAPSHOT,
    async (_event, id: string): Promise<boolean> => {
      return resultsStore().deleteSnapshot(id);
    }
  );

  // Delete multiple snapshots
  safeHandle(
    IPC_CHANNELS.QUERY_RESULTS.DELETE_SNAPSHOTS,
    async (_event, ids: string[]): Promise<number> => {
      return resultsStore().deleteSnapshots(ids);
    }
  );

  // Pin a snapshot
  safeHandle(
    IPC_CHANNELS.QUERY_RESULTS.PIN_SNAPSHOT,
    async (_event, id: string): Promise<boolean> => {
      return resultsStore().pinSnapshot(id);
    }
  );

  // Unpin a snapshot
  safeHandle(
    IPC_CHANNELS.QUERY_RESULTS.UNPIN_SNAPSHOT,
    async (_event, id: string): Promise<boolean> => {
      return resultsStore().unpinSnapshot(id);
    }
  );

  // Set label for a snapshot
  safeHandle(
    IPC_CHANNELS.QUERY_RESULTS.LABEL_SNAPSHOT,
    async (_event, id: string, label: string): Promise<boolean> => {
      return resultsStore().labelSnapshot(id, label);
    }
  );

  // Get storage statistics
  safeHandle(
    IPC_CHANNELS.QUERY_RESULTS.GET_STORAGE_STATS,
    async (): Promise<ResultStorageStats> => {
      return resultsStore().getStorageStats();
    }
  );

  // Purge snapshots
  safeHandle(
    IPC_CHANNELS.QUERY_RESULTS.PURGE,
    async (_event, options: PurgeOptions): Promise<PurgeResult> => {
      return resultsStore().purge(options);
    }
  );

  // Compare two snapshots
  safeHandle(
    IPC_CHANNELS.QUERY_RESULTS.COMPARE_SNAPSHOTS,
    async (
      _event,
      baseId: string,
      compareId: string,
      options?: DiffOptions
    ): Promise<ResultDiff | null> => {
      return resultsStore().compareSnapshots(baseId, compareId, options);
    }
  );
}
