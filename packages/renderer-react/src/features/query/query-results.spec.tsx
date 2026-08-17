/**
 * The results pane's states, and the result-set tabs over them. The grid itself has its own spec
 * (`results-grid.spec.tsx`) and its own double, which is why AG Grid is mocked here too: what this file
 * is about is which of the five states the pane chooses, and one of them is "a grid".
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_SETTINGS, DEFAULT_SETTINGS, type QueryResult } from '@joinery/shared';
import { TooltipProvider } from '../../ui';
import { aiStore } from '../../state/ai';
import { queryPlanStore, type PlanState } from '../../state/query-plan';
import { settingsStore } from '../../state/settings';

// jsdom has no layout, so a real AG Grid renders a header and no rows — see `results-grid.spec.tsx`.
vi.mock('ag-grid-react', () => ({ AgGridReact: () => <div data-testid="ag-grid-double" /> }));

const { QueryResults } = await import('./query-results');

const TAB_ID = 'tab-1';

/** The pane's toolbar is tooltipped, so the provider the shell mounts once has to be here. */
function renderPane(element: React.ReactElement) {
  return render(<TooltipProvider>{element}</TooltipProvider>);
}

const resultSet = (rows: number, columns: string[], extra: Record<string, unknown> = {}) => ({
  columns: columns.map(name => ({ name, dataType: 'text' })) as never,
  rows: Array.from({ length: rows }, () => ({})),
  ...extra,
});

const success = (overrides: Partial<QueryResult> = {}): QueryResult => ({
  queryId: 'query-1',
  success: true,
  resultSets: [resultSet(2, ['id', 'email'])],
  executionTime: 12,
  ...overrides,
});

describe('states', () => {
  it('shows a spinner while a query is running, even with a previous result present', () => {
    renderPane(<QueryResults result={success()} executing tabId={TAB_ID} />);
    expect(screen.getByTestId('query-results-executing')).toBeTruthy();
    expect(screen.queryByTestId('query-results')).toBeNull();
  });

  it('invites the user to run something when nothing has run', () => {
    renderPane(<QueryResults result={null} executing={false} tabId={TAB_ID} />);
    expect(screen.getByTestId('query-results-empty').textContent).toContain('No results yet');
  });

  it('shows the error text a failed query returned', () => {
    renderPane(
      <QueryResults
        result={{ queryId: 'q', success: false, error: 'relation "nope" does not exist' }}
        executing={false}
        tabId={TAB_ID}
      />
    );
    expect(screen.getByTestId('query-results-error-text').textContent).toBe(
      'relation "nope" does not exist'
    );
    // No tabs at all in the error state — there is nothing to switch between.
    expect(screen.queryByTestId('query-results-tabs')).toBeNull();
  });

  it('lands on the first result set when there is one', () => {
    renderPane(<QueryResults result={success()} executing={false} tabId={TAB_ID} />);
    // The counts are the grid toolbar's now, and the columns are the grid's own header cells — which
    // is why the count is what this spec asserts and `results-grid.spec.tsx` asserts the colDefs.
    expect(screen.getByTestId('results-row-count').textContent).toBe('2');
    expect(screen.getByTestId('results-column-count').textContent).toBe('2 cols');
  });

  it('lands on Messages for a statement with no result sets', () => {
    // An INSERT or a DDL. The Angular version made the same choice (`:1838`).
    renderPane(
      <QueryResults
        result={success({ resultSets: [], rowsAffected: 3, messages: ['3 rows inserted'] })}
        executing={false}
        tabId={TAB_ID}
      />
    );
    expect(screen.getByTestId('query-messages').textContent).toContain('3 rows inserted');
    expect(screen.getByTestId('query-messages').textContent).toContain('3 rows affected');
  });
});

describe('multi-statement batches', () => {
  it('shows one tab per result set, each with its row count, plus Messages', () => {
    renderPane(
      <QueryResults
        result={success({
          resultSets: [resultSet(2, ['a']), resultSet(5, ['b', 'c'])],
        })}
        executing={false}
        tabId={TAB_ID}
      />
    );

    const tabs = screen.getAllByTestId('query-results-tab');
    expect(tabs.map(tab => tab.textContent)).toEqual(['Result 1(2)', 'Result 2(5)']);
    expect(screen.getByTestId('query-results-tab-messages')).toBeTruthy();
  });

  it('switches result sets', async () => {
    renderPane(
      <QueryResults
        result={success({ resultSets: [resultSet(2, ['a']), resultSet(5, ['b'])] })}
        executing={false}
        tabId={TAB_ID}
      />
    );

    await userEvent.click(screen.getAllByTestId('query-results-tab')[1] as HTMLElement);

    expect(screen.getByTestId('results-row-count').textContent).toBe('5');
    expect(screen.getByTestId('results-column-count').textContent).toBe('1 col');
  });
});

