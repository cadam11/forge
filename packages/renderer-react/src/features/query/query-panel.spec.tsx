/**
 * The query panel's own decisions, with the editor seam replaced by a double.
 *
 * The panel is a Monaco host, and Monaco cannot run in jsdom — which is why `QueryCommands` was split
 * out in the first place, so `query-commands.spec.tsx` could mount the command table without it. That
 * split covers "the id reaches the handler". What it cannot cover is what the handlers DO with the
 * editor, and one of them was wrong in a way no existing test could see: Execute Selection inferred
 * "nothing is selected" from the selected text being equal to the whole buffer, so a deliberate ⌘A was
 * refused.
 *
 * So `../../editor` is mocked here — the whole seam, which is a single module boundary precisely
 * because ESLint bans importing Monaco anywhere else — and the panel is driven through the real command
 * bus, the real tab store and the real execution store. What is under test is the wiring between them.
 */

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDockviewPanelProps } from 'dockview-react';
import type { ExecuteScope, QueryRequest, QueryResult } from '@joinery/shared';

import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import { dispatchCommand } from '../../commands';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { connectionStore } from '../../state/connection';
import { queryExecutionStore } from '../../state/query-execution';
import { tabStore } from '../../state/tab';
import { TooltipProvider } from '../../ui';

// ── The editor double ──────────────────────────────────────────────────────────────────────

/**
 * The editor's state, as the panel can observe it through the handle.
 *
 * `selection` and `value` are separate on purpose: the bug this file exists for was a comparison
 * between them, so a double that derived one from the other could not express the failing case.
 */
const editorState = {
  value: '',
  selection: '',
  hasSelection: false,
  setValues: [] as string[],
};

const handle = {
  getValue: () => editorState.value,
  setValue: (next: string) => {
    editorState.setValues.push(next);
    editorState.value = next;
  },
  focus: () => undefined,
  layout: () => undefined,
  textToExecute: (scope: ExecuteScope) =>
    // Mirrors `statements.ts`: a non-empty selection always wins, whatever the scope says.
    editorState.selection !== '' ? editorState.selection : scope === 'all' ? editorState.value : '',
  hasSelection: () => editorState.hasSelection,
  insertSnippet: () => undefined,
  runAction: () => undefined,
};

vi.mock('../../editor', () => ({
  // The host div carries the testid the real one does, so a locator in this file reads like the e2e one.
  SqlEditor: ({
    handleRef,
    'data-testid': testId,
  }: {
    handleRef: { current: unknown };
    'data-testid'?: string;
  }) => {
    handleRef.current = handle;
    return <div data-testid={testId} />;
  },
  formatSql: (sql: string) => sql.toUpperCase(),
  monacoLanguageFor: () => 'pgsql',
  sqlIntellisense: { loadMetadata: async () => undefined },
}));

const { QueryPanel } = await import('./query-panel');

// ── The harness ────────────────────────────────────────────────────────────────────────────

const okResult: QueryResult = {
  queryId: 'query-1',
  success: true,
  resultSets: [{ columns: [{ name: 'id', type: 'int' }], rows: [{ id: 1 }] }],
  executionTime: 2,
};

const teardowns: (() => void)[] = [];
const notifications: string[] = [];

/** Dockview hands the panel a `params.tabId` and an `api`; these two members are all it touches. */
function panelProps(tabId: string): IDockviewPanelProps {
  return {
    params: { tabId },
    api: {
      id: tabId,
      onDidActiveChange: () => ({ dispose: () => undefined }),
    },
  } as unknown as IDockviewPanelProps;
}

/** A connected profile, a query tab on it, and the panel mounted for that tab. */
function mountPanel(sql: string): { tabId: string; unmount: () => void } {
  connectionStore.setState({
    profiles: [{ id: 'conn-1', name: 'Test PG', engine: 'postgresql' }],
  } as never);
  const tabId = tabStore.getState().openQueryTab('conn-1', 'shop', sql, false);
  editorState.value = sql;
  // The toolbar's buttons are tooltipped, and Radix requires the provider the shell mounts once.
  const { unmount } = render(
    <TooltipProvider>
      <QueryPanel {...panelProps(tabId)} />
    </TooltipProvider>
  );
  return { tabId, unmount };
}

