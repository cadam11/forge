import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '@joinery/shared';
import { createIpcQueryClient } from './query-provider';
import { useIpcMutation, useIpcQuery } from './use-ipc-call';
import { installJoineryMock, removeJoineryMock } from '../test/joinery-mock';

/** Renders `ui` against a fresh client and hands back that client for cache assertions. */
function renderWithClient(ui: React.ReactNode): QueryClient {
  const client = createIpcQueryClient();
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}

const keysIn = (client: QueryClient) =>
  client
    .getQueryCache()
    .getAll()
    .map(query => query.queryKey);

const PROFILE = { id: 'profile-1', name: 'local' } as unknown as ConnectionProfile;

afterEach(() => {
  removeJoineryMock();
});

describe('useIpcQuery', () => {
  it('calls the operation and keys it by namespace + operation', async () => {
    const getVersion = vi.fn(() => Promise.resolve('0.5.0'));
    installJoineryMock({ app: { getVersion } });

    function Probe() {
      const { data } = useIpcQuery({ namespace: 'app', operation: 'getVersion' });
      return <p data-testid="v">{data ?? 'loading'}</p>;
    }

    const client = renderWithClient(<Probe />);
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('0.5.0'));

    expect(getVersion).toHaveBeenCalledWith();
    expect(keysIn(client)).toEqual([['app', 'getVersion']]);
  });

  it('passes the call arguments through in order', async () => {
    const getChildren = vi.fn(() => Promise.resolve([]));
    installJoineryMock({ explorer: { getChildren } });

    function Probe() {
      useIpcQuery({
        namespace: 'explorer',
        operation: 'getChildren',
        args: ['conn-1', 'AdventureWorks', 'dbo/Tables'],
        keyArgs: ['conn-1', 'AdventureWorks', 'dbo/Tables'],
      });
      return null;
    }

    renderWithClient(<Probe />);
    await waitFor(() =>
      expect(getChildren).toHaveBeenCalledWith('conn-1', 'AdventureWorks', 'dbo/Tables')
    );
  });

  it('builds the key from keyArgs, not from the call arguments', async () => {
    // The key is deliberately narrower than the call here: one entry per database rather
    // than per tree path, so a reconnect invalidates the whole subtree at once.
    const getChildren = vi.fn(() => Promise.resolve([]));
    installJoineryMock({ explorer: { getChildren } });

    function Probe() {
      useIpcQuery({
        namespace: 'explorer',
        operation: 'getChildren',
        args: ['conn-1', 'AdventureWorks', 'dbo/Tables'],
        keyArgs: ['conn-1'],
      });
      return null;
    }

    const client = renderWithClient(<Probe />);
    await waitFor(() => expect(getChildren).toHaveBeenCalled());

    expect(keysIn(client)).toEqual([['explorer', 'getChildren', 'conn-1']]);
  });

  it('surfaces a missing bridge member as a named error rather than a stray undefined', async () => {
    installJoineryMock({ app: {} });

    function Probe() {
      const { error } = useIpcQuery({ namespace: 'app', operation: 'getVersion' });
      return <p data-testid="e">{error ? `${error.name}: ${error.message}` : 'pending'}</p>;
    }

    renderWithClient(<Probe />);
    await waitFor(() =>
      expect(screen.getByTestId('e').textContent).toBe(
        'TypeError: window.joinery.app.getVersion is not a function'
      )
    );
  });
});

