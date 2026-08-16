/**
 * The execute sequence: what happens between the user asking for a run and a result being in the store.
 *
 * Ported from `query.component.ts:1779-1873`, minus the two halves that moved elsewhere — the IPC call
 * and the running/result bookkeeping are `state/query-execution.ts`, and the placeholder prompt is a
 * dialog. What is left here is the ORDER, which is the part worth having in one readable function:
 *
 *   1. read the SQL the caret and the setting select (`editor.textToExecute`);
 *   2. refuse an empty run, and refuse one with no connection — both with the original's wording;
 *   3. if the SQL carries `${placeholders}`, prompt, then substitute — and abandon the run if the
 *      prompt is cancelled;
 *   4. execute, which is where the store takes over;
 *   5. on success, rename the tab — through the AI namer when it is enabled, otherwise from the SQL.
 *
 * ── The prompt is a promise, and why ───────────────────────────────────────────────────────
 *
 * Step 3 has to suspend the sequence until a dialog resolves, which in the Angular version was a
 * `new Promise` around a hand-built modal (`:1663`). A React dialog is declarative, so the promise is
 * kept but its resolver is parked in a ref and called by the dialog's own callbacks. That is the one
 * place in this task where a ref holds control flow, and the alternative — splitting the sequence into
 * "before the prompt" and "after the prompt" state machines — was tried and is worse: the SQL, the
 * connection, the database and the tab title all have to survive the gap, and a machine that carries
 * them is the same promise with more parts.
 */

import { useCallback, useRef, useState } from 'react';
import type { AppSettings } from '@joinery/shared';

import { aiStore, selectAutoRenameEnabled } from '../../state/ai';
import { notify } from '../../state/diagnostics';
import { queryExecutionStore } from '../../state/query-execution';
import { queryHistoryStore } from '../../state/query-history';
import { generateQueryTitle, tabStore } from '../../state/tab';
import { detectPlaceholders, substitutePlaceholders } from './placeholders';
import { editorPrefsStore } from '../../state/editor-prefs';

/** What the panel knows and the sequence needs. Resolved fresh per run by the caller. */
export interface RunContext {
  readonly tabId: string;
  readonly tabTitle: string;
  readonly connectionId: string | undefined;
  readonly database: string | undefined;
  readonly querySettings: AppSettings['query'];
  /** The SQL to run, already resolved from the selection / caret / setting. */
  readonly sql: string;
}

export interface RunQuery {
  /** Runs the sequence. Resolves when the result (or the refusal) has landed. */
  readonly run: (context: RunContext) => Promise<void>;
  /** The placeholders currently being prompted for, or an empty array. Drives the dialog. */
  readonly prompting: readonly string[];
  /** The dialog's submit. */
  readonly submitPlaceholders: (values: Readonly<Record<string, string>>) => void;
  /** The dialog's cancel — and the backdrop, and Escape. */
  readonly cancelPlaceholders: () => void;
}

export function useRunQuery(): RunQuery {
  const [prompting, setPrompting] = useState<readonly string[]>([]);
  /** The parked resolver for the placeholder prompt. `null` when no prompt is open. */
  const pending = useRef<((values: Record<string, string> | null) => void) | null>(null);

  const promptForPlaceholders = useCallback(
    (placeholders: readonly string[]): Promise<Record<string, string> | null> => {
      // A second prompt cannot open while one is up: the only caller awaits this, and the toolbar's
      // execute is disabled while a run is in flight. Asserted rather than assumed, because a leaked
      // resolver would hang the next run forever with no visible cause.
      if (pending.current !== null) {
        throw new Error('[useRunQuery] a placeholder prompt is already open');
      }
      setPrompting(placeholders);
      return new Promise(resolve => {
        pending.current = resolve;
      });
    },
    []
  );

  const settlePrompt = useCallback((values: Record<string, string> | null): void => {
    const resolve = pending.current;
    pending.current = null;
    setPrompting([]);
    resolve?.(values);
  }, []);

  const run = useCallback(
    async (context: RunContext): Promise<void> => {
      if (context.sql.trim() === '') {
        notify.warning('No query to execute');
        return;
      }
      if (context.connectionId === undefined) {
        notify.error('No active connection');
        return;
      }

      let sql = context.sql;
      const placeholders = detectPlaceholders(sql);
      if (placeholders.length > 0) {
        const values = await promptForPlaceholders(placeholders);
        if (values === null) return; // Cancelled.
        editorPrefsStore.getState().rememberPlaceholderValues(values);
        sql = substitutePlaceholders(sql, values);
      }

      const result = await queryExecutionStore.getState().execute({
        tabId: context.tabId,
        tabTitle: context.tabTitle,
        connectionId: context.connectionId,
        database: context.database,
        sql,
        maxRows: context.querySettings.maxRowsToDisplay,
      });

      // `null` means superseded or no bridge; a failed query is a result with `success: false`.
      if (result === null) return;

      // The history list is main-process state that the execute has just appended to. Refreshed only
      // when something is showing it, exactly as `:1841-1843` did — the dialog is Task 19's, so today
      // this is a no-op unless that store has been loaded.
      if (queryHistoryStore.getState().entries.length > 0) {
        void queryHistoryStore.getState().loadHistory();
      }

      if (result.success) renameTabFromResult(context.tabId, sql, context.database);
    },
    [promptForPlaceholders]
  );

  return {
    run,
    prompting,
    submitPlaceholders: useCallback(
      (values: Readonly<Record<string, string>>) => settlePrompt({ ...values }),
      [settlePrompt]
    ),
    cancelPlaceholders: useCallback(() => settlePrompt(null), [settlePrompt]),
  };
}

/**
 * Auto-rename after a successful run. Ported from `:1852-1860` and `:2652-2666`.
 *
 * The AI path is fire-and-forget and silent on failure, which is the original's behaviour and the right
 * one: a tab title is not worth a toast. The fallback is `generateQueryTitle`, which Task 4 already
 * ported out of `tab.state.ts` — the Angular query component carried its own near-duplicate
 * (`updateTabTitleFromSql`, `:2621-2649`) with the same three regexes and slightly different
 * truncation, and that duplicate dies here rather than being ported a second time.
 */
function renameTabFromResult(tabId: string, sql: string, database: string | undefined): void {
  const tabs = tabStore.getState();
  if (selectAutoRenameEnabled(aiStore.getState())) {
    void aiStore
      .getState()
      .generateTabName({ sql, database })
      .then(response => {
        if (response?.suggestedName) tabs.renameTab(tabId, response.suggestedName);
      });
    return;
  }
  // The index argument only matters when the SQL yields no name at all, in which case the original
  // produced a preview of the statement rather than "Query N" — so any index is unreachable here.
  tabs.renameTab(tabId, generateQueryTitle(sql, 1));
}
