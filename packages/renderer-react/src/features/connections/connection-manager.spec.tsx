/**
 * The manager, and the flow between the two dialogs.
 *
 * Two things are asserted rather than described, because both are load-bearing and neither is
 * visible from reading either component alone:
 *
 *  - **The manager launches the editor, and the editor hands control back.** The brief's own summary
 *    of what the manager is for ("its only job is launching the editor"), tested through
 *    `ConnectionDialogs` so it covers the state machine and not just a callback.
 *  - **Every row action carries its own profile id.** The Angular sidebar's recurring bug was an
 *    action resolving "the active connection", and a list of rows is the easiest place to reintroduce
 *    it — so the disconnect test acts on a NON-focused profile while another one is open and asserts
 *    exactly one of them died.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConnectionProfile } from '@joinery/shared';

import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import { dispatchCommand } from '../../commands';
import { IpcQueryProvider } from '../../ipc';
import { TooltipProvider } from '../../ui';
import { connectionStore } from '../../state/connection';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { explorerStore } from '../../state/explorer';
import { ConnectionDialogs } from './connection-dialogs';

const teardowns: (() => void)[] = [];
let deleted: string[] = [];
let disconnected: string[] = [];
let notifications: string[] = [];

function profile(
  id: string,
  name: string,
  overrides: Partial<ConnectionProfile> = {}
): ConnectionProfile {
  return {
    id,
    name,
    engine: 'postgresql',
    server: `${id}.example.com`,
    port: 5432,
    authenticationType: 'sql',
    username: 'reader',
    encrypt: false,
    trustServerCertificate: true,
    connectionTimeout: 15,
    ...overrides,
  };
}

const PG_ONE = profile('pg-one', 'PG One', { color: '#1e88e5' });
const PG_TWO = profile('pg-two', 'PG Two');

beforeEach(() => {
  deleted = [];
  disconnected = [];
  notifications = [];

  teardowns.push(
    installJoineryMock({
      connection: {
        list: () => Promise.resolve([PG_ONE, PG_TWO]),
        delete: (id: string) => {
          deleted.push(id);
          return Promise.resolve();
        },
        disconnect: (id: string) => {
          disconnected.push(id);
          return Promise.resolve();
        },
        connect: (id: string) =>
          Promise.resolve({ id, profile: PG_ONE, status: 'connected' as const }),
        ping: () => Promise.resolve(true),
        // Only the editor's Save/Connect path reaches this; it echoes the profile back the way the
        // main process does.
        save: (incoming: ConnectionProfile) =>
          Promise.resolve({ ...incoming, id: incoming.id === '' ? 'pg-new' : incoming.id }),
      },
      database: { list: () => Promise.resolve([]) },
      app: { setState: () => Promise.resolve() },
    })
  );
  teardowns.push(
    setNotifier({
      success: message => notifications.push(`success: ${message}`),
      error: message => notifications.push(`error: ${message}`),
      info: message => notifications.push(`info: ${message}`),
      warning: message => notifications.push(`warning: ${message}`),
    })
  );
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));

  connectionStore.setState({ profiles: [PG_ONE, PG_TWO] });
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  connectionStore.getState().destroy();
  connectionStore.setState({
    profiles: [],
    connectedProfileIds: new Set(),
    databasesByConnection: new Map(),
    healthByConnection: new Map(),
  });
  explorerStore.getState().clear();
  vi.clearAllMocks();
});

/** Mounts the real command host, so every test drives the dialogs the way the sidebar does. */
function mountHost(): void {
  const { unmount } = render(
    <IpcQueryProvider>
      <TooltipProvider>
        <ConnectionDialogs />
      </TooltipProvider>
    </IpcQueryProvider>
  );
  teardowns.push(unmount);
}

async function openManager(): Promise<void> {
  mountHost();
  dispatchCommand('open-connection-manager');
  await screen.findByTestId('connection-manager');
}

