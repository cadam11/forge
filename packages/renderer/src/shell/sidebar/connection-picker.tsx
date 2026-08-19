/**
 * The connection list: which profiles exist, which are open, which one the sidebar is pointed at,
 * and the four things you can do about it.
 *
 * Replaces `sidebar.component.ts:83-153`. Two behaviours are worth naming because they are easy
 * to get wrong and the multi-connection e2e spec exists to hold them:
 *
 *  - **Focus is derived, never written.** Picking an open connection expands and selects its
 *    server node and — only if no tab already targets it — opens a query tab, because focus in
 *    this app IS the active query tab's connection (`state/connection.ts`'s header). The Angular
 *    comment at `:840-847` states the same rule; what it could not do was navigate, because the
 *    router had no outlet (PLAN.md 0.1). Selecting the node is the whole visible effect.
 *  - **Every action names its connection.** No item resolves "the active connection" internally.
 *
 * The trailing status glyph per row is a real read of the heartbeat (`healthByConnection`), not a
 * connected/disconnected boolean: a profile can be open and failing its 30s ping, which is the
 * state the user needs to see before they wonder why a query hangs. Amber, per HOUSE-RULES §5 —
 * a degraded connection is caution, not danger, and chartreuse is capped at two per surface so it
 * cannot be spent one-per-row here.
 */

import { type CSSProperties } from 'react';
import {
  Check,
  ChevronDown,
  Database,
  Plug,
  RefreshCw,
  Settings,
  TriangleAlert,
  Unplug,
} from 'lucide-react';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  cn,
} from '../../ui';
import { dispatchCommand } from '../../commands';
import {
  selectProfileFor,
  useConnectionStore,
  useMostRecentConnectionId,
} from '../../state/connection';
import { connectProfile, disconnectConnection, refreshFocused } from './node-actions';

/** A user-chosen accent for one profile, if they set one. Runtime data, so it travels as a var. */
function profileColorVar(color: string | undefined): CSSProperties | undefined {
  return color === undefined ? undefined : ({ '--profile-color': color } as CSSProperties);
}

export interface ConnectionPickerProps {
  /** Reveals a server node in the tree. Owned by `Sidebar`, which holds the `TreeHandle`. */
  readonly onRevealServer: (connectionId: string) => void;
}

export function ConnectionPicker({ onRevealServer }: ConnectionPickerProps) {
  const profiles = useConnectionStore(state => state.profiles);
  const connectedProfileIds = useConnectionStore(state => state.connectedProfileIds);
  const healthByConnection = useConnectionStore(state => state.healthByConnection);
  const focusedConnectionId = useMostRecentConnectionId();
  const focusedProfile = useConnectionStore(selectProfileFor(focusedConnectionId));

  if (profiles.length === 0) return null;

  return (
    <div className="px-2 pt-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            data-testid="sidebar-connection-trigger"
            className="w-full justify-start gap-2 px-2"
          >
            <Icon
              icon={focusedProfile === null ? Unplug : Database}
              size="sm"
              className={cn(
                'stroke-fg-muted',
                focusedProfile?.color !== undefined && 'stroke-(--profile-color)'
              )}
              style={profileColorVar(focusedProfile?.color)}
            />
            <span className="min-w-0 grow truncate text-left">
              {focusedProfile?.name ?? 'Select connection'}
            </span>
            <Icon icon={ChevronDown} size="sm" className="stroke-fg-subtle" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          data-testid="sidebar-connection-menu"
          className="w-(--radix-dropdown-menu-trigger-width)"
        >
          {profiles.map(profile => {
            const connected = connectedProfileIds.has(profile.id);
            if (!connected) {
              return (
                <DropdownMenuItem
                  key={profile.id}
                  icon={Plug}
                  data-testid="sidebar-connection-connect"
                  onSelect={() => void connectProfile(profile.id)}
                >
                  Connect: {profile.name}
                </DropdownMenuItem>
              );
            }
            const focused = profile.id === focusedConnectionId;
            // Absent entry = healthy: no heartbeat result has come back yet.
            const healthy = healthByConnection.get(profile.id) ?? true;
            return (
              <DropdownMenuItem
                key={profile.id}
                icon={focused ? Check : Database}
                data-testid="sidebar-connection-focus"
                onSelect={() => onRevealServer(profile.id)}
              >
                <span className="flex min-w-0 grow items-center gap-1.5">
                  <span className="min-w-0 grow truncate">{profile.name}</span>
                  {healthy ? null : (
                    <Icon
                      icon={TriangleAlert}
                      size="sm"
                      label={`${profile.name} is not responding`}
                      className="stroke-warning"
                      data-testid="sidebar-connection-unhealthy"
                    />
                  )}
                </span>
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={Plug}
            data-testid="sidebar-connection-new"
            onSelect={() => dispatchCommand('open-connection-dialog')}
          >
            New Connection…
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={Settings}
            data-testid="sidebar-connection-manage"
            onSelect={() => dispatchCommand('open-connection-manager')}
          >
            Manage Connections…
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon={RefreshCw}
            disabled={connectedProfileIds.size === 0}
            data-testid="sidebar-connection-refresh"
            onSelect={() => void refreshFocused()}
          >
            Refresh
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={Unplug}
            disabled={focusedConnectionId === null}
            data-testid="sidebar-connection-disconnect"
            onSelect={() => {
              // `disabled` above already guarantees this, but the narrowing is needed anyway and a
              // silent no-op is better than an assertion in a menu handler.
              if (focusedConnectionId !== null) disconnectConnection(focusedConnectionId);
            }}
          >
            Disconnect {focusedProfile?.name ?? ''}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
