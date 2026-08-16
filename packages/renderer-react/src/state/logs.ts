/**
 * The diagnostics hub behind the Output / Console panel, and the sink Task 4's
 * `diagnostics.*` seam has been waiting for.
 *
 * Ported from `packages/renderer/src/app/core/services/log.service.ts` (117 LOC). Conventions:
 * `capabilities.ts`. Three jobs, same as the original:
 *
 *  1. mirror the main-process log stream — the recent buffer once, then live entries;
 *  2. record renderer-originated entries locally AND forward them to main so the on-disk log
 *     file holds one unified timeline;
 *  3. own the panel's open state, its unseen-error badge, and "scroll to this entry".
 *
 * ── What is new here, and why ─────────────────────────────────────────────────────────────
 *
 * **The forward to main is throttled.** PLAN.md §7.8 lists `logs.append` as an unthrottled
 * write the renderer can drive at will: every forwarded entry is an IPC round trip that ends
 * in a synchronous `electron-store`-adjacent file append in the main process. One misbehaving
 * effect — or a chat stream logging per chunk — turns that into a write storm on the main
 * thread, which is the thread that also paints the window. Fixing the contract is out of scope
 * (§8), so the guard is client-side, cheap, and visible: a token bucket over a one-second
 * window, and when it overflows the store forwards ONE summary entry instead of the flood. The
 * dropped entries are still shown locally — the throttle protects the IPC channel, not the UI,
 * and hiding a diagnostic from the person reading the diagnostics panel would be the wrong
 * trade every time.
 *
 * **The IPC subscription is a hook, not a constructor side effect.** `useLogStream` (below)
 * uses the Task 3 layer — `useIpcQuery` for the recent buffer and `useIpcEvent` for the live
 * channel — so the availability guard, the StrictMode-safe teardown and the pre-paint handler
 * ref all come with it. The store itself never touches the bridge except to forward an entry,
 * which keeps its de-duplication and bucketing testable with no bridge at all.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import type { LogEntry, LogLevel } from '@joinery/shared';
import { ipc, isIpcAvailable, useIpcEvent, useIpcQuery } from '../ipc';
import { setDiagnosticsSink, type DiagnosticsSink } from './diagnostics';

/** Matches the Angular original. The panel is virtualization-free, so this cap is also its. */
const MAX_ENTRIES = 1000;

/** Token bucket for the forward-to-main path. See the module comment. */
const APPEND_WINDOW_MS = 1000;
const MAX_APPENDS_PER_WINDOW = 20;

export interface LogStoreState {
  readonly entries: readonly LogEntry[];
  readonly isOpen: boolean;
  /** The entry the panel should scroll to and expand — set when opened from an error toast. */
  readonly focusedEntryId: string | null;
  /** Errors logged since the user last looked at the panel. Drives the status-bar badge. */
  readonly unseenErrors: number;

  /** Adopts the recent buffer read from main at startup. Idempotent. */
  readonly hydrate: (recent: readonly LogEntry[]) => void;
  /** Appends one entry from any source, de-duplicated by id. */
  readonly push: (entry: LogEntry) => void;
  /** Records a renderer-originated entry, shows it, and forwards it to main (throttled). */
  readonly addLocal: (level: LogLevel, tag: string, message: string, detail?: string) => LogEntry;

  readonly open: (focusEntryId?: string) => void;
  readonly close: () => void;
  readonly toggle: () => void;
  readonly clearFocus: () => void;
  readonly clear: () => void;
  readonly revealFile: () => void;
}

export type LogStore = ReturnType<typeof createLogStore>;

/** Injected so the throttle can be tested without waiting a real second. */
export interface LogStoreOptions {
  readonly now?: () => number;
}

