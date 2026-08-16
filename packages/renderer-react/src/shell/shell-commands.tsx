/**
 * Every command handler this task owns, in one table, plus the shell's own ⌘J shortcut.
 *
 * `COMMAND_CONSUMERS` names "Task 7 shell" as the consumer of fifteen commands; this file is that
 * consumer, and the correspondence is meant to be checkable by reading the two side by side. The
 * handlers that used to live inside `menu.service.ts` — the ⌘N connection/database resolution, the
 * file-open flow, the three-step refresh — are here rather than in the bridge, because the bridge's
 * only job is channel → command (see its header).
 *
 * **No command here opens a placeholder any more, and this component renders nothing.** All three of
 * PLAN.md 0.1's broken menu items — implemented in Angular as `router.navigate()` into a router with
 * no outlet, so they did nothing and had done nothing for months — now reach a real dialog owned by
 * the feature that built it: File ▸ New Connection by Task 9's `features/connections/ConnectionDialogs`,
 * Database ▸ Backup by Task 12's `features/backup/BackupDialogs`, and Database ▸ Restore by Task 13's
 * `features/restore/RestoreDialogs`. All three are mounted by `app-shell.tsx` beside this component,
 * so what is left here is a pure handler table. The one thing that still reaches for a dialog from
 * here is ⌘N with nothing connected, which dispatches the command rather than owning a second copy.
 */

import { dispatchCommand, useCommand } from '../commands';
import { ipc, isIpcAvailable } from '../ipc';
import { chatPanelStore } from '../state/chat';
import { connectionStore, selectDefaultDatabaseFor } from '../state/connection';
import { diagnostics, notify } from '../state/diagnostics';
import { explorerStore } from '../state/explorer';
import { logStore } from '../state/logs';
import { settingsStore } from '../state/settings';
import { selectActiveTab, tabStore } from '../state/tab';
import { workbenchStore } from '../state/workbench';

/**
 * Opens a .sql file into a new query tab.
 *
 * Ported from `menu.service.ts:329-354`. Only reached when the active tab is NOT a query tab: when
 * one is active it owns the file-open (Task 10), and both handlers make the same check so neither
 * needs a claim protocol. Every failure is reported — the Angular original swallowed the read error
 * into a bare `console.error`.
 */
async function openQueryFromFile(): Promise<void> {
  if (!isIpcAvailable()) return;

  const connection = connectionStore.getState();
  const connectionId = connection.focusedConnectionId() ?? connection.mostRecentConnectionId();
  const databaseName =
    connectionId === null ? null : selectDefaultDatabaseFor(connectionId)(connection);
  if (connectionId === null || databaseName === null) {
    notify.warning('Connect to a database before opening a query file.');
    return;
  }

  try {
    const result = await ipc().app.showOpenDialog({
      title: 'Open Query',
      filters: [
        { name: 'SQL Files', extensions: ['sql'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || filePath === undefined) return;

    const content = await ipc().workspace.readFile(filePath);
    tabStore.getState().openQueryTab(connectionId, databaseName, content, false);
  } catch (error) {
    diagnostics.error('failed to open a query file', error);
    notify.error('Could not open that file.');
  }
}

/**
 * Server ▸ Refresh, ported from `menu.service.ts:356-386` including its ordering comment: the
 * per-connection database list, then the server node's children, then whichever node the user had
 * selected. Each can be stale independently, and the tree can hold a stale local mutation after the
 * picker has already corrected itself.
 */
async function refreshExplorer(): Promise<void> {
  const connection = connectionStore.getState();
  const explorer = explorerStore.getState();
  const connectionId = connection.mostRecentConnectionId();

  try {
    if (connectionId !== null) {
      await connection.loadDatabases(connectionId);
      const serverNode = explorer.rootNodes.find(
        node => node.type === 'server' && node.connectionId === connectionId
      );
      if (serverNode) await explorer.refreshNode(serverNode.id);
    }
    const selectedNodeId = explorerStore.getState().selectedNodeId;
    if (selectedNodeId !== null) await explorerStore.getState().refreshNode(selectedNodeId);
  } catch (error) {
    diagnostics.error('failed to refresh the explorer', error);
  }
}

/** ⌘N. Always a fresh tab, per the Angular comment: the user pressed ⌘N to get a new one. */
function newQuery(): void {
  const connection = connectionStore.getState();
  const connectionId = connection.mostRecentConnectionId();
  const databaseName =
    connectionId === null ? null : selectDefaultDatabaseFor(connectionId)(connection);

  if (connectionId === null || databaseName === null) {
    // Angular navigated to the dead /connections route here. The intent was right; the destination
    // did not exist. Dispatching the command rather than opening the editor directly keeps Task 9's
    // dialog owned by one consumer.
    dispatchCommand('open-connection-dialog');
    return;
  }
  tabStore.getState().openQueryTab(connectionId, databaseName, undefined, false, false);
}

/**
 * Registers the shell's handlers. Mount once, from the shell; renders nothing.
 *
 * Every `useCommand` call is unconditional and in a fixed order, which is what the rules of hooks
 * require and what makes this list safe to read as a table.
 */
export function ShellCommands() {
  // Tabs.
  useCommand('new-query', () => newQuery());
  useCommand('open-query-file', () => {
    // Task 10's editor handles this when a query tab is active; this is the other branch.
    if (selectActiveTab(tabStore.getState())?.type === 'query') return;
    void openQueryFromFile();
  });
  useCommand('close-active-tab', () => {
    const active = selectActiveTab(tabStore.getState());
    if (active) tabStore.getState().closeTab(active.id);
  });
  useCommand('next-tab', () => tabStore.getState().nextTab());
  useCommand('previous-tab', () => tabStore.getState().previousTab());
  useCommand('show-welcome', () => tabStore.getState().showWelcome());

  // Panels.
  useCommand('toggle-sidebar', () => workbenchStore.getState().toggleSidebar());
  useCommand('toggle-chat-panel', () => chatPanelStore.getState().togglePanel());
  useCommand('toggle-output-panel', () => logStore.getState().toggle());
  useCommand('open-settings', () => settingsStore.getState().open());

  // Connections.
  useCommand('disconnect-connection', () => {
    const connectionId = connectionStore.getState().focusedConnectionId();
    if (connectionId === null) {
      notify.warning('No active connection.');
      return;
    }
    void connectionStore.getState().disconnect(connectionId);
  });
  useCommand('refresh-explorer', () => {
    void refreshExplorer();
  });

  // Nothing to render: every dialog this component used to stand in for is owned by its own feature.
  return null;
}
