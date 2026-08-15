/**
 * Theme IPC Handlers
 *
 * Uses Electron's nativeTheme API to detect macOS dark/light mode
 * and notify the renderer when the OS theme changes.
 */

import { nativeTheme, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@joinery/shared';
import { safeHandle } from './safe-handle';

export function registerThemeHandlers(): void {
  // Get the current native theme (dark or light)
  safeHandle(IPC_CHANNELS.THEME.GET_NATIVE, async (): Promise<'dark' | 'light'> => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  });

  // Listen for OS theme changes and broadcast to all renderer windows
  nativeTheme.on('updated', () => {
    const resolvedTheme: 'dark' | 'light' = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send(IPC_CHANNELS.THEME.CHANGED, resolvedTheme);
    }
  });
}
