/**
 * Shared diagnostics types for the cross-process log stream that backs the
 * Output / Console panel and "Details" affordance on error toasts.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Where a log entry originated. */
export type LogSource = 'main' | 'renderer';

export interface LogEntry {
  /** Stable id so the renderer can de-dup and scroll-to a specific entry. */
  id: string;
  /** Epoch milliseconds. */
  timestamp: number;
  level: LogLevel;
  /** Subsystem tag, e.g. "PoolManager", "IPC:Database". */
  tag: string;
  message: string;
  source: LogSource;
  /**
   * Full detail for the expandable view: stack trace, SQL that failed,
   * engine-specific error fields (mssql number/lineNumber, pg detail/hint),
   * already flattened to a string so it survives the IPC boundary intact.
   */
  detail?: string;
}
