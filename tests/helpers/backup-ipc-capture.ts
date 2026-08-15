/**
 * Test helper for backup/restore integration tests.
 *
 * The PgBackupService and MySQLBackupService report completion via
 * `BrowserWindow.getAllWindows()[i].webContents.send(channel, payload)`.
 * In a Node-only Vitest run there are no windows, so completion goes
 * nowhere and the caller has no signal to await.
 *
 * Each spec mocks `electron` to install a fake `BrowserWindow` whose
 * `webContents.send` pushes payloads into the `IpcCapture.events` array
 * exported here. Tests then call `waitForOperation(capture, opId)` to
 * resolve once the matching `completed` or `failed` event arrives.
 *
 * Usage (top of spec file):
 *
 *   import { ipcCapture } from '../../helpers/backup-ipc-capture';
 *   vi.mock('electron', () => ({
 *     BrowserWindow: {
 *       getAllWindows: () => [{
 *         webContents: { send: ipcCapture.send },
 *       }],
 *     },
 *   }));
 */

export interface CapturedIpcEvent {
  channel: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

export interface IpcCapture {
  events: CapturedIpcEvent[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send: (channel: string, payload: any) => void;
  reset: () => void;
}

/**
 * Singleton capture instance. Spec files reset() it in beforeEach.
 */
export const ipcCapture: IpcCapture = (() => {
  const events: CapturedIpcEvent[] = [];
  return {
    events,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send(channel: string, payload: any): void {
      events.push({ channel, payload });
    },
    reset(): void {
      events.length = 0;
    },
  };
})();

/**
 * Resolve once an IPC progress event with the given operationId arrives
 * with status 'completed' or 'failed'. Throws on timeout (default 30s).
 */
export async function waitForOperation(
  capture: IpcCapture,
  operationId: string,
  timeoutMs: number = 30_000
): Promise<{ success: boolean; error?: string }> {
  const POLL_MS = 50;
  const MAX_ITER = Math.ceil(timeoutMs / POLL_MS);
  for (let i = 0; i < MAX_ITER; i++) {
    // Different services use different id field names: PG/MySQL use
    // `operationId`, the MSSQL BackupRestoreService uses `backupId` /
    // `restoreId`. Match all three so this helper works across engines.
    const hit = capture.events.find(
      e =>
        (e.payload?.operationId === operationId ||
          e.payload?.backupId === operationId ||
          e.payload?.restoreId === operationId) &&
        (e.payload?.status === 'completed' || e.payload?.status === 'failed')
    );
    if (hit) {
      return {
        success: hit.payload.status === 'completed',
        error: hit.payload.error,
      };
    }
    await sleep(POLL_MS);
  }
  throw new Error(
    `[backup-ipc-capture] timed out after ${timeoutMs}ms waiting for operation ${operationId}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
