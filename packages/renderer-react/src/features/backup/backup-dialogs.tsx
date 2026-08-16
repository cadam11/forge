/**
 * The consumer `COMMAND_CONSUMERS` names for the two backup commands, and the one place that decides
 * whether the backup dialog is on screen.
 *
 * ── What this takes over ────────────────────────────────────────────────────────────────────
 *
 *  - **`open-backup-dialog`** — Database ▸ Backup on the native menu. PLAN.md 0.1's second broken
 *    item: `menu.service.ts:211` implemented it as `router.navigate(['/backup'])` into a router with
 *    no `router-outlet`, so it had done nothing for months. Task 7 parked a placeholder on the wire;
 *    the placeholder is deleted in the same commit that adds this file, so the command is never
 *    handled twice.
 *  - **`backup-database`** — the sidebar's database context menu and its footer action, both of which
 *    carry the connection and database they mean.
 *
 * The menu carries no payload, so it resolves its target from `mostRecentConnectionId()` (not focus —
 * see the comment on the handler below); the sidebar states it. That is
 * the whole reason the registry has both ids (see its §"The sidebar's dialog entry points"), and it is
 * why the resolution lives here rather than in the dialog: a dialog whose props may be "no database"
 * would need an empty state for a case that should never open it.
 *
 * ── Why the engine is resolved at dispatch ──────────────────────────────────────────────────
 *
 * Every option decision in the wizard reads the engine (`backup-model.ts`), and the profile is where
 * it lives. Resolving it here means a stale context menu — right-click a database, delete the
 * connection in the manager, then pick the item — reports "that connection no longer exists" instead
 * of opening a dialog with no engine, which is the same shape `connection-dialogs.tsx` uses and for
 * the same reason: a failure reported from inside `render` is a side effect of rendering.
 *
 * ── Why the in-flight record lives here ─────────────────────────────────────────────────────
 *
 * A dump outlives the dialog that started it: closing the dialog does not stop it (J-48 item e —
 * `BackupRestoreService.cancel` only stops the progress poll, so there is nothing honest to offer but
 * Close). Nothing in `packages/main` guards against a second dump of the same database — `pg-backup.ts`
 * mints a fresh operation id per call and never looks at the destination, so two `pg_dump` processes
 * will happily interleave into one archive and **both report success** (J-48 item f). So the record of
 * what is still running has to survive the dialog it was started from, which is why it is module state
 * rather than component state, and why the subscription that retires an entry is on this always-mounted
 * component rather than on the dialog.
 *
 * It is a mitigation, not the fix: it only knows about runs this window started, and it dies with the
 * window. The authoritative guard belongs in main, which is what J-48 item f asks for.
 */

import { useCallback, useState, useSyncExternalStore } from 'react';
import type { BackupProgress, DatabaseEngine } from '@joinery/shared';

import { useCommand } from '../../commands';
import { useIpcEvent } from '../../ipc';
import {
  connectionStore,
  selectDefaultDatabaseFor,
  selectProfileFor,
} from '../../state/connection';
import { notify } from '../../state/diagnostics';
import { BackupDialog, type BackupRunCoordination } from './backup-dialog';

/** What the dialog needs, once. `null` is "closed", which is the only other state. */
interface BackupTarget {
  readonly connectionId: string;
  readonly databaseName: string;
  readonly engine: DatabaseEngine;
}

/** A dump this window started. Kept after it finishes — see `finished`. */
interface RunRecord {
  /** The destination it was started against, so the refusal can name the file being written. */
  readonly path: string;
  /** The main process's operation id, once known. `null` until the START reply or the first event. */
  readonly backupId: string | null;
  /**
   * Whether it has reported a terminal event.
   *
   * Finished runs are **kept rather than deleted**, and that is the one non-obvious thing in this
   * file. Two subscribers see each progress event — the dialog's, which asks `isForeignRun` whether the
   * event is somebody else's, and this component's, which retires the run — and nothing orders them.
   * If retiring meant deleting, then whether an event is recognised as foreign would depend on which
   * subscriber ran first. Keeping the record makes the answer the same either way. They are pruned by
   * `rememberRun`, so the map cannot grow without bound.
   */
  readonly finished: boolean;
}

