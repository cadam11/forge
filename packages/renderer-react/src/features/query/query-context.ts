/**
 * Where a query will run, resolved once.
 *
 * The connection chip replaces the read-only line Task 10's toolbar rendered
 * (`query-toolbar.tsx:110-116`), and the whole risk in that swap is a chip that resolves its answer
 * differently from the thing that actually executes. So the resolution is one pure function here,
 * the chip renders it, and `query-context.spec.ts` pins the strings.
 *
 * ── The resolution, and what it is NOT ────────────────────────────────────────────────────────
 *
 * **The tab's own metadata.** `tab.connectionId` names the profile and `tab.databaseName` names the
 * database, because those two fields are what `useRunQuery` reads on execute
 * (`query-panel.tsx:99-112` builds `runContext` from exactly them). Anything else would be a chip
 * describing a different query than the one F5 runs.
 *
 * It is deliberately **not** `mostRecentConnectionId()`. That resolver exists for the payload-free
 * native-menu commands — Database ▸ Backup and friends, which have no tab to ask
 * (`commands/registry.ts:240-249`) — and for ⌘N, which is choosing a target for a tab that does not
 * exist yet (`shell/shell-commands.tsx:97-112`). A query tab already has a target; asking a global
 * "most recent" resolver would make a chip that changes what it says when the user clicks another
 * tab. Nor is it `focusedConnectionId()`, which derives from the ACTIVE tab and would give every
 * inactive query tab the active one's answer.
 *
 * `selectDefaultDatabaseFor` does appear here, but only where the tab is silent — see
 * `resolveConnectionSwitch`.
 */

import type { ConnectionProfile, DatabaseEngine } from '@joinery/shared';

import type { Tab } from '../../state/tab';

/** The word the chip and the old toolbar line both use for an unset connection. */
export const NO_CONNECTION = 'no connection';

/** And for an unset database. */
export const NO_DATABASE = 'no database';

/** The separator between the two halves. Kept from the toolbar line it replaces. */
export const CONTEXT_SEPARATOR = ' · ';

export interface QueryContext {
  readonly connectionId: string | null;
  /** The profile's name, or `null` when the tab has no connection or the profile is gone. */
  readonly connectionName: string | null;
  readonly databaseName: string | null;
  /** Drives the chip's engine glyph. `null` when there is no profile to read it from. */
  readonly engine: DatabaseEngine | null;
  /** The profile's user-chosen colour, for the chip's edge. */
  readonly color: string | null;
}

/**
 * The tab's target. A tab pointing at a profile that has since been deleted resolves to a named
 * connection id with a `null` name — which is what lets the chip say "no connection" rather than
 * print an id at the user.
 */
export function resolveQueryContext(
  tab: Tab | undefined,
  profiles: readonly ConnectionProfile[]
): QueryContext {
  const connectionId = tab?.connectionId ?? null;
  const profile = connectionId === null ? undefined : profiles.find(p => p.id === connectionId);
  return {
    connectionId,
    connectionName: profile?.name ?? null,
    databaseName: tab?.databaseName ?? null,
    engine: profile?.engine ?? null,
    color: profile?.color ?? null,
  };
}

/**
 * The one string the toolbar used to render, byte for byte:
 * `` `${connectionName ?? 'no connection'} · ${databaseName ?? 'no database'}` ``.
 *
 * Still rendered — as the chip's own label — so `query-toolbar.spec`'s and the e2e's
 * `query-context` assertions keep meaning what they meant.
 */
export function formatQueryContext(
  context: Pick<QueryContext, 'connectionName' | 'databaseName'>
): string {
  return `${context.connectionName ?? NO_CONNECTION}${CONTEXT_SEPARATOR}${context.databaseName ?? NO_DATABASE}`;
}

/**
 * The tab update that switching the chip's connection makes.
 *
 * `databaseName` is resolved for the NEW connection rather than carried over: a database name is
 * meaningful only against the server that has it, and keeping `shop` while moving from a PostgreSQL
 * profile to a SQL Server one produces a tab that cannot execute. Angular used
 * `profile?.database ?? null` here (`query.component.ts:1889-1896`) — the profile's configured
 * default, ignoring both the database the user last picked for that connection and the case where
 * the configured default no longer exists. `resolveDatabase` is the store's own three-stage
 * `selectDefaultDatabaseFor`, i.e. the same answer ⌘N would give, which is the one a user has
 * already been taught.
 */
export function resolveConnectionSwitch(
  connectionId: string,
  resolveDatabase: (connectionId: string) => string | null
): { readonly connectionId: string; readonly databaseName: string | undefined } {
  const databaseName = resolveDatabase(connectionId);
  return { connectionId, databaseName: databaseName ?? undefined };
}
