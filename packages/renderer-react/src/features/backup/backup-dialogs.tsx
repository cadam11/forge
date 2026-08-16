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
 * The menu carries no payload, so it resolves its target from focus; the sidebar states it. That is
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
 */

import { useState } from 'react';
import type { DatabaseEngine } from '@joinery/shared';

import { useCommand } from '../../commands';
import {
  connectionStore,
  selectDefaultDatabaseFor,
  selectProfileFor,
} from '../../state/connection';
import { notify } from '../../state/diagnostics';
import { BackupDialog } from './backup-dialog';

/** What the dialog needs, once. `null` is "closed", which is the only other state. */
interface BackupTarget {
  readonly connectionId: string;
  readonly databaseName: string;
  readonly engine: DatabaseEngine;
}

export function BackupDialogs() {
  const [target, setTarget] = useState<BackupTarget | null>(null);

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

  return (
    <BackupDialog
      // Remounts when the target changes, so the form re-reads its `defaultValues` and no state from
      // the previous database's dump survives into the next one.
      key={`${target.connectionId}:${target.databaseName}`}
      connectionId={target.connectionId}
      databaseName={target.databaseName}
      engine={target.engine}
      onDismiss={() => setTarget(null)}
    />
  );
}