/**
 * Keyed by connection + database rather than by destination path, because the database is what the
 * user is choosing when they re-open the dialog and the path is not settled until they have typed it.
 * It is also the stricter of the two: two dumps of one database to two paths are a load problem on the
 * server, where two dumps to one path are a corrupt archive.
 */
const runs = new Map<string, RunRecord>();

/** How many records are kept. Finished ones are dropped oldest-first past this; live ones never are. */
const MAX_RUN_RECORDS = 32;

/** Insert or replace one record, pruning finished ones so the map stays bounded. */
function rememberRun(key: string, record: RunRecord): void {
  runs.set(key, record);
  // Map iterates in insertion order, so the first finished entry is the oldest one.
  for (const [candidate, existing] of runs) {
    if (runs.size <= MAX_RUN_RECORDS) break;
    if (existing.finished) runs.delete(candidate);
  }
}

/**
 * Subscribers to the record above, so an open dialog re-reads it the moment a run retires.
 *
 * `useSyncExternalStore` rather than a version counter in component state: the record is external to
 * React and its entries are replaced rather than mutated, so `liveRun(key)` is already a referentially
 * stable snapshot — which is the exact shape that hook exists for.
 */
const runListeners = new Set<() => void>();

function subscribeToRuns(listener: () => void): () => void {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
}

function emitRunsChanged(): void {
  for (const listener of runListeners) listener();
}

function runKey(connectionId: string, databaseName: string): string {
  return `${connectionId}\u0000${databaseName}`;
}

/**
 * The key of the one live run that has no id yet, if there is exactly one.
 *
 * The fallback for a START reply that carried no id: without it a live record could never be retired
 * and its database would be blocked for the rest of the session, which is a worse failure than the one
 * this record exists to prevent. "Exactly one" is the whole condition — with two unbound runs there is
 * no evidence which one an event belongs to, so neither is guessed at.
 */
function unclaimedRunKey(backupId: string): string | null {
  let candidate: string | null = null;
  for (const [key, run] of runs) {
    if (run.backupId === backupId) return null; // already owned
    if (run.finished || run.backupId !== null) continue;
    if (candidate !== null) return null; // ambiguous
    candidate = key;
  }
  return candidate;
}

