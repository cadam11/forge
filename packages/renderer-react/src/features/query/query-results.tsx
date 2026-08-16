/**
 * The query tab's results pane: the result-set tabs, Messages, **History**, the four states that are
 * not a grid — executing, nothing-run-yet, failed, and a batch whose statement returned no rows — and
 * the **row-detail rail** beside them.
 *
 * Replaces `query.component.ts:388-531`, whose result tabs were hand-rolled `<button
 * class="result-tab">` elements with a `[class.active]` binding and an `activeTab()` signal holding
 * strings like `'result-0'` — parsed back out with `parseInt(tab.replace('result-', ''), 10)` to find
 * the result set. Radix `Tabs` owns the roving focus and the `aria-selected` wiring instead, and the
 * value is still the index because that is what identifies a result set.
 *
 * ── Why this component is memoised ────────────────────────────────────────────────────────────
 *
 * It is the R2 boundary (PLAN.md's grid-performance risk). `QueryPanel` re-renders for reasons that
 * have nothing to do with the result — the first keystroke after a save flips `isDirty`, which writes
 * the tab store — and without `memo` here every one of those would re-render the grid beneath it. The
 * props are chosen so the memo can actually hold: `result` is the object the execution store's
 * `results` Map holds (identity changes only when a query lands) and the other two are primitives.
 * Adding a prop that is built in the panel's render body — an array, an object literal, an inline
 * arrow — would silently defeat this, which is what `render-isolation.spec.tsx` exists to catch.
 *
 * Task 14 added two subscriptions HERE rather than two props, for the same reason: the connection and
 * database its sub-panels need are read with primitive selectors, so this component re-renders when
 * the tab is re-pointed and never when the tab is merely typed in — and `<ResultsGrid>`'s memo holds
 * regardless, because every prop it receives is a store value or a `useCallback`.
 *
 * ── Which tab is showing, without an effect ───────────────────────────────────────────────────
 *
 * `selected` is the user's last explicit pick and `active` is derived from it: a pick that no longer
 * names an existing tab (result set 3 of a batch that now returns one) falls back to the default. So a
 * new result cannot leave the pane pointed at nothing, and no effect has to chase it — which is also
 * what lets "view this snapshot" switch to the grid by setting one piece of state.
 */

import { memo, useCallback, useState } from 'react';
import { History, Terminal } from 'lucide-react';
import type { QueryResult, QueryResultSnapshot, ResultSet } from '@joinery/shared';