describe('secrets cannot reach the query cache', () => {
  it('will not compile a parameterised operation without an explicit keyArgs', () => {
    function Probe() {
      // This is the guard. `connection.test(profile, password, sshPassword, sshPassphrase)`
      // — PLAN.md §7.1. If `keyArgs` were optional, or if the hook fell back to spreading
      // `args`, this would compile and put three passwords in the cache under
      // ['connection','test',…], readable by anything holding the QueryClient.
      // @ts-expect-error keyArgs is required for any operation that takes parameters
      useIpcQuery({
        namespace: 'connection',
        operation: 'test',
        args: [PROFILE, 'hunter2', 'ssh-secret', 'passphrase-secret'],
      });

      // The same call is legal once the caller says what identifies the result — and the
      // only thing it can name is data it chose, so a password cannot arrive by default.
      useIpcQuery({
        namespace: 'connection',
        operation: 'test',
        args: [PROFILE, 'hunter2', 'ssh-secret', 'passphrase-secret'],
        keyArgs: [PROFILE.id],
        enabled: false,
      });

      return null;
    }

    expect(Probe).toBeTypeOf('function');
  });

  it('keeps passwords out of the key at runtime even when they are passed to the call', async () => {
    const test = vi.fn(() => Promise.resolve({ success: true }));
    installJoineryMock({ connection: { test } });

    function Probe() {
      useIpcQuery({
        namespace: 'connection',
        operation: 'test',
        args: [PROFILE, 'hunter2', 'ssh-secret', 'passphrase-secret'],
        keyArgs: [PROFILE.id],
      });
      return null;
    }

    const client = renderWithClient(<Probe />);
    await waitFor(() => expect(test).toHaveBeenCalled());

    // The bridge did receive the secrets — they are needed for the call.
    expect(test).toHaveBeenCalledWith(PROFILE, 'hunter2', 'ssh-secret', 'passphrase-secret');

    // The cache did not. Asserted over the serialised key, so a secret nested anywhere in
    // it fails this test rather than slipping past an equality check on the top level.
    const serialised = JSON.stringify(keysIn(client));
    expect(keysIn(client)).toEqual([['connection', 'test', 'profile-1']]);
    for (const secret of ['hunter2', 'ssh-secret', 'passphrase-secret']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('gives mutations no query key at all', async () => {
    const save = vi.fn(() => Promise.resolve(PROFILE));
    installJoineryMock({ connection: { save } });

    function Probe() {
      const mutation = useIpcMutation({ namespace: 'connection', operation: 'save' });
      return <button onClick={() => mutation.mutate([PROFILE, 'hunter2'])}>save</button>;
    }

    const client = renderWithClient(<Probe />);
    screen.getByRole('button').click();

    await waitFor(() => expect(save).toHaveBeenCalledWith(PROFILE, 'hunter2'));

    // Mutation variables are never written to the query cache, so the write path has no
    // secret-leak surface to reason about at all.
    expect(keysIn(client)).toEqual([]);
  });
});

describe('the call is inferred from the preload declaration', () => {
  it('rejects wrong arity, wrong argument types and unknown operations', () => {
    function Probe() {
      useIpcQuery({
        namespace: 'explorer',
        operation: 'getChildren',
        // @ts-expect-error getChildren takes three arguments, not two
        args: ['conn-1', 'AdventureWorks'],
        keyArgs: ['conn-1'],
      });

      useIpcQuery({
        namespace: 'database',
        operation: 'getInfo',
        // @ts-expect-error database.getInfo takes strings, not a number
        args: ['conn-1', 42],
        keyArgs: ['conn-1'],
      });

      // @ts-expect-error onProgress is an event subscription, not an operation
      useIpcQuery({ namespace: 'backup', operation: 'onProgress', args: [], keyArgs: [] });

      // @ts-expect-error no such operation
      useIpcQuery({ namespace: 'app', operation: 'getVersionPlease' });

      // @ts-expect-error mutate takes save's own parameter list; a bare profile is not it
      useIpcMutation({ namespace: 'connection', operation: 'save' }).mutate(PROFILE);

      return null;
    }

    expect(Probe).toBeTypeOf('function');
  });

  it('infers the result type from the operation', async () => {
    installJoineryMock({ app: { getVersion: () => Promise.resolve('0.5.0') } });

    function Probe() {
      const { data } = useIpcQuery({ namespace: 'app', operation: 'getVersion' });
      // `data` is `string | undefined`, so a string method is legal and no cast is needed.
      return <p data-testid="upper">{data?.toUpperCase() ?? '-'}</p>;
    }

    renderWithClient(<Probe />);
    await waitFor(() => expect(screen.getByTestId('upper').textContent).toBe('0.5.0'));
  });
});