export function createLogStore(options: LogStoreOptions = {}) {
  const now = options.now ?? (() => Date.now());

  // Bucket bookkeeping: resources, not state. Nothing renders them and no component may
  // reach them, which is what keeps "the throttle cannot be disabled from the UI" true.
  let windowStartedAt = 0;
  let appendsThisWindow = 0;
  let suppressedThisWindow = 0;

  return create<LogStoreState>()((set, get) => {
    /**
     * Forwards an entry to main if the bucket allows it. Returns nothing: the caller has
     * already shown the entry locally, so a refusal here is not a failure it can act on.
     *
     * The summary entry is forwarded on the FIRST send of a new window rather than on a timer,
     * so this function owns no timers and cannot leak one. The cost is that a flood which stops
     * dead reports its tail on the next log line rather than a second later — acceptable for a
     * diagnostic about diagnostics, and it keeps the whole guard at three numbers.
     */
    const forwardToMain = (entry: LogEntry): void => {
      if (!isIpcAvailable()) return;

      const timestamp = now();
      if (timestamp - windowStartedAt >= APPEND_WINDOW_MS) {
        const dropped = suppressedThisWindow;
        windowStartedAt = timestamp;
        appendsThisWindow = 0;
        suppressedThisWindow = 0;
        if (dropped > 0) {
          const summary: LogEntry = {
            id: `r-throttle-${timestamp}`,
            timestamp,
            level: 'warn',
            tag: 'renderer',
            message: `${dropped} renderer log entr${dropped === 1 ? 'y was' : 'ies were'} not forwarded to the log file (rate limit)`,
            source: 'renderer',
          };
          appendsThisWindow += 1;
          void ipc()
            .logs.append(summary)
            .catch(() => undefined);
        }
      }

      if (appendsThisWindow >= MAX_APPENDS_PER_WINDOW) {
        suppressedThisWindow += 1;
        return;
      }
      appendsThisWindow += 1;
      // Fire-and-forget with an explicit swallow: this IS the error-reporting path, so routing
      // its own failure back through `diagnostics` would recurse.
      void ipc()
        .logs.append(entry)
        .catch(() => undefined);
    };

    return {
      entries: [],
      isOpen: false,
      focusedEntryId: null,
      unseenErrors: 0,

      hydrate: recent => {
        if (recent.length === 0) return;
        set({ entries: recent.slice(-MAX_ENTRIES) });
      },

      push: entry => {
        const entries = get().entries;
        // De-dup: a renderer entry is forwarded to main and streams back with the same id, and
        // the initial buffer read can overlap the first live events.
        if (entries.some(e => e.id === entry.id)) return;

        const next = [...entries, entry];
        set({
          entries: next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next,
          unseenErrors:
            entry.level === 'error' && !get().isOpen ? get().unseenErrors + 1 : get().unseenErrors,
        });
      },

      addLocal: (level, tag, message, detail) => {
        const entry: LogEntry = {
          id: `r-${crypto.randomUUID()}`,
          timestamp: now(),
          level,
          tag,
          message,
          source: 'renderer',
          ...(detail === undefined ? {} : { detail }),
        };
        get().push(entry);
        forwardToMain(entry);
        return entry;
      },

      open: focusEntryId => {
        set({ isOpen: true, unseenErrors: 0, focusedEntryId: focusEntryId ?? null });
      },

      close: () => set({ isOpen: false }),

      toggle: () => {
        if (get().isOpen) get().close();
        else get().open();
      },

      clearFocus: () => set({ focusedEntryId: null }),

      clear: () => set({ entries: [], unseenErrors: 0 }),

      revealFile: () => {
        if (!isIpcAvailable()) return;
        void ipc()
          .logs.revealFile()
          .catch(() => undefined);
      },
    };
  });
}

export const logStore = createLogStore();
export const useLogStore = logStore;

// ── Selectors ────────────────────────────────────────────────────────────────────────────────

export function selectErrorCount(state: Pick<LogStoreState, 'entries'>): number {
  return state.entries.filter(e => e.level === 'error').length;
}

/** Fresh array — subscribe with `useShallow`, or read `entries` and filter in a memo. */
export function selectErrorEntries(state: Pick<LogStoreState, 'entries'>): readonly LogEntry[] {
  return state.entries.filter(e => e.level === 'error');
}

// ── The two seams the shell closes ───────────────────────────────────────────────────────────

/**
 * Points Task 4's `diagnostics.*` façade at this store, so every `catch` block in the nine
 * ported stores lands in the Output panel and in the on-disk log file instead of the devtools
 * console nobody has open. Returns the teardown that restores the previous sink.
 *
 * `cause` is `unknown` by contract, so it is rendered rather than trusted: an `Error` becomes
 * message + stack, anything else is JSON if it can be and `String(cause)` if it cannot.
 */
export function installLogDiagnosticsSink(store: LogStore = logStore): () => void {
  const write = (level: 'error' | 'warn', context: string, cause: unknown): void => {
    store.getState().addLocal(level, 'renderer', context, describeCause(cause));
  };

  const sink: DiagnosticsSink = {
    error: (context, cause) => write('error', context, cause),
    warn: (context, cause) => write('warn', context, cause),
  };
  return setDiagnosticsSink(sink);
}

/** Exported for its own test: the shape of a rendered `unknown` is easy to get wrong. */
export function describeCause(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof Error) return cause.stack ?? `${cause.name}: ${cause.message}`;
  if (typeof cause === 'string') return cause;
  try {
    return JSON.stringify(cause, null, 2);
  } catch {
    // A circular object, or a BigInt. Either way `String` always answers.
    return String(cause);
  }
}

/**
 * Mirrors the main-process log stream into the store. Mount exactly once, from the shell.
 *
 * The recent buffer is a query and the live channel is a subscription — the split PLAN.md §2
 * prescribes. `hydrate` is idempotent and `push` de-duplicates on id, so the overlap between
 * "the buffer main had when we asked" and "the entries that arrived while we were asking"
 * resolves itself rather than needing a sequence number.
 */
export function useLogStream(store: LogStore = logStore): void {
  const recent = useIpcQuery({
    namespace: 'logs',
    operation: 'getRecent',
    args: [MAX_ENTRIES],
    keyArgs: [MAX_ENTRIES],
    enabled: isIpcAvailable(),
  });

  const hydrate = store(state => state.hydrate);
  const push = store(state => state.push);

  // An effect, not a straight call during render: a store write while rendering updates other
  // subscribed components mid-render, which React reports as an error rather than tolerating.
  // The cost is one paint with an empty panel, which nobody is looking at during startup.
  useEffect(() => {
    if (recent.data !== undefined) hydrate(recent.data);
  }, [recent.data, hydrate]);

  useIpcEvent('logs', 'onEntry', push);
}
