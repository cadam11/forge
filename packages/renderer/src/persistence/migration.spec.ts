/**
 * The migration's gate. User data is at stake — the entire snippet library lives in localStorage and
 * nowhere else (PLAN.md 0.5) — so the assertions here are about the two properties that make it safe
 * rather than about its happy path:
 *
 *   idempotent — a marker in AppState, checked inside the same critical section that writes it
 *   lossless   — a key is removed only after the data it held reached AppState and main said so
 *
 * The second property is what Task 24 changed. Before the cutover this migration was
 * NON-DESTRUCTIVE in the strong sense — localStorage was byte-identical afterwards, always —
 * because the Angular renderer still read the same six keys on every boot. Angular is gone, so the
 * keys are now lifted and then removed, and the tests below pin the exact boundary: removed on a
 * successful lift, NOT removed when the write failed, NOT removed when the value could not be
 * parsed, NOT removed on a boot that only found a marker.
 *
 * Everything runs against `createAppStateDouble`, which reproduces main's shallow-spread `setState`
 * rather than a forgiving deep merge. See that file for why.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installJoineryMock, removeJoineryMock } from '../test/joinery-mock';
import { createAppStateDouble, type AppStateDouble } from '../test/app-state-double';
import { setDiagnosticsSink } from '../state/diagnostics';
import { LEGACY_KEYS } from './legacy-local-storage';
import { migrateLegacyLocalStorage } from './migration';
import { createRendererStatePersistence } from './renderer-state';

/** Exactly what the Angular renderer leaves behind for a user who has actually used the app. */
const ANGULAR_LOCAL_STORAGE: Readonly<Record<string, string>> = {
  [LEGACY_KEYS.settings]: JSON.stringify({
    theme: 'light',
    editor: { fontSize: 18 },
    grid: { copyFormat: 'csv' },
  }),
  [LEGACY_KEYS.completedTours]: JSON.stringify(['welcome', 'first-query']),
  [LEGACY_KEYS.welcomeDismissed]: 'true',
  [LEGACY_KEYS.snippets]: JSON.stringify([
    {
      id: 'snip-1',
      name: 'Recent orders',
      sql: 'SELECT TOP 10 * FROM orders ORDER BY created_at DESC',
      tags: ['orders', 'report'],
      createdAt: '2026-01-02T03:04:05.000Z',
    },
    {
      id: 'snip-2',
      name: 'Row counts',
      sql: 'SELECT COUNT(*) FROM customers',
      tags: [],
      createdAt: '2026-02-03T04:05:06.000Z',
    },
  ]),
  [LEGACY_KEYS.ctrlEConfirmed]: 'true',
  [LEGACY_KEYS.flywayPlaceholderValues]: JSON.stringify({ schema: 'dbo', env: 'staging' }),
};

function seedAngularLocalStorage(values = ANGULAR_LOCAL_STORAGE): void {
  for (const [key, value] of Object.entries(values)) {
    window.localStorage.setItem(key, value);
  }
}

/** The whole of localStorage, so "nothing changed" can be asserted as one comparison. */
function localStorageSnapshot(): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key !== null) snapshot[key] = window.localStorage.getItem(key) ?? '';
  }
  return snapshot;
}

let bridge: AppStateDouble;
const teardowns: (() => void)[] = [];

beforeEach(() => {
  window.localStorage.clear();
  bridge = createAppStateDouble();
  teardowns.push(installJoineryMock({ app: bridge.app }));
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  window.localStorage.clear();
});

