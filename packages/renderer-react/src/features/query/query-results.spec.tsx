/**
 * The results pane's states, and the result-set tabs over them. The grid itself has its own spec
 * (`results-grid.spec.tsx`) and its own double, which is why AG Grid is mocked here too: what this file
 * is about is which of the five states the pane chooses, and one of them is "a grid".
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type QueryResult } from '@joinery/shared';
import { TooltipProvider } from '../../ui';
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
