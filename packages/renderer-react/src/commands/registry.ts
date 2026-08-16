/**
 * The command registry: every inter-feature message in the renderer, and its payload type.
 *
 * ── What this replaces ──────────────────────────────────────────────────────────────────────
 *
 * The Angular renderer's real inter-feature bus was `window.dispatchEvent(new
 * CustomEvent('joinery:…'))` — untyped, unregistered, and unenforced. PLAN.md 0.4 counted the
 * damage: sixteen distinct event names dispatched, only six of them with a listener anywhere in
 * the app, so ten command-palette entries did nothing at all when clicked and no compiler, test or
 * review step could tell. A `CustomEvent`'s `detail` is `any`; the palette dispatched
 * `joinery:open-backup` for months against a listener that never existed.
 *
 * ── Why the dead ones are not here ──────────────────────────────────────────────────────────
 *
 * Porting the ten dead dispatches as registry entries would reproduce exactly the property that
 * made them dead: an id nothing handles, indistinguishable from an id something handles. So this
 * file lists the six channels that had a live producer AND a live consumer in the Angular app, and
 * `COMMAND_CONSUMERS` below is a `Record` over the id union — adding a command without naming who
 * handles it does not compile. Task 16 adds the palette's commands as it wires their handlers, one
 * entry per handler, which is the point: the dead-command class of bug cannot recur, because the
 * only way to add a command is to name its consumer.
 *
 * Ids keep the DOM event names (minus the `joinery:` prefix) so the mapping back to the audit is
 * one-to-one and greppable.
 *
 * ── Adding a command ───────────────────────────────────────────────────────────────────────
 *
 * 1. add the id and its payload type to `CommandPayloads`;
 * 2. add its consumer to `COMMAND_CONSUMERS` (the compiler will insist);
 * 3. subscribe with `useCommand` in the component that handles it.
 */

export interface CommandPayloads {
  // ── The native menu (Task 7) ───────────────────────────────────────────────────────────────
  //
  // `packages/preload/src/index.ts` exposes 31 `menu.on*` channels (counted in the file and
  // cross-checked against the 31 subscriptions in the Angular `menu.service.ts`; the task brief's
  // "34" is a miscount, recorded in the Task 7 report). Every one of them is subscribed by
  // `shell/menu-bridge.tsx` and routed to exactly one command below, so the bridge is a
  // translation table and the question "what does this menu item do?" is answered by grepping one
  // id. `menu-copy` is the only channel with logic in the bridge, because it is the only one with
  // a claim-and-fall-back protocol.
  //
  // Several of these consumers land in a later task, which is the same shape the six original
  // entries already had (`insert-snippet` → Task 10). What the registry enforces is that a
  // consumer is NAMED, not that it exists yet: the alternative — leaving the channel unsubscribed
  // until its surface arrives — is exactly the untracked-dead-menu-item state the audit found.

  /** File ▸ New Connection. The first of 0.1's three broken items. */
  'open-connection-dialog': void;
  /** File ▸ New Query (⌘N). Always a fresh tab, per `menu.service.ts:308-327`. */
  'new-query': void;
  /** File ▸ Open Query. Loads a .sql file into the active query tab, or into a new one. */
  'open-query-file': void;
  /** File ▸ Close Tab (⌘W). */
  'close-active-tab': void;
  /** File ▸ Save Query (⌘S). */
  'save-query': void;
  /** File ▸ Save Query As (⇧⌘S). */
  'save-query-as': void;
  /** File ▸ Export Results. */
  'export-results': void;

  /** Edit ▸ Find (⌘F). */
  'editor-find': void;
  /** Edit ▸ Replace (⌥⌘F). */
  'editor-replace': void;
  /** Edit ▸ Format SQL (⇧⌥F). */
  'format-sql': void;
  /** Edit ▸ Toggle Comment (⌘/). */
  'toggle-comment': void;

  /** Query ▸ Execute (⌘↩ / F5). */
  'execute-query': void;
  /** Query ▸ Execute Selection (⇧⌘↩). */
  'execute-selection': void;
  /** Query ▸ Cancel (⌘.). */
  'cancel-query': void;
  /** Query ▸ History (⇧⌘H). */
  'open-query-history': void;

  /** Server ▸ Disconnect. */
  'disconnect-connection': void;
  /** Server ▸ Refresh (⌘R). */
  'refresh-explorer': void;
  /** Server ▸ Properties. */
  'show-server-properties': void;

  /** Database ▸ New Database. */
  'create-database': void;
  /** Database ▸ Backup. The second of 0.1's three broken items. */
  'open-backup-dialog': void;
  /** Database ▸ Restore. The third of 0.1's three broken items. */
  'open-restore-dialog': void;
  /** Database ▸ Properties. */
  'show-database-properties': void;

  /** View ▸ Welcome. */
  'show-welcome': void;
  /** View ▸ Toggle Sidebar (⌘B). */
  'toggle-sidebar': void;
  /** View ▸ Toggle AI Chat (⇧⌘I). */
  'toggle-chat-panel': void;
  /** View ▸ Toggle Results. */
  'toggle-results-panel': void;
  /** The Output / Console panel (⌘J). Not a menu channel — the shell's own shortcut. */
  'toggle-output-panel': void;

  /** Window ▸ Next Tab (⌃⇥). */
  'next-tab': void;
  /** Window ▸ Previous Tab (⌃⇧⇥). */
  'previous-tab': void;

  /** Joinery ▸ Settings (⌘,). */
  'open-settings': void;

