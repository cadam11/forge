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
