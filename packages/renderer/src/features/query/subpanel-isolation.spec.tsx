/**
 * R2/R3, asserted for Task 14's sub-panels: **nothing that happens elsewhere in the app re-renders
 * the row inspector or the result-history panel.**
 *
 * `render-isolation.spec.tsx` proves the same property for the grid, and PLAN.md's risk register is
 * why both exist: R2 is "a badly-scoped store selector re-renders 10k rows per keystroke" and R3 is
 * the streaming-chat equivalent — `chat.onStreamChunk` is a single global subscription (PLAN.md §7.6),
 * so every token writes a store that every mounted component can be subscribed to by accident.
 *
 * ── How the counting works, and why it is honest ──────────────────────────────────────────────
 *
 * Each panel module is mocked with a **wrapper that renders the real component** and increments a
 * counter first. Neither panel is memoised, so a wrapper render and a panel render are the same
 * event: if the pane re-renders the wrapper, the real panel re-renders too. What is being measured is
 * therefore the thing that matters — whether the parent's re-render reaches the subtree at all — and
 * the panels' own behaviour is untouched (their specs mount them for real).
 *
 * Every case ends with a sanity assertion in the same file: a NEW RESULT must re-render both. A test
 * that only counted zeros would pass against a pane that never updates anything.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, QueryResult } from '@joinery/shared';

import { chatPanelStore } from '../../state/chat';
import { connectionStore } from '../../state/connection';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import {
  queryExecutionStore,
  selectResultFor,
  useQueryExecutionStore,
} from '../../state/query-execution';
import { queryResultsStore } from '../../state/query-results';
import { tabStore } from '../../state/tab';
import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import { TooltipProvider } from '../../ui';
import { IpcQueryProvider } from '../../ipc';

// ── the render counters ────────────────────────────────────────────────────────────────────

const railRenders = { count: 0 };
const historyRenders = { count: 0 };

vi.mock('./row-detail-panel', async importOriginal => {
  const actual = await importOriginal<typeof import('./row-detail-panel')>();
  return {
    ...actual,
    RowDetailPanel: (props: Parameters<typeof actual.RowDetailPanel>[0]) => {
      railRenders.count += 1;
      return <actual.RowDetailPanel {...props} />;
    },
  };
});

vi.mock('./result-history-panel', async importOriginal => {
  const actual = await importOriginal<typeof import('./result-history-panel')>();
  return {
    ...actual,
    ResultHistoryPanel: (props: Parameters<typeof actual.ResultHistoryPanel>[0]) => {
      historyRenders.count += 1;
      return <actual.ResultHistoryPanel {...props} />;
    },
  };
});

/** The AG Grid double: a render counter that hands its two callbacks to the test. */
const grid: {
  onRowDoubleClicked: ((event: { rowIndex: number; data: Record<string, unknown> }) => void) | null;
  onSelectionChanged: (() => void) | null;
} = { onRowDoubleClicked: null, onSelectionChanged: null };

vi.mock('ag-grid-react', () => ({
  AgGridReact: ({
    onGridReady,
    onRowDoubleClicked,
    onSelectionChanged,
  }: {
    onGridReady?: (event: { api: unknown }) => void;
    onRowDoubleClicked?: (event: { rowIndex: number; data: Record<string, unknown> }) => void;
    onSelectionChanged?: () => void;
  }) => {
    grid.onRowDoubleClicked = onRowDoubleClicked ?? null;
    grid.onSelectionChanged = onSelectionChanged ?? null;
    const ready = useRef(false);
    useEffect(() => {
      if (ready.current) return;
      ready.current = true;
      onGridReady?.({ api: GRID_API });
    }, [onGridReady]);
    return <div data-testid="ag-grid-double" />;
  },
}));

const ROWS = [
  { id: 1, email: 'a@x.test' },
  { id: 2, email: 'b@x.test' },
];

