import { describe, it, expect } from 'vitest';
import { FULL_CAPABILITIES } from '@joinery/shared';
import { CapabilitiesStore } from './capabilities.state';

describe('CapabilitiesStore', () => {
  const dsqlCaps = {
    supportsMultipleDatabases: false,
    supportsDatabaseManagement: false,
    supportsStoredProcedures: false,
    supportsTriggers: false,
    supportsBackupRestore: false,
  };

  it('defaults to FULL_CAPABILITIES for unknown or undefined connections', () => {
    const store = new CapabilitiesStore();
    expect(store.for('nope')).toEqual(FULL_CAPABILITIES);
    expect(store.for(undefined)).toEqual(FULL_CAPABILITIES);
    expect(store.variantFor('nope')).toBeUndefined();
  });

  it('returns stored capabilities and variant', () => {
    const store = new CapabilitiesStore();
    store.set('c1', { capabilities: dsqlCaps, variant: 'dsql' });
    expect(store.for('c1').supportsTriggers).toBe(false);
    expect(store.variantFor('c1')).toBe('dsql');
  });

  it('clear() reverts a connection to defaults', () => {
    const store = new CapabilitiesStore();
    store.set('c1', { capabilities: dsqlCaps, variant: 'dsql' });
    store.clear('c1');
    expect(store.for('c1')).toEqual(FULL_CAPABILITIES);
    expect(store.variantFor('c1')).toBeUndefined();
  });
});