describe('counts and truncation', () => {
  it('prefers the true received count over the rows it was handed', () => {
    // The executor caps `rows` at the user's `maxRowsToDisplay` and reports the real count separately.
    renderPane(
      <QueryResults
        result={success({
          resultSets: [resultSet(10, ['a'], { rowCount: 40_000, truncated: true })],
        })}
        executing={false}
        tabId={TAB_ID}
      />
    );
    expect(screen.getByTestId('results-row-count').textContent).toBe('40,000');
    expect(screen.getByTestId('results-displayed-count').textContent).toBe('10');
    expect(screen.getByTestId('results-truncated')).toBeTruthy();
  });

  it('says nothing about truncation when nothing was truncated', () => {
    renderPane(<QueryResults result={success()} executing={false} tabId={TAB_ID} />);
    expect(screen.queryByTestId('results-truncated')).toBeNull();
  });

  it('falls back to "executed successfully" when a statement returned no messages', () => {
    renderPane(
      <QueryResults result={success({ resultSets: [] })} executing={false} tabId={TAB_ID} />
    );
    expect(screen.getByTestId('query-messages').textContent).toContain(
      'Query executed successfully.'
    );
  });

  /*
   * `QuerySettings.showExecutionTime`'s consumer assertion, and the whole reason the setting is allowed
   * to ship a live-looking toggle: before Task 15 the duration line printed unconditionally while a
   * toggle for it sat in Settings — J-44's class of defect, a control that persisted and changed nothing.
   */
  it('shows the duration line by default, and hides it when the setting is off', () => {
    const shown = renderPane(
      <QueryResults result={success({ resultSets: [] })} executing={false} tabId={TAB_ID} />
    );
    expect(screen.getByTestId('query-messages-execution-time').textContent).toContain('12');
    shown.unmount();

    settingsStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        query: { ...DEFAULT_SETTINGS.query, showExecutionTime: false },
      },
    });
    try {
      renderPane(
        <QueryResults result={success({ resultSets: [] })} executing={false} tabId={TAB_ID} />
      );
      expect(screen.queryByTestId('query-messages-execution-time')).toBeNull();
      // The rest of the pane is untouched: the setting hides one line, not the messages.
      expect(screen.getByTestId('query-messages').textContent).toContain(
        'Query executed successfully.'
      );
    } finally {
      settingsStore.setState({ settings: DEFAULT_SETTINGS });
    }
  });
});

/**
 * Task 19b's two tabs. Both are conditional, and each condition is a claim worth pinning: a Plan tab
 * belongs to ONE result, and an Analysis tab exists only while the user has left that feature on.
 */
describe('the plan and analysis tabs', () => {
  const plan: PlanState = {
    forResult: success(),
    engine: 'postgresql',
    kind: 'estimated',
    root: { type: 'Seq Scan', object: 'customers', costPercent: 100, extra: [], children: [] },
    summary: { totalCost: 12, warnings: [] },
    sql: 'SELECT * FROM customers',
  };

  afterEach(() => {
    queryPlanStore.setState({ plans: new Map() });
    aiStore.setState({ settings: { ...DEFAULT_AI_SETTINGS } });
  });

  it('offers no Plan tab until a plan has been asked for', () => {
    renderPane(<QueryResults result={success()} executing={false} tabId={TAB_ID} />);
    expect(screen.queryByTestId('query-results-tab-plan')).toBeNull();
  });

  it('lands on the Plan tab when a plan arrives, because that is what was asked for', () => {
    queryPlanStore.setState({ plans: new Map([[TAB_ID, plan]]) });
    renderPane(<QueryResults result={plan.forResult} executing={false} tabId={TAB_ID} />);

    expect(screen.queryByTestId('query-results-tab-plan')).not.toBeNull();
    expect(screen.getByTestId('execution-plan')).toBeTruthy();
    expect(screen.getByTestId('plan-node-type').textContent).toBe('Seq Scan');
  });

  it('retires the Plan tab when the tab’s result changes, with no invalidation call', () => {
    // The Angular `planData` signal was cleared only by the NEXT plan request, so an ordinary Execute
    // left a Plan tab up showing the previous statement's plan.
    queryPlanStore.setState({ plans: new Map([[TAB_ID, plan]]) });
    renderPane(
      <QueryResults result={success({ queryId: 'query-2' })} executing={false} tabId={TAB_ID} />
    );
    expect(screen.queryByTestId('query-results-tab-plan')).toBeNull();
  });

  it('offers the Analysis tab while the feature is on, and not when it is off', () => {
    const shown = renderPane(<QueryResults result={success()} executing={false} tabId={TAB_ID} />);
    // On by default, and NOT gated on the master AI switch — the panel's own "Set up AI" degrade is for
    // exactly the user who has not configured a provider.
    expect(screen.queryByTestId('query-results-tab-analysis')).not.toBeNull();
    shown.unmount();

    aiStore.setState({
      settings: {
        ...DEFAULT_AI_SETTINGS,
        features: { ...DEFAULT_AI_SETTINGS.features, analysisEnabled: false },
      },
    });
    renderPane(<QueryResults result={success()} executing={false} tabId={TAB_ID} />);
    expect(screen.queryByTestId('query-results-tab-analysis')).toBeNull();
  });

  it('analyses the result set the user was reading, not always the first of a batch', async () => {
    renderPane(
      <QueryResults
        result={success({ resultSets: [resultSet(2, ['a']), resultSet(2, ['b'])] })}
        executing={false}
        tabId={TAB_ID}
      />
    );

    // Read the second result set, then switch to Analysis. Deriving the target from the ACTIVE tab
    // cannot work — clicking Analysis makes Analysis active — so the last numeric pick is remembered.
    await userEvent.click(screen.getAllByTestId('query-results-tab')[1] as HTMLElement);
    await userEvent.click(screen.getByTestId('query-results-tab-analysis'));
    // No provider is configured in this spec, so the panel shows its degrade — which is enough to prove
    // it mounted with a result set rather than with `null`.
    expect(screen.queryByTestId('analysis-no-provider')).not.toBeNull();
  });
});
