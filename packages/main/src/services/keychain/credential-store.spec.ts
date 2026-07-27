import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Resolved to packages/main/src/__mocks__/keytar.ts via the vitest alias.
import * as keytar from 'keytar';
import { CredentialStore } from './credential-store';

describe('CredentialStore cache loading', () => {
  let getPasswordSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    CredentialStore.resetInstance();
    await keytar.setPassword('svc', 'credentials-vault', JSON.stringify({ 'conn-1': 'secret' }));
    getPasswordSpy = vi.spyOn(keytar, 'getPassword').mockImplementation(async () => {
      // Simulate a slow keychain so concurrent loads overlap.
      await new Promise(resolve => setTimeout(resolve, 20));
      return JSON.stringify({ 'conn-1': 'secret' });
    });
  });

  afterEach(() => {
    getPasswordSpy.mockRestore();
  });

  it('deduplicates concurrent loadAllIntoCache calls into one keychain read', async () => {
    const store = CredentialStore.getInstance();

    await Promise.all([store.loadAllIntoCache(), store.loadAllIntoCache(), store.get('conn-1')]);

    expect(getPasswordSpy).toHaveBeenCalledTimes(1);
  });

  it('get() self-loads when startup did not await the cache', async () => {
    const store = CredentialStore.getInstance();

    const password = await store.get('conn-1');

    expect(password).toBe('secret');
    expect(getPasswordSpy).toHaveBeenCalledTimes(1);
  });
});
