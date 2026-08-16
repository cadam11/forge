/**
 * The query tab's toolbar.
 *
 * Replaces `query.component.ts:168-303` — 135 lines of `mat-icon-button` with ligature icons, four
 * `<div class="toolbar-divider">` elements styled by hand, and a `.toolbar-spacer` — with the `Toolbar`
 * primitive, which brings the roving tabstop (one Tab press to reach the strip, arrows within it) and
 * the `--panel-header-height` token the audit's magic 38s were retired for.
 *
 * ── What is here, and what deliberately is not ─────────────────────────────────────────────
 *
 * Here: execute, cancel, find, replace, go to line, format, and the results-pane toggle. Every one of
 * them is also a command in `commands/registry.ts`, and the button dispatches nothing — it calls the
 * same handler the command does, because a toolbar button that dispatched a command would be a second
 * producer for a channel whose consumer is the very component rendering the button.
 *
 * Not here, with the task that owns each:
 *  - **query history** (Task 19's dialog; the Angular version was a 320px in-tab sidebar, which
 *    PLAN.md §1.4 replaces). Note that RESULT history — snapshots of what a query returned — is a
 *    different surface and does exist, as a tab in the results pane (Task 14);
 *  - **execution plan** and **export/copy results** (Tasks 19 and 11);
 *  - the **SQL dialect converter** — the Angular toolbar's `translate` menu over `query.convertSql`.
 *    No task in PLAN.md's Phase B claims it; recorded as an unowned surface in the Task 10 report
 *    rather than smuggled in here.
 */

import {
  ChevronsDownUp,
  CornerUpLeft,
  Hash,
  PanelBottom,
  Play,
  Replace,
  Search,
  Square,
} from 'lucide-react';

import {
  Spinner,
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarSpacer,
  Tooltip,
} from '../../ui';
import { keyHint } from '../../utils/platform';
import { ConnectionContextChip } from './connection-context-chip';

export interface QueryToolbarProps {
  /** Whose toolbar this is. The chip resolves the tab's own connection and database from it. */
  readonly tabId: string;
  readonly executing: boolean;
  readonly resultsHidden: boolean;
  /**
   * Null when the tab has no connection, which is the one thing the toolbar itself needs to know:
   * Execute is disabled without one. The chip reads the same resolution from the tab
   * (`query-context.ts`), so the database is no longer a prop here — it was only ever rendered by the
   * read-only line the chip replaced.
   */
  readonly connectionName: string | null;
  readonly onExecute: () => void;
  readonly onCancel: () => void;
  readonly onFormat: () => void;
  readonly onFind: () => void;
  readonly onReplace: () => void;
  readonly onGoToLine: () => void;
  readonly onToggleResults: () => void;
}

export function QueryToolbar({
  tabId,
  executing,
  resultsHidden,
  connectionName,
  onExecute,
  onCancel,
  onFormat,
  onFind,
  onReplace,
  onGoToLine,
  onToggleResults,
}: QueryToolbarProps) {
  return (
    <Toolbar
      aria-label="Query actions"
      data-testid="query-toolbar"
      className="border-b border-rule"
    >
      <Tooltip content={`Execute (F5 or ${keyHint('E')})`}>
        <ToolbarButton
          aria-label="Execute query"
          data-testid="query-execute"
          disabled={executing || connectionName === null}
          onClick={onExecute}
          // The spinner replaces the glyph rather than sitting beside it, so the button does not
          // change width mid-run and move every control after it.
          leadingIcon={executing ? undefined : Play}
          iconOnly
        >
          {executing ? <Spinner size="sm" /> : null}
        </ToolbarButton>
      </Tooltip>

      <Tooltip content="Cancel">
        <ToolbarButton
          aria-label="Cancel query"
          data-testid="query-cancel"
          disabled={!executing}
          onClick={onCancel}
          leadingIcon={Square}
          iconOnly
        />
      </Tooltip>

      <ToolbarSeparator />

      {/* Task 14's chip, which renders the same string the read-only line here used to — including
          its `query-context` testid. `formatQueryContext` is the one copy of that expression now. */}
      <ConnectionContextChip tabId={tabId} />

      <ToolbarSpacer />

      <Tooltip content={`Find (${keyHint('F')})`}>
        <ToolbarButton
          aria-label="Find"
          data-testid="query-find"
          onClick={onFind}
          leadingIcon={Search}
          iconOnly
        />
      </Tooltip>
      <Tooltip content="Find and replace (⌥⌘F)">
        <ToolbarButton
          aria-label="Find and replace"
          data-testid="query-replace"
          onClick={onReplace}
          leadingIcon={Replace}
          iconOnly
        />
      </Tooltip>
      <Tooltip content={`Go to line (${keyHint('G')})`}>
        <ToolbarButton
          aria-label="Go to line"
          data-testid="query-goto-line"
          onClick={onGoToLine}
          leadingIcon={Hash}
          iconOnly
        />
      </Tooltip>

      <ToolbarSeparator />

      <Tooltip content="Format SQL (⇧⌘F)">
        <ToolbarButton
          aria-label="Format SQL"
          data-testid="query-format"
          onClick={onFormat}
          leadingIcon={ChevronsDownUp}
          iconOnly
        />
      </Tooltip>

      <Tooltip content={resultsHidden ? 'Show results' : 'Hide results'}>
        <ToolbarButton
          aria-label="Toggle results"
          aria-pressed={!resultsHidden}
          data-testid="query-toggle-results"
          onClick={onToggleResults}
          leadingIcon={resultsHidden ? CornerUpLeft : PanelBottom}
          iconOnly
        />
      </Tooltip>
    </Toolbar>
  );
}
