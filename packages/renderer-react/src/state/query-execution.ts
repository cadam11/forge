/**
 * Query execution: which tabs are running something, and what each tab's current result is.
 *
 * This is the store the status bar's **executing** indicator reads, and Task 7 deliberately left that
 * indicator out rather than inventing a second source of truth for it (`shell/status-bar.tsx` header).
 * It is also where Task 11's results grid and Task 14's sub-panels read the current result from, which
 * is why the result lives here and not in the query panel's component state: three surfaces need it,
 * and a Dockview panel's React tree stays mounted while detached, so "the panel owns it" would mean an
 * unreachable owner.
 *
 * Ports `core/services/query-execution.service.ts` (27 LOC — the running-query registry the status bar
 * used) and the execution half of `query.component.ts:1779-1880`. Everything else in that method —
 * the placeholder prompt, the auto-rename, the history refresh — stays in the panel, because it is UI
 * sequencing rather than execution state.
 *
 * ── Keyed by tab, and why the queryId is not the key ────────────────────────────────────────
 *
 * A tab runs at most one query at a time and the UI asks its questions per tab ("is THIS editor
 * busy?", "what is THIS tab showing?"). The `queryId` is what the main process cancels by, so it is
 * carried in the value. The Angular original keyed its registry by tab too, and its `startExecution`
 * filtered out any existing entry for the same tab first — i.e. it already assumed one per tab.
 *
 * ── The stale-result rule, kept ────────────────────────────────────────────────────────────
 *
 * `query.component.ts:1835` drops a result whose `queryId` is no longer the tab's current one, which is
 * what stops a slow first query from overwriting the fast second one's results. That check is here,
 * against the store's own record, so it cannot be forgotten by a caller.
 */

import { create } from 'zustand';
import type { QueryResult } from '@joinery/shared';
import { ipc, isIpcAvailable } from '../ipc';
import { diagnostics, notify } from './diagnostics';

export interface RunningQuery {
  readonly tabId: string;
  readonly tabTitle: string;
  /** What `cancel` sends to the main process. */
  readonly queryId: string;
  readonly startedAt: number;
}

/** What a caller has to know to run something. The panel resolves all of it from its tab. */
export interface ExecuteRequest {
  readonly tabId: string;
  readonly tabTitle: string;
  readonly connectionId: string;
  readonly database: string | undefined;
  readonly sql: string;
  /** `QuerySettings.maxRowsToDisplay` — the executor truncates main-side, before IPC. */
  readonly maxRows: number;
}

export interface QueryExecutionState {
  /** One entry per tab with a query in flight. */
  readonly running: ReadonlyMap<string, RunningQuery>;
  /** The current result per tab. Absent means "nothing has run in this tab yet". */
  readonly results: ReadonlyMap<string, QueryResult>;

  /**
   * Runs the SQL and stores the result. Resolves with the result it stored, or `null` when the
   * request was superseded, the bridge is missing, or the tab already had a query in flight that
   * could not be cancelled.
   */
  readonly execute: (request: ExecuteRequest) => Promise<QueryResult | null>;
  /** Cancels the tab's in-flight query, if any. */
  readonly cancel: (tabId: string) => Promise<void>;
  /** Replaces a tab's displayed result — Task 14's "view this historical snapshot" path. */
  readonly setResult: (tabId: string, result: QueryResult | null) => void;
  /** Forgets a tab's result and any running record. Called when the tab closes. */
  readonly forgetTab: (tabId: string) => void;
}

export type QueryExecutionStore = ReturnType<typeof createQueryExecutionStore>;

/** `query-${Date.now()}` — the Angular id format (`:1811`), kept so main-process logs stay greppable. */
function nextQueryId(): string {
  return `query-${Date.now()}`;
}

