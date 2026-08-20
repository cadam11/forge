/**
 * The native-menu bridge: every `menu.on*` channel the preload bridge exposes, subscribed once and
 * routed to one command.
 *
 * Replaces `core/services/menu.service.ts` (391 LOC). That file mixed three jobs — subscribing to
 * the bridge, re-broadcasting on 24 RxJS `Subject`s, and *implementing* a handful of the actions
 * inline (a T-SQL properties query, a file-open dialog, a three-step explorer refresh). Three of its
 * subscriptions called `router.navigate()` into a router with no outlet, so File ▸ New Connection,
 * Database ▸ Backup and Database ▸ Restore did nothing at all (PLAN.md 0.1).
 *
 * Here the bridge does exactly one job. Every channel maps to a command id, the map is the whole
 * implementation, and the handlers live with the surfaces that own them (`shell-commands.tsx` for
 * this task's, Phase B tasks for the rest). Two consequences worth the arrangement:
 *
 *  - **"What does this menu item do?" is one grep.** Channel → id here, id → consumer in
 *    `COMMAND_CONSUMERS`, consumer → handler in the named file. The registry's `Record` over the id
 *    union means an id with no named consumer does not compile.
 *  - **A channel cannot be silently forgotten.** `MENU_COMMANDS` is typed as a total map over the
 *    bridge's own `menu` namespace (`Record<IpcEventName<'menu'>, …>`), derived from
 *    `packages/preload`. Adding a channel to preload and not routing it here is a type error, which
 *    is the property the Angular version could not have.
 *
 * ── The channel count ─────────────────────────────────────────────────────────────────────
 *
 * **32.** It was 31 at Task 24 — not the 34 that task's brief said — counted in
 * `packages/preload/src/index.ts` (the `menu` block) and cross-checked against `menu.service.ts`,
 * which had exactly 31 `menu.on*` calls. J-92 added the thirty-second, `onOpenAiSetup`, for the
 * `AI Setup…` item beside Settings in both menus that carry Settings. The type above is what makes
 * the number checkable rather than asserted.
 *
 * ── `menu-copy` is the one channel with logic ─────────────────────────────────────────────
 *
 * Edit ▸ Copy is *claimable*: the main process forwards ⌘C instead of using `role: 'copy'` so a
 * context-aware surface (the results grid, honouring the user's TSV/CSV/JSON copy format) can take
 * it, and when nobody does, the renderer falls back to `document.execCommand('copy')` — which is
 * what `role: 'copy'` would have done. `dispatchCommand` returns whether a handler claimed it, so
 * the protocol is one `if`, replacing the `cancelable: true` CustomEvent plus `preventDefault()`
 * dance at `menu.service.ts:301-306`.
 */

import { dispatchCommand, type PayloadlessCommandId } from '../commands';
import { useIpcEvent, type IpcEventName } from '../ipc';

/**
 * Channel → command. A total map over the bridge's `menu` namespace: every `on*` member preload
 * declares must appear, and none of them may name an unregistered command.
 *
 * Every value is a `PayloadlessCommandId` because a native menu click carries no data. That is not a
 * coincidence to be relied on quietly — it is why this file can dispatch generically at all
 * (`dispatchCommand` refuses a bare `CommandId`, see `commands/bus.ts`).
 */
export const MENU_COMMANDS: Record<IpcEventName<'menu'>, PayloadlessCommandId> = {
  // File
  onNewConnection: 'open-connection-dialog',
  onNewQuery: 'new-query',
  onOpenQuery: 'open-query-file',
  onCloseTab: 'close-active-tab',
  onSaveQuery: 'save-query',
  onSaveQueryAs: 'save-query-as',
  onExportResults: 'export-results',

  // Edit
  onCopy: 'menu-copy',
  onFind: 'editor-find',
  onReplace: 'editor-replace',
  onFormatSql: 'format-sql',
  onToggleComment: 'toggle-comment',

  // Query
  onExecuteQuery: 'execute-query',
  onExecuteSelection: 'execute-selection',
  onCancelQuery: 'cancel-query',
  onQueryHistory: 'open-query-history',

  // Server
  onDisconnect: 'disconnect-connection',
  onRefresh: 'refresh-explorer',
  onServerProperties: 'show-server-properties',

  // Database
  onNewDatabase: 'create-database',
  onBackup: 'open-backup-dialog',
  onRestore: 'open-restore-dialog',
  onDatabaseProperties: 'show-database-properties',

  // View
  onShowWelcome: 'show-welcome',
  onToggleSidebar: 'toggle-sidebar',
  onToggleChat: 'toggle-chat-panel',
  onToggleResults: 'toggle-results-panel',

  // Window
  onNextTab: 'next-tab',
  onPreviousTab: 'previous-tab',

  // Joinery / Help
  onOpenSettings: 'open-settings',
  onOpenAiSetup: 'open-ai-setup',
  onShowShortcuts: 'show-shortcuts',
};

/** Every routed channel. Exported so the bridge test can assert coverage without re-listing them. */
export const MENU_CHANNELS = Object.keys(MENU_COMMANDS) as readonly IpcEventName<'menu'>[];

/** The channel that needs the claim-and-fall-back protocol rather than a plain dispatch. */
const COPY_CHANNEL: IpcEventName<'menu'> = 'onCopy';

/**
 * One `useIpcEvent` per channel, and the hook is called from a loop over a module-level constant —
 * so the number and order of hook calls is fixed for the lifetime of the app, which is what the
 * rules of hooks actually require. `MENU_COMMANDS` cannot change at runtime; it is a frozen literal
 * in this module.
 */
function MenuChannel({ channel }: { readonly channel: IpcEventName<'menu'> }) {
  const commandId = MENU_COMMANDS[channel];

  useIpcEvent('menu', channel, () => {
    if (channel !== COPY_CHANNEL) {
      dispatchCommand(commandId);
      return;
    }
    // See the header: claimed by a context-aware surface, or the platform default.
    if (!dispatchCommand('menu-copy')) document.execCommand('copy');
  });

  return null;
}

/**
 * Mount once, from the shell.
 *
 * A component per channel rather than one hook call per channel in one component, because `useIpcEvent`'s
 * subscription is keyed on its arguments and one component per channel keeps each subscription's
 * identity obvious in the React tree — and because the alternative is a hand-written list
 * that has to be kept in step with `MENU_COMMANDS` by hand. Renders nothing.
 */
export function MenuBridge() {
  return (
    <>
      {MENU_CHANNELS.map(channel => (
        <MenuChannel key={channel} channel={channel} />
      ))}
    </>
  );
}
