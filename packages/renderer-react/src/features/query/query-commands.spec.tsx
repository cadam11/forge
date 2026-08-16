/**
 * The twelve command takeovers, and the active-tab guard that keeps N open query tabs from all reacting to
 * one dispatch.
 */

import { StrictMode } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchCommand, handlerCount } from '../../commands';
import { COMMAND_CONSUMERS, COMMAND_IDS, type CommandId } from '../../commands/registry';
import { QueryCommands, type QueryCommandHandlers } from './query-commands';

/** Every command whose registered consumer names Task 10. This is the list the component must cover. */
const TASK_10_COMMANDS = COMMAND_IDS.filter(id => /^Task 10\b/.test(COMMAND_CONSUMERS[id]));

function handlers(isActive = true): {
  props: QueryCommandHandlers;
  calls: string[];
} {
  const calls: string[] = [];
  const record = (name: string) => () => calls.push(name);
  return {
    calls,
    props: {
      isActive: () => isActive,
      onExecute: record('execute'),
      onExecuteSelection: record('execute-selection'),
      onCancel: record('cancel'),
      onFormat: record('format'),
      onFind: record('find'),
      onReplace: record('replace'),
      onToggleComment: record('toggle-comment'),
      onSave: record('save'),
      onSaveAs: record('save-as'),
      onOpenFile: record('open-file'),
      onToggleResults: record('toggle-results'),
      onInsertSnippet: sql => calls.push(`insert:${sql}`),
    },
  };
}

const teardowns: (() => void)[] = [];

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  // Nothing may leak: the handler table is module state.
  for (const id of COMMAND_IDS) expect(handlerCount(id)).toBe(0);
});

describe('the ids this component claims', () => {
  it('covers every command whose consumer names Task 10', () => {
    const { props } = handlers();
    const { unmount } = render(<QueryCommands {...props} />);
    teardowns.push(unmount);

    const unhandled = TASK_10_COMMANDS.filter(id => handlerCount(id) === 0);
    expect(unhandled).toEqual([]);
    // And the count, so deleting a `useCommand` line AND its registry claim in one edit still fails.
    expect(TASK_10_COMMANDS).toHaveLength(12);
  });

  it('subscribes nothing else', () => {
    const { props } = handlers();
    const { unmount } = render(<QueryCommands {...props} />);
    teardowns.push(unmount);

    const extra = COMMAND_IDS.filter(id => handlerCount(id) > 0 && !TASK_10_COMMANDS.includes(id));
    expect(extra).toEqual([]);
  });
});

describe('dispatching', () => {
  const CASES: readonly [CommandId, string][] = [
    ['execute-query', 'execute'],
    ['execute-selection', 'execute-selection'],
    ['cancel-query', 'cancel'],
    ['format-sql', 'format'],
    ['editor-find', 'find'],
    ['editor-replace', 'replace'],
    ['toggle-comment', 'toggle-comment'],
    ['save-query', 'save'],
    ['save-query-as', 'save-as'],
    ['open-query-file', 'open-file'],
    ['toggle-results-panel', 'toggle-results'],
  ];

  it.each(CASES)('%s reaches its handler', (id, expected) => {
    const { props, calls } = handlers();
    const { unmount } = render(<QueryCommands {...props} />);
    teardowns.push(unmount);

    act(() => void dispatchCommand(id as never));

    expect(calls).toEqual([expected]);
  });

  it('insert-snippet passes the SQL through', () => {
    const { props, calls } = handlers();
    const { unmount } = render(<QueryCommands {...props} />);
    teardowns.push(unmount);

    act(() => void dispatchCommand('insert-snippet', { sql: 'select 1' }));

    expect(calls).toEqual(['insert:select 1']);
  });
});

describe('the active-tab guard', () => {
  it('swallows every command for an inactive tab', () => {
    const { props, calls } = handlers(false);
    const { unmount } = render(<QueryCommands {...props} />);
    teardowns.push(unmount);

    for (const id of TASK_10_COMMANDS) {
      act(
        () =>
          void dispatchCommand(id === 'insert-snippet' ? id : (id as never), { sql: 'x' } as never)
      );
    }

    expect(calls).toEqual([]);
  });

  it('delivers to exactly one of two mounted tabs — the active one', () => {
    // The shape that matters: Dockview keeps an inactive panel's React tree mounted, so both tabs are
    // subscribed at once and only the guard separates them.
    const first = handlers(false);
    const second = handlers(true);
    const { unmount } = render(
      <>
        <QueryCommands {...first.props} />
        <QueryCommands {...second.props} />
      </>
    );
    teardowns.push(unmount);

    expect(handlerCount('save-query')).toBe(2);
    act(() => void dispatchCommand('save-query'));

    expect(first.calls).toEqual([]);
    expect(second.calls).toEqual(['save']);
  });

  it('reads the guard at dispatch time, not at render time', () => {
    // A boolean prop would have frozen the answer into whatever the last render saw. The panel's guard
    // reads `tabStore` when the command arrives, which is what makes activation-then-dispatch work with
    // no re-render in between.
    let active = false;
    const calls: string[] = [];
    const { props } = handlers();
    const { unmount } = render(
      <QueryCommands {...props} isActive={() => active} onExecute={() => calls.push('execute')} />
    );
    teardowns.push(unmount);

    act(() => void dispatchCommand('execute-query'));
    expect(calls).toEqual([]);

    active = true;
    act(() => void dispatchCommand('execute-query'));
    expect(calls).toEqual(['execute']);
  });

  it('uses the latest handler without resubscribing', () => {
    const calls: string[] = [];
    const { props } = handlers();
    const { rerender, unmount } = render(
      <QueryCommands {...props} onFormat={() => calls.push('first')} />
    );
    teardowns.push(unmount);
    rerender(<QueryCommands {...props} onFormat={() => calls.push('second')} />);

    expect(handlerCount('format-sql')).toBe(1);
    act(() => void dispatchCommand('format-sql'));
    expect(calls).toEqual(['second']);
  });
});

describe('lifecycle', () => {
  it('leaves exactly one subscription per id after a StrictMode double mount', () => {
    const { props, calls } = handlers();
    const { unmount } = render(
      <StrictMode>
        <QueryCommands {...props} />
      </StrictMode>
    );
    teardowns.push(unmount);

    expect(handlerCount('execute-query')).toBe(1);
    act(() => void dispatchCommand('execute-query'));
    expect(calls).toEqual(['execute']);
  });

  it('unsubscribes all twelve on unmount, so a closed tab is silent', () => {
    const { props } = handlers();
    const { unmount } = render(<QueryCommands {...props} />);
    unmount();
    for (const id of TASK_10_COMMANDS) expect(handlerCount(id)).toBe(0);
  });
});

describe('the component itself', () => {
  it('renders nothing, which is what lets the ownership test mount it', () => {
    // No Monaco, no dock, no DOM — `commands/bus.spec.tsx` renders this component as part of the app's
    // real command wiring, and it could not render the panel that owns it.
    const { props } = handlers();
    const { container, unmount } = render(<QueryCommands {...props} />);
    teardowns.push(unmount);
    expect(container.innerHTML).toBe('');
  });
});
