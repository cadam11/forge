/**
 * The step machine, and the persistence gate — both without a DOM, which is the reason they are here and
 * not in the overlay.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RendererStatePersistence } from '../persistence/renderer-state';
import { createToursStore, selectIsLastStep, selectNextTour, type Tour } from './tours';

const FIRST: Tour = {
  id: 'first',
  name: 'The first one',
  next: 'second',
  steps: [
    { target: 'a', title: 'A', description: 'a', placement: 'right' },
    { target: 'b', title: 'B', description: 'b', placement: 'bottom' },
  ],
};

const SECOND: Tour = {
  id: 'second',
  name: 'The second one',
  steps: [{ target: 'c', title: 'C', description: 'c', placement: 'top' }],
};

const TOURS = { first: FIRST, second: SECOND, empty: { id: 'empty', name: 'Empty', steps: [] } };

let update: ReturnType<typeof vi.fn>;
let persistence: RendererStatePersistence;

function makeStore(options: { hydrate?: readonly string[] | null } = {}) {
  const store = createToursStore(persistence);
  store.getState().installTours(TOURS);
  if (options.hydrate !== null) store.getState().hydrate(options.hydrate ?? []);
  return store;
}

beforeEach(() => {
  update = vi.fn(async () => 'written' as const);
  persistence = {
    read: async () => ({}),
    update: update as unknown as RendererStatePersistence['update'],
  };
});

describe('the step machine', () => {
  it('refuses an unknown tour and one with no steps', () => {
    const store = makeStore();
    store.getState().start('nope');
    expect(store.getState().activeTourId).toBeNull();
    // An empty tour would be an overlay with nothing in it — refused with the unknown case rather than
    // being a second state to render.
    store.getState().start('empty');
    expect(store.getState().activeTourId).toBeNull();
  });

  it('walks forward and back, and cannot go below the first step', () => {
    const store = makeStore();
    store.getState().start('first');
    expect(store.getState().stepIndex).toBe(0);

    store.getState().previous();
    expect(store.getState().stepIndex).toBe(0);

    store.getState().next();
    expect(store.getState().stepIndex).toBe(1);
    store.getState().previous();
    expect(store.getState().stepIndex).toBe(0);
  });

  it('finishing the last step ends the tour and records it', () => {
    const store = makeStore();
    store.getState().start('first');
    store.getState().next();
    expect(selectIsLastStep(store.getState())).toBe(true);

    store.getState().next();
    expect(store.getState().activeTourId).toBeNull();
    expect(store.getState().stepIndex).toBe(0);
    expect(store.getState().completed).toEqual(['first']);
  });

  it('dismissing records it too — a user who closed it has said "not this"', () => {
    // The Angular `dismissTour` and `completeTour` were byte-identical, and that is the right behaviour:
    // re-raising a dismissed tour on the next launch would be the app arguing.
    const store = makeStore();
    store.getState().start('first');
    store.getState().dismiss();
    expect(store.getState().completed).toEqual(['first']);
  });

  it('records a tour once, however many times it is run', () => {
    const store = makeStore({ hydrate: ['first'] });
    store.getState().start('first');
    store.getState().dismiss();
    expect(store.getState().completed).toEqual(['first']);
  });

  it('lets a completed tour be started again', () => {
    // A user who reached for "Start the guided tour" has asked for it.
    const store = makeStore({ hydrate: ['first'] });
    store.getState().start('first');
    expect(store.getState().activeTourId).toBe('first');
  });

  it('offers the chained tour, and stops offering it once it is done', () => {
    const store = makeStore();
    store.getState().start('first');
    expect(selectNextTour(store.getState())?.id).toBe('second');

    const done = makeStore({ hydrate: ['second'] });
    done.getState().start('first');
    expect(selectNextTour(done.getState())).toBeNull();
  });

  it('next() on no active tour does nothing rather than throwing', () => {
    const store = makeStore();
    store.getState().next();
    expect(store.getState().activeTourId).toBeNull();
    expect(store.getState().completed).toEqual([]);
  });
});

describe('persistence', () => {
  it('writes the completion list through the renderer-state door, never localStorage', async () => {
    const store = makeStore();
    store.getState().start('first');
    store.getState().dismiss();

    expect(update).toHaveBeenCalledTimes(1);
    const mutate = update.mock.calls[0]?.[0] as (current: object) => object;
    expect(mutate({ welcomeDismissed: true })).toEqual({
      welcomeDismissed: true,
      completedTours: ['first'],
    });
  });

  it('writes nothing before hydration', () => {
    // The gate `state/snippets.ts` and `state/editor-prefs.ts` both have: a tour finished before the
    // startup path has read the disk must not persist an empty list over the migrated one.
    const store = makeStore({ hydrate: null });
    store.getState().start('first');
    store.getState().dismiss();
    expect(store.getState().completed).toEqual(['first']);
    expect(update).not.toHaveBeenCalled();
  });

  it('reset forgets one tour and persists that too', () => {
    const store = makeStore({ hydrate: ['first', 'second'] });
    store.getState().reset('first');
    expect(store.getState().completed).toEqual(['second']);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
