/**
 * The in-flight record's own logic, tested directly rather than only through the two wizards.
 *
 * Task 12 asserted all of this through `BackupDialogs`, which is the right level for "does the dialog
 * refuse" but the wrong level for the four rules that are the reason the record is shaped the way it
 * is — id claiming, the ambiguity bail-out, keeping finished records, and the cross-kind guard that
 * only exists because one record now serves both features. Those are pure, so they are pinned here.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  createDbOperationsStore,
  dbOperationKey,
  isRunOwnedByAnother,
  selectLiveRun,
  type DbOperationsStore,
} from './db-operations';

const CONNECTION = 'conn-1';
const DB = 'joinery_test';
const OTHER_DB = 'other_db';

let store: DbOperationsStore;

beforeEach(() => {
  store = createDbOperationsStore();
});

const key = dbOperationKey(CONNECTION, DB);
const otherKey = dbOperationKey(CONNECTION, OTHER_DB);

function live(target: string = key) {
  return selectLiveRun(target)(store.getState());
}

describe('the key', () => {
  it('is the connection and the database, with no kind in it', () => {
    // The whole reason a restore can collide with a dump: they key on the same string.
    expect(dbOperationKey(CONNECTION, DB)).toBe(dbOperationKey(CONNECTION, DB));
    expect(dbOperationKey(CONNECTION, DB)).not.toBe(dbOperationKey('conn-2', DB));
    expect(dbOperationKey(CONNECTION, DB)).not.toBe(dbOperationKey(CONNECTION, OTHER_DB));
  });
});

describe('a run’s lifetime', () => {
  it('is live from begin until a terminal event', () => {
    store.getState().begin(key, 'backup', '/tmp/a.dump');
    expect(live()).toEqual({
      kind: 'backup',
      path: '/tmp/a.dump',
      operationId: null,
      finished: false,
    });

    store.getState().bind(key, 'op-1');
    expect(live()?.operationId).toBe('op-1');

    store.getState().settle('backup', 'op-1', false);
    expect(live()).not.toBeNull();

    store.getState().settle('backup', 'op-1', true);
    expect(live()).toBeNull();
  });

  it('keeps the finished record rather than deleting it', () => {
    // Order-independence: the wizard's `isForeignRun` and the host's retire both see each event.
    store.getState().begin(key, 'restore', '/tmp/a.dump');
    store.getState().bind(key, 'op-1');
    store.getState().settle('restore', 'op-1', true);

    expect(live()).toBeNull();
    expect(store.getState().runs.get(key)).toMatchObject({ finished: true, operationId: 'op-1' });
  });

  it('drops the record entirely when the start was refused', () => {
    store.getState().begin(key, 'backup', '/tmp/a.dump');
    store.getState().retire(key);

    expect(live()).toBeNull();
    expect(store.getState().runs.has(key)).toBe(false);
  });

  it('binds only once — an event that got there first is the better answer', () => {
    store.getState().begin(key, 'backup', '/tmp/a.dump');
    store.getState().bind(key, 'op-1');
    store.getState().bind(key, 'op-2');

    expect(live()?.operationId).toBe('op-1');
  });

  it('returns the same record object while nothing about it changed', () => {
    // Clone-on-write is what makes `selectLiveRun` safe to subscribe to directly: a stream of progress
    // lines for a run that is already bound must cost its subscribers no render.
    store.getState().begin(key, 'backup', '/tmp/a.dump');
    store.getState().bind(key, 'op-1');
    const first = live();

    store.getState().settle('backup', 'op-1', false);
    expect(live()).toBe(first);
    // …and an event belonging to nobody at all leaves a bound run alone too.
    store.getState().settle('backup', 'stranger', false);
    expect(live()).toBe(first);
  });
});

describe('claiming an id from the first event', () => {
  it('claims the one unbound run of that kind', () => {
    store.getState().begin(key, 'restore', '/tmp/a.dump');
    store.getState().settle('restore', 'op-9', false);

    expect(live()?.operationId).toBe('op-9');
  });

  it('claims nothing when two runs of that kind are unbound', () => {
    // No evidence which one the event belongs to, so neither is guessed at.
    store.getState().begin(key, 'backup', '/tmp/a.dump');
    store.getState().begin(otherKey, 'backup', '/tmp/b.dump');
    store.getState().settle('backup', 'op-9', false);

    expect(live()?.operationId).toBeNull();
    expect(live(otherKey)?.operationId).toBeNull();
  });

  it('never lets a dump’s event claim an unbound restore', () => {
    // The guard that only exists because one record now serves both features. Without the kind
    // filter the restore would answer to the dump's id for the rest of its life.
    store.getState().begin(key, 'restore', '/tmp/a.dump');
    store.getState().settle('backup', 'dump-op', false);

    expect(live()?.operationId).toBeNull();
  });

  it('marks a bound run finished even when another is unbound', () => {
    store.getState().begin(key, 'backup', '/tmp/a.dump');
    store.getState().bind(key, 'op-1');
    store.getState().begin(otherKey, 'backup', '/tmp/b.dump');

    store.getState().settle('backup', 'op-1', true);

    expect(live()).toBeNull();
    expect(live(otherKey)).not.toBeNull();
  });
});

describe('isRunOwnedByAnother', () => {
  it('is false for an id nobody owns — an unknown id is still ours', () => {
    store.getState().begin(key, 'backup', '/tmp/a.dump');
    expect(isRunOwnedByAnother(store.getState(), key, 'stranger')).toBe(false);
  });

  it('is true for an id another key owns, finished or not', () => {
    store.getState().begin(otherKey, 'backup', '/tmp/b.dump');
    store.getState().bind(otherKey, 'op-1');
    expect(isRunOwnedByAnother(store.getState(), key, 'op-1')).toBe(true);

    store.getState().settle('backup', 'op-1', true);
    expect(isRunOwnedByAnother(store.getState(), key, 'op-1')).toBe(true);
  });

  it('is false for the caller’s own id', () => {
    store.getState().begin(key, 'restore', '/tmp/a.dump');
    store.getState().bind(key, 'op-1');
    expect(isRunOwnedByAnother(store.getState(), key, 'op-1')).toBe(false);
  });

  it('is false when no target has been named yet', () => {
    expect(isRunOwnedByAnother(store.getState(), null, 'op-1')).toBe(false);
  });
});

describe('the collisions this record exists to catch', () => {
  it('reports a live dump to a restore of the same database', () => {
    store.getState().begin(key, 'backup', '/tmp/a.dump');
    expect(live()?.kind).toBe('backup');
  });

  it('reports a live restore to a dump of the same database', () => {
    store.getState().begin(key, 'restore', '/tmp/a.dump');
    expect(live()?.kind).toBe('restore');
  });

  it('leaves a different database alone', () => {
    store.getState().begin(key, 'restore', '/tmp/a.dump');
    expect(live(otherKey)).toBeNull();
  });
});

describe('bounding the map', () => {
  it('prunes finished records past the cap and never a live one', () => {
    // One live run, then far more finished ones than the cap.
    store.getState().begin(key, 'backup', '/tmp/live.dump');

    for (let i = 0; i < 60; i++) {
      const each = dbOperationKey(CONNECTION, `db-${i}`);
      store.getState().begin(each, 'backup', `/tmp/${i}.dump`);
      store.getState().bind(each, `op-${i}`);
      store.getState().settle('backup', `op-${i}`, true);
    }

    expect(live()).not.toBeNull();
    expect(store.getState().runs.size).toBeLessThanOrEqual(33);
  });
});