function isTerminal(status: BackupProgress['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Fold one progress event into the record: bind an id it can claim, and mark the run finished when the
 * event is terminal.
 *
 * Returns whether anything changed, so a stream of progress lines for an already-bound run costs the
 * shell no render.
 */
function settleRun(progress: BackupProgress): boolean {
  const claimed = unclaimedRunKey(progress.backupId);
  const terminal = isTerminal(progress.status);
  if (claimed !== null) {
    const run = runs.get(claimed);
    if (run !== undefined) {
      rememberRun(claimed, { path: run.path, backupId: progress.backupId, finished: terminal });
      return true;
    }
  }
  if (!terminal) return false;
  for (const [key, run] of runs) {
    if (run.backupId !== progress.backupId || run.finished) continue;
    rememberRun(key, { path: run.path, backupId: progress.backupId, finished: true });
    return true;
  }
  return false;
}

/** True for an id that belongs to a run other than `key`'s — see `applyProgress`'s `isForeignRun`. */
function isRunOwnedByAnother(key: string, backupId: string): boolean {
  for (const [otherKey, run] of runs) {
    if (otherKey !== key && run.backupId === backupId) return true;
  }
  return false;
}

/** The live run for `key`, or `null`. Finished records are history, not a reason to refuse. */
function liveRun(key: string | null): RunRecord | null {
  if (key === null) return null;
  const run = runs.get(key);
  if (run === undefined || run.finished) return null;
  return run;
}

/**
 * Drop every record. Module state outlives a test, so a spec that starts a dump would block the next
 * one; this is the only reason it is exported.
 */
export function resetBackupRunsForTests(): void {
  runs.clear();
  emitRunsChanged();
}

export function BackupDialogs() {
  const [target, setTarget] = useState<BackupTarget | null>(null);

  // One subscription for the app's lifetime — the dialog's own is torn down when it closes, and a run
  // that finishes after that still has to be retired or its database stays blocked for the session.
  useIpcEvent('backup', 'onProgress', progress => {
    if (settleRun(progress)) emitRunsChanged();
  });

  const key = target === null ? null : runKey(target.connectionId, target.databaseName);
  const inFlight = useSyncExternalStore(subscribeToRuns, () => liveRun(key));

  const beginRun = useCallback(
    (path: string): void => {
      if (key === null) return;
      rememberRun(key, { path, backupId: null, finished: false });
      emitRunsChanged();
    },
    [key]
  );

  const bindRun = useCallback(
    (backupId: string): void => {
      if (key === null) return;
      const run = runs.get(key);
      if (run === undefined || run.backupId !== null) return;
      rememberRun(key, { path: run.path, backupId, finished: run.finished });
      emitRunsChanged();
    },
    [key]
  );

  // The start call was refused, so nothing is running and the record must stop saying one is —
  // otherwise a refused start locks this database out of the feature for the rest of the session. It
  // is dropped rather than marked finished: there was never a run, so there is no id to recognise.
  const retireRun = useCallback((): void => {
    if (key === null) return;
    if (!runs.delete(key)) return;
    emitRunsChanged();
  }, [key]);

  const isForeignRun = useCallback(
    (backupId: string): boolean => (key === null ? false : isRunOwnedByAnother(key, backupId)),
    [key]
  );

  /**
   * Resolve a connection (and optionally a named database) to a full target, or report why not.
   *
   * The toast is legal here and only here: nothing is open yet, so it is not a toast above a modal
   * (J-42). Once the dialog is up, everything it has to say it says inline.
   */
  const openOn = (connectionId: string | null, databaseName: string | null): void => {
    if (connectionId === null) {
      notify.warning('Connect to a server before backing up a database.');
      return;
    }
    const profile = selectProfileFor(connectionId)(connectionStore.getState());
    if (profile === null) {
      notify.error('That connection no longer exists.');
      return;
    }
    const database =
      databaseName ?? selectDefaultDatabaseFor(connectionId)(connectionStore.getState());
    if (database === null || database === '') {
      notify.warning('Choose a database before backing it up.');
      return;
    }
    setTarget({ connectionId, databaseName: database, engine: profile.engine });
  };

  // Database ▸ Backup. No payload, so the target comes from whatever the workbench is focused on.
  //
  // `mostRecentConnectionId()` rather than `focusedConnectionId()`, and the difference matters: focus
  // derives from the **active query tab** alone (`selectFocusedConnectionId`), so a user who has
  // connected and picked a database but has no query tab open has no focus at all — and the native
  // menu item would refuse for a connection the sidebar is happily showing. `mostRecentConnectionId`
  // prefers the focused tab, requires it to still be connected, and otherwise falls back to the most
  // recent live connection, which is the same answer `useMostRecentConnectionId` gives the sidebar's
  // own backup button.
  useCommand('open-backup-dialog', () => {
    openOn(connectionStore.getState().mostRecentConnectionId(), null);
  });

  // The sidebar's targeted twin, which states both halves.
  useCommand('backup-database', ({ connectionId, databaseName }) => {
    openOn(connectionId, databaseName);
  });

  if (target === null) return null;

  const run: BackupRunCoordination = {
    inFlight,
    onStarted: beginRun,
    onBound: bindRun,
    onFailedToStart: retireRun,
    isForeignRun,
  };

  return (
    <BackupDialog
      // Remounts when the target changes, so the form re-reads its `defaultValues` and no state from
      // the previous database's dump survives into the next one.
      key={`${target.connectionId}:${target.databaseName}`}
      connectionId={target.connectionId}
      databaseName={target.databaseName}
      engine={target.engine}
      run={run}
      onDismiss={() => setTarget(null)}
    />
  );
}
