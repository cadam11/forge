/**
 * Result snapshots, named: the adapter over the one IPC member with five positional arguments, plus
 * the pure list logic the history panel renders (sort, label, timestamp, the snapshot → result
 * conversion the "view this one" action needs).
 *
 * ── Who writes a snapshot, and why the renderer usually does not ──────────────────────────────
 *
 * The main process does, on every execute that carried a `tabId` and a database
 * (`main/src/ipc/query.ipc.ts:59-78`, inside a `setImmediate` so the reply reaches the renderer
 * first). So the history list fills itself, and the renderer's `saveSnapshot` is NOT the auto-save
 * path — a second call there would write a duplicate row for one run.
 *
 * `captureResultSnapshot` is therefore the only renderer-side write, and it is a different act: the
 * user asking for a **pinned baseline** of what is on screen. That matters because auto-saved
 * snapshots are subject to main's own retention (30 days, 50 per tab, 500MB — `QUERY_RESULTS_CONFIG`)
 * and `skipPinned` is what exempts one; a baseline you intend to diff a future run against has to
 * survive fifty more runs. It also removes a race from anything that needs a snapshot to exist
 * *now*: main's write is asynchronous and the reply does not wait for it.
 *
 * ── PLAN.md §7.4, wrapped once ────────────────────────────────────────────────────────────────
 *
 * `queryResults.saveSnapshot(tabId, sql, connectionId, database, result)` is four strings and an
 * object, positionally — `sql`/`connectionId`/`database` are three adjacent strings, and any two of
 * them transposed is a silently mis-filed snapshot with no type error. The contract is out of scope
 * for this rewrite (PLAN.md §8), so it is wrapped here, once, in the only call site the renderer
 * has, and every caller passes a named object.
 */

import type { QueryResult, QueryResultSnapshot } from '@joinery/shared';

import { queryResultsStore } from '../../state/query-results';
import { truncate } from './fk-lookup';

/** How much of a snapshot's SQL the list shows when the user gave it no label. */
export const SNAPSHOT_SQL_PREVIEW = 90;

export type SnapshotSortField = 'executedAt' | 'totalRowCount' | 'executionTimeMs';
export type SnapshotSortOrder = 'asc' | 'desc';

export interface SnapshotSort {
  readonly field: SnapshotSortField;
  readonly order: SnapshotSortOrder;
}

/** Newest first, which is the order the list is read in. */
export const DEFAULT_SNAPSHOT_SORT: SnapshotSort = { field: 'executedAt', order: 'desc' };

/**
 * Picking a sort field: the same field again reverses, a different one starts descending.
 *
 * Ported from `result-history-panel.component.ts:932-939`, and pure so the panel's handler is a
 * single `setSort(current => nextSort(current, field))`. That matters beyond tidiness: the Angular
 * shape was two signal writes, and its React transcription — a `setSortOrder` inside a
 * `setSortField` updater — toggles TWICE under StrictMode, because an updater may be invoked more
 * than once and must therefore be pure.
 */
export function nextSort(current: SnapshotSort, field: SnapshotSortField): SnapshotSort {
  if (current.field !== field) return { field, order: 'desc' };
  return { field, order: current.order === 'asc' ? 'desc' : 'asc' };
}

export interface CaptureRequest {
  readonly tabId: string;
  readonly sql: string;
  readonly connectionId: string;
  readonly database: string;
  readonly result: QueryResult;
}

/**
 * Saves the result a tab is showing as a **pinned** snapshot, and returns it.
 *
 * Pinned, not merely saved: see the module header. `null` means the write or the pin failed and the
 * store has already reported it — the caller has nothing to add.
 */
export async function captureResultSnapshot(
  request: CaptureRequest
): Promise<QueryResultSnapshot | null> {
  const store = queryResultsStore.getState();
  const snapshot = await store.saveSnapshot(
    request.tabId,
    request.sql,
    request.connectionId,
    request.database,
    request.result
  );
  if (snapshot === null) return null;

  // The pin is what exempts it from main's retention sweep, which is the whole point of capturing.
  // A failed pin still leaves a usable snapshot, so the snapshot is returned either way and the
  // store's own toast reports the failure.
  await store.pinSnapshot(snapshot.id);
  return snapshot;
}

