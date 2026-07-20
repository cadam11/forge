/**
 * Diagnostics / logging IPC bridge.
 *
 * Wires the electron-free logger ring buffer (utils/logger) to the renderer:
 *   - streams every new entry to all windows (LOG.ENTRY),
 *   - serves the recent buffer on demand (LOG.GET_RECENT),
 *   - accepts renderer-originated entries into the shared timeline (LOG.APPEND),
 *   - appends entries to an on-disk log file and can reveal it (LOG.REVEAL_FILE).
 *
 * This is the only place that couples logging to electron, so utils/logger
 * stays safe to import from unit-tested code.
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { createWriteStream, mkdirSync, type WriteStream } from 'fs';
import { join } from 'path';
import type { LogEntry } from '@mj-forge/shared';
import { IPC_CHANNELS } from '@mj-forge/shared';
import { onLogEntry, getRecentLogs, ingestExternalEntry } from '../utils/logger';

let logStream: WriteStream | null = null;
let logFilePath = '';

function logFileLine(entry: LogEntry): string {
  const ts = new Date(entry.timestamp).toISOString();
  const base = `${ts} [${entry.level.toUpperCase()}] [${entry.source}] [${entry.tag}] ${entry.message}`;
  return entry.detail ? `${base}\n    ${entry.detail.replace(/\n/g, '\n    ')}\n` : `${base}\n`;
}

function broadcast(entry: LogEntry): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.LOG.ENTRY, entry);
    }
  }
  logStream?.write(logFileLine(entry));
}

export function registerLogHandlers(): void {
  // Open the on-disk log file under the OS logs dir. Best-effort: if this
  // fails we still stream to the renderer and console.
  try {
    const dir = app.getPath('logs');
    mkdirSync(dir, { recursive: true });
    logFilePath = join(dir, 'forge.log');
    logStream = createWriteStream(logFilePath, { flags: 'a' });
  } catch {
    logStream = null;
  }

  onLogEntry(broadcast);

  ipcMain.handle(IPC_CHANNELS.LOG.GET_RECENT, (_event, limit?: number) => getRecentLogs(limit));

  ipcMain.handle(IPC_CHANNELS.LOG.APPEND, (_event, entry: LogEntry) => {
    // Trust only the shape we control; stamp source so a buggy/hostile
    // renderer can't masquerade as main.
    ingestExternalEntry({ ...entry, source: 'renderer' });
  });

  ipcMain.handle(IPC_CHANNELS.LOG.REVEAL_FILE, () => {
    if (logFilePath) shell.showItemInFolder(logFilePath);
    return logFilePath;
  });
}
