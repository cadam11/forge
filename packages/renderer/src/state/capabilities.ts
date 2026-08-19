/**
 * Per-connection engine capabilities, populated from the `ActiveConnection` returned by
 * `connection.connect`. Standalone — it depends on no other store, which is why both the
 * connection store and the explorer store can read it without a cycle. Absence of an entry
 * means "assume fully capable", so engines that predate this store behave exactly as before.
 *
 * Ported from `packages/renderer/src/app/core/state/capabilities.state.ts`.
 *
 * ── The store conventions every file in `src/state/` follows ────────────────────────────────
 *
 * 1. **A factory plus a singleton.** `createCapabilitiesStore()` builds an independent store;
 *    `capabilitiesStore` is the one the app uses. Tests build their own instead of resetting a
 *    shared one, and a store that depends on another takes it as an explicit argument (see
 *    `connection.ts`), so the dependency graph is visible and acyclic.
 * 2. **Derived values are exported selectors, never fields.** Zustand has no `computed`, and a
 *    field that mirrors other fields is a field that can disagree with them. Angular's
 *    `computed()` becomes a pure `select*(state)` function — cheap, testable without React, and
 *    reusable from another store via `select*(deps.x.getState())`.
 * 3. **Subscribe through a selector, always.** `useCapabilitiesStore(selectHasNodes)` re-renders
 *    on that value; `useCapabilitiesStore()` re-renders on every field of every action. A chat
 *    token must not re-render the results grid, and the selector is the only thing that
 *    prevents it. When a selector returns a fresh object or array, wrap it:
 *    `useTabStore(useShallow(selectDirtyTabs))` — otherwise the new identity looks like a change
 *    on every store write. `src/state/selector-isolation.spec.tsx` is the proof.
 * 4. **Clone-on-write.** Every `Map`/`Set`/array update produces a new container, and returns the
 *    *previous* one unchanged when nothing actually changed, so `Object.is` equality keeps
 *    unrelated subscribers still.
 */

import { create } from 'zustand';
import { FULL_CAPABILITIES } from '@joinery/shared';
import type { EngineCapabilities, EngineVariant } from '@joinery/shared';

export interface ConnectionCapabilitiesEntry {
  capabilities: EngineCapabilities;
  variant?: EngineVariant;
}

export interface CapabilitiesState {
  readonly byConnection: ReadonlyMap<string, ConnectionCapabilitiesEntry>;
  /** Record what `connection.connect` reported for one profile. */
  readonly setCapabilities: (connectionId: string, entry: ConnectionCapabilitiesEntry) => void;
  /** Forget one profile, reverting it to `FULL_CAPABILITIES`. Called on disconnect. */
  readonly clearCapabilities: (connectionId: string) => void;
}

export type CapabilitiesStore = ReturnType<typeof createCapabilitiesStore>;

export function createCapabilitiesStore() {
  return create<CapabilitiesState>()(set => ({
    byConnection: new Map(),

    setCapabilities: (connectionId, entry) =>
      set(state => {
        const next = new Map(state.byConnection);
        next.set(connectionId, entry);
        return { byConnection: next };
      }),

    clearCapabilities: connectionId =>
      set(state => {
        if (!state.byConnection.has(connectionId)) return state;
        const next = new Map(state.byConnection);
        next.delete(connectionId);
        return { byConnection: next };
      }),
  }));
}

export const capabilitiesStore = createCapabilitiesStore();
export const useCapabilitiesStore = capabilitiesStore;

/**
 * The capabilities to assume for one connection. Was `CapabilitiesStore.for()`; renamed because
 * `for` is only legal as a member name, and a selector has to be a standalone function.
 */
export function selectCapabilitiesFor(connectionId: string | undefined) {
  return (state: CapabilitiesState): EngineCapabilities => {
    if (!connectionId) return FULL_CAPABILITIES;
    return state.byConnection.get(connectionId)?.capabilities ?? FULL_CAPABILITIES;
  };
}

export function selectVariantFor(connectionId: string | undefined) {
  return (state: CapabilitiesState): EngineVariant | undefined => {
    if (!connectionId) return undefined;
    return state.byConnection.get(connectionId)?.variant;
  };
}
