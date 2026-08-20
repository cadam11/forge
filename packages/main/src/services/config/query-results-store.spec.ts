import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QueryResult } from '@joinery/shared';
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
    dir = mkdtempSync(join(tmpdir(), 'joinery-qrs-'));
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

  it('purge olderThan honors the keepMinPerTab floor tab by tab', () => {
    // Exactly the automatic daily pass: a cutoff in the future (so every snapshot is age-eligible),
    // no tabId, and the floor the store asks for. Before J-116 the floor was read only inside the
    // `tabId` branch, so this pass deleted every snapshot of every tab.
    for (const tab of ['tab-1', 'tab-2']) {
      for (let i = 0; i < 8; i++) {
        store.saveSnapshot(tab, `SELECT ${i}`, 'conn-1', 'db', makeResult(1));
      }
    }
    const before = store.getSnapshots();

    const result = store.purge({
      olderThan: new Date(Date.now() + 60_000).toISOString(),
      skipPinned: true,
      keepMinPerTab: 5,
    });

    expect(result.deletedCount).toBe(6); // 3 aged out of each of the two tabs
    for (const tab of ['tab-1', 'tab-2']) {
      expect(store.getSnapshots({ tabId: tab }), tab).toHaveLength(5);
    }
    // And the survivors are the RECENT ones: no kept snapshot predates a deleted sibling in its tab.
    const keptIds = new Set(store.getSnapshots().map(s => s.id));
    for (const tab of ['tab-1', 'tab-2']) {
      const tabbed = before.filter(s => s.tabId === tab);
      const oldestKept = Math.min(
        ...tabbed.filter(s => keptIds.has(s.id)).map(s => new Date(s.executedAt).getTime())
      );
      const newestDeleted = Math.max(
        ...tabbed.filter(s => !keptIds.has(s.id)).map(s => new Date(s.executedAt).getTime())
      );
      expect(oldestKept, tab).toBeGreaterThanOrEqual(newestDeleted);
    }
  });

  it('purge olderThan still spares pinned snapshots under skipPinned, floor or no floor', () => {
    const pinned = store.saveSnapshot('tab-1', 'SELECT pinned', 'conn-1', 'db', makeResult(1));
    store.pinSnapshot(pinned.id);
    for (let i = 0; i < 9; i++) {
      store.saveSnapshot('tab-1', `SELECT ${i}`, 'conn-1', 'db', makeResult(1));
    }

    store.purge({
      olderThan: new Date(Date.now() + 60_000).toISOString(),
      skipPinned: true,
      keepMinPerTab: 5,
    });

    // The pinned one is the OLDEST of the ten, so the floor does not protect it — `skipPinned` does.
    expect(store.getSnapshot(pinned.id)).not.toBeNull();
    // Floor slots are counted over all of a tab's snapshots, pinned included, exactly as the
    // tab-scoped branch counts them: 5 recent + the pinned survivor.
    expect(store.getSnapshots({ tabId: 'tab-1' })).toHaveLength(6);
  });

  it('purge with a tabId still trims that tab down to the floor', () => {
    for (let i = 0; i < 7; i++) {
      store.saveSnapshot('tab-1', `SELECT ${i}`, 'conn-1', 'db', makeResult(1));
    }
    store.saveSnapshot('tab-2', 'SELECT other', 'conn-1', 'db', makeResult(1));

    const result = store.purge({ tabId: 'tab-1', keepMinPerTab: 3 });

    expect(result.deletedCount).toBe(4);
    expect(store.getSnapshots({ tabId: 'tab-1' })).toHaveLength(3);
    // An untargeted tab is not touched by a tab-scoped purge.
    expect(store.getSnapshots({ tabId: 'tab-2' })).toHaveLength(1);
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
