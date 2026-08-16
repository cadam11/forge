/**
 * R2, asserted: **a keystroke in the editor cannot re-render the results grid.**
 *
 * PLAN.md's risk register (R2) says a React port "can accidentally re-render 10k rows per keystroke
 * through a badly-scoped store selector", and the Task 11 brief makes the proof part of the gate. This
 * is the unit half of it; the browser half is `.superpowers/sdd/PLAN/task-11-perf.mjs`, which counts DOM
 * mutations inside a real AG Grid with 100k rows loaded while typing into a real Monaco.
 *
 * ── Why the hazard is real, and why it is not obvious ──────────────────────────────────────────
 *
 * `QueryPanel` subscribes to the tab store (`state.tabs.find(…)`), and typing writes that store: the
 * first keystroke after a save flips `isDirty`, `updateTab` replaces the tabs array, and the panel
 * re-renders. That is correct and cannot be removed — the tab header needs the dot. What must not
 * happen is that re-render reaching the grid, which is what `memo` on `<QueryResults>` and on
 * `<ResultsGrid>` is for, and what a future prop built in the panel's render body would silently undo.
 *
 * So the assertion is on RENDER COUNTS of the AG Grid element, not on a store's shape. Both halves are
 * checked, because a test that only counted renders could pass against a panel whose editor was not
 * wired to the store at all: the keystroke is proven to reach the tab store, and the grid is proven not
 * to have re-rendered.
 */

import { useEffect, useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDockviewPanelProps } from 'dockview-react';
import type { ExecuteScope, QueryResult } from '@joinery/shared';

import { connectionStore } from '../../state/connection';
import { queryExecutionStore } from '../../state/query-execution';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { tabStore } from '../../state/tab';
import { TooltipProvider } from '../../ui';

// ── The editor double, with a way to fire a keystroke ──────────────────────────────────────

const editorState = { value: '', onChange: null as ((value: string) => void) | null };

const handle = {
  getValue: () => editorState.value,
  setValue: (next: string) => {
    editorState.value = next;
  },
  focus: () => undefined,
  layout: () => undefined,
  textToExecute: (_scope: ExecuteScope) => editorState.value,
  hasSelection: () => false,
  insertSnippet: () => undefined,
  runAction: () => undefined,
};

vi.mock('../../editor', () => ({
  SqlEditor: ({
    handleRef,
    onChange,
  }: {
    handleRef: { current: unknown };
    onChange?: (value: string) => void;
  }) => {
    handleRef.current = handle;
    // The real editor calls `onChange` from Monaco's model-change event; this records it so the test
    // can fire one, which is the closest a jsdom test gets to a keystroke.
    editorState.onChange = onChange ?? null;
    return <div data-testid="query-editor" />;
  },
  formatSql: (sql: string) => sql,
  monacoLanguageFor: () => 'pgsql',
  sqlIntellisense: { loadMetadata: async () => undefined },
}));

// ── The grid double, which is a render counter ─────────────────────────────────────────────

const gridRenders = { count: 0 };

vi.mock('ag-grid-react', () => ({
  AgGridReact: ({ onGridReady }: { onGridReady?: (event: { api: unknown }) => void }) => {
    // Incremented in the render body, which is the only place that is honest under React's batching.
    gridRenders.count += 1;
    const ready = useRef(false);
    useEffect(() => {
      if (ready.current) return;
      ready.current = true;
      onGridReady?.({ api: GRID_API });
    }, [onGridReady]);
    return <div data-testid="ag-grid-double" />;
  },
}));

/** The three calls `<ResultsGrid>`'s auto-size makes on `onGridReady`. Nothing else is touched here. */
const GRID_API = {
  autoSizeAllColumns: () => undefined,
  getColumns: () => [],
  setColumnWidths: () => undefined,
};

const { QueryPanel } = await import('./query-panel');

// ── The harness ────────────────────────────────────────────────────────────────────────────

