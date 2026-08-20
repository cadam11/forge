/**
 * Installs a partial `window.joinery` for tests.
 *
 * Partial on purpose. `JoineryAPI` has 17 namespaces and well over a hundred members, and a
 * mock that implemented all of them would be the very 1:1 re-declaration `src/ipc/` exists
 * to delete — it would need editing every time preload changed. A test declares only the
 * members it exercises, and the single cast below is the one place that admits the object is
 * incomplete.
 */

import type { JoineryAPI } from '@joinery/preload';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Installs the mock and returns the teardown that removes it again. */
export function installJoineryMock(partial: DeepPartial<JoineryAPI>): () => void {
  Object.defineProperty(window, 'joinery', {
    configurable: true,
    writable: true,
    value: partial as JoineryAPI,
  });

  return () => {
    removeJoineryMock();
  };
}

/** Puts the window back into the "running in a plain browser" state. */
export function removeJoineryMock(): void {
  Reflect.deleteProperty(window, 'joinery');
}

export interface RecordedSubscription<TPayload> {
  /** The `on*` member to hand to the code under test. */
  readonly subscribe: (callback: (payload: TPayload) => void) => () => void;
  /** How many times anything subscribed. */
  readonly subscribeCount: () => number;
  /** How many of those subscriptions have been torn down. */
  readonly unsubscribeCount: () => number;
  /** Subscriptions that are still live — the number that matters under StrictMode. */
  readonly liveCount: () => number;
  /** Pushes a payload to every live listener, the way the main process would. */
  readonly emit: (payload: TPayload) => void;
}

/**
 * A stand-in for one bridge event that records its own subscribe/unsubscribe traffic.
 *
 * It mirrors preload's `createEventListener` (`packages/preload/src/index.ts:445-449`) in
 * the one respect the hook depends on: every subscribe call gets a distinct listener
 * identity, and its teardown removes that listener specifically. A mock that instead cleared
 * a shared list would make a double-fire bug untestable.
 */
export function recordSubscription<TPayload>(): RecordedSubscription<TPayload> {
  const live = new Set<(payload: TPayload) => void>();
  let subscribes = 0;
  let unsubscribes = 0;

  return {
    subscribe: callback => {
      subscribes += 1;
      const listener = (payload: TPayload) => callback(payload);
      live.add(listener);
      return () => {
        unsubscribes += 1;
        live.delete(listener);
      };
    },
    subscribeCount: () => subscribes,
    unsubscribeCount: () => unsubscribes,
    liveCount: () => live.size,
    emit: payload => {
      for (const listener of live) {
        listener(payload);
      }
    },
  };
}
