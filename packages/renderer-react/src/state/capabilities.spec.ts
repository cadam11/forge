/**
 * Ported from `packages/renderer/src/app/core/state/capabilities.state.spec.ts`.
 *
 * Every assertion is the original's. Two mechanical changes: `new CapabilitiesStore()` becomes
 * `createCapabilitiesStore()` (the factory from the store conventions), and the two argument-taking
 * readers `store.for(id)` / `store.variantFor(id)` become the exported selectors applied to a
 * state snapshot — Zustand has no methods-on-a-service to call.
 */

import { describe, it, expect } from 'vitest';
import { FULL_CAPABILITIES } from '@joinery/shared';
import {
  createCapabilitiesStore,
  selectCapabilitiesFor,
  selectVariantFor,
  type CapabilitiesStore,
} from './capabilities';

const capabilitiesFor = (store: CapabilitiesStore, id: string | undefined) =>
  selectCapabilitiesFor(id)(store.getState());
const variantFor = (store: CapabilitiesStore, id: string | undefined) =>
  selectVariantFor(id)(store.getState());

describe('capabilities store', () => {
  const dsqlCaps = {
    supportsMultipleDatabases: false,
    supportsDatabaseManagement: false,
    supportsStoredProcedures: false,
    supportsTriggers: false,
    supportsBackupRestore: false,
  };

  it('defaults to FULL_CAPABILITIES for unknown or undefined connections', () => {
    const store = createCapabilitiesStore();
    expect(capabilitiesFor(store, 'nope')).toEqual(FULL_CAPABILITIES);
    expect(capabilitiesFor(store, undefined)).toEqual(FULL_CAPABILITIES);
    expect(variantFor(store, 'nope')).toBeUndefined();
  });

  it('returns stored capabilities and variant', () => {
    const store = createCapabilitiesStore();
    store.getState().setCapabilities('c1', { capabilities: dsqlCaps, variant: 'dsql' });
    expect(capabilitiesFor(store, 'c1').supportsTriggers).toBe(false);
    expect(variantFor(store, 'c1')).toBe('dsql');
  });

  it('clearCapabilities() reverts a connection to defaults', () => {
    const store = createCapabilitiesStore();
    store.getState().setCapabilities('c1', { capabilities: dsqlCaps, variant: 'dsql' });
    store.getState().clearCapabilities('c1');
    expect(capabilitiesFor(store, 'c1')).toEqual(FULL_CAPABILITIES);
    expect(variantFor(store, 'c1')).toBeUndefined();
  });

  it('leaves the previous map identity alone when clearing an absent connection', () => {
    // New: convention 4 (clone-on-write returns the previous container when nothing changed) is
    // what keeps unrelated subscribers still, and it is invisible to the ported assertions.
    const store = createCapabilitiesStore();
    const before = store.getState().byConnection;
    store.getState().clearCapabilities('never-set');
    expect(store.getState().byConnection).toBe(before);
  });
});