const RESULT: QueryResult = {
  queryId: 'query-1',
  success: true,
  resultSets: [
    {
      columns: [
        { name: 'id', type: 'int' },
        { name: 'email', type: 'text' },
      ],
      rows: Array.from({ length: 500 }, (_, index) => ({ id: index, email: `u${index}@x.test` })),
    },
  ],
  executionTime: 4,
};

const teardowns: (() => void)[] = [];

function panelProps(tabId: string): IDockviewPanelProps {
  return {
    params: { tabId },
    api: { id: tabId, onDidActiveChange: () => ({ dispose: () => undefined }) },
  } as unknown as IDockviewPanelProps;
}

/** A query tab showing a result, with the panel mounted and the grid's first render already counted. */
function mountPanelWithResult(): { tabId: string; unmount: () => void } {
  connectionStore.setState({
    profiles: [{ id: 'conn-1', name: 'Test PG', engine: 'postgresql' }],
  } as never);
  const tabId = tabStore.getState().openQueryTab('conn-1', 'shop', 'SELECT 1', false);
  // Clean, so the NEXT keystroke is the one that flips `isDirty` — the dangerous one.
  tabStore.getState().markClean(tabId);
  editorState.value = 'SELECT 1';
  queryExecutionStore.getState().setResult(tabId, RESULT);

  const { unmount } = render(
    <TooltipProvider>
      <QueryPanel {...panelProps(tabId)} />
    </TooltipProvider>
  );
  return { tabId, unmount };
}

/** One keystroke, as Monaco delivers it: a model-change event carrying the whole new text. */
function keystroke(text: string): void {
  editorState.value = text;
  act(() => editorState.onChange?.(text));
}

beforeEach(() => {
  gridRenders.count = 0;
  editorState.value = '';
  editorState.onChange = null;
  teardowns.push(
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
  for (const tab of tabStore.getState().tabs) queryExecutionStore.getState().forgetTab(tab.id);
  tabStore.setState({ tabs: [], activeTabId: '' });
  connectionStore.setState({ profiles: [] } as never);
});

describe('a keystroke in the editor', () => {
  it('does not re-render the grid — not even the one that flips the dirty flag', () => {
    const { tabId, unmount } = mountPanelWithResult();
    teardowns.push(unmount);

    const baseline = gridRenders.count;
    expect(baseline).toBeGreaterThan(0); // the grid IS mounted; otherwise this test proves nothing

    keystroke('SELECT 2');

    // Half one: the keystroke really reached the store. `isDirty` flipping is exactly the write that
    // replaces the tabs array and re-renders the panel, so this is the hazard occurring, not avoided.
    expect(tabStore.getState().tabs.find(tab => tab.id === tabId)?.isDirty).toBe(true);
    expect(tabStore.getState().getTabContent(tabId)).toBe('SELECT 2');

    // Half two: the grid did not notice.
    expect(gridRenders.count).toBe(baseline);
  });

  it('does not re-render the grid over twenty more keystrokes', () => {
    const { tabId, unmount } = mountPanelWithResult();
    teardowns.push(unmount);
    const baseline = gridRenders.count;

    for (let index = 0; index < 20; index += 1) keystroke(`SELECT ${index}`);

    expect(tabStore.getState().getTabContent(tabId)).toBe('SELECT 19');
    expect(gridRenders.count).toBe(baseline);
  });

  it('still re-renders the grid when the RESULT changes — the memo is not a freeze', () => {
    const { tabId, unmount } = mountPanelWithResult();
    teardowns.push(unmount);
    const baseline = gridRenders.count;

    // A second query lands: a new result object, so the memo must let it through. A test that only
    // asserted "zero re-renders" would pass against a grid that never updates at all.
    act(() =>
      queryExecutionStore.getState().setResult(tabId, {
        ...RESULT,
        queryId: 'query-2',
        resultSets: [{ columns: [{ name: 'n', type: 'int' }], rows: [{ n: 1 }] }],
      })
    );

    expect(gridRenders.count).toBeGreaterThan(baseline);
  });
});
