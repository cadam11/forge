import { Injectable, computed, inject, signal } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import type { LogEntry, LogLevel } from '@mj-forge/shared';
import { IpcService } from './ipc.service';

const MAX_ENTRIES = 1000;

/**
 * Renderer-side diagnostics hub backing the Output / Console panel.
 *
 * - Mirrors the main-process log stream (loaded on init, then live via IPC).
 * - Captures renderer-originated errors (uncaught + surfaced toasts) so the
 *   panel shows one unified timeline, and forwards them to main so they land
 *   in the on-disk log file too.
 * - Owns the panel's open/visibility state and "scroll to this entry" focus.
 */
@Injectable({ providedIn: 'root' })
export class LogService {
  private readonly ipc = inject(IpcService);

  private readonly _entries = signal<LogEntry[]>([]);
  readonly entries = this._entries.asReadonly();

  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  /** Entry the panel should scroll to / highlight (set when opened via a toast). */
  private readonly _focusedEntryId = signal<string | null>(null);
  readonly focusedEntryId = this._focusedEntryId.asReadonly();

  /** Errors logged since the user last viewed the panel — drives the badge. */
  private readonly _unseenErrors = signal(0);
  readonly unseenErrors = this._unseenErrors.asReadonly();

  readonly errorCount = computed(() => this._entries().filter(e => e.level === 'error').length);

  private initialized = false;

  /** Idempotent: load the recent buffer and start streaming live entries. */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const recent = await this.ipc.getRecentLogs(MAX_ENTRIES);
      if (recent.length) this._entries.set(recent.slice(-MAX_ENTRIES));
    } catch {
      /* best-effort */
    }

    this.ipc.onLogEntry(entry => this.push(entry));
  }

  private push(entry: LogEntry): void {
    let added = false;
    this._entries.update(list => {
      // De-dup: renderer-originated entries are forwarded to main and stream
      // back with the same id, and the initial buffer load can overlap the
      // first live events.
      if (list.some(e => e.id === entry.id)) return list;
      added = true;
      const next = [...list, entry];
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    });
    if (added && entry.level === 'error' && !this._isOpen()) {
      this._unseenErrors.update(n => n + 1);
    }
  }

  /**
   * Record a renderer-originated entry. Shown immediately and forwarded to main
   * so it's persisted in the shared log file. The forwarded copy streams back
   * via onEntry, so we tag a local id and de-dup on it.
   */
  addLocal(level: LogLevel, tag: string, message: string, detail?: string): LogEntry {
    const entry: LogEntry = {
      id: `r-${uuidv4()}`,
      timestamp: Date.now(),
      level,
      tag,
      message,
      source: 'renderer',
      detail,
    };
    this.push(entry);
    void this.ipc.appendLog(entry).catch(() => undefined);
    return entry;
  }

  open(focusEntryId?: string): void {
    this._isOpen.set(true);
    this._unseenErrors.set(0);
    this._focusedEntryId.set(focusEntryId ?? null);
  }

  close(): void {
    this._isOpen.set(false);
  }

  toggle(): void {
    if (this._isOpen()) this.close();
    else this.open();
  }

  clearFocus(): void {
    this._focusedEntryId.set(null);
  }

  clear(): void {
    this._entries.set([]);
    this._unseenErrors.set(0);
  }

  revealFile(): void {
    void this.ipc.revealLogFile().catch(() => undefined);
  }
}
