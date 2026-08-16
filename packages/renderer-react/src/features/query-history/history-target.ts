/**
 * Where a history entry re-opens: the connection and database a "load" or "execute" lands on.
 *
 * Pure, and separate from the dialog, because this is the one piece of the feature with a rule in it
 * — and because that rule is a **correction to the Angular behaviour** rather than a port of it.
 *
 * `QueryHistoryService.openInNewTab` (`core/services/query-history.service.ts:71-82`) resolved the
 * target as `connectionState.focusedConnectionId()` and used `entry.database` only as the database
 * name. So loading an entry recorded against server A while the workbench was focused on server B
 * opened A's SQL pointed at B — silently, with the right-looking database name in the tab. For a
 * statement like `DELETE FROM orders WHERE id < 500` that is not a cosmetic difference.
 *
 * The rule here: **the entry's own connection wins while it is still connected.** A history entry
 * records where it ran; that is the honest default. Only when that server is no longer connected does
 * the resolution fall back to the workbench's own — and the caller says so in the toast, so the user
 * is never re-pointed without being told.
 */

export interface HistoryTargetInput {
  /** The connection the entry was recorded against. */
  readonly entryConnectionId: string;
  /** The database the entry was recorded against. May be empty for an entry from an older build. */
  readonly entryDatabase: string;
  /** Is `entryConnectionId` connected right now? */
  readonly isConnected: (connectionId: string) => boolean;
  /** The workbench's current connection, or null. */
  readonly fallbackConnectionId: string | null;
  /** That connection's selected-or-default database, or null. */
  readonly fallbackDatabase: (connectionId: string) => string | null;
}

export interface HistoryTarget {
  readonly connectionId: string;
  readonly databaseName: string;
  /** True when the entry's own server was unavailable and the workbench's was used instead. */
  readonly redirected: boolean;
}

/** The target, or `null` when nothing is connected at all and there is nowhere to open a tab. */
export function resolveHistoryTarget(input: HistoryTargetInput): HistoryTarget | null {
  const onItsOwnServer = input.isConnected(input.entryConnectionId);
  const connectionId = onItsOwnServer ? input.entryConnectionId : input.fallbackConnectionId;
  if (connectionId === null) return null;

  // The entry's database is kept even on a redirect: the user asked for THAT query, and a database of
  // the same name on the fallback server is the closest honest reading. It is only replaced when the
  // entry has no database at all (an entry written before the field existed).
  const databaseName =
    input.entryDatabase !== '' ? input.entryDatabase : (input.fallbackDatabase(connectionId) ?? '');
  if (databaseName === '') return null;

  return { connectionId, databaseName, redirected: !onItsOwnServer };
}
