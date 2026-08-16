/**
 * The query tab's results pane: the result-set tabs, the Messages pane, and the four states that are
 * not a grid — executing, nothing-run-yet, failed, and a batch whose statement returned no rows at all.
 * The cells themselves are `<ResultsGrid>`'s (Task 11 replaced this file's placeholder slot with it).
 *
 * Replaces `query.component.ts:388-531`, whose result tabs were hand-rolled `<button class="result-tab">`
 * elements with a `[class.active]` binding and an `activeTab()` signal holding strings like `'result-0'`
 * — parsed back out with `parseInt(tab.replace('result-', ''), 10)` to find the result set. Radix `Tabs`
 * owns the roving focus and the `aria-selected` wiring instead, and the value is still the index because
 * that is what identifies a result set.
 *
 * ── Why this component is memoised ────────────────────────────────────────────────────────────
 *
 * It is the R2 boundary (PLAN.md's grid-performance risk). `QueryPanel` re-renders for reasons that have
 * nothing to do with the result — the first keystroke after a save flips `isDirty`, which writes the tab
 * store — and without `memo` here every one of those would re-render the grid beneath it. The props are
 * chosen so the memo can actually hold: `result` is the object the execution store's `results` Map holds
 * (identity changes only when a query lands) and the other two are primitives. Adding a prop that is
 * built in the panel's render body — an array, an object literal, an inline arrow — would silently defeat
 * this, which is what `render-isolation.spec.tsx` exists to catch.
 */

import { memo } from 'react';
import { Terminal } from 'lucide-react';
import type { QueryResult, ResultSet } from '@joinery/shared';

import { EmptyState, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '../../ui';
import { ResultsGrid } from './results-grid';

const MESSAGES_TAB = 'messages';

export interface QueryResultsProps {
  readonly result: QueryResult | null;
  readonly executing: boolean;
  /** Whose results these are. Passed to the grid so File ▸ Export Results can find the active one. */
  readonly tabId: string;
}

/** The count a tab label shows: the true received count when the rows were capped main-side. */
function rowCountOf(resultSet: ResultSet): number {
  return resultSet.rowCount ?? resultSet.rows.length;
}

/** The Messages pane. Ported from `:491-500`, including the "executed successfully" fallback. */
function MessagesSlot({ result }: { readonly result: QueryResult }) {
  const messages = result.messages ?? [];
  return (
    <div className="flex flex-col gap-2 p-3" data-testid="query-messages">
      <pre className="whitespace-pre-wrap font-mono text-sm text-fg">
        {messages.length > 0 ? messages.join('\n') : 'Query executed successfully.'}
      </pre>
      {result.rowsAffected === undefined ? null : (
        <p className="text-md text-fg-muted">
          <span className="tabular-nums">{result.rowsAffected}</span> rows affected
        </p>
      )}
      <p className="text-md text-fg-muted">
        Execution time:{' '}
        <span className="tabular-nums">{result.executionTime ?? result.executionTimeMs ?? 0}</span>
        ms
      </p>
    </div>
  );
}

export const QueryResults = memo(function QueryResults({
  result,
  executing,
  tabId,
}: QueryResultsProps) {
  if (executing) {
    return (
      <div
        data-testid="query-results-executing"
        className="flex min-h-0 grow items-center justify-center p-6"
      >
        <Spinner label="Executing…" />
      </div>
    );
  }

  if (result === null) {
    return (
      <div
        data-testid="query-results-empty"
        className="flex min-h-0 grow items-center justify-center p-6"
      >
        <EmptyState
          icon={Terminal}
          size="sm"
          title="No results yet"
          description={`Execute a query to see its results. F5 or ${'⌘'}↩ both run it.`}
        />
      </div>
    );
  }

  if (result.error !== undefined) {
    return (
      <div className="min-h-0 grow overflow-auto p-3" data-testid="query-results-error">
        {/* A left rule in the danger token, which is this app's error treatment (PROPOSAL §2.1:
            rules, not filled banners). The same shape the connection editor's failure panel uses. */}
        <div className={cn('flex flex-col gap-1 border-l-2 border-danger bg-surface px-3 py-2')}>
          <p className="text-md text-danger">Query failed</p>
          <pre
            data-testid="query-results-error-text"
            className="whitespace-pre-wrap font-mono text-sm text-fg"
          >
            {result.error}
          </pre>
        </div>
      </div>
    );
  }

  const resultSets = result.resultSets ?? [];
  // A statement with no result sets (an INSERT, a DDL) lands on Messages, exactly as `:1838` chose.
  const defaultTab = resultSets.length > 0 ? '0' : MESSAGES_TAB;

  return (
    <Tabs
      defaultValue={defaultTab}
      className="flex min-h-0 grow flex-col"
      data-testid="query-results"
    >
      <TabsList data-testid="query-results-tabs">
        {resultSets.map((resultSet, index) => (
          <TabsTrigger
            key={index}
            value={String(index)}
            data-testid="query-results-tab"
            className="font-mono text-2xs tracking-eyebrow uppercase"
          >
            Result {index + 1}
            <span className="tabular-nums text-fg-subtle">({rowCountOf(resultSet)})</span>
          </TabsTrigger>
        ))}
        <TabsTrigger
          value={MESSAGES_TAB}
          data-testid="query-results-tab-messages"
          className="font-mono text-2xs tracking-eyebrow uppercase"
        >
          Messages
        </TabsTrigger>
      </TabsList>

      {resultSets.map((resultSet, index) => (
        <TabsContent key={index} value={String(index)} className="flex min-h-0 grow flex-col">
          {/* Radix unmounts the inactive tab's content, so exactly one grid per query tab exists at a
              time — which is what keeps a ten-statement batch from mounting ten grids. */}
          <ResultsGrid resultSet={resultSet} tabId={tabId} />
        </TabsContent>
      ))}
      <TabsContent value={MESSAGES_TAB} className="min-h-0 grow overflow-auto">
        <MessagesSlot result={result} />
      </TabsContent>
    </Tabs>
  );
});
