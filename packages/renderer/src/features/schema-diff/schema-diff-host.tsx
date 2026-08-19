/**
 * The consumer `COMMAND_CONSUMERS` names for the two schema-comparison commands.
 *
 *  - **`open-schema-diff`** — the palette entry. Registered since Task 16 with "Task 19" named as its
 *    owner and nothing subscribed, so the row rendered as `Not wired yet — Task 19`. It resolves its
 *    server from `mostRecentConnectionId()`, for the reason `features/backup` and `features/databases`
 *    both give: focus derives from the active query tab alone, so a user who has just connected and has
 *    no query tab has no focus at all.
 *  - **`compare-database-schemas`** — new in Task 19b, and the sidebar's targeted twin. In Angular the
 *    only way to this dialog was the palette; a user right-clicking the database they wanted to compare
 *    found nothing there. The payload pre-selects that database as the SOURCE.
 *
 * Mounted by the shell rather than inside the dialog, for the usual reason: a handler whose job is to
 * open the dialog cannot live in it.
 *
 * ── The refusals happen HERE, not in the dialog ──────────────────────────────────────────────
 *
 * Two things can make the dialog pointless before it opens: no connection, and a server with fewer than
 * two databases loaded. Both are `notify.warning` with the reason, which is legal because nothing is open
 * yet (J-42's rule is about toasts OVER a modal). The engine question is different — PostgreSQL genuinely
 * cannot be asked, and that is worth a dialog that explains rather than a toast that vanishes — so the
 * dialog opens and refuses inside itself. See `diff-query.ts`.
 */

import { useCallback, useState } from 'react';

import { useCommand } from '../../commands';
import {
  connectionStore,
  selectDatabasesFor,
  selectProfileFor,
  useConnectionStore,
} from '../../state/connection';
import { notify } from '../../state/diagnostics';
import { tabStore } from '../../state/tab';
import { canCompareDatabases } from './diff-query';
import { SchemaDiffDialog } from './schema-diff-dialog';

interface OpenDialog {
  readonly connectionId: string;
  readonly source: string | null;
}

export function SchemaDiffHost() {
  const [open, setOpen] = useState<OpenDialog | null>(null);

  /**
   * SUBSCRIBED, not read at open time — the same correction Task 19a's review made to
   * `DatabaseDialogs.taken`: the database list arrives asynchronously, so a dialog opened before
   * `loadDatabases` answers would hold an empty picker for its whole life. The selector returns the
   * stored array itself, so this does not re-render on unrelated writes.
   */
  const databases = useConnectionStore(selectDatabasesFor(open?.connectionId ?? null));
  const profile = useConnectionStore(selectProfileFor(open?.connectionId ?? null));

  /** Resolve a connection to something worth opening a dialog on, or say why not. */
  const resolve = useCallback((connectionId: string | null): string | null => {
    if (connectionId === null) {
      notify.warning('Connect to a server before comparing schemas.');
      return null;
    }
    const state = connectionStore.getState();
    const candidate = selectProfileFor(connectionId)(state);
    if (candidate === null) {
      notify.error('That connection no longer exists.');
      return null;
    }
    // The engine check is deliberately NOT here — see the file header.
    if (
      canCompareDatabases(candidate.engine) &&
      selectDatabasesFor(connectionId)(state).length < 2
    ) {
      notify.warning(
        `${candidate.name} has only one database loaded — there is nothing to compare it to.`
      );
      return null;
    }
    return connectionId;
  }, []);

  useCommand('open-schema-diff', () => {
    const connectionId = resolve(connectionStore.getState().mostRecentConnectionId());
    if (connectionId === null) return;
    // The focused tab's database is the natural source when the command carries none.
    setOpen({ connectionId, source: connectionStore.getState().focusedDatabaseName() });
  });

  useCommand('compare-database-schemas', ({ connectionId, databaseName }) => {
    if (resolve(connectionId) === null) return;
    setOpen({ connectionId, source: databaseName });
  });

  if (open === null || profile === null) return null;

  return (
    <SchemaDiffDialog
      serverName={profile.name}
      engine={profile.engine}
      databases={databases.map(database => database.name)}
      initialSource={open.source}
      onDismiss={() => setOpen(null)}
      onGenerate={({ source, sql }) => {
        // The tab is pointed at the SOURCE database, because that is where the query's unqualified
        // references resolve; `autoExecute` is false on purpose — the point of generating SQL rather than
        // diffing is that the user can read and edit it before it runs. The Angular version passed
        // `true`, so a four-section comparison of two large catalogues started running the instant the
        // dialog closed, with nobody having seen the statement.
        tabStore.getState().openQueryTab(open.connectionId, source, sql, false);
        setOpen(null);
        notify.success('Comparison query ready — run it when you are ready');
      }}
    />
  );
}
