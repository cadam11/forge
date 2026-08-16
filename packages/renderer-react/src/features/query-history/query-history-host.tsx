/**
 * `open-query-history`'s consumer — the takeover of a command registered since Task 7 and unowned
 * since then (`COMMAND_CONSUMERS` named "Task 19 query-history dialog" and nothing was subscribed, so
 * Query ▸ History (⇧⌘H) and the palette entry both warned into DEV and did nothing).
 *
 * Mounted by the shell rather than by the query tab, and that is not a style choice: the history
 * dialog opens a NEW query tab, and ⇧⌘H has to work with no query tab in front of it. A handler inside
 * the query panel would have made the menu item conditional on already having the thing it creates.
 *
 * It owns three jobs the dialog deliberately does not:
 *
 *  1. **loading** — the store is fetched when the command arrives, not when the dialog mounts, so the
 *     first frame of the dialog already has rows in it rather than a spinner that flashes;
 *  2. **the target** — `history-target.ts`, and the toast when an entry is re-pointed;
 *  3. **opening the tab** — `tabStore.openQueryTab`, with `autoExecute` for the execute action.
 */

import { useState } from 'react';
import type { QueryHistoryEntry } from '@joinery/shared';

import { useCommand } from '../../commands';
import {
  connectionStore,
  selectDefaultDatabaseFor,
  selectIsConnected,
} from '../../state/connection';
import { notify } from '../../state/diagnostics';
import { queryHistoryStore } from '../../state/query-history';
import { tabStore } from '../../state/tab';
import { resolveHistoryTarget } from './history-target';
import { QueryHistoryDialog } from './query-history-dialog';

export function QueryHistoryHost() {
  const [open, setOpen] = useState(false);

  useCommand('open-query-history', () => {
    // Fire-and-forget: the store reports its own failure and leaves the list empty, which the dialog
    // renders as its empty state. Nothing here should hold the keystroke open on an IPC round trip.
    void queryHistoryStore.getState().loadHistory();
    setOpen(true);
  });

  if (!open) return null;

  return (
    <QueryHistoryDialog
      onDismiss={() => setOpen(false)}
      onLoad={entry => reopen(entry, false)}
      onExecute={entry => reopen(entry, true)}
    />
  );
}

/** Open one entry in a new query tab, optionally running it on arrival. */
function reopen(entry: QueryHistoryEntry, autoExecute: boolean): void {
  const connection = connectionStore.getState();
  const target = resolveHistoryTarget({
    entryConnectionId: entry.connectionId,
    entryDatabase: entry.database,
    isConnected: connectionId => selectIsConnected(connectionId)(connection),
    fallbackConnectionId: connection.mostRecentConnectionId(),
    fallbackDatabase: connectionId => selectDefaultDatabaseFor(connectionId)(connection),
  });

  if (target === null) {
    notify.warning('Connect to a server before opening a query from history.');
    return;
  }
  if (target.redirected) {
    // Said out loud rather than silently: the SQL is about to run somewhere other than where it was
    // recorded, and that is exactly the case the Angular resolution got wrong without telling anyone.
    notify.info(
      `${entry.connectionName} is not connected — opening on the current server instead.`
    );
  }

  // `reuseEmpty: false`. Loading from history is the ⌘N case, not the explorer case: the user named a
  // specific statement and expects a tab of its own rather than their current empty tab re-pointed.
  tabStore
    .getState()
    .openQueryTab(target.connectionId, target.databaseName, entry.sql, autoExecute, false);
}