describe('localStorage → AppState migration — the round trip', () => {
  it('lifts all six keys, with the shapes the Angular renderer wrote', async () => {
    seedAngularLocalStorage();

    const result = await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(result.outcome).toBe('migrated');
    expect([...result.keysPresent].sort()).toEqual([...Object.values(LEGACY_KEYS)].sort());
    expect(result.keysRejected).toEqual([]);

    const persisted = bridge.snapshot().reactRendererState;
    expect(persisted?.settings).toEqual({
      theme: 'light',
      editor: { fontSize: 18 },
      grid: { copyFormat: 'csv' },
    });
    expect(persisted?.completedTours).toEqual(['welcome', 'first-query']);
    expect(persisted?.welcomeDismissed).toBe(true);
    expect(persisted?.snippets).toHaveLength(2);
    expect(persisted?.snippets?.[0]?.sql).toBe(
      'SELECT TOP 10 * FROM orders ORDER BY created_at DESC'
    );
    expect(persisted?.snippets?.[1]?.tags).toEqual([]);
    expect(persisted?.confirmedCtrlEExecute).toBe(true);
    expect(persisted?.flywayPlaceholderValues).toEqual({ schema: 'dbo', env: 'staging' });
    expect(persisted?.migratedFromLocalStorageAt).toBeTypeOf('string');
  });

  it('survives a reboot: the second launch reads the migrated data back out of AppState', async () => {
    seedAngularLocalStorage();
    await migrateLegacyLocalStorage(createRendererStatePersistence());

    // A new "process": same persisted object, fresh call counters, and — the point — a browser
    // profile that has been wiped, so nothing can come from localStorage this time.
    const second = bridge.reboot();
    removeJoineryMock();
    installJoineryMock({ app: second.app });
    window.localStorage.clear();

    const persistence = createRendererStatePersistence();
    const result = await migrateLegacyLocalStorage(persistence);

    expect(result.outcome).toBe('already-migrated');
    const state = await persistence.read();
    expect(state.snippets).toHaveLength(2);
    expect(state.settings?.theme).toBe('light');
  });

  it('removes the six keys once they are safely in AppState', async () => {
    seedAngularLocalStorage();

    const result = await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect([...result.keysCleared].sort()).toEqual([...Object.values(LEGACY_KEYS)].sort());
    expect(localStorageSnapshot()).toEqual({});
    // …and the data is where it was moved to, which is the half that makes the removal a MOVE
    // rather than a delete.
    expect(bridge.snapshot().reactRendererState?.snippets).toHaveLength(2);
  });

  it('removes nothing when the write was refused, so a retry still has the data', async () => {
    // The ordering that matters most. A removal before the acknowledgement would destroy the
    // snippet library on any boot where main was not there to take it.
    seedAngularLocalStorage();
    const before = localStorageSnapshot();
    removeJoineryMock();

    const result = await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(result.outcome).toBe('unavailable');
    expect(result.keysCleared).toEqual([]);
    expect(localStorageSnapshot()).toEqual(before);
  });

  it('leaves a key whose value parsed but LOST ENTRIES, and still migrates the survivors', async () => {
    // The all-or-nothing rule has a hole if it only looks at whole keys: three of the six parsers
    // filter *inside* a value (`snippets.filter(isSqlSnippet)`, the tours string filter, the flyway
    // non-string drop). Such a key is not "rejected" — most of it came across — so without a
    // separate signal it lands in the removal list and the dropped entries are gone unwarned.
    // NO SILENT DESTRUCTION: a partial lift retains the key, and says so.
    const warnings: { message: string; context: unknown }[] = [];
    teardowns.push(
      setDiagnosticsSink({
        error: () => undefined,
        warn: (message, context) => warnings.push({ message, context }),
      })
    );
    seedAngularLocalStorage();
    const partial = JSON.stringify([{ id: 'ok', sql: 'SELECT 1' }, { nonsense: true }, 42]);
    window.localStorage.setItem(LEGACY_KEYS.snippets, partial);

    const result = await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(result.outcome).toBe('migrated');
    // Not rejected — it parsed, and what parsed was migrated.
    expect(result.keysRejected).toEqual([]);
    expect(result.keysPartial).toEqual([LEGACY_KEYS.snippets]);
    // The survivors are in AppState…
    expect(bridge.snapshot().reactRendererState?.snippets).toEqual([{ id: 'ok', sql: 'SELECT 1' }]);
    // …and the key is still on disk, because the two entries that did NOT come across exist
    // nowhere else.
    expect(result.keysCleared).not.toContain(LEGACY_KEYS.snippets);
    expect(window.localStorage.getItem(LEGACY_KEYS.snippets)).toBe(partial);
    // Every other key was clean, so those ARE removed — one partial key must not strand the rest.
    expect([...result.keysCleared].sort()).toEqual(
      Object.values(LEGACY_KEYS)
        .filter(key => key !== LEGACY_KEYS.snippets)
        .sort()
    );
    // And it is not silent.
    expect(
      warnings.some(
        w =>
          w.message.includes('discarded') &&
          JSON.stringify(w.context).includes(LEGACY_KEYS.snippets)
      ),
      `expected a warning naming the partially-parsed key; got ${JSON.stringify(warnings)}`
    ).toBe(true);
  });

  // The other two lossy parsers, so all three are pinned and none can be "simplified" back into
  // reporting a clean parse. Each case seeds one key with a value that partly survives.
  it.each([
    {
      key: LEGACY_KEYS.completedTours,
      raw: JSON.stringify(['welcome', 7, null, 'first-query']),
      field: 'completedTours' as const,
      survivors: ['welcome', 'first-query'],
    },
    {
      key: LEGACY_KEYS.flywayPlaceholderValues,
      raw: JSON.stringify({ schema: 'dbo', port: 5432 }),
      field: 'flywayPlaceholderValues' as const,
      survivors: { schema: 'dbo' },
    },
  ])('reports $key as partial when entries inside it are dropped', async testCase => {
    seedAngularLocalStorage();
    window.localStorage.setItem(testCase.key, testCase.raw);

    const result = await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(result.keysPartial).toEqual([testCase.key]);
    expect(result.keysCleared).not.toContain(testCase.key);
    expect(window.localStorage.getItem(testCase.key)).toBe(testCase.raw);
    expect(bridge.snapshot().reactRendererState?.[testCase.field]).toEqual(testCase.survivors);
  });

  it('leaves a key it could not parse, because that data did not make it across', async () => {
    seedAngularLocalStorage();
    window.localStorage.setItem(LEGACY_KEYS.snippets, '[{"id":"snip-1",');

    const result = await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(result.keysRejected).toEqual([LEGACY_KEYS.snippets]);
    expect(result.keysCleared).not.toContain(LEGACY_KEYS.snippets);
    expect(window.localStorage.getItem(LEGACY_KEYS.snippets)).toBe('[{"id":"snip-1",');
    // Everything that DID parse is gone, so one bad key does not strand the other five.
    expect(Object.keys(localStorageSnapshot())).toEqual([LEGACY_KEYS.snippets]);
  });

  it('leaves keys alone when AppState already held state, because a lift can LOSE the merge', async () => {
    // `{...lifted, ...current}` means an existing AppState value wins. So on a profile that had
    // already run a (pre-cutover) React build, `joinery-snippets` can be reported as migrated while
    // contributing nothing — and it is then the only copy of that list. Removing it would be the
    // loss this module exists to prevent, so the removal is gated on AppState having been EMPTY.
    seedAngularLocalStorage();
    const seeded = createAppStateDouble({
      reactRendererState: { snippets: [{ id: 'react-made', sql: 'SELECT 3' }] },
    });
    removeJoineryMock();
    installJoineryMock({ app: seeded.app });

    const result = await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(result.outcome).toBe('migrated');
    expect(result.keysCleared).toEqual([]);
    expect(seeded.snapshot().reactRendererState?.snippets).toEqual([
      { id: 'react-made', sql: 'SELECT 3' },
    ]);
    // The Angular list is still on disk, which is the whole point: it lost the merge, so this is
    // the only place it exists.
    expect(window.localStorage.getItem(LEGACY_KEYS.snippets)).toBe(
      ANGULAR_LOCAL_STORAGE[LEGACY_KEYS.snippets]
    );
  });

  it('leaves keys alone on an already-migrated boot: they may be newer than the marker', async () => {
    // The marker says a previous run lifted what was there THEN. A key written since — a snippet
    // created in Angular after a React boot, during coexistence — is unlifted user data, and
    // sweeping it because a marker exists would be exactly the loss this module prevents.
    const persistence = createRendererStatePersistence();
    seedAngularLocalStorage();
    await migrateLegacyLocalStorage(persistence);
    expect(localStorageSnapshot()).toEqual({});

    window.localStorage.setItem(LEGACY_KEYS.snippets, JSON.stringify([{ id: 'later', sql: 'x' }]));
    const second = await migrateLegacyLocalStorage(persistence);

    expect(second.outcome).toBe('already-migrated');
    expect(second.keysCleared).toEqual([]);
    expect(window.localStorage.getItem(LEGACY_KEYS.snippets)).toBe('[{"id":"later","sql":"x"}]');
  });

  it('keeps main-process collections, which can only have grown', async () => {
    // Anything already in `AppState` wins for the collections: a snippet or a tour created in the
    // React renderer must not lose to a stale Angular list.
    seedAngularLocalStorage();
    const seeded = createAppStateDouble({
      reactRendererState: {
        snippets: [{ id: 'react-made', sql: 'SELECT 3' }],
        welcomeDismissed: false,
      },
    });
    removeJoineryMock();
    installJoineryMock({ app: seeded.app });

    await migrateLegacyLocalStorage(createRendererStatePersistence());

    const persisted = seeded.snapshot().reactRendererState;
    expect(persisted?.snippets).toEqual([{ id: 'react-made', sql: 'SELECT 3' }]);
    expect(persisted?.welcomeDismissed).toBe(false);
    // …while everything AppState had nothing to say about still comes across.
    expect(persisted?.completedTours).toEqual(['welcome', 'first-query']);
  });

  it('lets the Angular settings win over an UNSTAMPED pre-migration settings object', async () => {
    // The asymmetry, and what decides it: provenance. No `settingsAuthoredByReactAt` means no
    // renderer claims to have chosen this while knowing what it was overwriting — so it must not be
    // allowed to silently discard what the user did choose, in Angular.
    seedAngularLocalStorage();
    const seeded = createAppStateDouble({
      reactRendererState: { settings: { theme: 'system', editor: { fontSize: 13 } } },
    });
    removeJoineryMock();
    installJoineryMock({ app: seeded.app });

    await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(seeded.snapshot().reactRendererState?.settings).toEqual({
      theme: 'light',
      editor: { fontSize: 18 },
      grid: { copyFormat: 'csv' },
    });
  });

  it('keeps a STAMPED settings object, however default-shaped it looks', async () => {
    // The other half, and the reason the rule cannot be a shape heuristic: this object IS the
    // defaults, and the stamp says the user chose them in React after a settled migration. Lifting
    // over it would discard that choice — and Angular's object is itself mostly Angular defaults,
    // since `settings.service.ts:149` rewrites the whole thing when one field changes.
    seedAngularLocalStorage();
    const seeded = createAppStateDouble({
      reactRendererState: {
        settings: { theme: 'system', editor: { fontSize: 13 } },
        settingsAuthoredByReactAt: '2026-08-01T00:00:00.000Z',
      },
    });
    removeJoineryMock();
    installJoineryMock({ app: seeded.app });

    await migrateLegacyLocalStorage(createRendererStatePersistence());

    const persisted = seeded.snapshot().reactRendererState;
    expect(persisted?.settings).toEqual({ theme: 'system', editor: { fontSize: 13 } });
    // Everything else still comes across: only `settings` is provenance-gated.
    expect(persisted?.snippets).toHaveLength(2);
    expect(persisted?.migratedFromLocalStorageAt).toBeTypeOf('string');
  });

  it('keeps a pre-migration settings object when localStorage has no settings key at all', async () => {
    seedAngularLocalStorage();
    window.localStorage.removeItem(LEGACY_KEYS.settings);
    const seeded = createAppStateDouble({
      reactRendererState: { settings: { theme: 'dark' } },
    });
    removeJoineryMock();
    installJoineryMock({ app: seeded.app });

    await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(seeded.snapshot().reactRendererState?.settings).toEqual({ theme: 'dark' });
  });
});

