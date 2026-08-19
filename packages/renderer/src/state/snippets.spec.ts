/**
 * The snippet store, against a persistence double.
 *
 * Two things are being pinned here, and the second is the one PLAN.md 0.5 cares about:
 *
 * 1. CRUD round-trips — what the store holds is what the persistence layer was asked to write;
 * 2. **the write gate**. Until `hydrate` has run, the store must write NOTHING: a create before
 *    hydration would persist a one-item list over the user's migrated library. Same gate, and the same
 *    reason, as `state/editor-prefs.ts`.
 *
 * The double records mutators rather than states, so a test can assert what the store asked for
 * against a `current` value of its choosing — which is how the read-modify-write shape is checked
 * without a live bridge.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ReactRendererState,
  ReactRendererStateMutator,
  RendererStatePersistence,
} from '../persistence/renderer-state';
import { createSnippetsStore, type SqlSnippet } from './snippets';

interface Double extends RendererStatePersistence {
  /** Every mutator the store handed to `update`, in order. */
  readonly mutators: ReactRendererStateMutator[];
  /** What the last mutator produced against `current`. */
  readonly lastResult: (current?: ReactRendererState) => ReactRendererState | undefined;
}

function persistenceDouble(): Double {
  const mutators: ReactRendererStateMutator[] = [];
  return {
    mutators,
    read: vi.fn(() => Promise.resolve({} as ReactRendererState)),
    update: vi.fn((mutate: ReactRendererStateMutator) => {
      mutators.push(mutate);
      return Promise.resolve('written' as const);
    }),
    lastResult: (current = {}) => mutators[mutators.length - 1]?.(current),
  };
}

const EXISTING: SqlSnippet[] = [
  { id: 'snip-1', name: 'Customers', sql: 'SELECT * FROM customers', tags: ['reporting'] },
];

let persistence: Double;
let store: ReturnType<typeof createSnippetsStore>;

beforeEach(() => {
  persistence = persistenceDouble();
  store = createSnippetsStore(persistence);
});

describe('the snippet store', () => {
  it('writes nothing before hydration', () => {
    // The gate. A create here would persist a library of one over whatever Task 5 migrated.
    store.getState().createSnippet({ name: 'Too early', sql: 'SELECT 1', tags: [] });
    store.getState().deleteSnippet('snip-1');

    expect(persistence.update).not.toHaveBeenCalled();
    // The in-memory state still moved, which is the honest behaviour: nothing is lost, it is just not
    // written yet. Hydration replaces it, because hydration is the truth.
    expect(store.getState().snippets).toHaveLength(1);
    store.getState().hydrate(EXISTING);
    expect(store.getState().snippets).toEqual(EXISTING);
  });

  it('creates a snippet with an id, a timestamp and normalised tags', () => {
    store.getState().hydrate([]);

    const id = store
      .getState()
      .createSnippet({ name: '  Monthly  ', sql: 'SELECT 1', tags: [' a ', 'b', 'a', ''] });

    const created = store.getState().snippets[0];
    expect(created?.id).toBe(id);
    expect(created?.name).toBe('Monthly');
    expect(created?.tags).toEqual(['a', 'b']);
    expect(created?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(persistence.update).toHaveBeenCalledOnce();
  });

  it('persists the whole list, preserving the rest of the sub-object', () => {
    store.getState().hydrate(EXISTING);
    store.getState().createSnippet({ name: 'New', sql: 'SELECT 2', tags: [] });

    // The read-modify-write: the mutator receives the persisted object and must return it with only
    // `snippets` replaced — a patch of `{ snippets }` alone would delete the migration marker, because
    // main's `setState` merge replaces the sub-object wholesale.
    const written = persistence.lastResult({
      migratedFromLocalStorageAt: '2026-08-15T00:00:00.000Z',
      welcomeDismissed: true,
    });

    expect(written?.migratedFromLocalStorageAt).toBe('2026-08-15T00:00:00.000Z');
    expect(written?.welcomeDismissed).toBe(true);
    expect(written?.snippets).toHaveLength(2);
    expect(written?.snippets?.map(snippet => snippet.name)).toEqual(['Customers', 'New']);
  });

  it('appends newest last, which is the order existing data is in', () => {
    store.getState().hydrate(EXISTING);
    store.getState().createSnippet({ name: 'Second', sql: 'SELECT 2', tags: [] });

    expect(store.getState().snippets.map(snippet => snippet.name)).toEqual(['Customers', 'Second']);
  });

  it('updates only the fields the patch names', () => {
    store.getState().hydrate(EXISTING);

    store.getState().updateSnippet('snip-1', { name: ' Renamed ' });

    const updated = store.getState().snippets[0];
    expect(updated?.name).toBe('Renamed');
    expect(updated?.sql).toBe('SELECT * FROM customers');
    expect(updated?.tags).toEqual(['reporting']);

    store.getState().updateSnippet('snip-1', { sql: 'SELECT 1', tags: ['x', 'x'] });
    expect(store.getState().snippets[0]?.sql).toBe('SELECT 1');
    expect(store.getState().snippets[0]?.tags).toEqual(['x']);
  });

  it('deletes by id', () => {
    store.getState().hydrate(EXISTING);
    store.getState().deleteSnippet('snip-1');

    expect(store.getState().snippets).toEqual([]);
    expect(persistence.lastResult()?.snippets).toEqual([]);
  });

  it('does not write for an unknown id, in either direction', () => {
    store.getState().hydrate(EXISTING);

    store.getState().updateSnippet('nope', { name: 'x' });
    store.getState().deleteSnippet('nope');

    expect(persistence.update).not.toHaveBeenCalled();
    expect(store.getState().snippets).toEqual(EXISTING);
  });

  it('mints ids that do not collide', () => {
    store.getState().hydrate([]);
    const ids = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      ids.add(store.getState().createSnippet({ name: `s${index}`, sql: 'SELECT 1', tags: [] }));
    }
    // The Angular id was `snippet-${Date.now()}-${Math.random()…}`; 50 creates inside one millisecond
    // is exactly the case that collided.
    expect(ids.size).toBe(50);
  });
});
