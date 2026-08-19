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
 *  - **query history** (Task 19a's `features/query-history` dialog, reached by ⇧⌘H and the palette;
 *    the Angular version was a 320px in-tab sidebar, which PLAN.md §1.4 replaces). Note that RESULT
 *    history — snapshots of what a query returned — is a different surface and does exist, as a tab in
 *    the results pane (Task 14);
 *  - **export/copy results** (Task 11's results toolbar, which sits over the grid rather than here).
 *
 * The **execution plan** button IS here as of Task 19b, and its label changes with the engine: on SQL
 * Server the only plan reachable through `query.execute` is an executed one, so the tooltip says so
 * before the confirmation does (`execution-plan.ts`).
 */

import {
  ChevronsDownUp,
  CornerUpLeft,
  Hash,
  Languages,
  PanelBottom,
  Play,
  Replace,
  Search,
  Square,
  Workflow,
} from 'lucide-react';
import type { DatabaseEngine } from '@joinery/shared';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Spinner,
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarSpacer,
  Tooltip,
} from '../../ui';
import { keyHint } from '../../utils/platform';
import { ConnectionContextChip } from './connection-context-chip';
import { PLAN_KIND } from './execution-plan';
import { CONVERTIBLE_ENGINES, ENGINE_LABELS } from './sql-convert';

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
  /**
   * The tab's own engine, which decides which conversion targets the menu offers. `undefined` when the
   * tab has no connection, and the menu is then absent — there is no "from" dialect to convert out of.
   */
  readonly engine?: DatabaseEngine;
  readonly onConvertSql: (toEngine: DatabaseEngine) => void;
  /** Ask this tab's engine for the current statement's plan. Also `show-execution-plan`'s handler. */
  readonly onShowExecutionPlan: () => void;
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
  engine,
  onConvertSql,
  onShowExecutionPlan,
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

      {/* The execution plan. Present with no connection as well — the handler refuses with a sentence,
          which is the J-44-compliant answer to "why is this greyed out?" — but the TOOLTIP is what
          carries the engine's terms, because they differ in a way that matters: pressing this on SQL
          Server runs the statement. */}
      <Tooltip
        content={
          engine !== undefined && PLAN_KIND[engine] === 'actual'
            ? 'Show execution plan — SQL Server has to run the statement to report one'
            : 'Show execution plan'
        }
      >
        <ToolbarButton
          aria-label="Show execution plan"
          data-testid="query-execution-plan"
          disabled={executing}
          onClick={onShowExecutionPlan}
          leadingIcon={Workflow}
          iconOnly
        />
      </Tooltip>

      <ToolbarSeparator />

      {/* The SQL dialect converter — the Angular `translate` menu (`query.component.ts:246-265`), which
          PLAN.md's Phase B left unowned until Task 19a. The current engine is omitted from the list, as
          it was there; the palette's three entries refuse it with a sentence instead, because a palette
          has no engine to hide (`sql-convert.ts`). */}
      {engine === undefined ? null : (
        <DropdownMenu>
          <Tooltip content="Convert SQL to another dialect">
            <DropdownMenuTrigger asChild>
              <ToolbarButton
                iconOnly
                leadingIcon={Languages}
                aria-label="Convert SQL dialect"
                data-testid="query-convert"
              />
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Convert to</DropdownMenuLabel>
            {CONVERTIBLE_ENGINES.filter(target => target !== engine).map(target => (
              <DropdownMenuItem
                key={target}
                data-testid={`query-convert-${target}`}
                onSelect={() => onConvertSql(target)}
              >
                {ENGINE_LABELS[target]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

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
