import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QueryResultSnapshot } from '@mj-forge/shared';
import { SnapshotFileStore } from './snapshot-file-store';

function makeSnapshot(
  id: string,
  overrides: Partial<QueryResultSnapshot> = {}
): QueryResultSnapshot {
  return {
    id,
    tabId: 'tab-1',
    sql: 'SELECT 1',
    connectionId: 'conn-1',
    database: 'db',
    executedAt: new Date().toISOString(),
    executionTimeMs: 3,
    success: true,
    totalRowCount: 2,
    storageSizeBytes: 100,
    resultSets: [
      {
        columns: [{ name: 'a', type: 'int' }],
        rowCount: 2,
        rows: [{ a: 1 }, { a: 2 }],
        checksum: 'abc',
      },
    ],
    ...overrides,
  };
}

describe('SnapshotFileStore', () => {
  let dir: string;
  let store: SnapshotFileStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-snap-'));
    store = new SnapshotFileStore(dir);
  });

  afterEach(async () => {
    await store.settle();
    rmSync(dir, { recursive: true, force: true });
  });

  it('add() exposes metadata immediately and full data via load()', async () => {
    store.add(makeSnapshot('s1'));

    const meta = store.listMeta();
    expect(meta).toHaveLength(1);
    expect(meta[0].id).toBe('s1');
    expect('resultSets' in meta[0]).toBe(false);

    // load works even before the async file write settles (in-flight cache)…
    expect(store.load('s1')?.resultSets[0].rows).toHaveLength(2);

    // …and after it settles, from disk.
    await store.settle();
    expect(store.load('s1')?.resultSets[0].rows).toHaveLength(2);
  });

  it('a new instance over the same dir sees only the index, loads files on demand', async () => {
    store.add(makeSnapshot('s1'));
    store.add(makeSnapshot('s2', { tabId: 'tab-2' }));
    await store.settle();

    const reopened = new SnapshotFileStore(dir);
    expect(reopened.listMeta().map(m => m.id)).toEqual(['s2', 's1']);
    expect(reopened.load('s1')?.sql).toBe('SELECT 1');
  });

  it('remove() deletes metadata and files', async () => {
    store.add(makeSnapshot('s1'));
    store.add(makeSnapshot('s2'));
    await store.settle();

    expect(store.remove(['s1', 'missing'])).toBe(1);
    await store.settle();

    expect(store.listMeta().map(m => m.id)).toEqual(['s2']);
    expect(store.load('s1')).toBeNull();
    const files = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json');
    expect(files).toEqual(['s2.json']);
  });

  it('update() patches metadata only', async () => {
    store.add(makeSnapshot('s1'));
    expect(store.update('s1', { isPinned: true, label: 'baseline' })).toBe(true);
    expect(store.update('missing', { isPinned: true })).toBe(false);
    await store.settle();

    const reopened = new SnapshotFileStore(dir);
    expect(reopened.listMeta()[0].isPinned).toBe(true);
    expect(reopened.listMeta()[0].label).toBe('baseline');
  });

  it('survives a corrupt index by starting empty', async () => {
    store.add(makeSnapshot('s1'));
    await store.settle();

    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'index.json'), '{not json');

    const reopened = new SnapshotFileStore(dir);
    expect(reopened.listMeta()).toEqual([]);
  });

  it('removeOrphans() unlinks snapshot files missing from the index', async () => {
    store.add(makeSnapshot('s1'));
    store.add(makeSnapshot('s2'));
    await store.settle();

    store.remove(['s2']);
    await store.settle();

    const { writeFileSync } = await import('node:fs');
    // Simulate an orphan left behind by a crash.
    writeFileSync(join(dir, 'ghost.json'), JSON.stringify(makeSnapshot('ghost')));

    await store.removeOrphans();
    expect(existsSync(join(dir, 'ghost.json'))).toBe(false);
    expect(existsSync(join(dir, 's1.json'))).toBe(true);
  });

  it('flushIndexSync() persists pending index changes without awaiting timers', () => {
    store.add(makeSnapshot('s1'));
    store.flushIndexSync();

    const reopened = new SnapshotFileStore(dir);
    expect(reopened.listMeta().map(m => m.id)).toEqual(['s1']);
  });
});
