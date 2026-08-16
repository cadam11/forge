/**
 * The consumer `COMMAND_CONSUMERS` names for the two restore commands, and the one place that decides
 * whether the restore dialog is on screen.
 *
 * ── What this takes over ────────────────────────────────────────────────────────────────────
 *
 *  - **`open-restore-dialog`** — Database ▸ Restore on the native menu. The **last** of PLAN.md 0.1's
 *    three broken items: `menu.service.ts:216` implemented it as `router.navigate(['/restore'])` into
 *    a router with no `router-outlet`, so it had done nothing for months. Task 7 parked a placeholder
 *    on the wire; the placeholder is deleted in the same commit that adds this file, which also empties
 *    `ShellCommands` of its last rendered output.
 *  - **`restore-database`** — the sidebar's server *and* database context menus, plus its footer
 *    action. The server-level entry carries no database name, because a restore creates its target.
 *
 * The menu carries no payload, so it resolves through `mostRecentConnectionId()` for the reason
 * `backup-dialogs.tsx` sets out at length: focus derives from the active query tab alone, so a user who
 * has connected but opened no query tab has no focus and the menu item would refuse for a connection
 * the sidebar is happily showing.
 *
 * ── Why the database list is read here ──────────────────────────────────────────────────────
 *
 * `targetKindFor` — the decision that gates the confirmation — needs the databases the server actually
 * reports, and it needs the difference between "the list is empty" and "the list could not be read".
 * `selectDatabasesFor` cannot express that: it answers `[]` for both. So the list is a real query, and
 * `null` (pending or failed) reaches the dialog as `'unknown'`, which demands the confirmation.
 *
 * ── The in-flight record ────────────────────────────────────────────────────────────────────
 *
 * Shared with the backup wizard, in `state/db-operations.ts`. This component owns the half that has to
 * outlive the dialog: the always-mounted `restore.onProgress` subscription that retires a run whose
 * dialog has already been closed. The dialog owns the other half itself rather than taking it as a
 * prop — unlike `BackupDialog`, whose target is fixed at dispatch — because a restore's target
 * database is chosen *inside* the dialog, so this component cannot know which key to watch.
 */

import { useState } from 'react';
import type { DatabaseEngine } from '@joinery/shared';

import { useCommand } from '../../commands';
import { useIpcEvent, useIpcQuery } from '../../ipc';
import { selectCapabilitiesFor, useCapabilitiesStore } from '../../state/capabilities';
import { connectionStore, selectProfileFor, useConnectionStore } from '../../state/connection';
import { dbOperationsStore } from '../../state/db-operations';
import { diagnostics, notify } from '../../state/diagnostics';
import { RestoreDialog } from './restore-dialog';
import { restoreOperationId } from './restore-model';

/** What the dialog needs, once. `null` is "closed", which is the only other state. */
interface RestoreTarget {
  readonly connectionId: string;
  /** The database the command named, or `null` for the server-level entry points. */
  readonly databaseName: string | null;
  readonly engine: DatabaseEngine;
}

export function RestoreDialogs() {
  const [target, setTarget] = useState<RestoreTarget | null>(null);

  // One subscription for the app's lifetime. A restore that finishes after its dialog has been closed
  // still has to be retired, or its target stays blocked for the rest of the session.
  useIpcEvent('restore', 'onProgress', progress => {
    const operationId = restoreOperationId(progress);
    // Two of the three engines never send `restoreId` — see `restoreOperationId`. An event with no
    // recognisable id at all cannot settle anything, and guessing would retire the wrong run.
    if (operationId === null) return;
    const terminal =
      progress.status === 'completed' ||
      progress.status === 'failed' ||
      progress.status === 'cancelled';
    dbOperationsStore.getState().settle('restore', operationId, terminal);
  });

  const connectionId = target?.connectionId ?? null;
  const loadDatabases = useConnectionStore(state => state.loadDatabases);
  const capabilities = useCapabilitiesStore(selectCapabilitiesFor(connectionId ?? undefined));

  // `null` while it is pending or has failed, which is what makes the dialog demand a confirmation it
  // could otherwise have skipped. `enabled` keeps it from firing while nothing is open.
  const databases = useIpcQuery({
    namespace: 'database',
    operation: 'list',
    args: [connectionId ?? ''],
    keyArgs: [connectionId],
    enabled: connectionId !== null,
    retry: false,
  });

  const knownDatabases =
    databases.data === undefined ? null : databases.data.map(database => database.name);

  /**
   * Resolve a connection to a full target, or report why not.
   *
   * The toast is legal here and only here: nothing is open yet, so it is not a toast above a modal
   * (J-42). Once the dialog is up, everything it has to say it says inline.
   *
   * No "choose a database first" branch, unlike the backup twin: a restore creates its target, so the
   * server-level entry points are legitimate and a null database is the ordinary case.
   */
  const openOn = (id: string | null, databaseName: string | null): void => {
    if (id === null) {
      notify.warning('Connect to a server before restoring a database.');
      return;
    }
    const profile = selectProfileFor(id)(connectionStore.getState());
    if (profile === null) {
      notify.error('That connection no longer exists.');
      return;
    }
    setTarget({ connectionId: id, databaseName, engine: profile.engine });
  };

  useCommand('open-restore-dialog', () => {
    openOn(connectionStore.getState().mostRecentConnectionId(), null);
  });

  useCommand('restore-database', ({ connectionId: id, databaseName }) => {
    openOn(id, databaseName ?? null);
  });

  if (target === null) return null;

  return (
    <RestoreDialog
      // Remounts when the target changes, so no state from the previous restore survives into the next.
      key={`${target.connectionId}:${target.databaseName ?? ''}`}
      connectionId={target.connectionId}
      engine={target.engine}
      databaseName={target.databaseName}
      databases={knownDatabases}
      canCreateDatabases={capabilities.supportsDatabaseManagement}
      onRestored={() => {
        // The restore either created a database the sidebar has never heard of or replaced one it now
        // has stale figures for. Both fixed by re-reading the list; the failure is logged rather than
        // toasted, because the dialog is still open (J-42) and the restore itself did succeed.
        void loadDatabases(target.connectionId).catch(error => {
          diagnostics.error('the database list could not be reloaded after a restore', error);
        });
        void databases.refetch();
      }}
      onDismiss={() => setTarget(null)}
    />
  );
}
