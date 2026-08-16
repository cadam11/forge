/**
 * The results pane's five states. The cells are Task 11's; everything around them is this task's, and this
 * is what "structure ready for the grid" means concretely.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { QueryResult } from '@joinery/shared';
import { QueryResults } from './query-results';

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
    render(<QueryResults result={success()} executing />);
    expect(screen.getByTestId('query-results-executing')).toBeTruthy();
    expect(screen.queryByTestId('query-results')).toBeNull();
  });

  it('invites the user to run something when nothing has run', () => {
    render(<QueryResults result={null} executing={false} />);
    expect(screen.getByTestId('query-results-empty').textContent).toContain('No results yet');
  });

  it('shows the error text a failed query returned', () => {
    render(
      <QueryResults
        result={{ queryId: 'q', success: false, error: 'relation "nope" does not exist' }}
        executing={false}
      />
    );
    expect(screen.getByTestId('query-results-error-text').textContent).toBe(
      'relation "nope" does not exist'
    );
    // No tabs at all in the error state — there is nothing to switch between.
    expect(screen.queryByTestId('query-results-tabs')).toBeNull();
  });

  it('lands on the first result set when there is one', () => {
    render(<QueryResults result={success()} executing={false} />);
    expect(screen.getByTestId('query-result-rows').textContent).toBe('2');
    expect(screen.getAllByTestId('query-result-column').map(node => node.textContent)).toEqual([
      'id',
      'email',
    ]);
  });

  it('lands on Messages for a statement with no result sets', () => {
    // An INSERT or a DDL. The Angular version made the same choice (`:1838`).
    render(
      <QueryResults
        result={success({ resultSets: [], rowsAffected: 3, messages: ['3 rows inserted'] })}
        executing={false}
      />
    );
    expect(screen.getByTestId('query-messages').textContent).toContain('3 rows inserted');
    expect(screen.getByTestId('query-messages').textContent).toContain('3 rows affected');
  });
});

describe('multi-statement batches', () => {
  it('shows one tab per result set, each with its row count, plus Messages', () => {
    render(
      <QueryResults
        result={success({
          resultSets: [resultSet(2, ['a']), resultSet(5, ['b', 'c'])],
        })}
        executing={false}
      />
    );

    const tabs = screen.getAllByTestId('query-results-tab');
    expect(tabs.map(tab => tab.textContent)).toEqual(['Result 1(2)', 'Result 2(5)']);
    expect(screen.getByTestId('query-results-tab-messages')).toBeTruthy();
  });

  it('switches result sets', async () => {
    render(
      <QueryResults
        result={success({ resultSets: [resultSet(2, ['a']), resultSet(5, ['b'])] })}
        executing={false}
      />
    );

    await userEvent.click(screen.getAllByTestId('query-results-tab')[1] as HTMLElement);

    expect(screen.getByTestId('query-result-rows').textContent).toBe('5');
    expect(screen.getByTestId('query-result-column').textContent).toBe('b');
  });
});

describe('counts and truncation', () => {
  it('prefers the true received count over the rows it was handed', () => {
    // The executor caps `rows` at the user's `maxRowsToDisplay` and reports the real count separately.
    render(
      <QueryResults
        result={success({
          resultSets: [resultSet(10, ['a'], { rowCount: 40_000, truncated: true })],
        })}
        executing={false}
      />
    );
    expect(screen.getByTestId('query-result-rows').textContent).toBe('40000');
    expect(screen.getByTestId('query-result-truncated')).toBeTruthy();
  });

  it('says nothing about truncation when nothing was truncated', () => {
    render(<QueryResults result={success()} executing={false} />);
    expect(screen.queryByTestId('query-result-truncated')).toBeNull();
  });

  it('falls back to "executed successfully" when a statement returned no messages', () => {
    render(<QueryResults result={success({ resultSets: [] })} executing={false} />);
    expect(screen.getByTestId('query-messages').textContent).toContain(
      'Query executed successfully.'
    );
  });
});
