/**
 * Credential-store IPC — keychain AVAILABILITY only (J-118).
 *
 * Nothing about a credential crosses this boundary: no value, no key, no count. The renderer
 * is told one boolean, so it can say in the status bar that passwords will not be saved this
 * session instead of leaving the user with "my passwords keep disappearing".
 *
 * Two directions, because degradation has two arrival times. The keychain can already be
 * refused during the startup vault read — before any window has finished loading, so a push
 * would land on nobody — which is what GET_KEYCHAIN_STATUS answers on mount. And it can fail
 * later, on a save or a delete, which is what KEYCHAIN_STATUS_CHANGED pushes.
 *
 * The subscription is taken through `CredentialStore.onStatusChanged`, so this file never
 * reads the store's internals and the store never imports electron.
 */

import { BrowserWindow } from 'electron';
import { IPC_CHANNELS, type KeychainStatus } from '@joinery/shared';
import { CredentialStore } from '../services/keychain/credential-store';
import { safeHandle } from './safe-handle';

function broadcastKeychainStatus(status: KeychainStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.CREDENTIALS.KEYCHAIN_STATUS_CHANGED, status);
    }
  }
}

export function registerCredentialHandlers(): void {
  const store = CredentialStore.getInstance();

  safeHandle(IPC_CHANNELS.CREDENTIALS.GET_KEYCHAIN_STATUS, async (): Promise<KeychainStatus> => ({
    available: store.isKeychainAvailable(),
  }));

  // Held for the life of the process on purpose: the store is a singleton and the
  // degradation edge fires at most once, so there is nothing to unsubscribe from.
  store.onStatusChanged(broadcastKeychainStatus);
}
