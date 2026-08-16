/**
 * The sidebar frame: brand mark, connection picker, database picker, the object explorer, and the
 * footer's five actions.
 *
 * This is the top of the ≤6-component split PLAN.md §1.1 asks for in place of the 1,926-LOC
 * `sidebar.component.ts`: `BrandMark`, `ConnectionPicker`, `DatabasePicker`, `ExplorerTree`,
 * `NodeContextMenu`, and this frame. Two non-component modules carry the rest — `sql-text.ts`
 * (pure, per-engine SQL) and `node-actions.ts` (every side effect the menus have).
 *
 * ── What the frame owns, and what it does not ────────────────────────────────────────────
 *
 * It owns the `TreeHandle`, because the connection picker needs to reveal a server node in a
 * virtualized tree and only the handle can scroll to a row that may not be mounted. It owns no
 * geometry: the pane's width, its collapse and its persistence are the shell's (`app-shell.tsx`),
 * and it draws **no border on its right edge** — the resize handle owns that hairline. The
 * Angular header also carried `padding-top: 38px` of traffic-light clearance and
 * `-webkit-app-region: drag`; both moved to the titlebar, which now spans the whole window.
 *
 * ── The footer's disabled logic ──────────────────────────────────────────────────────────
 *
 * Four of the five actions need an open connection, and two of those additionally need the engine
 * to support backup/restore. Angular gated New Query and Backup on `!focusedSelectedDatabase()`
 * as well, which made them dead until the user had touched the picker even though a default
 * database was resolvable; `openQueryForConnection` and the backup dispatch resolve it the same
 * way ⌘N does, so the extra condition is gone.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Code, DatabaseBackup, HardDriveDownload, Plus, RefreshCw, Sparkles } from 'lucide-react';

import {
  Button,
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarSpacer,
  Tooltip,
  type TreeHandle,
} from '../../ui';
import { dispatchCommand } from '../../commands';
import { selectCapabilitiesFor, useCapabilitiesStore } from '../../state/capabilities';
import { useChatPanelStore } from '../../state/chat';
import {
  connectionStore,
  selectSelectedDatabaseFor,
  useMostRecentConnectionId,
} from '../../state/connection';
import { explorerStore, useExplorerStore } from '../../state/explorer';
import { serverNodeId } from '../../state/explorer-path';
import { tabStore } from '../../state/tab';
import { BrandMark } from './brand-mark';
import { ConnectionPicker } from './connection-picker';
import { DatabasePicker } from './database-picker';
import { ExplorerTree } from './explorer-tree';
import { openQueryForConnection, refreshFocused } from './node-actions';
import { useResolvedDatabase } from './use-resolved-database';

export function Sidebar() {
  const treeRef = useRef<TreeHandle | null>(null);

  /**
   * Point the sidebar at an already-open connection: expand and select its server node, scroll it
   * into view, and give the tree keyboard focus so the user can carry on with the arrow keys. The
   * query tab is opened only when nothing already targets the connection — focus follows the tab
   * activation, which is the rule `state/connection.ts` documents, so opening a second tab would
   * be the picker writing focus by force.
   */
  /**
   * The view half of a reveal.
   *
   * `reveal-explorer-node`'s handler is in `shell-commands.tsx`, not here, and the reason is a mount
   * one: **this component does not exist while the sidebar is collapsed** (`app-shell.tsx` renders
   * `null` for it), so a `useCommand` here would be a command that dies exactly when the user most
   * needs it — and would DEV-warn as a dead dispatch, which is the class of bug this whole task is
   * about. The handler therefore does the store work (uncollapse, expand, select) and leaves a reveal
   * request behind; this effect does the part only the `TreeHandle` can do — scroll a row the
   * virtualizer may not have mounted, then take focus so the arrow keys carry on from there.
   *
   * Because the request lives in the store, a reveal that arrives while the pane is closed is still
   * honoured: this effect runs on mount and finds it waiting.
   */
  const revealRequest = useExplorerStore(state => state.revealRequest);
  useEffect(() => {
    if (revealRequest === null) return;
    treeRef.current?.scrollToId(revealRequest);
    treeRef.current?.focus();
    explorerStore.getState().clearRevealRequest();
  }, [revealRequest]);

  const revealServer = useCallback((connectionId: string) => {
    const nodeId = serverNodeId(connectionId);
    const explorer = explorerStore.getState();
    void explorer.expandNode(nodeId);
    explorer.selectNode(nodeId);
    treeRef.current?.scrollToId(nodeId);
    treeRef.current?.focus();

    const tabs = tabStore.getState().tabs;
    if (tabs.some(tab => tab.connectionId === connectionId)) return;
    const lastDatabase = selectSelectedDatabaseFor(connectionId)(connectionStore.getState());
    if (lastDatabase === null) return;
    tabStore.getState().openQueryTab(connectionId, lastDatabase);
  }, []);

  return (
    <aside
      aria-label="Connections and database explorer"
      data-testid="sidebar"
      className="flex h-full min-h-0 min-w-0 flex-col bg-chrome"
    >
      <div className="flex h-(--panel-header-height) shrink-0 items-center gap-2 border-b border-rule px-3">
        <BrandMark />
        <h2 className="min-w-0 grow truncate font-mono text-2xs tracking-eyebrow text-fg-muted uppercase">
          Explorer
        </h2>
        <Tooltip content="New connection">
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            leadingIcon={Plus}
            aria-label="New connection"
            data-testid="sidebar-new-connection"
            onClick={() => dispatchCommand('open-connection-dialog')}
          />
        </Tooltip>
      </div>

      <ConnectionPicker onRevealServer={revealServer} />
      <DatabasePicker />

      <div className="flex min-h-0 grow flex-col border-t border-rule">
        <ExplorerTree treeRef={treeRef} />
      </div>

      <SidebarActions />
    </aside>
  );
}

