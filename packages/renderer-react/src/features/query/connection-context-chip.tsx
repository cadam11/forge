/**
 * The connection chip: where this query tab will run, and the two menus that change it.
 *
 * Replaces `connection-context-chip.component.ts` (264 lines) and, in the same edit, the read-only
 * context line Task 10's toolbar rendered as a placeholder for it (`query-toolbar.tsx:110-116`). The
 * resolution and the label are `query-context.ts`'s, so the chip cannot drift from the target the
 * toolbar's Execute button actually uses — `query-context.spec.ts` pins the strings, including the
 * `data-testid="query-context"` label's, which is what the e2e asserts against.
 *
 * Four differences from the Angular chip, each with a reason:
 *
 *  - **The engine glyph is one icon, not three devicons.** Angular set `devicon-mysql-original` /
 *    `devicon-postgresql-plain` / `devicon-azuresqldatabase-plain` — a webfont that is not in this
 *    renderer's dependency list, so those classes styled nothing and the chip showed an empty `<i>`.
 *    Lucide's `Database`, tinted with the profile's own colour, is what the sidebar's connection
 *    picker already uses for exactly this job.
 *  - **Only CONNECTED profiles are offered.** Switching a query tab to a closed connection produces a
 *    tab that cannot execute; Angular listed every profile and emitted the change regardless.
 *  - **Switching connection re-resolves the database** through the store's own three-stage default
 *    rather than the profile's configured one — see `resolveConnectionSwitch`.
 *  - **The database list is read from the store**, which loads it on connect and caches it per
 *    connection, with one refresh when it is empty. Angular re-fetched on every menu open.
 */

import { useCallback, type CSSProperties } from 'react';
import { Check, ChevronDown, Database, Unplug } from 'lucide-react';

import {
  connectionStore,
  selectDatabasesFor,
  selectDefaultDatabaseFor,
  useConnectionStore,
} from '../../state/connection';
import { tabStore, useTabStore } from '../../state/tab';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  cn,
} from '../../ui';
import { formatQueryContext, resolveConnectionSwitch, resolveQueryContext } from './query-context';

/** A user-chosen accent for one profile. Runtime data, so it travels as a custom property. */
function profileColorVar(color: string | null): CSSProperties | undefined {
  return color === null ? undefined : ({ '--profile-color': color } as CSSProperties);
}

export interface ConnectionContextChipProps {
  readonly tabId: string;
}

export function ConnectionContextChip({ tabId }: ConnectionContextChipProps) {
  // The tab by identity, not the whole array: `updateTab` replaces `tabs` on every keystroke that
  // flips `isDirty`, and this component must not re-render for that. The `find` result is the same
  // object until this tab itself changes.
  const tab = useTabStore(state => state.tabs.find(candidate => candidate.id === tabId));
  const profiles = useConnectionStore(state => state.profiles);
  const connectedIds = useConnectionStore(state => state.connectedProfileIds);

  const context = resolveQueryContext(tab, profiles);
  const databases = useConnectionStore(selectDatabasesFor(context.connectionId));

  const switchConnection = useCallback(
    (connectionId: string): void => {
      if (connectionId === context.connectionId) return;
      const state = connectionStore.getState();
      tabStore.getState().updateTab(
        tabId,
        resolveConnectionSwitch(connectionId, id => selectDefaultDatabaseFor(id)(state))
      );
    },
    [context.connectionId, tabId]
  );

  const switchDatabase = useCallback(
    (databaseName: string): void => {
      if (databaseName === context.databaseName) return;
      tabStore.getState().updateTab(tabId, { databaseName });
      // The sidebar's picker and every payload-free command read the per-connection selection, so a
      // tab-level switch that did not write it would leave the two disagreeing about "the" database.
      if (context.connectionId !== null) {
        connectionStore.getState().selectDatabase(context.connectionId, databaseName);
      }
    },
    [context.connectionId, context.databaseName, tabId]
  );

  /** One load when the cache is empty — a tab restored before its connection opened. */
  const ensureDatabases = useCallback((): void => {
    if (context.connectionId === null || databases.length > 0) return;
    void connectionStore.getState().loadDatabases(context.connectionId);
  }, [context.connectionId, databases.length]);

  const connectedProfiles = profiles.filter(profile => connectedIds.has(profile.id));
  const showConnections = connectedProfiles.length > 1;

  return (
    <DropdownMenu onOpenChange={open => (open ? ensureDatabases() : undefined)}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          data-testid="chip-connection-context"
          aria-label="Change this tab’s connection or database"
          // A left rule in the profile's colour: the chip is the one place a user distinguishes two
          // servers at a glance, and Angular's chip carried the same edge (`border-left: 3px`).
          className={cn(
            'min-w-0 gap-1.5 border-l-2 border-l-rule-strong px-2',
            context.color !== null && 'border-l-(--profile-color)'
          )}
          style={profileColorVar(context.color)}
        >
          <Icon
            icon={context.connectionName === null ? Unplug : Database}
            size="sm"
            className={cn('stroke-fg-muted', context.color !== null && 'stroke-(--profile-color)')}
          />
          {/* The exact string the toolbar's read-only line rendered, and the same testid — see
              `query-context.ts`. Mono, because these are identifiers. */}
          <span
            data-testid="query-context"
            className="min-w-0 truncate font-mono text-2xs tracking-eyebrow text-fg-muted uppercase"
          >
            {formatQueryContext(context)}
          </span>
          <Icon icon={ChevronDown} size="sm" className="stroke-fg-subtle" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        data-testid="chip-menu"
        className="max-h-80 overflow-y-auto"
      >
        {showConnections ? (
          <>
            <DropdownMenuLabel>Connection</DropdownMenuLabel>
            {connectedProfiles.map(profile => (
              <DropdownMenuItem
                key={profile.id}
                icon={profile.id === context.connectionId ? Check : Database}
                data-testid="chip-connection-item"
                onSelect={() => switchConnection(profile.id)}
              >
                {profile.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuLabel>Database</DropdownMenuLabel>
        {databases.length === 0 ? (
          <DropdownMenuItem disabled data-testid="chip-database-empty">
            No databases
          </DropdownMenuItem>
        ) : (
          databases.map(database => (
            <DropdownMenuItem
              key={database.name}
              icon={database.name === context.databaseName ? Check : Database}
              data-testid="chip-database-item"
              onSelect={() => switchDatabase(database.name)}
            >
              {database.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
