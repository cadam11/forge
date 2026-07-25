import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryHistoryStore } from './query-history';

const sampleEntry = (sql: string) => ({
  connectionId: 'conn-1',
  connectionName: 'Test',
  database: 'db1',
  sql,
  executedAt: new Date().toISOString(),
  executionTimeMs: 5,
  success: true,
});

/** Fresh instance simulating a new process: sees only persisted data. */
function freshInstance(): QueryHistoryStore {
  QueryHistoryStore.resetInstance();
  return QueryHistoryStore.getInstance();
}

describe('QueryHistoryStore (debounced persistence)', () => {
  let store: QueryHistoryStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = freshInstance();
    store.clearAll();
    store.flush();
  });

  afterEach(() => {
    // Never leave a pending timer running into the next test.
    QueryHistoryStore.getInstance().flush();
    vi.useRealTimers();
  });

  it('add() is visible immediately through getHistory()', () => {
    store.add(sampleEntry('SELECT 1'));
    expect(store.getHistory().map(e => e.sql)).toEqual(['SELECT 1']);
  });

  it('does not hit disk per add — a fresh instance sees nothing before the debounce fires', () => {
    store.add(sampleEntry('SELECT 1'));

    const fresh = freshInstance();
    expect(fresh.getHistory()).toHaveLength(0);
  });

  it('persists after the debounce window elapses', () => {
    store.add(sampleEntry('SELECT 1'));
    store.add(sampleEntry('SELECT 2'));
    vi.advanceTimersByTime(1000);

    const fresh = freshInstance();
    expect(fresh.getHistory().map(e => e.sql)).toEqual(['SELECT 2', 'SELECT 1']);
  });

  it('flush() persists immediately (quit path)', () => {
    store.add(sampleEntry('SELECT 1'));
    store.flush();

    const fresh = freshInstance();
    expect(fresh.getHistory()).toHaveLength(1);
  });

  it('deleteEntry mutates cache and persists on flush', () => {
    const entry = store.add(sampleEntry('SELECT 1'));
    store.add(sampleEntry('SELECT 2'));
    expect(store.deleteEntry(entry.id)).toBe(true);
    expect(store.deleteEntry('nope')).toBe(false);
    store.flush();

    const fresh = freshInstance();
    expect(fresh.getHistory().map(e => e.sql)).toEqual(['SELECT 2']);
  });

  it('keeps at most 1000 entries', () => {
    for (let i = 0; i < 1005; i++) {
      store.add(sampleEntry(`SELECT ${i}`));
    }
    expect(store.getCount()).toBe(1000);
    // Most recent first; the oldest five fell off.
    expect(store.getHistory({ limit: 1 })[0].sql).toBe('SELECT 1004');
  });
});
