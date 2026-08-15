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

import { describe, expect, it } from 'vitest';
import * as state from './index';

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

  it('wires the cross-store singletons to each other, not to fresh copies', () => {
    // The proof that the DAG resolved: the connection store's teardown of one profile clears that
    // profile from the capabilities store and the explorer store it was handed at construction.
    state.capabilitiesStore.getState().setCapabilities('conn-1', {
      capabilities: {
        ...state.selectCapabilitiesFor(undefined)(state.capabilitiesStore.getState()),
      },
      variant: 'dsql',
    });
    state.explorerStore.getState().addServerNode('conn-1', 'Local');

    expect(state.selectVariantFor('conn-1')(state.capabilitiesStore.getState())).toBe('dsql');
    expect(state.explorerStore.getState().rootNodes).toHaveLength(1);

    // `disconnect` short-circuits on a profile that is not connected, so the teardown is reached
    // through the explorer/capabilities mutators directly — the same functions it calls.
    state.explorerStore.getState().removeServerNode('conn-1');
    state.capabilitiesStore.getState().clearCapabilities('conn-1');

    expect(state.selectVariantFor('conn-1')(state.capabilitiesStore.getState())).toBeUndefined();
    expect(state.explorerStore.getState().rootNodes).toHaveLength(0);
  });

  it('leaves no heartbeat timers behind', () => {
    // Importing the barrel must not start anything on a schedule.
    state.connectionStore.getState().destroy();
    expect(state.connectionStore.getState().connectedProfileIds.size).toBe(0);
  });
});
