/**
 * The consumer `COMMAND_CONSUMERS` names for the three database-management commands, and the one place
 * that decides whether a create or rename dialog is on screen.
 *
 * ── What this takes over ────────────────────────────────────────────────────────────────────
 *
 *  - **`create-database`** — Database ▸ New Database on the native menu, and the palette entry. No
 *    payload, so it resolves its target from `mostRecentConnectionId()` for the same reason
 *    `features/backup` does (focus derives from the active query tab alone, so a user with a
 *    connection and no query tab has no focus at all).
 *  - **`create-database-on-server`** — the sidebar's server context menu and its database picker, both
 *    of which name the server they mean.
 *  - **`rename-database`** — the sidebar's database context menu, which names both halves.
 *
 * All three were registered-but-unowned: `COMMAND_CONSUMERS` said "Task 19" and nothing subscribed, so
 * the menu item and both context-menu items warned into DEV and did nothing.
 *
 * ── Capability gating, and where it is NOT ──────────────────────────────────────────────────
 *
 * `EngineCapabilities.supportsDatabaseManagement` is what says whether CREATE/RENAME DATABASE mean
 * anything on this server (Aurora DSQL, for one, says no). The sidebar already disables its items on
 * it, so the gate here is the second half of the same check rather than a duplicate: the palette entry
 * and the native menu item are not the sidebar and have no node to read a capability from, so without
 * this the one path the sidebar closes would still be open through ⌘-anything.
 *
 * A refused command **says why**. `notify.warning` here is legal for the same reason it is in
 * `backup-dialogs.tsx`: nothing is open yet, so it is not a toast over a modal (J-42).
 */

import { useCallback, useMemo, useState } from 'react';
import type { RecoveryModel } from '@joinery/shared';

import { useCommand } from '../../commands';
import { ipc, useInvalidateIpc } from '../../ipc';
import { capabilitiesStore, selectCapabilitiesFor } from '../../state/capabilities';
import {
  connectionStore,
  selectDatabasesFor,
  selectProfileFor,
  useConnectionStore,
} from '../../state/connection';
import { diagnostics, notify } from '../../state/diagnostics';
import { logStore } from '../../state/logs';
import { CreateDatabaseDialog } from './create-database-dialog';
import { RenameDatabaseDialog } from './rename-database-dialog';
import {
  invalidateAfterDatabaseCreate,
  invalidateAfterDatabaseRename,
  type DatabaseCacheInvalidator,
} from './database-invalidation';
import { runDatabaseOperation } from './database-operations';

/** Which dialog is up, and on what. `null` is "neither", the only other state. */
type OpenDialog =
  | { readonly kind: 'create'; readonly connectionId: string; readonly recovery: boolean }
  | { readonly kind: 'rename'; readonly connectionId: string; readonly databaseName: string };

