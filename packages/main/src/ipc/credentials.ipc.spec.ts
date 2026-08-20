/**
 * The credentials channel (J-118). The first unit spec for an IPC handler in this package, so
 * it states its own harness: electron is replaced with the two members this file touches —
 * `ipcMain.handle`, which is captured so the handler can be invoked directly, and
 * `BrowserWindow.getAllWindows`, which is fed a list of fake windows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@joinery/shared';
// Resolved to packages/main/src/__mocks__/keytar.ts via the vitest alias.
import * as keytar from 'keytar';
// Safe as static imports: vitest hoists the `vi.mock` below above every import, so both of
// these see the fake electron. (`await import(…)` would say the same thing and would not
// compile — this package emits CommonJS, which has no top-level await.)
import { CredentialStore } from '../services/keychain/credential-store';
import { registerCredentialHandlers } from './credentials.ipc';

interface SentMessage {
  readonly channel: string;
  readonly payload: unknown;
}

interface FakeWindow {
  destroyed: boolean;
  readonly sent: SentMessage[];
  readonly isDestroyed: () => boolean;
  readonly webContents: { send: (channel: string, payload: unknown) => void };
}

/** `vi.hoisted` because the `vi.mock` factory below runs before this module's own body. */
const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  windows: [] as {
    isDestroyed: () => boolean;
    webContents: { send: (c: string, p: unknown) => void };
  }[],
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler);
    },
  },
  BrowserWindow: { getAllWindows: () => electron.windows },
}));

function makeWindow(): FakeWindow {
  const sent: SentMessage[] = [];
  const win: FakeWindow = {
    destroyed: false,
    sent,
    isDestroyed: () => win.destroyed,
    webContents: { send: (channel, payload) => sent.push({ channel, payload }) },
  };
  electron.windows.push(win);
  return win;
}

/** Calls the registered invoke handler the way `ipcRenderer.invoke` would. */
async function invokeStatus(): Promise<unknown> {
  const handler = electron.handlers.get(IPC_CHANNELS.CREDENTIALS.GET_KEYCHAIN_STATUS);
  expect(handler, 'GET_KEYCHAIN_STATUS was never registered').toBeDefined();
  return handler?.({});
}

const spies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(async () => {
  electron.handlers.clear();
  electron.windows.length = 0;
  CredentialStore.resetInstance();
  await keytar.setPassword('svc', 'credentials-vault', JSON.stringify({ 'conn-1': 'secret' }));
  registerCredentialHandlers();
});

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore();
});

describe('credentials IPC', () => {
  it('answers the current availability on invoke', async () => {
    await expect(invokeStatus()).resolves.toEqual({ available: true });
  });

  it('answers false once the keychain has been refused', async () => {
    spies.push(vi.spyOn(keytar, 'setPassword').mockRejectedValue(new Error('keychain is locked')));

    await CredentialStore.getInstance().set('conn-2', 'super-secret-value');

    await expect(invokeStatus()).resolves.toEqual({ available: false });
  });

  it('pushes the degradation to every live window, and skips destroyed ones', async () => {
    const live = makeWindow();
    const closing = makeWindow();
    closing.destroyed = true;
    spies.push(vi.spyOn(keytar, 'setPassword').mockRejectedValue(new Error('keychain is locked')));

    await CredentialStore.getInstance().set('conn-2', 'super-secret-value');

    expect(live.sent).toEqual([
      {
        channel: IPC_CHANNELS.CREDENTIALS.KEYCHAIN_STATUS_CHANGED,
        payload: { available: false },
      },
    ]);
    expect(closing.sent).toEqual([]);
  });

  it('pushes availability and nothing else — no credential crosses the bridge', async () => {
    const win = makeWindow();
    spies.push(vi.spyOn(keytar, 'setPassword').mockRejectedValue(new Error('keychain is locked')));

    await CredentialStore.getInstance().set('conn-2', 'super-secret-value');

    const serialised = JSON.stringify(win.sent);
    expect(serialised).not.toContain('super-secret-value');
    expect(serialised).not.toContain('conn-2');
  });

  it('pushes once, not once per failed write', async () => {
    const win = makeWindow();
    spies.push(vi.spyOn(keytar, 'setPassword').mockRejectedValue(new Error('keychain is locked')));

    const store = CredentialStore.getInstance();
    await store.set('conn-2', 'a');
    await store.set('conn-3', 'b');

    expect(win.sent).toHaveLength(1);
  });

  it('pushes nothing while the keychain is working', async () => {
    const win = makeWindow();

    await CredentialStore.getInstance().set('conn-2', 'another-secret');

    expect(win.sent).toEqual([]);
  });
});
