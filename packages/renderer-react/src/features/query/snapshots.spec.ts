/**
 * The snapshot adapter and the history list's pure logic.
 *
 * The one test with a mock is the adapter's: what it exists to prevent is a transposition of the
 * three adjacent strings `queryResults.saveSnapshot` takes positionally (PLAN.md §7.4), so the
 * assertion is on the argument LIST that reached the bridge, in order.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryResult, QueryResultSnapshot } from '@joinery/shared';

import { queryResultsStore } from '../../state/query-results';
import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import {
  captureResultSnapshot,
  formatSnapshotStats,
  formatSnapshotTime,
  snapshotAsResult,
  snapshotLabel,
  snapshotNeedsHydration,
  sortSnapshots,
  SNAPSHOT_SQL_PREVIEW,
} from './snapshots';

function snapshotOf(overrides: Partial<QueryResultSnapshot> = {}): QueryResultSnapshot {
  return {
    id: 'snap-1',
    tabId: 'tab-1',
    sql: 'SELECT * FROM customers',
    connectionId: 'conn-1',
    database: 'joinery_test',
    executedAt: '2026-08-15T10:00:00.000Z',
    executionTimeMs: 41,
    success: true,
    totalRowCount: 5,
    storageSizeBytes: 800,
    resultSets: [],
    ...overrides,
  };
}

const RESULT: QueryResult = {
  queryId: 'query-1',
  success: true,
  resultSets: [{ columns: [{ name: 'id', type: 'int4' }], rows: [{ id: 1 }] }],
  executionTime: 41,
};

const teardowns: (() => void)[] = [];

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  queryResultsStore.setState({ snapshots: [], selectedIds: [], currentDiff: null });
});

function silence(): void {
  teardowns.push(
    setDiagnosticsSink({ error: () => undefined, warn: () => undefined }),
    setNotifier({
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warning: () => undefined,
    })
  );
}

describe('captureResultSnapshot', () => {
  it('passes the five positional arguments in the contract’s order', async () => {
    silence();
    const saveSnapshot = vi.fn(async () => snapshotOf({ id: 'saved-1' }));
    const pinSnapshot = vi.fn(async () => true);
    teardowns.push(installJoineryMock({ queryResults: { saveSnapshot, pinSnapshot } }));

    const saved = await captureResultSnapshot({
      tabId: 'tab-9',
      sql: 'SELECT 1',
      connectionId: 'conn-7',
      database: 'shop',
      result: RESULT,
    });

    expect(saveSnapshot).toHaveBeenCalledWith('tab-9', 'SELECT 1', 'conn-7', 'shop', RESULT);
    expect(saved?.id).toBe('saved-1');
  });

  it('pins what it saved — that is what exempts it from main’s retention sweep', async () => {
    silence();
    const pinSnapshot = vi.fn(async () => true);
    teardowns.push(
      installJoineryMock({
        queryResults: { saveSnapshot: async () => snapshotOf({ id: 'saved-2' }), pinSnapshot },
      })
    );

    await captureResultSnapshot({
      tabId: 'tab-1',
      sql: 'SELECT 1',
      connectionId: 'conn-1',
      database: 'shop',
      result: RESULT,
    });

    expect(pinSnapshot).toHaveBeenCalledWith('saved-2');
  });

  it('does not attempt a pin when the save failed', async () => {
    silence();
    const pinSnapshot = vi.fn(async () => true);
    teardowns.push(
      installJoineryMock({
        queryResults: {
          saveSnapshot: async () => {
            throw new Error('disk full');
          },
          pinSnapshot,
        },
      })
    );

    const saved = await captureResultSnapshot({
      tabId: 'tab-1',
      sql: 'SELECT 1',
      connectionId: 'conn-1',
      database: 'shop',
      result: RESULT,
    });

    expect(saved).toBeNull();
    expect(pinSnapshot).not.toHaveBeenCalled();
  });

  it('is null with no bridge at all, rather than throwing into a click handler', async () => {
    silence();
    const saved = await captureResultSnapshot({
      tabId: 'tab-1',
      sql: 'SELECT 1',
      connectionId: 'conn-1',
      database: 'shop',
      result: RESULT,
    });
    expect(saved).toBeNull();
  });
});

describe('snapshotAsResult', () => {
  it('carries the rows, the duration and the failure across', () => {
    const snapshot = snapshotOf({
      resultSets: [{ columns: [{ name: 'id', type: 'int4' }], rowCount: 1, rows: [{ id: 1 }] }],
    });
    expect(snapshotAsResult(snapshot)).toEqual({
      queryId: 'snap-1',
      success: true,
      resultSets: snapshot.resultSets,
      executionTime: 41,
      error: undefined,
    });
  });

  it('keeps a failed snapshot’s error, so the pane renders its failure state', () => {
    const result = snapshotAsResult(snapshotOf({ success: false, error: 'syntax error' }));
    expect(result).toMatchObject({ success: false, error: 'syntax error' });
  });
});

describe('snapshotNeedsHydration', () => {
  it('is true for a list entry that had rows', () => {
    expect(snapshotNeedsHydration(snapshotOf({ totalRowCount: 5, resultSets: [] }))).toBe(true);
  });

  it('is false once the rows are in hand', () => {
    expect(
      snapshotNeedsHydration(snapshotOf({ resultSets: [{ columns: [], rowCount: 0, rows: [] }] }))
    ).toBe(false);
  });

  it('is false for a snapshot that genuinely returned nothing', () => {
    expect(snapshotNeedsHydration(snapshotOf({ totalRowCount: 0, resultSets: [] }))).toBe(false);
  });
});

describe('snapshotLabel', () => {
  it('is the user’s label when there is one', () => {
    expect(snapshotLabel(snapshotOf({ label: 'baseline' }))).toBe('baseline');
  });

  it('falls back to the SQL on one line', () => {
    expect(snapshotLabel(snapshotOf({ sql: '  SELECT *\n  FROM   customers\n' }))).toBe(
      'SELECT * FROM customers'
    );
  });

  it('treats an empty label as no label', () => {
    expect(snapshotLabel(snapshotOf({ label: '', sql: 'SELECT 1' }))).toBe('SELECT 1');
  });

  it('ellipsises a long statement once', () => {
    const sql = `SELECT ${'c'.repeat(200)} FROM t`;
    expect(snapshotLabel(snapshotOf({ sql }))).toHaveLength(SNAPSHOT_SQL_PREVIEW + 1);
  });
});

describe('sortSnapshots', () => {
  const a = snapshotOf({
    id: 'a',
    executedAt: '2026-08-15T10:00:00.000Z',
    totalRowCount: 5,
    executionTimeMs: 10,
  });
  const b = snapshotOf({
    id: 'b',
    executedAt: '2026-08-15T11:00:00.000Z',
    totalRowCount: 1,
    executionTimeMs: 90,
  });
  const c = snapshotOf({
    id: 'c',
    executedAt: '2026-08-15T09:00:00.000Z',
    totalRowCount: 9,
    executionTimeMs: 50,
  });

  it('sorts newest first by default field and desc order', () => {
    expect(sortSnapshots([a, b, c], 'executedAt', 'desc').map(s => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts ascending when asked', () => {
    expect(sortSnapshots([a, b, c], 'executedAt', 'asc').map(s => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('sorts by row count and by duration numerically', () => {
    expect(sortSnapshots([a, b, c], 'totalRowCount', 'desc').map(s => s.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(sortSnapshots([a, b, c], 'executionTimeMs', 'asc').map(s => s.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('never mutates the store’s array', () => {
    const input = [a, b, c];
    sortSnapshots(input, 'executedAt', 'asc');
    expect(input.map(s => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks a tie on id, so the list does not shuffle between renders', () => {
    const tied = [
      snapshotOf({ id: 'z', executedAt: a.executedAt }),
      snapshotOf({ id: 'y', executedAt: a.executedAt }),
    ];
    expect(sortSnapshots(tied, 'executedAt', 'desc').map(s => s.id)).toEqual(['y', 'z']);
    expect(sortSnapshots([...tied].reverse(), 'executedAt', 'desc').map(s => s.id)).toEqual([
      'y',
      'z',
    ]);
  });
});

describe('formatSnapshotTime', () => {
  it('is the clock alone for a snapshot from today', () => {
    const now = new Date('2026-08-15T18:00:00.000Z');
    const at = new Date('2026-08-15T09:30:05.000Z');
    expect(formatSnapshotTime(at.toISOString(), now)).toBe(
      at.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    );
  });

  it('adds the date for anything older', () => {
    const now = new Date('2026-08-15T18:00:00.000Z');
    const formatted = formatSnapshotTime('2026-08-13T09:30:05.000Z', now);
    expect(formatted).toContain(
      new Date('2026-08-13T09:30:05.000Z').toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    );
  });

  it('returns an unparseable timestamp unchanged rather than “Invalid Date”', () => {
    expect(formatSnapshotTime('not a date')).toBe('not a date');
  });
});

describe('formatSnapshotStats', () => {
  it('counts rows and milliseconds, with grouping', () => {
    expect(formatSnapshotStats(snapshotOf({ totalRowCount: 1234, executionTimeMs: 4100 }))).toBe(
      `${(1234).toLocaleString()} rows · ${(4100).toLocaleString()}ms`
    );
  });

  it('says row, singular, for one', () => {
    expect(formatSnapshotStats(snapshotOf({ totalRowCount: 1 }))).toContain('1 row ·');
  });

  it('says failed for a failed snapshot instead of counting its zero rows', () => {
    expect(formatSnapshotStats(snapshotOf({ success: false, totalRowCount: 0 }))).toBe('failed');
  });
});
