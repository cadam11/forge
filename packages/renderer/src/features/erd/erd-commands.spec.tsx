/**
 * The `open-erd` takeover.
 *
 * `open-erd` has been registered with no subscriber since Task 16, which is what made the palette show
 * it disabled and name the task that owed it (`features/command-palette/palette-model.ts:commandState`).
 * The first assertion here is that state ending: with this component mounted, the command has a handler,
 * so the palette reports it ready.
 *
 * The rest is target resolution, which is the only logic in the file — and the branch that matters is
 * the one with nothing connected, because dispatching a command that silently does nothing is the exact
 * failure mode PLAN.md 0.1 catalogued in the Angular menus.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { dispatchCommand, handlerCount } from '../../commands';
import { connectionStore } from '../../state/connection';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { tabStore } from '../../state/tab';
import { ErdCommands } from './erd-commands';

const notifications: string[] = [];
const teardowns: (() => void)[] = [];

beforeEach(() => {
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
  tabStore.setState({ tabs: [], activeTabId: '' });
  connectionStore.setState({ profiles: [], databasesByConnection: new Map() } as never);
});

/** A connected profile whose default database resolves through the profile's own `database`. */
function connect(): void {
  connectionStore.setState({
    profiles: [{ id: 'conn-1', name: 'Test PG', engine: 'postgresql', database: 'joinery_test' }],
    connectedProfileIds: new Set(['conn-1']),
    databasesByConnection: new Map([['conn-1', [{ name: 'joinery_test' }]]]),
  } as never);
}

describe('ErdCommands', () => {
  it('claims open-erd, which is what stops the palette calling it unowned', () => {
    expect(handlerCount('open-erd')).toBe(0);
    const view = render(<ErdCommands />);

    expect(handlerCount('open-erd')).toBe(1);

    view.unmount();
    expect(handlerCount('open-erd')).toBe(0);
  });

  it('renders nothing', () => {
    const { container } = render(<ErdCommands />);
    expect(container.innerHTML).toBe('');
  });

  it('opens a DATABASE-level diagram for the resolved connection', () => {
    connect();
    render(<ErdCommands />);

    dispatchCommand('open-erd');

    const opened = tabStore.getState().tabs.find(tab => tab.type === 'erd');
    expect(opened).toMatchObject({
      connectionId: 'conn-1',
      databaseName: 'joinery_test',
      title: 'ERD: joinery_test',
    });
    // No table and no focus depth: a palette entry has no node to take them from.
    expect(opened?.metadata?.['tableName']).toBeUndefined();
    expect(opened?.metadata?.['focusDepth']).toBeUndefined();
  });

  it('focuses the new tab', () => {
    connect();
    render(<ErdCommands />);

    dispatchCommand('open-erd');

    const opened = tabStore.getState().tabs.find(tab => tab.type === 'erd');
    expect(tabStore.getState().activeTabId).toBe(opened?.id);
  });

  it('reuses the existing tab rather than opening a second one', () => {
    connect();
    render(<ErdCommands />);

    dispatchCommand('open-erd');
    dispatchCommand('open-erd');

    expect(tabStore.getState().tabs.filter(tab => tab.type === 'erd')).toHaveLength(1);
  });

  it('says why nothing happened when no connection can be resolved', () => {
    render(<ErdCommands />);

    dispatchCommand('open-erd');

    expect(tabStore.getState().tabs.filter(tab => tab.type === 'erd')).toHaveLength(0);
    expect(notifications).toEqual(['warning:Connect to a database before opening a diagram.']);
  });

  it('says why nothing happened when the connection has no databases either', () => {
    connectionStore.setState({
      profiles: [{ id: 'conn-1', name: 'Test PG', engine: 'postgresql' }],
      connectedProfileIds: new Set(['conn-1']),
      databasesByConnection: new Map(),
    } as never);
    render(<ErdCommands />);

    dispatchCommand('open-erd');

    expect(tabStore.getState().tabs.filter(tab => tab.type === 'erd')).toHaveLength(0);
    expect(notifications).toHaveLength(1);
  });
});