export function DatabaseDialogs() {
  const [open, setOpen] = useState<OpenDialog | null>(null);
  const invalidate = useInvalidateIpc();

  /**
   * The names already on this server — SUBSCRIBED, not read once.
   *
   * `selectDatabasesFor(…)(connectionStore.getState())` during render was the bug: the list is loaded
   * asynchronously, so a dialog opened before `loadDatabases` answers (⌘-anything on a server whose
   * picker has not been touched, or a slow server) held an empty `taken` for its whole life and let a
   * colliding name through to the round trip it exists to avoid. The selector returns the stored array
   * itself — `EMPTY_DATABASES` when there is none — so subscribing does not re-render on every write.
   */
  const databases = useConnectionStore(selectDatabasesFor(open?.connectionId ?? null));
  const taken = useMemo(() => databases.map(database => database.name), [databases]);

  /**
   * Resolve a connection to something a dialog can open on, or say why not.
   *
   * `recovery` is whether the recovery-model select applies, which is an engine question: SQL Server has
   * recovery models and PostgreSQL and MySQL do not — the Angular dialog made the same branch inline
   * (`create-database-dialog.component.ts:63`).
   */
  const resolve = useCallback((connectionId: string | null, action: string) => {
    if (connectionId === null) {
      notify.warning(`Connect to a server before ${action}.`);
      return null;
    }
    const state = connectionStore.getState();
    const profile = selectProfileFor(connectionId)(state);
    if (profile === null) {
      notify.error('That connection no longer exists.');
      return null;
    }
    const capabilities = selectCapabilitiesFor(connectionId)(capabilitiesStore.getState());
    if (!capabilities.supportsDatabaseManagement) {
      notify.warning(`${profile.name} does not support creating or renaming databases.`);
      return null;
    }
    return { profile, recovery: profile.engine === 'mssql' };
  }, []);

  useCommand('create-database', () => {
    const connectionId = connectionStore.getState().mostRecentConnectionId();
    const resolved = resolve(connectionId, 'creating a database');
    if (resolved === null || connectionId === null) return;
    setOpen({ kind: 'create', connectionId, recovery: resolved.recovery });
  });

  useCommand('create-database-on-server', ({ connectionId }) => {
    const resolved = resolve(connectionId, 'creating a database');
    if (resolved === null) return;
    setOpen({ kind: 'create', connectionId, recovery: resolved.recovery });
  });

  useCommand('rename-database', ({ connectionId, databaseName }) => {
    if (resolve(connectionId, 'renaming a database') === null) return;
    setOpen({ kind: 'rename', connectionId, databaseName });
  });

  const cache: DatabaseCacheInvalidator = invalidate;

  const create = useCallback(
    async (connectionId: string, name: string, recoveryModel: RecoveryModel | undefined) => {
      const outcome = await runDatabaseOperation(() =>
        // `recoveryModel` is omitted rather than defaulted on PG/MySQL: main branches on its presence.
        ipc().database.create(connectionId, {
          name,
          ...(recoveryModel === undefined ? {} : { recoveryModel }),
        })
      );
      if (outcome.error !== null) return outcome.error;

      announce(`Created ${name}`, outcome.statement);
      // Awaited before the dialog closes, so the sidebar behind it already shows the new database when
      // it does. A fan-out that raced the close is how a user learns to press Refresh out of habit.
      await invalidateAfterDatabaseCreate(connectionId, name, cache);
      return null;
    },
    [cache]
  );

  const rename = useCallback(
    async (connectionId: string, currentName: string, newName: string) => {
      const outcome = await runDatabaseOperation(() =>
        ipc().database.rename(connectionId, { currentName, newName, closeConnections: true })
      );
      if (outcome.error !== null) return outcome.error;

      announce(`Renamed ${currentName} to ${newName}`, outcome.statement);
      await invalidateAfterDatabaseRename(connectionId, currentName, newName, cache);
      return null;
    },
    [cache]
  );

  if (open === null) return null;

  if (open.kind === 'create') {
    return (
      <CreateDatabaseDialog
        key={open.connectionId}
        recoveryModels={open.recovery}
        taken={taken}
        onSubmit={(name, recoveryModel) => create(open.connectionId, name, recoveryModel)}
        onDismiss={() => setOpen(null)}
      />
    );
  }

  return (
    <RenameDatabaseDialog
      key={`${open.connectionId}:${open.databaseName}`}
      currentName={open.databaseName}
      taken={taken}
      onSubmit={newName => rename(open.connectionId, open.databaseName, newName)}
      onDismiss={() => setOpen(null)}
    />
  );
}

/**
 * Tell the user, and put the statement where it can be read.
 *
 * CLAUDE.md's SQL-transparency rule: `DatabaseOperationResult.tsql` carries the exact statement the main
 * process ran, and dropping it would make a CREATE DATABASE the one write in this app whose SQL nobody
 * can see. The Output panel is where it goes — `logStore.addLocal` is the renderer's own log path, and
 * the statement is the entry's `detail`, which is the expandable half of a log row.
 */
function announce(message: string, statement: string | undefined): void {
  notify.success(message);
  if (statement === undefined || statement.trim() === '') {
    diagnostics.warn('a database operation reported no statement', message);
    return;
  }
  logStore.getState().addLocal('info', 'Database', message, statement);
}
