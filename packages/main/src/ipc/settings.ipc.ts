/**
 * Settings IPC Handlers
 * Provides get/set for application settings persisted via electron-store
 */

import { IPC_CHANNELS } from '@forgedb/shared';
import { AppStateStore } from '../services/config/app-state';
import { safeHandle } from './safe-handle';

export function registerSettingsHandlers(): void {
  const appState = AppStateStore.getInstance();

  safeHandle(IPC_CHANNELS.SETTINGS.GET, async (_event, key?: string): Promise<unknown> => {
    const state = appState.getState();
    if (key) {
      return (state as unknown as Record<string, unknown>)[key];
    }
    return state;
  });

  safeHandle(
    IPC_CHANNELS.SETTINGS.SET,
    async (_event, key: string, value: unknown): Promise<void> => {
      appState.setState({ [key]: value });
    }
  );
}
