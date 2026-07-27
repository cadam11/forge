import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QueryResult } from '@mj-forge/shared';
import { QueryResultsStore } from './query-results-store';

function makeResult(rows: number): QueryResult {
  return {
    queryId: 'q1',
    success: true,
    executionTime: 4,
    resultSets: [
      {
        columns: [{ name: 'n', type: 'int' }],
        rowCount: rows,
        rows: Array.from({ length: rows }, (_, i) => ({ n: i })),
      },
    ],
  };
}

describe('QueryResultsStore (file-backed)', () => {
  let dir: string;
  let store: QueryResultsStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-qrs-'));
    store = new QueryResultsStore(dir);
  });

  afterEach(async () => {
    await store.settle();
    rmSync(dir, { recursive: true, force: true });
  });

  it('getSnapshots returns metadata without row payloads', () => {
    store.saveSnapshot('tab-1', 'SELECT 1', 'conn-1', 'db', makeResult(5));

    const list = store.getSnapshots({ tabId: 'tab-1' });
    expect(list).toHaveLength(1);
    expect(list[0].totalRowCount).toBe(5);
    expect(list[0].resultSets).toEqual([]);
  });

  it('getSnapshot hydrates the full rows', () => {
    const saved = store.saveSnapshot('tab-1', 'SELECT 1', 'conn-1', 'db', makeResult(5));

    const full = store.getSnapshot(saved.id);
    expect(full?.resultSets[0].rows).toHaveLength(5);
  });

  it('enforces the per-tab snapshot cap, keeping pinned ones', () => {
    const first = store.saveSnapshot('tab-1', 'SELECT 0', 'conn-1', 'db', makeResult(1));
    store.pinSnapshot(first.id);
    for (let i = 1; i <= 55; i++) {
      store.saveSnapshot('tab-1', `SELECT ${i}`, 'conn-1', 'db', makeResult(1));
    }

    const list = store.getSnapshots({ tabId: 'tab-1' });
    expect(list.length).toBeLessThanOrEqual(51); // 50 cap + pinned survivor
    expect(list.some(s => s.id === first.id)).toBe(true);
  });

  it('purge olderThan removes matching snapshots and reports stats', () => {
    const old = store.saveSnapshot('tab-1', 'SELECT old', 'conn-1', 'db', makeResult(2));
    // Backdate via the pin/label metadata path is not exposed; simulate by
    // purging with a future cutoff instead.
    const result = store.purge({ olderThan: new Date(Date.now() + 60_000).toISOString() });

    expect(result.deletedCount).toBe(1);
    expect(store.getSnapshot(old.id)).toBeNull();
    expect(store.getStorageStats().totalSnapshots).toBe(0);
  });

  it('pin, label, delete round-trip', () => {
    const s = store.saveSnapshot('tab-1', 'SELECT 1', 'conn-1', 'db', makeResult(1));

    expect(store.pinSnapshot(s.id)).toBe(true);
    expect(store.labelSnapshot(s.id, 'golden')).toBe(true);
    const meta = store.getSnapshots()[0];
    expect(meta.isPinned).toBe(true);
    expect(meta.label).toBe('golden');

    expect(store.deleteSnapshot(s.id)).toBe(true);
    expect(store.deleteSnapshot(s.id)).toBe(false);
  });

  it('compareSnapshots still diffs through the file store', () => {
    const a = store.saveSnapshot('tab-1', 'SELECT 1', 'conn-1', 'db', makeResult(3));
    const b = store.saveSnapshot('tab-1', 'SELECT 1', 'conn-1', 'db', makeResult(4));

    const diff = store.compareSnapshots(a.id, b.id);
    expect(diff).not.toBeNull();
    expect(diff!.summary.addedRows).toBe(1);
  });
});
