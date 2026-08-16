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
  // The accelerator in each comment below is the one `packages/main/src/menu.ts` actually
  // registers, and that file is the source of truth — Phase B reads these annotations when it
  // renders a shortcut hint, so a drifted one becomes a wrong label in the UI. They are comments
  // rather than data because the renderer may not import from `packages/main`; the mechanical
  // check is a re-read of `menu.ts` whenever a binding moves.
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
  /** Edit ▸ Format SQL (⇧⌘F). */
  'format-sql': void;
  /** Edit ▸ Toggle Comment (⌘/). */
  'toggle-comment': void;

  /** Query ▸ Execute (⌘E — `registerAccelerator: false`, so Task 10's editor owns the keystroke). */
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
  /** View ▸ Toggle Sidebar (⌘\). */
  'toggle-sidebar': void;
  /** View ▸ Toggle AI Chat (⇧⌘I). */
  'toggle-chat-panel': void;
  /** View ▸ Toggle Results. */
  'toggle-results-panel': void;
  /** The Output / Console panel (⌘J). Not a menu channel — the shell's own shortcut. */
  'toggle-output-panel': void;

  /** Window ▸ Next Tab (⇧⌘] on macOS, Ctrl+Tab elsewhere). */
  'next-tab': void;
  /** Window ▸ Previous Tab (⇧⌘[ on macOS, ⌃⇧⇥ elsewhere). */
  'previous-tab': void;

  /** Joinery ▸ Settings (⌘,). */
  'open-settings': void;

  // ── The sidebar's dialog entry points (Task 8) ─────────────────────────────────────────────
  //
  // Eight ids, and every one of them is the *targeted* twin of something above. The native menu
  // carries no data, so `open-backup-dialog` and friends have to resolve their target from focus;
  // a right-click on a database node under server A knows exactly which database on which server
  // it means, and the Angular sidebar spent an `overrideConnectionId` parameter on every one of
  // these saying so (`sidebar.component.ts:932,976,1146-1228`) precisely because resolving from
  // focus routed the operation to the wrong server. A payload states it instead of a nullable
  // parameter defaulting to a global, which is the whole difference.
  //
  // An id whose owner has not shipped yet has no handler, and that is legal (see `bus.spec.ts`'s
  // ownership rule): dispatching one warns in DEV with the owner named below, which is the designed
  // feedback for a surface that has not arrived. Tasks 9 and 12 have since added theirs — and changed
  // no sidebar code doing it, which was the point of the payload. Tasks 13/19 own the rest.

  /** Sidebar ▸ Connections ▸ Manage Connections. */
  'open-connection-manager': void;
  /** Sidebar ▸ server node ▸ Edit Connection… — the editor opened on an existing profile. */
  'edit-connection': { connectionId: string };

  /** Sidebar ▸ server node ▸ New Database… */
  'create-database-on-server': { connectionId: string };
  /** Sidebar ▸ database node ▸ Backup Database… */
  'backup-database': { connectionId: string; databaseName: string };
  /**
   * Sidebar ▸ Restore Database… A restore *creates* its target, so the server node offers it with
   * no database name — which is why this one field is optional and the backup twin's is not.
   */
  'restore-database': { connectionId: string; databaseName?: string };
  /** Sidebar ▸ database node ▸ Rename… */
  'rename-database': { connectionId: string; databaseName: string };
  /** Sidebar ▸ database node ▸ Delete… (the confirm step belongs to the handler). */
  'delete-database': { connectionId: string; databaseName: string };
  /** Sidebar ▸ table/view/procedure/function ▸ Properties… (⌥↩). */
  'show-object-properties': {
    connectionId: string;
    databaseName: string;
    schema: string;
    objectName: string;
    objectType: string;
  };

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

  // ── The query tab's sub-panels (Task 14) ───────────────────────────────────────────────────
  //
  // One command, because one of the three surfaces needs a keyboard path that is not a click on the
  // thing itself: the row inspector opens on a row the user has to be able to name without a mouse.
  // The result-history panel and the connection chip are a result tab and a toolbar control, so
  // their affordance IS their surface and a command for them would be a second producer for a
  // channel whose consumer is the same component.

  /**
   * Open the row-detail rail on the focused (else selected, else first) row of the active tab's
   * grid. Also the double-click handler's own path, so both routes land in one place.
   */
  'results-row-open': void;
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
    'Task 9 features/connections/ConnectionDialogs, mounted by the shell. Producers: the native ' +
    'menu bridge (File ▸ New Connection — no longer the silent router no-op of PLAN.md 0.1), the ' +
    'Task 8 sidebar header, its connection menu, the explorer empty state, and ⌘N with nothing ' +
    'connected.',
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
    'Task 12 features/backup/BackupDialogs, mounted by the shell. It resolves the target through ' +
    'mostRecentConnectionId() — not focus, which derives from the active query tab alone — and that ' +
    'connection’s default database, because the native menu carries no payload (PLAN.md 0.1 item 2 — ' +
    'no longer the silent router no-op, and no longer the Task 7 placeholder either).',
  'open-restore-dialog':
    'Task 13 features/restore/RestoreDialogs, mounted by the shell. It resolves the target through ' +
    'mostRecentConnectionId() — not focus — because the native menu carries no payload, and it needs ' +
    'no database name at all: a restore creates its target (PLAN.md 0.1 item 3 — the last of the ' +
    'three silent router no-ops, and no longer the Task 7 placeholder either).',
  'show-database-properties': 'Task 19 database-properties surface.',

  'show-welcome': 'Task 7 shell (tabStore.showWelcome).',
  'toggle-sidebar': 'Task 7 shell (workbenchStore.toggleSidebar).',
  'toggle-chat-panel': 'Task 7 shell (chatPanelStore.togglePanel).',
  'toggle-results-panel': 'Task 10 query tab (its results pane).',
  'toggle-output-panel': 'Task 7 shell (logStore.toggle). Producer: the shell ⌘J shortcut.',

  'next-tab': 'Task 7 shell (tabStore.nextTab).',
  'previous-tab': 'Task 7 shell (tabStore.previousTab).',

  'open-settings':
    'Task 15 features/settings/SettingsDialog, mounted by the shell. It calls settingsStore.open() ' +
    'itself — the Task 7 placeholder that held this wire while no panel existed is deleted, so ⌘, is ' +
    'handled exactly once.',

  // The sidebar's eight targeted entry points. Producer for all of them: Task 8 sidebar
  // (`shell/sidebar/node-menu.tsx` and `connection-picker.tsx`).
  'open-connection-manager':
    'Task 9 features/connections/ConnectionDialogs, which shows the manager. Producer: Task 8 ' +
    'sidebar connection menu.',
  'edit-connection':
    'Task 9 features/connections/ConnectionDialogs, which resolves the payload id to a profile and ' +
    'opens the editor on it. Producer: Task 8 sidebar server context menu.',
  'create-database-on-server':
    'Task 19 create-database dialog, targeting the payload connection rather than the focused ' +
    'one. Producer: Task 8 sidebar (server context menu and database picker).',
  'backup-database':
    'Task 12 features/backup/BackupDialogs, targeting the payload database rather than the focused ' +
    'one. Producer: Task 8 sidebar (database context menu and the footer action).',
  'restore-database':
    'Task 13 features/restore/RestoreDialogs, targeting the payload connection — and its optional ' +
    'database, which pre-selects the restore target rather than naming what is read. Producer: ' +
    'Task 8 sidebar (server and database context menus, and the footer action).',
  'rename-database': 'Task 19 rename-database dialog. Producer: Task 8 sidebar database menu.',
  'delete-database':
    'Task 19 delete-database confirmation, which owns the in-use warning and the tab/node ' +
    'teardown. Producer: Task 8 sidebar database menu.',
  'show-object-properties':
    'Task 19 object-properties surface (the wired table-properties container, not the dead ' +
    'panel clone of PLAN.md 0.2). Producer: Task 8 sidebar object context menus.',

  'menu-copy':
    'Task 11 results grid (claims it when focus is inside the grid and there is no text selection); ' +
    'Task 7 menu bridge dispatches it and falls back to document.execCommand when unclaimed.',
  'cursor-position': 'Task 7 status bar. Producer: Task 10 Monaco editor.',
  'insert-snippet': 'Task 10 query editor. Producer: Task 16 snippet library.',
  'show-shortcuts':
    'Task 16 shortcuts cheatsheet. Producers: Task 7 shell shortcut, Task 16 palette.',
  'open-object-search': 'Task 16 object search. Producer: Task 16 palette.',
  'open-snippets': 'Task 16 snippet library. Producer: Task 16 palette.',

  'results-row-open':
    'Task 11/14 results grid (it owns the displayed order, so it assembles the payload the rail ' +
    'needs and claims the command only for the ACTIVE tab — the same guard export-results uses). ' +
    'Producers: the results toolbar’s Inspect button and a double-click on a row.',
};

/** Every registered id, for tests and for the palette's "is this wired?" assertion in Task 16. */
export const COMMAND_IDS = Object.keys(COMMAND_CONSUMERS) as readonly CommandId[];