/**
 * The footer strip. A `Toolbar` rather than five loose buttons, so the whole group is one tabstop
 * with arrow-key movement inside it (`ui/toolbar.tsx`) — the Angular row was five separate tab
 * stops in a 240px rail.
 */
function SidebarActions() {
  const connectionId = useMostRecentConnectionId();
  const selectedDatabase = useResolvedDatabase(connectionId);
  const capabilities = useCapabilitiesStore(selectCapabilitiesFor(connectionId ?? undefined));
  const chatOpen = useChatPanelStore(state => state.panelOpen);
  const toggleChat = useChatPanelStore(state => state.togglePanel);

  const connected = connectionId !== null;
  const canBackup = connected && capabilities.supportsBackupRestore;

  return (
    <Toolbar
      aria-label="Explorer actions"
      data-testid="sidebar-actions"
      className="shrink-0 border-t border-rule"
    >
      <Tooltip content="New query">
        <ToolbarButton
          iconOnly
          leadingIcon={Code}
          aria-label="New query"
          data-testid="sidebar-new-query"
          disabled={!connected}
          onClick={() => {
            if (connectionId !== null) openQueryForConnection(connectionId);
          }}
        />
      </Tooltip>
      <Tooltip content="Refresh the explorer">
        <ToolbarButton
          iconOnly
          leadingIcon={RefreshCw}
          aria-label="Refresh the explorer"
          data-testid="sidebar-refresh"
          disabled={!connected}
          onClick={() => void refreshFocused()}
        />
      </Tooltip>

      <ToolbarSeparator />

      <Tooltip content="Back up a database">
        <ToolbarButton
          iconOnly
          leadingIcon={DatabaseBackup}
          aria-label="Back up a database"
          data-testid="sidebar-backup"
          disabled={!canBackup || selectedDatabase === null}
          onClick={() => {
            if (connectionId !== null && selectedDatabase !== null) {
              dispatchCommand('backup-database', { connectionId, databaseName: selectedDatabase });
            }
          }}
        />
      </Tooltip>
      <Tooltip content="Restore a database">
        <ToolbarButton
          iconOnly
          leadingIcon={HardDriveDownload}
          aria-label="Restore a database"
          data-testid="sidebar-restore"
          disabled={!canBackup}
          onClick={() => {
            if (connectionId !== null) dispatchCommand('restore-database', { connectionId });
          }}
        />
      </Tooltip>

      <ToolbarSpacer />

      <Tooltip content={chatOpen ? 'Close the assistant' : 'Open the assistant'}>
        <ToolbarButton
          iconOnly
          leadingIcon={Sparkles}
          aria-label="Toggle the assistant"
          aria-pressed={chatOpen}
          data-testid="sidebar-toggle-chat"
          className={chatOpen ? 'text-accent' : undefined}
          onClick={toggleChat}
        />
      </Tooltip>
    </Toolbar>
  );
}
