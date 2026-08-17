/**
 * The sixteen commands the query tab takes over, in one table.
 *
 * `commands/registry.ts` names "Task 10 query editor" as the consumer of eleven ids and "Task 10 query
 * tab" of a twelfth (`toggle-results-panel`); this component is that consumer, and the correspondence is
 * meant to be checkable by reading the two side by side — the same arrangement `shell/shell-commands.tsx`
 * has for Task 7's fourteen.
 *
 * ── Why this is its own component and not `useCommand` calls inside the panel ───────────────
 *
 * Two reasons, and the second is the load-bearing one:
 *
 * 1. the panel is a Monaco host, and Monaco cannot be instantiated in jsdom — so command wiring living
 *    inside it could not be unit-tested at all;
 * 2. `commands/bus.spec.tsx`'s ownership test renders the app's REAL command wiring and fails when an id
 *    claims a shipped task but has no live handler. That test can mount this component (it takes plain
 *    callbacks and renders nothing) and cannot mount the panel. Keeping the wiring separable is what lets
 *    the twelve ids be covered by the same guard as Task 7's and Task 9's.
 *
 * ── The active-tab guard ───────────────────────────────────────────────────────────────────
 *
 * Every query tab is mounted at once — Dockview keeps an inactive panel's React tree alive (PLAN.md R5
 * finding 4) — so every open query tab subscribes to all twelve. The guard is therefore mandatory rather
 * than defensive: without it, ⌘S with four tabs open would write four files. It is a function evaluated
 * at DISPATCH time, not a boolean prop, because a stale render's `false` would silently swallow the
 * command; the Angular version had the same shape (`const guard = fn => () => { … if (active?.id ===
 * this.tabId) fn(); }`, `query.component.ts:1088-1091`).
 */

import type { DatabaseEngine } from '@joinery/shared';

import { useCommand } from '../../commands';

export interface QueryCommandHandlers {
  /** True when this tab is the active one. Evaluated per dispatch — see the header. */
  readonly isActive: () => boolean;
  /** ⌃E's gate is NOT here: the menu's Query ▸ Execute runs, and the gate is the keystroke's. */
  readonly onExecute: () => void;
  readonly onExecuteSelection: () => void;
  readonly onCancel: () => void;
  readonly onFormat: () => void;
  readonly onFind: () => void;
  readonly onReplace: () => void;
  readonly onToggleComment: () => void;
  readonly onSave: () => void;
  readonly onSaveAs: () => void;
  readonly onOpenFile: () => void;
  readonly onToggleResults: () => void;
  readonly onInsertSnippet: (sql: string) => void;
  /**
   * Rewrite the editor's SQL in another dialect (Task 19a).
   *
   * Three ids, one handler: the engine is the payload the ids encode, because a palette entry may not
   * carry one (`commands/catalogue.ts`'s `CatalogueEntry`). See `sql-convert.ts` for the adapter.
   */
  readonly onConvertSql: (toEngine: DatabaseEngine) => void;
  /**
   * Ask the engine for this statement's execution plan (Task 19b).
   *
   * One id, and it is payload-free so the palette can offer it — the toolbar button calls this same
   * handler directly, as every other button in that strip does.
   */
  readonly onShowExecutionPlan: () => void;
}

export function QueryCommands({
  isActive,
  onExecute,
  onExecuteSelection,
  onCancel,
  onFormat,
  onFind,
  onReplace,
  onToggleComment,
  onSave,
  onSaveAs,
  onOpenFile,
  onToggleResults,
  onInsertSnippet,
  onConvertSql,
  onShowExecutionPlan,
}: QueryCommandHandlers) {
  /**
   * One wrapper, so the guard cannot be forgotten on a new entry. Not a loop over a table: `useCommand`
   * is a hook, so the calls have to be unconditional and in a fixed order, and a `Object.entries(…).map`
   * over a props object would put the hook order at the mercy of key order.
   */
  const guard = (handler: () => void) => () => {
    if (isActive()) handler();
  };

  useCommand('execute-query', guard(onExecute));
  useCommand('execute-selection', guard(onExecuteSelection));
  useCommand('cancel-query', guard(onCancel));

  useCommand('format-sql', guard(onFormat));
  useCommand('editor-find', guard(onFind));
  useCommand('editor-replace', guard(onReplace));
  useCommand('toggle-comment', guard(onToggleComment));

  useCommand('save-query', guard(onSave));
  useCommand('save-query-as', guard(onSaveAs));
  // The other half of this one is `shell-commands.tsx`, which handles it when the active tab is NOT a
  // query tab. Both check, so neither needs a claim protocol — the Angular branch at
  // `menu.service.ts:86-97` split across its two owners.
  useCommand('open-query-file', guard(onOpenFile));

  useCommand('toggle-results-panel', guard(onToggleResults));

  useCommand(
    'convert-sql-to-mssql',
    guard(() => onConvertSql('mssql'))
  );
  useCommand(
    'convert-sql-to-postgresql',
    guard(() => onConvertSql('postgresql'))
  );
  useCommand(
    'convert-sql-to-mysql',
    guard(() => onConvertSql('mysql'))
  );

  useCommand('show-execution-plan', guard(onShowExecutionPlan));

  useCommand('insert-snippet', payload => {
    if (isActive()) onInsertSnippet(payload.sql);
  });

  return null;
}
