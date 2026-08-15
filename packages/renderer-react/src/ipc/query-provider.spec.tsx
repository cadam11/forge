import { useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ipc, IpcUnavailableError } from './api';
import { ipcKeys } from './keys';
import { createIpcQueryClient, IpcQueryProvider } from './query-provider';
import { installJoineryMock, removeJoineryMock } from '../test/joinery-mock';

/** The smallest real consumer of the layer: one query, keyed by the factory. */
function AppVersion() {
  const { data, error } = useQuery({
    queryKey: ipcKeys.app.key('getVersion'),
    queryFn: () => ipc().app.getVersion(),
  });

  if (error) {
    return <p data-testid="probe-error">{error.name}</p>;
  }
  return <p data-testid="probe-version">{data ?? 'loading'}</p>;
}

describe('createIpcQueryClient', () => {
  it('disables retries, because a rejected invoke is an answer and not a blip', () => {
    const defaults = createIpcQueryClient().getDefaultOptions();

    expect(defaults.queries?.retry).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);
  });

  it('does not refetch on window focus, which a desktop window changes constantly', () => {
    expect(createIpcQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });

  it('gives results a staleTime, so co-mounted panels share one read', () => {
    expect(createIpcQueryClient().getDefaultOptions().queries?.staleTime).toBe(30_000);
  });
});

describe('IpcQueryProvider', () => {
  afterEach(() => {
    removeJoineryMock();
  });

  it('resolves a query through the bridge', async () => {
    installJoineryMock({ app: { getVersion: () => Promise.resolve('0.5.0') } });

    render(
      <IpcQueryProvider>
        <AppVersion />
      </IpcQueryProvider>
    );

    await waitFor(() => expect(screen.getByTestId('probe-version').textContent).toBe('0.5.0'));
  });

  it('surfaces the availability guard as a query error rather than a crash', async () => {
    removeJoineryMock();

    render(
      <IpcQueryProvider>
        <AppVersion />
      </IpcQueryProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('probe-error').textContent).toBe(IpcUnavailableError.name)
    );
  });

  it('does not retry a failing query', async () => {
    const getVersion = vi.fn(() => Promise.reject(new Error('main process said no')));
    installJoineryMock({ app: { getVersion } });

    render(
      <IpcQueryProvider>
        <AppVersion />
      </IpcQueryProvider>
    );

    await waitFor(() => expect(screen.getByTestId('probe-error')).toBeDefined());
    expect(getVersion).toHaveBeenCalledTimes(1);
  });
});