beforeEach(() => {
  editorState.value = '';
  editorState.selection = '';
  editorState.hasSelection = false;
  editorState.setValues = [];
  notifications.length = 0;
  teardowns.push(
    setDiagnosticsSink({ error: () => undefined, warn: () => undefined }),
    setNotifier({
      success: message => notifications.push(`success:${message}`),
      error: message => notifications.push(`error:${message}`),
      info: message => notifications.push(`info:${message}`),
      warning: message => notifications.push(`warning:${message}`),
    })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  for (const tab of tabStore.getState().tabs) queryExecutionStore.getState().forgetTab(tab.id);
  tabStore.setState({ tabs: [], activeTabId: '' });
  connectionStore.setState({ profiles: [] } as never);
});

/** Runs a command through the real bus and lets the resulting promises settle. */
async function invoke(
  id: 'execute-query' | 'execute-selection' | 'open-query-file'
): Promise<void> {
  await act(async () => {
    dispatchCommand(id);
    await Promise.resolve();
  });
}

// ── Execute Selection ──────────────────────────────────────────────────────────────────────

describe('execute-selection', () => {
  it('runs a ⌘A select-all, because selecting everything IS a selection', async () => {
    const execute = vi.fn(async (_request: QueryRequest) => okResult);
    teardowns.push(installJoineryMock({ query: { execute } }));
    const { unmount } = mountPanel('SELECT 1;\nSELECT 2;');
    teardowns.push(unmount);

    // ⌘A: Monaco reports a selection, and its text is the whole document.
    editorState.hasSelection = true;
    editorState.selection = 'SELECT 1;\nSELECT 2;';

    await invoke('execute-selection');

    // The bug: `selection === whole` read this as "nothing selected" and answered "Select some SQL to
    // execute" — refusing the most obvious way to use the command.
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0].sql).toBe('SELECT 1;\nSELECT 2;');
    expect(notifications).not.toContain('warning:Select some SQL to execute');
  });

  it('runs a partial selection, not the buffer around it', async () => {
    const execute = vi.fn(async (_request: QueryRequest) => okResult);
    teardowns.push(installJoineryMock({ query: { execute } }));
    const { unmount } = mountPanel('SELECT 1;\nSELECT 2;');
    teardowns.push(unmount);

    editorState.hasSelection = true;
    editorState.selection = 'SELECT 2;';

    await invoke('execute-selection');

    expect(execute.mock.calls[0]?.[0].sql).toBe('SELECT 2;');
  });

  it('refuses when the caret is collapsed, rather than running the whole buffer', async () => {
    const execute = vi.fn(async (_request: QueryRequest) => okResult);
    teardowns.push(installJoineryMock({ query: { execute } }));
    const { unmount } = mountPanel('SELECT 1;');
    teardowns.push(unmount);

    // The Angular menu item ran the whole buffer here (`query.component.ts:1095` bound Execute
    // Selection to `executeQuery()`), which made it a duplicate of Execute.
    await invoke('execute-selection');

    expect(execute).not.toHaveBeenCalled();
    expect(notifications).toContain('warning:Select some SQL to execute');
  });

  it('refuses a selection of nothing but whitespace', async () => {
    const execute = vi.fn(async (_request: QueryRequest) => okResult);
    teardowns.push(installJoineryMock({ query: { execute } }));
    const { unmount } = mountPanel('SELECT 1;\n   \n');
    teardowns.push(unmount);

    // Monaco's `isEmpty()` is a zero-WIDTH check, so a blank line IS a selection — and there is still
    // nothing to run in it.
    editorState.hasSelection = true;
    editorState.selection = '   \n';

    await invoke('execute-selection');

    expect(execute).not.toHaveBeenCalled();
    expect(notifications).toContain('warning:Select some SQL to execute');
  });

  it('still sends the whole buffer for plain Execute', async () => {
    const execute = vi.fn(async (_request: QueryRequest) => okResult);
    teardowns.push(installJoineryMock({ query: { execute } }));
    const { unmount } = mountPanel('SELECT 1;');
    teardowns.push(unmount);

    await invoke('execute-query');

    // The two commands are different, which is the whole point of the deviation from Angular.
    expect(execute.mock.calls[0]?.[0].sql).toBe('SELECT 1;');
  });
});

// ── Opening a file ─────────────────────────────────────────────────────────────────────────

describe('open-query-file', () => {
  it('leaves the freshly opened tab CLEAN', async () => {
    teardowns.push(
      installJoineryMock({
        app: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/a.sql'] }) },
        workspace: { readFile: async () => 'SELECT 42;' },
      })
    );
    const { tabId, unmount } = mountPanel('SELECT 1;');
    teardowns.push(unmount);
    // An edited tab, which is the state the bug was visible from: the clean baseline is `SELECT 1;`.
    tabStore.getState().setTabContent(tabId, 'SELECT 1; -- edited');
    expect(tabStore.getState().tabs.find(tab => tab.id === tabId)?.isDirty).toBe(true);

    await invoke('open-query-file');
    // `openQueryFile` awaits two bridge calls before `adoptOpenedFile` runs.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const tab = tabStore.getState().tabs.find(candidate => candidate.id === tabId);
    expect(editorState.setValues).toEqual(['SELECT 42;']);
    // Without the baseline move, reading a file made the tab dirty the instant it opened — unsaved dot,
    // and Task 7's close guard warning about work the user had never touched.
    expect(tab?.isDirty).toBe(false);
    expect(tab?.metadata?.['filePath']).toBe('/tmp/a.sql');
    expect(tabStore.getState().getTabContent(tabId)).toBe('SELECT 42;');
  });
});
