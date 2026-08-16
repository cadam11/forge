/**
 * The query tab's results pane — **the structure, with the grid left out.**
 *
 * PLAN.md's Task 11 owns the grid itself (`ag-grid-react`, all 26 `--ag-*` from tokens, sort/filter,
 * the three copy formats, export), and this task's constraint is explicit: "the query tab renders
 * results into a placeholder section (structure ready for the grid, no ag-grid dep yet)". So everything
 * around the cells is real — the result-set tabs, the row counts, the truncation notice, the Messages
 * pane, the error state, the empty state — and the cells are a labelled slot.
 *
 * It is not an empty div, for the same reason Task 7's panel placeholders were not: what is here has to
 * prove the seams work. The tabs come from `result.resultSets`, so a multi-statement batch is exercised;
 * the counts come from `rowCount ?? rows.length`, which is the field the executor sets when it truncates
 * main-side; and the error path renders `result.error`, which is what a failed execute produces.
 *
 * Replaces `query.component.ts:388-531`, whose result tabs were hand-rolled `<button class="result-tab">`
 * elements with a `[class.active]` binding and an `activeTab()` signal holding strings like `'result-0'`
 * — parsed back out with `parseInt(tab.replace('result-', ''), 10)` to find the result set. Radix `Tabs`
 * owns the roving focus and the `aria-selected` wiring instead, and the value is still the index because
 * that is what identifies a result set.
 */

import { Terminal } from 'lucide-react';
import type { QueryResult, ResultSet } from '@joinery/shared';

import { EmptyState, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '../../ui';

const MESSAGES_TAB = 'messages';

export interface QueryResultsProps {
  readonly result: QueryResult | null;
  readonly executing: boolean;
}

/** The count the header shows: the true received count when the rows were capped main-side. */
function rowCountOf(resultSet: ResultSet): number {
  return resultSet.rowCount ?? resultSet.rows.length;
}

/**
 * One result set's slot. Column names are real (they come back with the result and cost nothing), the
 * cells are Task 11's.
 */
function ResultSetSlot({ resultSet }: { readonly resultSet: ResultSet }) {
  const rows = rowCountOf(resultSet);
  return (
    <div className="flex min-h-0 flex-col gap-2 p-3" data-testid="query-result-set">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-mono text-2xs tracking-eyebrow text-fg-muted uppercase">
          <span data-testid="query-result-rows" className="tabular-nums">
            {rows}
          </span>{' '}
          {rows === 1 ? 'row' : 'rows'} · {resultSet.columns.length}{' '}
          {resultSet.columns.length === 1 ? 'column' : 'columns'}
        </p>
        {resultSet.truncated === true ? (
          <p data-testid="query-result-truncated" className="text-xs text-warning">
            Truncated to your maximum row setting.
          </p>
        ) : null}
      </div>

      {/* The column header row, hairline-ruled per `tables.md`'s look. The rows below it are the
          grid's, and saying so beats an empty rectangle a reader could mistake for "no data". */}
      <div className="min-h-0 overflow-auto rounded-sm border border-rule">
        <div className="flex items-center gap-4 border-b border-rule bg-surface px-3 py-1.5">
          {resultSet.columns.map(column => (
            <span
              key={column.name}
              data-testid="query-result-column"
              className="font-mono text-xs whitespace-nowrap text-fg"
            >
              {column.name}
            </span>
          ))}
        </div>
        <p className="px-3 py-2 text-md text-fg-muted">
          The results grid lands in Task 11. The result is in the store and its shape is above.
        </p>
      </div>
    </div>
  );
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

export function QueryResults({ result, executing }: QueryResultsProps) {
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
          <ResultSetSlot resultSet={resultSet} />
        </TabsContent>
      ))}
      <TabsContent value={MESSAGES_TAB} className="min-h-0 grow overflow-auto">
        <MessagesSlot result={result} />
      </TabsContent>
    </Tabs>
  );
}