describe('localStorage → AppState migration — idempotency', () => {
  it('writes once and never again, however many times it runs', async () => {
    seedAngularLocalStorage();
    const persistence = createRendererStatePersistence();

    const first = await migrateLegacyLocalStorage(persistence);
    const writesAfterFirst = bridge.calls.setState;
    const migratedAt = bridge.snapshot().reactRendererState?.migratedFromLocalStorageAt;

    const second = await migrateLegacyLocalStorage(persistence);
    const third = await migrateLegacyLocalStorage(persistence);

    expect(first.outcome).toBe('migrated');
    expect(second.outcome).toBe('already-migrated');
    expect(third.outcome).toBe('already-migrated');
    expect(writesAfterFirst).toBe(1);
    expect(bridge.calls.setState).toBe(1);
    expect(bridge.snapshot().reactRendererState?.migratedFromLocalStorageAt).toBe(migratedAt);
  });

  it('does not re-lift a localStorage value that changed after the migration', async () => {
    // The coexistence hazard in the other direction: the user goes back to Angular and changes a
    // setting. That is Angular's business; a second migration would drag it over the top of
    // whatever the React renderer has, so there is no second migration.
    seedAngularLocalStorage();
    const persistence = createRendererStatePersistence();
    await migrateLegacyLocalStorage(persistence);

    window.localStorage.setItem(LEGACY_KEYS.settings, JSON.stringify({ theme: 'dark' }));
    const result = await migrateLegacyLocalStorage(persistence);

    expect(result.outcome).toBe('already-migrated');
    expect(bridge.snapshot().reactRendererState?.settings?.theme).toBe('light');
  });

  it('collapses two concurrent runs into one migration', async () => {
    // A StrictMode double-effect, or two callers racing at startup. The marker check and the write
    // share one critical section, so the loser sees the winner's marker.
    seedAngularLocalStorage();
    const persistence = createRendererStatePersistence();

    const [first, second] = await Promise.all([
      migrateLegacyLocalStorage(persistence),
      migrateLegacyLocalStorage(persistence),
    ]);

    expect([first.outcome, second.outcome].sort()).toEqual(['already-migrated', 'migrated']);
    expect(bridge.calls.setState).toBe(1);
    expect(bridge.snapshot().reactRendererState?.snippets).toHaveLength(2);
  });

  it('writes the marker and the data in ONE call, so a crash cannot separate them', async () => {
    // The half-migration question. Main merges a `setState` payload into its in-memory state in one
    // synchronous spread before its debounced, atomic disk write, so the only two outcomes are
    // "all of it landed" and "none of it did" — and the second is safe because localStorage was
    // never touched. This asserts the precondition: one call carrying both.
    seedAngularLocalStorage();
    const payloads: unknown[] = [];
    const recording = createAppStateDouble();
    removeJoineryMock();
    installJoineryMock({
      app: {
        getState: recording.app.getState,
        setState: (partial: Parameters<typeof recording.app.setState>[0]) => {
          payloads.push(structuredClone(partial));
          return recording.app.setState(partial);
        },
      },
    });

    await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(payloads).toHaveLength(1);
    const written = (payloads[0] as { reactRendererState?: Record<string, unknown> })
      .reactRendererState;
    expect(written?.['migratedFromLocalStorageAt']).toBeTypeOf('string');
    expect(written?.['snippets']).toHaveLength(2);
  });

  it('runs again after a failed write, because a failed write leaves no marker', async () => {
    seedAngularLocalStorage();
    let failNext = true;
    const backing = createAppStateDouble();
    removeJoineryMock();
    installJoineryMock({
      app: {
        getState: backing.app.getState,
        setState: (partial: Parameters<typeof backing.app.setState>[0]) => {
          if (failNext) {
            failNext = false;
            return Promise.reject(new Error('main process went away'));
          }
          return backing.app.setState(partial);
        },
      },
    });

    const persistence = createRendererStatePersistence();
    const before = localStorageSnapshot();
    const failed = await migrateLegacyLocalStorage(persistence);

    expect(failed.outcome).toBe('failed');
    expect(backing.snapshot().reactRendererState).toBeUndefined();
    // The stronger of the two "nothing was written" orderings gets the same assertions as the
    // `unavailable` one: a rejected write must leave localStorage exactly as it found it, or the
    // retry below would have nothing to migrate.
    expect(failed.keysCleared).toEqual([]);
    expect(localStorageSnapshot()).toEqual(before);

    // Second attempt, same data still sitting in localStorage.
    expect((await migrateLegacyLocalStorage(persistence)).outcome).toBe('migrated');
    expect(backing.snapshot().reactRendererState?.snippets).toHaveLength(2);
  });
});

