/**
 * The database picker for the focused connection.
 *
 * Replaces `sidebar.component.ts:156-209`. The list, the selection and the loading flag are all
 * per-connection in the store, so this reads them for `mostRecentConnectionId` and nothing here
 * has a notion of "the" database.
 *
 * "New Database…" is capability-gated rather than offered-then-refused: on a server that hosts one
 * fixed database (Aurora DSQL) `supportsDatabaseManagement` is false and the item is disabled, so
 * the keyboard path refuses it too. The Angular version showed it always and answered a click with
 * `notification.info('This server hosts a single fixed database …')` — one of five copies of that
 * pattern.
 */

import { Check, ChevronDown, Database, Plus } from 'lucide-react';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  Spinner,
} from '../../ui';
import { dispatchCommand } from '../../commands';
import {
  connectionStore,
  selectDatabasesFor,
  useConnectionStore,
  useMostRecentConnectionId,
} from '../../state/connection';
import { selectCapabilitiesFor, useCapabilitiesStore } from '../../state/capabilities';
import { useResolvedDatabase } from './use-resolved-database';

export function DatabasePicker() {
  const connectionId = useMostRecentConnectionId();
  const databases = useConnectionStore(selectDatabasesFor(connectionId));
  const selected = useResolvedDatabase(connectionId);
  const loading = useConnectionStore(state => state.loadingDatabases);
  const capabilities = useCapabilitiesStore(selectCapabilitiesFor(connectionId ?? undefined));

  if (connectionId === null) return null;

  return (
    <div className="px-2 pt-1 pb-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            disabled={loading}
            aria-label="Select database"
            data-testid="sidebar-database-trigger"
            className="w-full justify-start gap-2 px-2"
          >
            {loading ? (
              <Spinner size="sm" className="size-3.5" />
            ) : (
              <Icon icon={Database} size="sm" className="stroke-fg-muted" />
            )}
            <span className="min-w-0 grow truncate text-left">
              {loading ? 'Loading…' : (selected ?? 'Select database')}
            </span>
            <Icon icon={ChevronDown} size="sm" className="stroke-fg-subtle" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          data-testid="sidebar-database-menu"
          className="max-h-80 w-(--radix-dropdown-menu-trigger-width) overflow-y-auto"
        >
          {databases.map(database => (
            <DropdownMenuItem
              key={database.name}
              icon={database.name === selected ? Check : Database}
              data-testid="sidebar-database-item"
              onSelect={() =>
                connectionStore.getState().selectDatabase(connectionId, database.name)
              }
            >
              {database.name}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={Plus}
            disabled={!capabilities.supportsDatabaseManagement}
            data-testid="sidebar-database-new"
            onSelect={() => dispatchCommand('create-database-on-server', { connectionId })}
          >
            New Database…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