describe('what the manager shows', () => {
  it('shows nothing until a command asks for it', () => {
    mountHost();
    expect(screen.queryByTestId('connection-manager')).toBeNull();
    expect(screen.queryByTestId('connection-editor')).toBeNull();
  });

  it('lists every saved profile with its engine and address', async () => {
    await openManager();

    const rows = screen.getAllByTestId('connection-manager-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('PG One');
    expect(rows[0]?.textContent).toContain('PostgreSQL');
    expect(rows[0]?.textContent).toContain('pg-one.example.com:5432');
  });

  it('shows a colour tag only for a profile that has one', async () => {
    await openManager();

    const rows = screen.getAllByTestId('connection-manager-row');
    expect(rows[0]?.querySelector('[data-testid="connection-manager-row-color"]')).not.toBeNull();
    expect(rows[1]?.querySelector('[data-testid="connection-manager-row-color"]')).toBeNull();
  });

  it('offers an empty state with its own CTA when nothing is saved', async () => {
    connectionStore.setState({ profiles: [] });
    await openManager();

    expect(screen.getByTestId('connection-manager-empty')).toBeTruthy();
    expect(screen.queryByTestId('connection-manager-list')).toBeNull();
  });

  it('marks a live connection and swaps its action to Disconnect', async () => {
    connectionStore.setState({ connectedProfileIds: new Set(['pg-one']) });
    await openManager();

    const [first, second] = screen.getAllByTestId('connection-manager-row');
    expect(first?.getAttribute('data-connected')).toBe('true');
    expect(second?.getAttribute('data-connected')).toBe('false');
    expect(screen.getByLabelText('Disconnect PG One')).toBeTruthy();
    expect(screen.getByLabelText('Connect PG Two')).toBeTruthy();
  });
});

describe('launching the editor', () => {
  it('replaces itself with the editor on New connection, and comes back on Cancel', async () => {
    const user = userEvent.setup();
    await openManager();

    await user.click(screen.getByTestId('connection-manager-new'));

    // Replaces, rather than stacking: two open Radix modals would mean two scrims and two focus
    // traps, and a manager the user has to dismiss twice.
    expect(screen.getByTestId('connection-editor')).toBeTruthy();
    expect(screen.queryByTestId('connection-manager')).toBeNull();
    // A blank form, not one of the profiles.
    expect(screen.getByLabelText('Connection name')).toHaveProperty('value', '');

    await user.click(screen.getByTestId('connection-cancel'));
    expect(await screen.findByTestId('connection-manager')).toBeTruthy();
    expect(screen.queryByTestId('connection-editor')).toBeNull();
  });

  it('opens the editor on the row’s own profile', async () => {
    const user = userEvent.setup();
    await openManager();

    await user.click(screen.getByLabelText('Edit PG Two'));

    expect(screen.getByLabelText('Connection name')).toHaveProperty('value', 'PG Two');
    expect(screen.getByLabelText('Server')).toHaveProperty('value', 'pg-two.example.com');
  });

  it('does NOT return to the manager after a successful Connect', async () => {
    // The server node the connect just opened is behind the dialog; dropping the user back into the
    // manager would cover the thing they were trying to reach.
    const user = userEvent.setup();
    await openManager();

    await user.click(screen.getByLabelText('Edit PG Two'));
    await user.click(screen.getByTestId('connection-connect'));

    await waitFor(() => expect(screen.queryByTestId('connection-editor')).toBeNull());
    expect(screen.queryByTestId('connection-manager')).toBeNull();
  });
});

describe('the row actions', () => {
  it('connects exactly the row’s profile', async () => {
    const user = userEvent.setup();
    await openManager();

    await user.click(screen.getByLabelText('Connect PG Two'));

    await waitFor(() =>
      expect(connectionStore.getState().connectedProfileIds.has('pg-two')).toBe(true)
    );
    expect(connectionStore.getState().connectedProfileIds.has('pg-one')).toBe(false);
    // And the explorer got the server node, so the manager's Connect is the same operation the
    // sidebar's is.
    expect(explorerStore.getState().rootNodes.map(node => node.connectionId)).toEqual(['pg-two']);
  });

  it('disconnects exactly the row’s profile, leaving the others open', async () => {
    connectionStore.setState({ connectedProfileIds: new Set(['pg-one', 'pg-two']) });
    const user = userEvent.setup();
    await openManager();

    await user.click(screen.getByLabelText('Disconnect PG One'));

    await waitFor(() => expect(disconnected).toEqual(['pg-one']));
    expect(connectionStore.getState().connectedProfileIds.has('pg-two')).toBe(true);
  });

  it('takes two clicks to delete, and names the profile in the confirm step', async () => {
    const user = userEvent.setup();
    await openManager();

    await user.click(screen.getByLabelText('Delete PG One'));
    // Nothing has been written yet — the first click only arms the confirm.
    expect(deleted).toEqual([]);
    expect(screen.getByLabelText('Confirm deleting PG One')).toBeTruthy();
    // And only this row is armed.
    expect(screen.getByLabelText('Delete PG Two')).toBeTruthy();

    await user.click(screen.getByLabelText('Confirm deleting PG One'));
    await waitFor(() => expect(deleted).toEqual(['pg-one']));
  });

  it('disarms the confirm without deleting', async () => {
    const user = userEvent.setup();
    await openManager();

    await user.click(screen.getByLabelText('Delete PG One'));
    await user.click(screen.getByLabelText('Keep PG One'));

    expect(screen.getByLabelText('Delete PG One')).toBeTruthy();
    expect(deleted).toEqual([]);
  });
});

describe('the command host', () => {
  it('opens a blank editor for open-connection-dialog', async () => {
    mountHost();
    dispatchCommand('open-connection-dialog');

    expect(await screen.findByTestId('connection-editor')).toBeTruthy();
    expect(screen.getByLabelText('Connection name')).toHaveProperty('value', '');
    // Dismissing goes nowhere, because this route did not come from the manager.
    expect(screen.queryByTestId('connection-manager')).toBeNull();
  });

  it('opens the editor on the payload’s profile for edit-connection', async () => {
    mountHost();
    dispatchCommand('edit-connection', { connectionId: 'pg-two' });

    await screen.findByTestId('connection-editor');
    expect(screen.getByLabelText('Connection name')).toHaveProperty('value', 'PG Two');
  });

  it('reports a stale edit-connection payload instead of opening a blank form', async () => {
    // A context menu can outlive the profile it named. Falling through to the create form would
    // silently turn "edit this" into "make a new one".
    mountHost();
    dispatchCommand('edit-connection', { connectionId: 'deleted-long-ago' });

    await waitFor(() =>
      expect(notifications).toContain('error: That connection no longer exists.')
    );
    expect(screen.queryByTestId('connection-editor')).toBeNull();
  });

  it('closes the editor with no manager behind it when it was opened directly', async () => {
    const user = userEvent.setup();
    mountHost();
    dispatchCommand('open-connection-dialog');
    await screen.findByTestId('connection-editor');

    await user.click(screen.getByTestId('connection-cancel'));

    await waitFor(() => expect(screen.queryByTestId('connection-editor')).toBeNull());
    expect(screen.queryByTestId('connection-manager')).toBeNull();
  });
});
