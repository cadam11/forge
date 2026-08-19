/**
 * The result-history panel, mounted for real.
 *
 * The pure parts are pinned elsewhere (`snapshots.spec.ts` for the adapter, the sort and the
 * formats; `result-diff.spec.ts` for the diff view model). What this file exists for is the wiring
 * a user actually touches: the list, the pin, the inline label that replaced a `window.prompt` that
 * has never worked in Electron, and the two-snapshot comparison that renders the inline diff.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryResult, QueryResultSnapshot, ResultDiff } from '@joinery/shared';

import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { queryResultsStore } from '../../state/query-results';
import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import { TooltipProvider } from '../../ui';
import { ResultHistoryPanel } from './result-history-panel';

const TAB_ID = 'tab-1';

function snapshotOf(overrides: Partial<QueryResultSnapshot> = {}): QueryResultSnapshot {
  return {
    id: 'snap-1',
    tabId: TAB_ID,
    sql: 'SELECT * FROM customers',
    connectionId: 'conn-1',
    database: 'joinery_test',
    executedAt: '2026-08-15T10:00:00.000Z',
    executionTimeMs: 41,
    success: true,
    totalRowCount: 5,
    storageSizeBytes: 800,
    resultSets: [],
    ...overrides,
  };
}

const SNAPSHOTS: QueryResultSnapshot[] = [
  snapshotOf({ id: 'newest', executedAt: '2026-08-15T12:00:00.000Z', totalRowCount: 9 }),
  snapshotOf({
    id: 'middle',
    executedAt: '2026-08-15T11:00:00.000Z',
    label: 'baseline',
    isPinned: true,
  }),
  snapshotOf({
    id: 'oldest',
    executedAt: '2026-08-15T10:00:00.000Z',
    success: false,
    error: 'boom',
    totalRowCount: 0,
  }),
];

const RESULT: QueryResult = {
  queryId: 'q1',
  success: true,
  resultSets: [{ columns: [{ name: 'id', type: 'int4' }], rows: [{ id: 1 }] }],
  executionTime: 12,
};

const DIFF: ResultDiff = {
  summary: {
    totalBaseRows: 3,
    totalCompareRows: 4,
    addedRows: 1,
    removedRows: 0,
    modifiedRows: 1,
    unchangedRows: 2,
    columnsAdded: 0,
    columnsRemoved: 0,
    columnsModified: 0,
  },
  schemaDiff: {
    addedColumns: [],
    removedColumns: [],
    modifiedColumns: [],
    columnOrderChanged: false,
  },
  rowDiffs: [
    {
      type: 'modified',
      rowIndex: 0,
      keyValues: { id: 1 },
      cellChanges: [{ column: 'email', baseValue: 'old@x.test', compareValue: 'new@x.test' }],
    },
    { type: 'added', rowIndex: 3, keyValues: { id: 4 }, compareRow: { id: 4, email: 'n@x.test' } },
    { type: 'unchanged', rowIndex: 1, keyValues: { id: 2 } },
    { type: 'unchanged', rowIndex: 2, keyValues: { id: 3 } },
  ],
  metadata: {
    baseSnapshot: { id: 'middle', executedAt: '2026-08-15T11:00:00.000Z', rowCount: 3 },
    compareSnapshot: { id: 'newest', executedAt: '2026-08-15T12:00:00.000Z', rowCount: 4 },
    comparisonTimeMs: 1,
  },
};

const teardowns: (() => void)[] = [];
const notifications: string[] = [];
let bridge: {
  getSnapshots: ReturnType<typeof vi.fn>;
  pinSnapshot: ReturnType<typeof vi.fn>;
  unpinSnapshot: ReturnType<typeof vi.fn>;
  labelSnapshot: ReturnType<typeof vi.fn>;
  compareSnapshots: ReturnType<typeof vi.fn>;
  saveSnapshot: ReturnType<typeof vi.fn>;
};

function installBridge(): void {
  bridge = {
    getSnapshots: vi.fn(() => Promise.resolve(SNAPSHOTS)),
    pinSnapshot: vi.fn(() => Promise.resolve(true)),
    unpinSnapshot: vi.fn(() => Promise.resolve(true)),
    labelSnapshot: vi.fn(() => Promise.resolve(true)),
    compareSnapshots: vi.fn(() => Promise.resolve(DIFF)),
    saveSnapshot: vi.fn(() => Promise.resolve(snapshotOf({ id: 'captured' }))),
  };
  teardowns.push(installJoineryMock({ queryResults: bridge }));
}

function mountPanel(props: Partial<Parameters<typeof ResultHistoryPanel>[0]> = {}) {
  const onView = vi.fn();
  const rendered = render(
    <TooltipProvider>
      <ResultHistoryPanel
        tabId={TAB_ID}
        result={RESULT}
        connectionId="conn-1"
        database="joinery_test"
        sql="SELECT * FROM customers"
        onView={onView}
        {...props}
      />
    </TooltipProvider>
  );
  return { ...rendered, onView };
}

function rowIds(): string[] {
  return screen
    .getAllByTestId('history-row')
    .map(row => row.getAttribute('data-snapshot-id') ?? '');
}

function row(id: string): HTMLElement {
  const found = screen
    .getAllByTestId('history-row')
    .find(element => element.getAttribute('data-snapshot-id') === id);
  if (found === undefined) throw new Error(`no history row for ${id}`);
  return found;
}

beforeEach(() => {
  installBridge();
  notifications.length = 0;
  teardowns.push(
    setDiagnosticsSink({ error: () => undefined, warn: () => undefined }),
    setNotifier({
      success: message => notifications.push(message),
      error: message => notifications.push(message),
      info: message => notifications.push(message),
      warning: message => notifications.push(message),
    })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  queryResultsStore.setState({
    snapshots: [],
    selectedIds: [],
    currentDiff: null,
    comparingIds: null,
  });
  vi.clearAllMocks();
});

describe('the list', () => {
  it('loads THIS tab’s snapshots on mount, newest first', async () => {
    mountPanel();

    await waitFor(() => expect(rowIds()).toEqual(['newest', 'middle', 'oldest']));
    expect(bridge.getSnapshots).toHaveBeenCalledExactlyOnceWith({ tabId: TAB_ID });
    expect(screen.getByTestId('history-count').textContent).toBe('3');
  });

  it('names a snapshot by its label, and by its SQL when it has none', async () => {
    mountPanel();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    expect(within(row('middle')).getByTestId('history-view').textContent).toBe('baseline');
    expect(within(row('newest')).getByTestId('history-view').textContent).toBe(
      'SELECT * FROM customers'
    );
  });

  it('shows rows and duration, and says “failed” instead of counting a failure’s zero rows', async () => {
    mountPanel();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    expect(within(row('newest')).getByTestId('history-stats').textContent).toBe('9 rows · 41ms');
    expect(within(row('oldest')).getByTestId('history-stats').textContent).toBe('failed');
  });

  it('marks the pinned one', async () => {
    mountPanel();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    expect(row('middle').getAttribute('data-pinned')).toBe('true');
    expect(row('newest').getAttribute('data-pinned')).toBe('false');
  });

  it('offers the empty state when nothing has been saved', async () => {
    bridge.getSnapshots.mockResolvedValueOnce([]);
    mountPanel();

    expect(await screen.findByTestId('history-empty')).toBeTruthy();
  });

  it('reloads when the tab’s result changes, and when asked', async () => {
    const user = userEvent.setup();
    const { rerender } = mountPanel();
    await waitFor(() => expect(bridge.getSnapshots).toHaveBeenCalledTimes(1));

    rerender(
      <TooltipProvider>
        <ResultHistoryPanel
          tabId={TAB_ID}
          result={{ ...RESULT, queryId: 'q2' }}
          connectionId="conn-1"
          database="joinery_test"
          sql="SELECT 1"
          onView={() => undefined}
        />
      </TooltipProvider>
    );
    await waitFor(() => expect(bridge.getSnapshots).toHaveBeenCalledTimes(2));

    await user.click(screen.getByTestId('history-refresh'));
    await waitFor(() => expect(bridge.getSnapshots).toHaveBeenCalledTimes(3));
  });
});

describe('pinning and labelling', () => {
  it('pins an unpinned snapshot and unpins a pinned one', async () => {
    const user = userEvent.setup();
    mountPanel();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    await user.click(within(row('newest')).getByTestId('history-pin'));
    expect(bridge.pinSnapshot).toHaveBeenCalledExactlyOnceWith('newest');

    await user.click(within(row('middle')).getByTestId('history-pin'));
    expect(bridge.unpinSnapshot).toHaveBeenCalledExactlyOnceWith('middle');
  });

  it('labels through an inline field — Enter commits', async () => {
    const user = userEvent.setup();
    mountPanel();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    await user.click(within(row('newest')).getByTestId('history-label'));
    await user.type(screen.getByTestId('history-label-input'), 'before the migration{Enter}');

    expect(bridge.labelSnapshot).toHaveBeenCalledExactlyOnceWith('newest', 'before the migration');
    expect(screen.queryByTestId('history-label-input')).toBeNull();
  });

  it('abandons the label on Escape', async () => {
    const user = userEvent.setup();
    mountPanel();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    await user.click(within(row('newest')).getByTestId('history-label'));
    await user.type(screen.getByTestId('history-label-input'), 'never{Escape}');

    expect(bridge.labelSnapshot).not.toHaveBeenCalled();
    expect(screen.queryByTestId('history-label-input')).toBeNull();
  });

  it('opens the existing label for editing rather than an empty field', async () => {
    const user = userEvent.setup();
    mountPanel();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    await user.click(within(row('middle')).getByTestId('history-label'));
    expect((screen.getByTestId('history-label-input') as HTMLInputElement).value).toBe('baseline');
  });
});

describe('capture', () => {
  it('saves the result on screen with the SQL that produced it, and pins it', async () => {
    const user = userEvent.setup();
    mountPanel();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    await user.click(screen.getByTestId('history-capture'));

    await waitFor(() =>
      expect(bridge.saveSnapshot).toHaveBeenCalledExactlyOnceWith(
        TAB_ID,
        'SELECT * FROM customers',
        'conn-1',
        'joinery_test',
        RESULT
      )
    );
    await waitFor(() => expect(bridge.pinSnapshot).toHaveBeenCalledWith('captured'));
    expect(notifications).toContain('Result captured and pinned');
  });

  it('is refused with nothing to capture', async () => {
    mountPanel({ result: null });
    expect((screen.getByTestId('history-capture') as HTMLButtonElement).disabled).toBe(true);
  });

  it('is refused for a failed result — there is nothing worth keeping', async () => {
    mountPanel({ result: { queryId: 'q1', success: false, error: 'syntax error' } });
    expect((screen.getByTestId('history-capture') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('comparing two snapshots', () => {
  async function selectTwo(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await waitFor(() => expect(rowIds()).toHaveLength(3));
    await user.click(within(row('middle')).getByTestId('history-select'));
    await user.click(within(row('newest')).getByTestId('history-select'));
  }

  it('enables Compare only with exactly two selected', async () => {
    const user = userEvent.setup();
    mountPanel();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    expect((screen.getByTestId('history-compare') as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(row('middle')).getByTestId('history-select'));
    expect((screen.getByTestId('history-compare') as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(row('newest')).getByTestId('history-select'));
    expect((screen.getByTestId('history-compare') as HTMLButtonElement).disabled).toBe(false);
    await user.click(within(row('oldest')).getByTestId('history-select'));
    expect((screen.getByTestId('history-compare') as HTMLButtonElement).disabled).toBe(true);
  });

  it('counts the selection', async () => {
    const user = userEvent.setup();
    mountPanel();
    await selectTwo(user);

    expect(screen.getByTestId('history-selected-count').textContent).toContain('2');
  });

  it('renders the inline diff: the counts, and the changed rows main returned', async () => {
    const user = userEvent.setup();
    mountPanel();
    await selectTwo(user);

    await user.click(screen.getByTestId('history-compare'));

    const diff = await screen.findByTestId('history-diff');
    expect(bridge.compareSnapshots).toHaveBeenCalledWith('middle', 'newest', undefined);
    expect(within(diff).getByTestId('history-diff-added').textContent).toBe('1');
    expect(within(diff).getByTestId('history-diff-modified').textContent).toBe('1');
    expect(within(diff).getByTestId('history-diff-unchanged').textContent).toBe('2');

    // The rows themselves — the half the Angular panel threw away.
    const rows = within(diff).getAllByTestId('history-diff-row');
    expect(rows.map(element => element.getAttribute('data-kind'))).toEqual(['modified', 'added']);
    expect(rows[0]?.textContent).toContain('old@x.test');
    expect(rows[0]?.textContent).toContain('new@x.test');
  });

  it('says so when the two snapshots hold the same rows', async () => {
    bridge.compareSnapshots.mockResolvedValueOnce({
      ...DIFF,
      summary: { ...DIFF.summary, addedRows: 0, modifiedRows: 0, unchangedRows: 4 },
      rowDiffs: [
        { type: 'unchanged', rowIndex: 3, keyValues: { id: 1 } },
        { type: 'unchanged', rowIndex: 0, keyValues: { id: 2 } },
      ],
    });
    const user = userEvent.setup();
    mountPanel();
    await selectTwo(user);

    await user.click(screen.getByTestId('history-compare'));

    expect((await screen.findByTestId('history-diff-identical')).textContent).toContain(
      'No differences'
    );
  });

  it('closes the comparison and keeps the list', async () => {
    const user = userEvent.setup();
    mountPanel();
    await selectTwo(user);
    await user.click(screen.getByTestId('history-compare'));
    await screen.findByTestId('history-diff');

    await user.click(screen.getByTestId('history-diff-close'));

    expect(screen.queryByTestId('history-diff')).toBeNull();
    expect(rowIds()).toHaveLength(3);
  });
});

describe('viewing one', () => {
  it('hands the snapshot to its host, which is what replaces the tab’s result', async () => {
    const user = userEvent.setup();
    const { onView } = mountPanel();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    await user.click(within(row('middle')).getByTestId('history-view'));

    expect(onView).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'middle', label: 'baseline' })
    );
  });
});

describe('sorting', () => {
  it('sorts by rows, and reverses on a second pick of the same field', async () => {
    const user = userEvent.setup();
    mountPanel();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    await user.click(screen.getByTestId('history-sort'));
    await user.click(screen.getByTestId('history-sort-totalRowCount'));
    expect(rowIds()).toEqual(['newest', 'middle', 'oldest']);

    await user.click(screen.getByTestId('history-sort'));
    await user.click(screen.getByTestId('history-sort-totalRowCount'));
    expect(rowIds()).toEqual(['oldest', 'middle', 'newest']);
  });
});