import {
  queryExecutionStore,
  selectSqlFor,
  useQueryExecutionStore,
} from '../../state/query-execution';
import { queryResultsStore } from '../../state/query-results';
import { diagnostics, notify } from '../../state/diagnostics';
import { useTabStore } from '../../state/tab';
import { EmptyState, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '../../ui';
import { ResultHistoryPanel } from './result-history-panel';
import { ResultsGrid } from './results-grid';
import { RowDetailPanel, type RowDetailTarget } from './row-detail-panel';
import { formatSnapshotTime, snapshotAsResult, snapshotNeedsHydration } from './snapshots';

const MESSAGES_TAB = 'messages';
const HISTORY_TAB = 'history';

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
  const connectionId = useTabStore(
    state => state.tabs.find(tab => tab.id === tabId)?.connectionId ?? null
  );
  const database = useTabStore(
    state => state.tabs.find(tab => tab.id === tabId)?.databaseName ?? null
  );
  const sql = useQueryExecutionStore(selectSqlFor(tabId));

  /**
   * The user's explicit tab pick, tied to the result it was made against.
   *
   * Tying it is what sends a new run back to its rows: a user who was reading Messages or History when
   * they pressed Execute gets the result they asked for, which is what `query.component.ts:1838` did
   * with `activeTab.set('result-0')`. It also cannot leave the pane pointed at a result set a shorter
   * batch no longer has — `tabValues` is checked as well.
   */
  const [selected, setSelected] = useState<{
    readonly forResult: QueryResult | null;
    readonly value: string;
  } | null>(null);
  /**
   * The inspected row, tied to the result it was opened on — same trick as `viewing` below, and for a
   * sharper reason: the target closes over the GRID's displayed-order accessor, and a grid that has
   * been unmounted by a new result or a switch to another result set can no longer answer. Deriving
   * the rail's visibility from `result` identity and the active tab retires it exactly when the grid
   * it belongs to goes away, with no effect and no teardown callback threaded through the grid.
   */
  const [rowDetail, setRowDetail] = useState<{
    readonly forResult: QueryResult;
    readonly target: RowDetailTarget;
  } | null>(null);
  /**
   * The snapshot the pane is showing, tied to the RESULT OBJECT it installed. Comparing identities is
   * what retires the notice when the next real run lands, with no effect and no stale flag: a
   * different result means the user is not looking at the snapshot any more.
   */
  const [viewing, setViewing] = useState<{
    readonly forResult: QueryResult;
    readonly snapshot: QueryResultSnapshot;
  } | null>(null);

  const closeRowDetail = useCallback(() => setRowDetail(null), []);

  /**
   * Opening the rail. `result` is the only dependency, so this arrow keeps its identity across every
   * render that is not a new query — which is what lets `<ResultsGrid>`'s memo hold while the grid
   * still gets a way to open the rail. When the result DOES change the grid re-renders anyway.
   */
  const openRowDetail = useCallback(
    (target: RowDetailTarget): void => {
      if (result === null) return;
      setRowDetail({ forResult: result, target });
    },
    [result]
  );

  /** Next/Previous walk the GRID's displayed order — see `DisplayedRows`. */
  const navigateRowDetail = useCallback((direction: 'next' | 'previous'): void => {
    setRowDetail(current => {
      if (current === null) return current;
      const target = current.target;
      const index = direction === 'next' ? target.rowIndex + 1 : target.rowIndex - 1;
      if (index < 0) return current;
      const row = target.source.at(index);
      if (row === null) return current;
      return {
        ...current,
        target: { ...target, rowIndex: index, row, totalRows: target.source.count() },
      };
    });
  }, []);

  const viewSnapshot = useCallback(
    (snapshot: QueryResultSnapshot): void => {
      void hydrate(snapshot)
        .then(full => {
          if (full === null) return;
          const asResult = snapshotAsResult(full);
          // The SQL travels with it: the row inspector resolves FK metadata from the statement that
          // produced what is on screen, and that is now the snapshot's, not the editor's.
          queryExecutionStore.getState().setResult(tabId, asResult, full.sql);
          setViewing({ forResult: asResult, snapshot: full });
          setRowDetail(null);
          setSelected({
            forResult: asResult,
            value: full.resultSets.length > 0 ? '0' : MESSAGES_TAB,
          });
        })
        // `hydrate` reports a missing snapshot itself and resolves with null; this arm is for the
        // unexpected, which must not become a silent unhandled rejection out of a click.
        .catch(error => {
          notify.error('Could not load that saved result');
          diagnostics.error('failed to open a saved result', error);
        });
    },
    [tabId]
  );

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
  const tabValues = [...resultSets.map((_, index) => String(index)), MESSAGES_TAB, HISTORY_TAB];
  const active =
    selected !== null && selected.forResult === result && tabValues.includes(selected.value)
      ? selected.value
      : defaultTab;
  const showingSnapshot = viewing !== null && viewing.forResult === result;
  const inspecting =
    rowDetail !== null &&
    rowDetail.forResult === result &&
    String(rowDetail.target.resultIndex) === active
      ? rowDetail.target
      : null;

  return (
    <div className="flex min-h-0 grow flex-col">
      {showingSnapshot ? (
        // Amber: a result that is not this tab's latest run is stale, which is exactly what
        // HOUSE-RULES §5 reserves amber for. A rule, not a filled banner.
        <p
          data-testid="query-results-historical"
          className="shrink-0 border-l-2 border-warning bg-surface px-3 py-1 text-sm text-fg"
        >
          Showing a saved result from{' '}
          <span className="tabular-nums">{formatSnapshotTime(viewing.snapshot.executedAt)}</span>.
          Run the query again to return to live results.
        </p>
      ) : null}

      <div className="flex min-h-0 grow">
        <Tabs
          value={active}
          onValueChange={value => setSelected({ forResult: result, value })}
          className="flex min-w-0 min-h-0 grow flex-col"
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
            <TabsTrigger
              value={HISTORY_TAB}
              data-testid="query-results-tab-history"
              className="font-mono text-2xs tracking-eyebrow uppercase"
            >
              <History className="size-3.5 shrink-0 stroke-fg-muted" aria-hidden />
              History
            </TabsTrigger>
          </TabsList>

          {resultSets.map((resultSet, index) => (
            <TabsContent key={index} value={String(index)} className="flex min-h-0 grow flex-col">
              {/* Radix unmounts the inactive tab's content, so exactly one grid per query tab exists
                  at a time — which is what keeps a ten-statement batch from mounting ten grids. */}
              <ResultsGrid
                resultSet={resultSet}
                tabId={tabId}
                resultIndex={index}
                onRowOpen={openRowDetail}
              />
            </TabsContent>
          ))}
          <TabsContent value={MESSAGES_TAB} className="min-h-0 grow overflow-auto">
            <MessagesSlot result={result} />
          </TabsContent>
          <TabsContent value={HISTORY_TAB} className="flex min-h-0 grow flex-col">
            <ResultHistoryPanel
              tabId={tabId}
              result={result}
              connectionId={connectionId}
              database={database}
              sql={sql}
              onView={viewSnapshot}
            />
          </TabsContent>
        </Tabs>

        {inspecting === null ? null : (
          <RowDetailPanel
            tabId={tabId}
            target={inspecting}
            onClose={closeRowDetail}
            onNavigate={navigateRowDetail}
          />
        )}
      </div>
    </div>
  );
});

/**
 * A list entry's rows, fetched by id when they are still on disk.
 *
 * The failure is reported here rather than swallowed, because the user asked to see something and
 * nothing appearing needs a reason (`query.component.ts:2569-2573` did the same).
 */
async function hydrate(snapshot: QueryResultSnapshot): Promise<QueryResultSnapshot | null> {
  if (!snapshotNeedsHydration(snapshot)) return snapshot;
  const full = await queryResultsStore.getState().getSnapshot(snapshot.id);
  if (full === null) {
    notify.error('Could not load that saved result');
    return null;
  }
  return full;
}