/** Only the members `<ResultsGrid>` and the rail's navigation actually call. */
const GRID_API = {
  autoSizeAllColumns: () => undefined,
  getColumns: () => [],
  setColumnWidths: () => undefined,
  getSelectedRows: () => [],
  isDestroyed: () => false,
  getDisplayedRowCount: () => ROWS.length,
  getDisplayedRowAtIndex: (index: number) => ({ data: ROWS[index] }),
};

const { QueryResults } = await import('./query-results');

// ── the harness ────────────────────────────────────────────────────────────────────────────

const RESULT: QueryResult = {
  queryId: 'query-1',
  success: true,
  resultSets: [
    {
      columns: [
        { name: 'id', type: 'int4' },
        { name: 'email', type: 'text' },
      ],
      rows: ROWS,
    },
  ],
  executionTime: 4,
};

const teardowns: (() => void)[] = [];

/**
 * Stands in for `<QueryPanel>`: it reads the result from the store with the same selector the panel
 * uses and passes it down. That subscription is what makes "a new result lands" a real prop change
 * here rather than a store write nothing is listening to — and it is deliberately the ONLY thing this
 * harness subscribes to, so a keystroke reaches the pane through no path but the one being measured.
 */
function Harness({ tabId, children }: { readonly tabId: string; readonly children?: ReactNode }) {
  const result = useQueryExecutionStore(selectResultFor(tabId));
  return (
    <IpcQueryProvider>
      <TooltipProvider>
        {children}
        <QueryResults result={result} executing={false} tabId={tabId} />
      </TooltipProvider>
    </IpcQueryProvider>
  );
}

/** A query tab showing `RESULT`, with the pane mounted and the rail and history panel both open. */
async function mountPaneWithPanels(): Promise<{ tabId: string; unmount: () => void }> {
  connectionStore.setState({
    profiles: [{ id: 'conn-1', name: 'Test PG', engine: 'postgresql' } as ConnectionProfile],
  } as never);
  const tabId = tabStore.getState().openQueryTab('conn-1', 'joinery_test', 'SELECT 1', false);
  tabStore.getState().markClean(tabId);
  queryExecutionStore.getState().setResult(tabId, RESULT, 'SELECT id, email FROM customers');

  const { unmount } = render(<Harness tabId={tabId} />);

  // Open the rail the way a user does.
  await act(async () => {
    grid.onRowDoubleClicked?.({ rowIndex: 0, data: ROWS[0] as Record<string, unknown> });
  });
  // The history panel is a result tab, so it mounts when its content does. Rendering it alongside the
  // grid is not possible (Radix unmounts the inactive tab), so it is mounted here in its own pane
  // instance — see the second describe.
  return { tabId, unmount };
}

/** One keystroke's worth of store traffic: the text, then the dirty flag it flips. */
function keystroke(tabId: string, text: string): void {
  act(() => {
    tabStore.getState().setTabContent(tabId, text);
    tabStore.getState().markDirty(tabId);
  });
}

/** What one streaming chat token does to the store `chat.onStreamChunk` writes. */
function chatToken(text: string): void {
  act(() => {
    chatPanelStore.setState(state => ({
      streaming: true,
      streamingContent: state.streamingContent + text,
    }));
  });
}