describe('localStorage → AppState migration — the empty and broken cases', () => {
  it('is a clean no-op on a fresh install: nothing read, nothing written, no marker', async () => {
    const result = await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(result.outcome).toBe('no-data');
    expect(result.keysPresent).toEqual([]);
    expect(bridge.calls.setState).toBe(0);
    expect(bridge.snapshot().reactRendererState).toBeUndefined();
  });

  it('stays available to migrate later, since a fresh install writes no marker', async () => {
    // Boot React first (nothing to migrate), then use Angular, then boot React again. The snippets
    // created in between must still come across.
    const persistence = createRendererStatePersistence();
    expect((await migrateLegacyLocalStorage(persistence)).outcome).toBe('no-data');

    seedAngularLocalStorage();
    expect((await migrateLegacyLocalStorage(persistence)).outcome).toBe('migrated');
    expect(bridge.snapshot().reactRendererState?.snippets).toHaveLength(2);
  });

  it('migrates the readable keys when one is corrupt, and reports the one it skipped', async () => {
    seedAngularLocalStorage();
    window.localStorage.setItem(LEGACY_KEYS.snippets, '[{"id":"snip-1",');

    const result = await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(result.outcome).toBe('migrated');
    expect(result.keysRejected).toEqual([LEGACY_KEYS.snippets]);
    const persisted = bridge.snapshot().reactRendererState;
    expect(persisted?.snippets).toBeUndefined();
    expect(persisted?.settings?.theme).toBe('light');
    expect(persisted?.completedTours).toEqual(['welcome', 'first-query']);
    // And the corrupt value is still there for a human to look at.
    expect(window.localStorage.getItem(LEGACY_KEYS.snippets)).toBe('[{"id":"snip-1",');
  });

  it('keeps the snippets that parse when one entry in the array is junk', async () => {
    seedAngularLocalStorage();
    window.localStorage.setItem(
      LEGACY_KEYS.snippets,
      JSON.stringify([{ id: 'ok', sql: 'SELECT 1' }, { nonsense: true }, 42])
    );

    await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(bridge.snapshot().reactRendererState?.snippets).toEqual([{ id: 'ok', sql: 'SELECT 1' }]);
  });

  it('reads `welcomeDismissed` the way Angular reads it: only the literal string true', async () => {
    window.localStorage.setItem(LEGACY_KEYS.welcomeDismissed, 'yes');

    await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(bridge.snapshot().reactRendererState?.welcomeDismissed).toBe(false);
  });

  it('reports `unavailable` and touches nothing when there is no bridge', async () => {
    seedAngularLocalStorage();
    const before = localStorageSnapshot();
    removeJoineryMock();

    const result = await migrateLegacyLocalStorage(createRendererStatePersistence());

    expect(result.outcome).toBe('unavailable');
    expect(localStorageSnapshot()).toEqual(before);
  });
});