/**
 * A snapshot as a `QueryResult`, for `queryExecutionStore.setResult` — the "view this historical
 * result" path that store's header names (`state/query-execution.ts:68`).
 *
 * Ported from `query.component.ts:2564-2589`, including the `queryId: snapshot.id` substitution: the
 * grid keys nothing off it, and it makes a historical result identifiable in a log.
 *
 * The rows have to be there. A list entry carries metadata only (`query-results-store.ts:177-181`),
 * so a caller hydrates with `queryResults.getSnapshot(id)` first — `snapshotNeedsHydration` is the
 * test for it.
 */
export function snapshotAsResult(snapshot: QueryResultSnapshot): QueryResult {
  return {
    queryId: snapshot.id,
    success: snapshot.success,
    resultSets: snapshot.resultSets,
    executionTime: snapshot.executionTimeMs,
    error: snapshot.error,
  };
}

/** True when this snapshot's rows are still on disk main-side and must be fetched by id. */
export function snapshotNeedsHydration(snapshot: QueryResultSnapshot): boolean {
  return snapshot.resultSets.length === 0 && snapshot.totalRowCount > 0;
}

/** What the list shows as a snapshot's name: the user's label, else the SQL on one line. */
export function snapshotLabel(snapshot: QueryResultSnapshot): string {
  if (snapshot.label !== undefined && snapshot.label !== '') return snapshot.label;
  return truncate(snapshot.sql.trim().replace(/\s+/g, ' '), SNAPSHOT_SQL_PREVIEW);
}

/** The SQL, always — the second line of a list row, and the Copy SQL payload. */
export function snapshotSqlPreview(snapshot: QueryResultSnapshot): string {
  return truncate(snapshot.sql.trim().replace(/\s+/g, ' '), SNAPSHOT_SQL_PREVIEW);
}

/**
 * Sorted, without touching the store's array.
 *
 * Ported from `result-history-panel.component.ts:892-914`. Its comparator sorted `executedAt` by
 * parsed time and the other two numerically, which is kept; what is added is a **stable tie-break on
 * id**, because two snapshots of the same query a millisecond apart otherwise swapped places on
 * every re-render.
 */
export function sortSnapshots(
  snapshots: readonly QueryResultSnapshot[],
  field: SnapshotSortField,
  order: SnapshotSortOrder
): QueryResultSnapshot[] {
  const direction = order === 'asc' ? 1 : -1;
  return [...snapshots].sort((left, right) => {
    const comparison = compareBy(left, right, field);
    if (comparison !== 0) return comparison * direction;
    return left.id.localeCompare(right.id);
  });
}

function compareBy(
  left: QueryResultSnapshot,
  right: QueryResultSnapshot,
  field: SnapshotSortField
): number {
  if (field === 'executedAt') {
    return new Date(left.executedAt).getTime() - new Date(right.executedAt).getTime();
  }
  return left[field] - right[field];
}

/**
 * A snapshot's time, as short as it can be and still unambiguous: the clock alone for today, the
 * date and the clock for anything older.
 *
 * Replaces the Angular `SmartDatePipe`, whose contract was "the previous row's date, so a repeated
 * day can be elided" — a per-row-position format, which means the same snapshot reads differently
 * depending on what is above it and cannot be asserted. `now` is a parameter so the test does not
 * depend on the day it runs.
 */
export function formatSnapshotTime(executedAt: string, now: Date = new Date()): string {
  const at = new Date(executedAt);
  if (Number.isNaN(at.getTime())) return executedAt;

  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();

  const clock = at.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  if (sameDay) return clock;

  const day = at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${day} ${clock}`;
}

/** `1,234 rows · 41ms`, or `failed` — the metadata line of a list row. */
export function formatSnapshotStats(snapshot: QueryResultSnapshot): string {
  if (!snapshot.success) return 'failed';
  const rows = `${snapshot.totalRowCount.toLocaleString()} ${snapshot.totalRowCount === 1 ? 'row' : 'rows'}`;
  return `${rows} · ${snapshot.executionTimeMs.toLocaleString()}ms`;
}
