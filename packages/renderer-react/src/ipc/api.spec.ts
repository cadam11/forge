import { afterEach, describe, expect, it, vi } from 'vitest';
import { findJoineryApi, ipc, IpcUnavailableError, isIpcAvailable } from './api';
import { installJoineryMock, removeJoineryMock } from '../test/joinery-mock';

describe('the availability guard', () => {
  afterEach(() => {
    removeJoineryMock();
  });

  it('reports the bridge as unavailable when preload never ran', () => {
    expect(isIpcAvailable()).toBe(false);
    expect(findJoineryApi()).toBeUndefined();
  });

  it('throws a named error from ipc() rather than returning something unusable', () => {
    expect(() => ipc()).toThrow(IpcUnavailableError);

    // Named, so a caller can tell "not in Electron" from "the main process said no".
    try {
      ipc();
      expect.unreachable('ipc() must throw when window.joinery is absent');
    } catch (error) {
      expect(error).toBeInstanceOf(IpcUnavailableError);
      expect((error as Error).name).toBe('IpcUnavailableError');
    }
  });

  it('returns the bridge once preload has exposed it', () => {
    const getVersion = vi.fn(() => Promise.resolve('0.5.0'));
    installJoineryMock({ app: { getVersion } });

    expect(isIpcAvailable()).toBe(true);
    expect(ipc()).toBe(findJoineryApi());
    expect(ipc().app.getVersion).toBe(getVersion);
  });

  it('re-reads the global instead of caching, so a late-arriving bridge is picked up', () => {
    expect(isIpcAvailable()).toBe(false);

    installJoineryMock({ app: { getVersion: () => Promise.resolve('0.5.0') } });
    expect(isIpcAvailable()).toBe(true);

    removeJoineryMock();
    expect(isIpcAvailable()).toBe(false);
    expect(() => ipc()).toThrow(IpcUnavailableError);
  });
});
