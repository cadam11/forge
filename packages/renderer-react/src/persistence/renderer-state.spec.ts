/**
 * The writer, and specifically the two things that make it the only write path worth having:
 * it never clobbers a sibling field, and two concurrent writers cannot interleave.
 *
 * Both are properties of main's shallow-spread `setState` (PLAN.md §7.5), which
 * `createAppStateDouble` reproduces exactly — so a regression here would be a real data loss, not a
 * test artifact.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installJoineryMock, removeJoineryMock } from '../test/joinery-mock';
import { createAppStateDouble, type AppStateDouble } from '../test/app-state-double';
import { setDiagnosticsSink } from '../state/diagnostics';
import {
  createRendererStatePersistence,
  REACT_RENDERER_STATE_VERSION,
  validateReactRendererState,
} from './renderer-state';

let bridge: AppStateDouble;
const teardowns: (() => void)[] = [];

beforeEach(() => {
  bridge = createAppStateDouble();
  teardowns.push(installJoineryMock({ app: bridge.app }));
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
});

describe('renderer state writer', () => {
  it('preserves the fields it is not writing', async () => {
    const persistence = createRendererStatePersistence();

    await persistence.update(current => ({
      ...current,
      snippets: [{ id: 's1', sql: 'SELECT 1' }],
    }));
    await persistence.update(current => ({ ...current, settings: { theme: 'dark' } }));

    const state = await persistence.read();
    expect(state.snippets).toHaveLength(1);
    expect(state.settings).toEqual({ theme: 'dark' });
  });

  it('does not disturb the rest of AppState', async () => {
    const persistence = createRendererStatePersistence();
    await bridge.app.setState({ lastConnectedProfileIds: ['profile-a'], sidebarWidth: 320 });

    await persistence.update(current => ({ ...current, welcomeDismissed: true }));

    const snapshot = bridge.snapshot();
    expect(snapshot.lastConnectedProfileIds).toEqual(['profile-a']);
    expect(snapshot.sidebarWidth).toBe(320);
    expect(snapshot.reactRendererState?.welcomeDismissed).toBe(true);
  });

  it('serializes concurrent writes so neither loses its field', async () => {
    // Without the chain, both mutators would read the same empty state and the second write would
    // delete the first one's field. This is that regression, asserted directly.
    const persistence = createRendererStatePersistence();

    await Promise.all([
      persistence.update(current => ({ ...current, welcomeDismissed: true })),
      persistence.update(current => ({ ...current, confirmedCtrlEExecute: true })),
    ]);

    const state = await persistence.read();
    expect(state.welcomeDismissed).toBe(true);
    expect(state.confirmedCtrlEExecute).toBe(true);
  });

  it('queues a read behind an unawaited write', async () => {
    // What the settings store does: `void update(…)` and carry on. A read issued afterwards must
    // not overtake it, or a caller sees state that is already stale by the time it arrives.
    const persistence = createRendererStatePersistence();

    void persistence.update(current => ({ ...current, welcomeDismissed: true }));

    expect((await persistence.read()).welcomeDismissed).toBe(true);
  });

  it('stamps the schema version on every write', async () => {
    const persistence = createRendererStatePersistence();

    await persistence.update(current => ({ ...current, welcomeDismissed: false }));

    expect(bridge.snapshot().reactRendererState?.version).toBe(REACT_RENDERER_STATE_VERSION);
  });

  it('reports a mutator that declines to write, without calling the bridge', async () => {
    const persistence = createRendererStatePersistence();

    const result = await persistence.update(() => undefined);

    expect(result).toBe('unchanged');
    expect(bridge.calls.setState).toBe(0);
  });

  it('reports a rejected write instead of throwing into a startup path', async () => {
    removeJoineryMock();
    installJoineryMock({
      app: {
        getState: bridge.app.getState,
        setState: () => Promise.reject(new Error('nope')),
      },
    });

    const result = await createRendererStatePersistence().update(current => ({
      ...current,
      welcomeDismissed: true,
    }));

    expect(result).toBe('failed');
  });

  it('reports an unavailable bridge, and reads as empty rather than throwing', async () => {
    removeJoineryMock();
    const persistence = createRendererStatePersistence();

    expect(await persistence.update(current => current)).toBe('unavailable');
    expect(await persistence.read()).toEqual({});
  });

  it('keeps working after a failed write', async () => {
    // The chain must not wedge: one rejected write cannot stop the next one.
    let failNext = true;
    removeJoineryMock();
    installJoineryMock({
      app: {
        getState: bridge.app.getState,
        setState: (partial: Parameters<typeof bridge.app.setState>[0]) => {
          if (failNext) {
            failNext = false;
            return Promise.reject(new Error('transient'));
          }
          return bridge.app.setState(partial);
        },
      },
    });
    const persistence = createRendererStatePersistence();

    expect(await persistence.update(current => ({ ...current, welcomeDismissed: true }))).toBe(
      'failed'
    );
    expect(await persistence.update(current => ({ ...current, welcomeDismissed: true }))).toBe(
      'written'
    );
  });
});

describe('validateReactRendererState', () => {
  it('drops fields of the wrong type and keeps their siblings', () => {
    const validated = validateReactRendererState({
      version: 1,
      migratedFromLocalStorageAt: 42,
      settings: 'not an object',
      completedTours: ['a', 7],
      welcomeDismissed: 'true',
      snippets: [{ id: 'ok', sql: 'SELECT 1' }, { id: 'no-sql' }],
      confirmedCtrlEExecute: true,
      flywayPlaceholderValues: { good: 'yes', bad: 3 },
    });

    expect(validated.version).toBe(1);
    expect(validated.migratedFromLocalStorageAt).toBeUndefined();
    expect(validated.settings).toBeUndefined();
    expect(validated.completedTours).toBeUndefined();
    expect(validated.welcomeDismissed).toBeUndefined();
    expect(validated.snippets).toEqual([{ id: 'ok', sql: 'SELECT 1' }]);
    expect(validated.confirmedCtrlEExecute).toBe(true);
    expect(validated.flywayPlaceholderValues).toBeUndefined();
  });

  it('treats anything that is not an object as empty', () => {
    expect(validateReactRendererState(undefined)).toEqual({});
    expect(validateReactRendererState(null)).toEqual({});
    expect(validateReactRendererState([1, 2])).toEqual({});
    expect(validateReactRendererState('nope')).toEqual({});
  });

  it('accepts a snippet the migration would have accepted', () => {
    // The two thresholds must be the same, or a snippet migrates in and vanishes on the next read.
    const snippet = { id: 's', sql: 'SELECT 1', name: 'x', tags: ['t'], createdAt: 'now' };
    expect(validateReactRendererState({ snippets: [snippet] }).snippets).toEqual([snippet]);
  });
});
