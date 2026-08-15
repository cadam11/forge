/**
 * Safe IPC handler wrapper
 * Wraps ipcMain.handle with try/catch + error logging
 */

import { ipcMain } from 'electron';
import { createLogger } from '../utils/logger';

const log = createLogger('IPC');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IpcHandler = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any;

/**
 * Build a detail blob from an error: stack plus any engine-specific fields
 * (mssql exposes `number`/`lineNumber`/`state`; pg exposes `detail`/`hint`/
 * `where`/`code`). These never survive the IPC reject (only `message` does),
 * so we capture them into the log stream where the Output panel can show them.
 */
function errorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const lines: string[] = [];
  if (error.stack) lines.push(error.stack);

  const extraKeys = [
    'code',
    'number',
    'state',
    'lineNumber',
    'severity',
    'detail',
    'hint',
    'where',
    'constraint',
    'table',
    'sqlMessage',
    'sqlState',
  ];
  const bag = error as unknown as Record<string, unknown>;
  const extras = extraKeys
    .filter(k => bag[k] !== undefined && bag[k] !== null)
    .map(k => `${k}: ${String(bag[k])}`);
  if (extras.length) lines.push(extras.join('\n'));

  const joined = lines.join('\n');
  return joined.trim() ? joined : undefined;
}

/**
 * Register an IPC handler with automatic error logging.
 * Errors are logged with the channel name (with full detail captured into the
 * log stream) then re-thrown so Electron serialises them back to the renderer.
 */
export function safeHandle(channel: string, handler: IpcHandler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = errorDetail(error);
      // Pass the detail string as a trailing arg so the logger folds it into
      // the entry's expandable detail (and the renderer Output panel sees it).
      if (detail) {
        log.error(`${channel}: ${message}`, detail);
      } else {
        log.error(`${channel}: ${message}`);
      }
      throw error;
    }
  });
}