export function createQueryExecutionStore() {
  return create<QueryExecutionState>()((set, get) => {
    /** Replace one key in a Map without touching the other entries' identities. */
    const patchMap = <T>(map: ReadonlyMap<string, T>, key: string, value: T | null) => {
      const next = new Map(map);
      if (value === null) next.delete(key);
      else next.set(key, value);
      return next;
    };

    const startRunning = (entry: RunningQuery): void =>
      set(state => ({ running: patchMap(state.running, entry.tabId, entry) }));

    const stopRunning = (tabId: string): void =>
      set(state => ({ running: patchMap(state.running, tabId, null) }));

    return {
      running: new Map(),
      results: new Map(),

      execute: async request => {
        if (!isIpcAvailable()) return null;

        // A tab that is already running something: cancel it first, exactly as `:1804-1806` did.
        // Awaited here, unlike the original's fire-and-forget `.catch(() => {})`, so the two queries
        // cannot both be in flight against the same pool — which is what made the stale-result check
        // load-bearing rather than defensive.
        const inFlight = get().running.get(request.tabId);
        if (inFlight !== undefined) await get().cancel(request.tabId);

        const queryId = nextQueryId();
        startRunning({
          tabId: request.tabId,
          tabTitle: request.tabTitle,
          queryId,
          startedAt: Date.now(),
        });
        // Clear the previous result the moment a new run starts: leaving it up means a grid showing
        // last query's rows under a spinner.
        set(state => ({ results: patchMap(state.results, request.tabId, null) }));

        try {
          const result = await ipc().query.execute({
            connectionId: request.connectionId,
            database: request.database,
            sql: request.sql,
            queryId,
            // Lets the main process persist the result snapshot itself instead of the renderer
            // round-tripping the whole result set back over IPC (`:1826-1828`).
            tabId: request.tabId,
            maxRows: request.maxRows,
          });

          // Superseded: another execute (or a cancel) replaced this tab's record while we waited.
          if (get().running.get(request.tabId)?.queryId !== queryId) return null;

          set(state => ({ results: patchMap(state.results, request.tabId, result) }));
          return result;
        } catch (error) {
          if (get().running.get(request.tabId)?.queryId !== queryId) return null;
          // A rejected execute is a result too: the panel renders `result.error`, and the Angular
          // version built exactly this shape in its catch (`:1862-1867`).
          const failure: QueryResult = {
            queryId,
            success: false,
            error: error instanceof Error ? error.message : 'Query execution failed',
            executionTime: Date.now() - (get().running.get(request.tabId)?.startedAt ?? Date.now()),
          };
          diagnostics.error('query execution failed', error);
          set(state => ({ results: patchMap(state.results, request.tabId, failure) }));
          return failure;
        } finally {
          // Only if it is still ours: a superseding execute has already installed its own record and
          // must not be marked finished by the one it replaced.
          if (get().running.get(request.tabId)?.queryId === queryId) stopRunning(request.tabId);
        }
      },

      cancel: async tabId => {
        const entry = get().running.get(tabId);
        if (entry === undefined || !isIpcAvailable()) return;
        // Cleared BEFORE the await: the cancel itself is a round trip, and until it returns the
        // toolbar would otherwise offer Cancel again for a query already being cancelled.
        stopRunning(tabId);
        try {
          await ipc().query.cancel(entry.queryId);
          notify.info('Query cancelled');
        } catch (error) {
          notify.error('Could not cancel the query');
          diagnostics.error('failed to cancel query', error);
        }
      },

      setResult: (tabId, result) =>
        set(state => ({ results: patchMap(state.results, tabId, result) })),

      forgetTab: tabId =>
        set(state => ({
          running: patchMap(state.running, tabId, null),
          results: patchMap(state.results, tabId, null),
        })),
    };
  });
}

export const queryExecutionStore = createQueryExecutionStore();
export const useQueryExecutionStore = queryExecutionStore;

/** Is THIS tab busy? The selector the toolbar and the editor's disabled states use. */
export function selectIsExecuting(tabId: string | undefined) {
  return (state: Pick<QueryExecutionState, 'running'>): boolean =>
    tabId !== undefined && state.running.has(tabId);
}

/** Is anything busy? The status bar's indicator. Ported from `isAnyRunning`. */
export function selectAnyExecuting(state: Pick<QueryExecutionState, 'running'>): boolean {
  return state.running.size > 0;
}

/** How many. Ported from `runningCount` — the status bar shows it once it exceeds one. */
export function selectRunningCount(state: Pick<QueryExecutionState, 'running'>): number {
  return state.running.size;
}

export function selectResultFor(tabId: string | undefined) {
  return (state: Pick<QueryExecutionState, 'results'>): QueryResult | null =>
    tabId === undefined ? null : (state.results.get(tabId) ?? null);
}