  // ── The six channels that had a live producer AND consumer in Angular ──────────────────────

  /**
   * Edit ▸ Copy (⌘C), forwarded from the native menu — the renderer never sees the keystroke,
   * because Electron's menu accelerator captures it.
   *
   * The one *claimable* command: `dispatchCommand` returns true when a handler returned true, and
   * the caller falls back to `document.execCommand('copy')` when nobody claimed it. This replaces
   * the `cancelable: true` CustomEvent plus `preventDefault()` protocol at
   * `menu.service.ts:296-306` / `results-grid.component.ts:1207`, which is the only reason
   * handlers may return a boolean at all.
   */
  'menu-copy': void;

  /** Monaco's caret moved. Producer: the query editor. Consumer: the status bar's Ln/Col. */
  'cursor-position': { line: number; column: number };

  /** Producer: the snippet library. Consumer: the active query editor. */
  'insert-snippet': { sql: string };

  /** Producer: the ⌘/ shortcut and the palette. Consumer: the shortcuts cheatsheet. */
  'show-shortcuts': void;

  /** Producer: the palette. Consumer: the object-search overlay. */
  'open-object-search': void;

  /** Producer: the palette. Consumer: the snippet library. */
  'open-snippets': void;
}

export type CommandId = keyof CommandPayloads;

export type CommandPayload<Id extends CommandId> = CommandPayloads[Id];

/**
 * Who handles each command, and who sends it. A `Record` over the whole id union on purpose: this
 * is the compile-time gate that keeps the registry free of commands nothing consumes. Update it in
 * the same edit as `CommandPayloads` or the build fails.
 */
export const COMMAND_CONSUMERS: Record<CommandId, string> = {
  // The native menu. "Task 7 shell" means `shell/shell-commands.tsx`, which is where every
  // handler this task owns is registered, in one table.
  'open-connection-dialog':
    'Task 9 connection editor. Task 7 shell registers a placeholder dialog so the menu item is ' +
    'no longer the silent router no-op of PLAN.md 0.1.',
  'new-query':
    'Task 7 shell (tabStore.openQueryTab, or the connection dialog when nothing is connected).',
  'open-query-file':
    'Task 10 query editor when a query tab is active; Task 7 shell otherwise (it opens the file ' +
    'dialog and creates the tab). Both subscribe and each checks the active tab, which is the ' +
    'Angular branch at menu.service.ts:86-97 split across its two owners.',
  'close-active-tab': 'Task 7 shell (tabStore.closeTab on the active tab).',
  'save-query': 'Task 10 query editor.',
  'save-query-as': 'Task 10 query editor.',
  'export-results': 'Task 11 results grid.',

  'editor-find': 'Task 10 query editor (Monaco find widget).',
  'editor-replace': 'Task 10 query editor (Monaco replace widget).',
  'format-sql': 'Task 10 query editor (sql-formatter).',
  'toggle-comment': 'Task 10 query editor.',

  'execute-query': 'Task 10 query editor.',
  'execute-selection': 'Task 10 query editor.',
  'cancel-query': 'Task 10 query editor.',
  'open-query-history': 'Task 19 query-history dialog.',

  'disconnect-connection': 'Task 7 shell (connectionStore.disconnect on the focused connection).',
  'refresh-explorer':
    'Task 7 shell (the three-step refresh of menu.service.ts:356-386: database list, server ' +
    'node, selected node).',
  'show-server-properties': 'Task 19 server-properties surface.',

  'create-database': 'Task 19 create-database dialog.',
  'open-backup-dialog':
    'Task 12 backup dialog. Task 7 shell registers a placeholder dialog (PLAN.md 0.1 item 2).',
  'open-restore-dialog':
    'Task 13 restore dialog. Task 7 shell registers a placeholder dialog (PLAN.md 0.1 item 3).',
  'show-database-properties': 'Task 19 database-properties surface.',

  'show-welcome': 'Task 7 shell (tabStore.showWelcome).',
  'toggle-sidebar': 'Task 7 shell (workbenchStore.toggleSidebar).',
  'toggle-chat-panel': 'Task 7 shell (chatPanelStore.togglePanel).',
  'toggle-results-panel': 'Task 10 query tab (its results pane).',
  'toggle-output-panel': 'Task 7 shell (logStore.toggle). Producer: the shell ⌘J shortcut.',

  'next-tab': 'Task 7 shell (tabStore.nextTab).',
  'previous-tab': 'Task 7 shell (tabStore.previousTab).',

  'open-settings':
    'Task 15 settings panel. Task 7 shell opens the store flag it reads (settingsStore.open), ' +
    'so the wire is live before the panel exists.',

  'menu-copy':
    'Task 11 results grid (claims it when focus is inside the grid and there is no text selection); ' +
    'Task 7 menu bridge dispatches it and falls back to document.execCommand when unclaimed.',
  'cursor-position': 'Task 7 status bar. Producer: Task 10 Monaco editor.',
  'insert-snippet': 'Task 10 query editor. Producer: Task 16 snippet library.',
  'show-shortcuts':
    'Task 16 shortcuts cheatsheet. Producers: Task 7 shell shortcut, Task 16 palette.',
  'open-object-search': 'Task 16 object search. Producer: Task 16 palette.',
  'open-snippets': 'Task 16 snippet library. Producer: Task 16 palette.',
};

/** Every registered id, for tests and for the palette's "is this wired?" assertion in Task 16. */
export const COMMAND_IDS = Object.keys(COMMAND_CONSUMERS) as readonly CommandId[];