beforeEach(() => {
  railRenders.count = 0;
  historyRenders.count = 0;
  grid.onRowDoubleClicked = null;
  grid.onSelectionChanged = null;
  teardowns.push(
    installJoineryMock({
      explorer: { getEnrichedColumns: vi.fn(() => Promise.resolve([])) },
      queryResults: { getSnapshots: vi.fn(() => Promise.resolve([])) },
    }),
    setDiagnosticsSink({ error: () => undefined, warn: () => undefined }),
    setNotifier({
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warning: () => undefined,
    })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  for (const tab of tabStore.getState().tabs) queryExecutionStore.getState().forgetTab(tab.id);
  tabStore.setState({ tabs: [], activeTabId: '' });
  connectionStore.setState({ profiles: [] } as never);
  queryResultsStore.setState({ snapshots: [], selectedIds: [], currentDiff: null });
  chatPanelStore.setState({ streaming: false, streamingContent: '' });
});

describe('the row-detail rail', () => {
  it('is mounted by a double-click on a row', async () => {
    const { unmount } = await mountPaneWithPanels();
    teardowns.push(unmount);

    expect(screen.getByTestId('rowdetail-panel')).toBeTruthy();
    expect(railRenders.count).toBeGreaterThan(0);
  });

  it('does not re-render for twenty keystrokes in the editor', async () => {
    const { tabId, unmount } = await mountPaneWithPanels();
    teardowns.push(unmount);
    const baseline = railRenders.count;

    for (let index = 0; index < 20; index += 1) keystroke(tabId, `SELECT ${index}`);

    // The keystrokes really landed — otherwise this test proves nothing.
    expect(tabStore.getState().getTabContent(tabId)).toBe('SELECT 19');
    expect(tabStore.getState().tabs.find(tab => tab.id === tabId)?.isDirty).toBe(true);
    expect(railRenders.count).toBe(baseline);
  });

  it('does not re-render for a hundred streaming chat tokens', async () => {
    const { unmount } = await mountPaneWithPanels();
    teardowns.push(unmount);
    const baseline = railRenders.count;

    for (let index = 0; index < 100; index += 1) chatToken('tok ');

    expect(chatPanelStore.getState().streamingContent.length).toBe(400);
    expect(railRenders.count).toBe(baseline);
  });

  it('does not re-render when the grid’s selection changes', async () => {
    const { unmount } = await mountPaneWithPanels();
    teardowns.push(unmount);
    const baseline = railRenders.count;

    act(() => grid.onSelectionChanged?.());
    act(() => grid.onSelectionChanged?.());

    expect(railRenders.count).toBe(baseline);
  });

  it('DOES retire when a new result lands — the isolation is not a freeze', async () => {
    const { tabId, unmount } = await mountPaneWithPanels();
    teardowns.push(unmount);

    act(() =>
      queryExecutionStore
        .getState()
        .setResult(
          tabId,
          { queryId: 'query-2', success: true, resultSets: [{ columns: [], rows: [] }] },
          'SELECT 2'
        )
    );

    // The rail belonged to the previous result and its grid is gone, so it must not still be up.
    expect(screen.queryByTestId('rowdetail-panel')).toBeNull();
  });
});

describe('the result-history panel', () => {
  /** Mounts the pane and switches to the History tab, which is what mounts the panel. */
  async function mountWithHistory(): Promise<{ tabId: string; unmount: () => void }> {
    const mounted = await mountPaneWithPanels();
    const user = (await import('@testing-library/user-event')).default.setup();
    await user.click(screen.getByTestId('query-results-tab-history'));
    return mounted;
  }

  it('mounts when its tab is selected', async () => {
    const { unmount } = await mountWithHistory();
    teardowns.push(unmount);

    expect(screen.getByTestId('history-panel')).toBeTruthy();
    expect(historyRenders.count).toBeGreaterThan(0);
  });

  it('does not re-render for keystrokes or chat tokens', async () => {
    const { tabId, unmount } = await mountWithHistory();
    teardowns.push(unmount);
    const baseline = historyRenders.count;

    for (let index = 0; index < 20; index += 1) keystroke(tabId, `SELECT ${index}`);
    for (let index = 0; index < 100; index += 1) chatToken('tok ');

    expect(tabStore.getState().getTabContent(tabId)).toBe('SELECT 19');
    expect(historyRenders.count).toBe(baseline);
  });

  it('DOES re-render when a new result lands, so it can reload the list', async () => {
    const { tabId, unmount } = await mountWithHistory();
    teardowns.push(unmount);
    const baseline = historyRenders.count;

    act(() =>
      queryExecutionStore
        .getState()
        .setResult(
          tabId,
          { queryId: 'query-2', success: true, resultSets: [{ columns: [], rows: [] }] },
          'SELECT 2'
        )
    );

    expect(historyRenders.count).toBeGreaterThan(baseline);
  });
});
