/**
 * `open-erd` — the ERD's targetless entry point, and the takeover of a command that has been
 * registered-but-unowned since Task 16.
 *
 * `COMMAND_CONSUMERS['open-erd']` named "Task 18 ERD canvas" and nothing was subscribed, so the
 * palette showed the entry disabled and said so. That is the state this file ends.
 *
 * **Mounted unconditionally by the shell, not inside the panel** — the same rule
 * `features/chat/chat-commands.tsx` states and for a stronger reason: a command whose job is to OPEN
 * an ERD tab cannot live in the ERD tab. There would be nothing subscribed until one already existed.
 *
 * It resolves its own target, exactly as `new-query` does in `shell/shell-commands.tsx`: the focused
 * connection, else the most recent one, and that connection's selected-or-default database. A palette
 * entry has no node to carry a schema and a table, so this always opens the **database-level**
 * diagram — the entry point the Angular palette had and the sidebar does not (the sidebar's "Show
 * Relationships" is table-focused, `shell/sidebar/node-actions.ts:openRelationships`).
 */

import { useCommand } from '../../commands';
import { connectionStore, selectDefaultDatabaseFor } from '../../state/connection';
import { notify } from '../../state/diagnostics';
import { tabStore } from '../../state/tab';

export function ErdCommands() {
  useCommand('open-erd', () => {
    const connection = connectionStore.getState();
    const connectionId = connection.focusedConnectionId() ?? connection.mostRecentConnectionId();
    const databaseName =
      connectionId === null ? null : selectDefaultDatabaseFor(connectionId)(connection);

    if (connectionId === null || databaseName === null) {
      notify.warning('Connect to a database before opening a diagram.');
      return;
    }

    // No table and no schema: `openErdTab` titles it after the database and leaves `focusDepth`
    // unset, which is what a whole-database diagram means.
    tabStore.getState().openErdTab(connectionId, databaseName);
  });

  return null;
}
