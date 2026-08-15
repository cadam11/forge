/**
 * A load test for the barrel, and the only place the app-wide singletons are constructed under
 * test. It exists because nothing in the renderer imports `src/state/` yet — Task 7 is the first
 * consumer — so without this the bundler never walks the module graph and a cycle or a
 * bad initialisation order would sit undetected until the shell lands.
 *
 * The dependency order is load-bearing: `capabilities` → `explorer` → `connection` → `chat`, with
 * `tab` feeding `connection`. Each of those modules reads the previous one's singleton at module
 * scope, so an import cycle would leave one of them `undefined` here rather than failing loudly at
 * some later call site.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '@joinery/shared';
import { installJoineryMock, removeJoineryMock } from '../test/joinery-mock';
import * as state from './index';

const PROFILE = {
  id: 'conn-1',
  name: 'Local',
  engine: 'postgresql',
  server: 'localhost',
  port: 5432,
  authenticationType: 'sql',
  encrypt: false,
  trustServerCertificate: true,
  connectionTimeout: 30,
} as ConnectionProfile;

/** Silences the console sinks for a test that deliberately drives a failing path. */
function quietSinks(): () => void {
  const restoreDiagnostics = state.setDiagnosticsSink({
    error: () => undefined,
    warn: () => undefined,
  });
  const restoreNotifier = state.setNotifier({
    success: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warning: () => undefined,
  });
  return () => {
    restoreNotifier();
    restoreDiagnostics();
  };
}

const teardowns: (() => void)[] = [];

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  vi.useRealTimers();
});

describe('the state barrel', () => {
  it('constructs every singleton without a bridge present', () => {
    // No `installJoineryMock` on purpose: the app boots in a plain browser tab during `pnpm dev`,
    // and a store that threw at import time would take the whole renderer with it.
    const singletons = [
      state.capabilitiesStore,
      state.tabStore,
      state.explorerStore,
      state.connectionStore,
      state.queryHistoryStore,
      state.queryResultsStore,
      state.aiStore,
      state.chatPanelStore,
      state.settingsStore,
    ];

    for (const store of singletons) {
      expect(typeof store.getState).toBe('function');
      expect(store.getState()).toBeTypeOf('object');
    }
  });

  it('wires the cross-store singletons to each other, not to fresh copies', async () => {
    // The proof that the DAG resolved, driven through the connection store's own teardown: a
    // `disconnect` must clear the profile from the capabilities store and the explorer store that
    // were handed to it at construction. If any of the three had been given a fresh copy of a
    // dependency, the two assertions at the end would still see the seeded state.
    teardowns.push(quietSinks());
    teardowns.push(
      installJoineryMock({
        connection: { disconnect: () => Promise.resolve() },
        app: { setState: () => Promise.resolve() },
      })
    );

    state.capabilitiesStore.getState().setCapabilities(PROFILE.id, {
      capabilities: state.selectCapabilitiesFor(undefined)(state.capabilitiesStore.getState()),
      variant: 'dsql',
    });
    state.explorerStore.getState().addServerNode(PROFILE.id, PROFILE.name);
    // `disconnect` short-circuits on a profile it does not believe is connected, so the connected
    // set is seeded directly rather than by running a whole connect.
    state.connectionStore.setState({ connectedProfileIds: new Set([PROFILE.id]) });

    expect(state.selectVariantFor(PROFILE.id)(state.capabilitiesStore.getState())).toBe('dsql');
    expect(state.explorerStore.getState().rootNodes).toHaveLength(1);

    await state.connectionStore.getState().disconnect(PROFILE.id);

    expect(state.selectVariantFor(PROFILE.id)(state.capabilitiesStore.getState())).toBeUndefined();
    expect(state.explorerStore.getState().rootNodes).toHaveLength(0);
    expect(state.connectionStore.getState().connectedProfileIds.size).toBe(0);
  });

  it('destroy() clears every heartbeat timer a connect on the singleton started', async () => {
    // Timers, counted the way `connection.spec.ts` counts them. Nothing is scheduled at import —
    // a heartbeat only starts inside `connect()` — so this drives one connect on the singleton and
    // then proves the teardown reaches it.
    teardowns.push(quietSinks());
    vi.useFakeTimers();
    teardowns.push(
      installJoineryMock({
        connection: {
          list: () => Promise.resolve([PROFILE]),
          connect: () => Promise.resolve(undefined),
          disconnect: () => Promise.resolve(),
        },
        database: { list: () => Promise.resolve([]) },
        app: { setState: () => Promise.resolve() },
      })
    );

    expect(vi.getTimerCount()).toBe(0);

    await state.connectionStore.getState().loadProfiles();
    await state.connectionStore.getState().connect(PROFILE.id);
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);

    state.connectionStore.getState().destroy();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);

    // Leave the shared singleton as it was found — the next test file gets the same module.
    await state.connectionStore.getState().disconnect(PROFILE.id);
    expect(state.connectionStore.getState().connectedProfileIds.size).toBe(0);
  });
});
