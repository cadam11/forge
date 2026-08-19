/**
 * The connection chip, mounted for real.
 *
 * `query-context.spec.ts` proves the string matches the toolbar line it replaced; this proves the
 * chip renders THAT string under the `query-context` testid the e2e reads, and that its two menus
 * write the tab rather than a global.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConnectionProfile, DatabaseInfo } from '@joinery/shared';

import { connectionStore } from '../../state/connection';
import { setDiagnosticsSink } from '../../state/diagnostics';
import { tabStore } from '../../state/tab';
import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import { TooltipProvider } from '../../ui';
import { ConnectionContextChip } from './connection-context-chip';

const PG: ConnectionProfile = {
  id: 'conn-pg',
  name: 'Test PG',
  engine: 'postgresql',
  color: '#c0ffee',
} as ConnectionProfile;

const MSSQL: ConnectionProfile = {
  id: 'conn-ms',
  name: 'Prod MSSQL',
  engine: 'mssql',
  database: 'sales',
} as ConnectionProfile;

const PG_DATABASES: DatabaseInfo[] = [
  { name: 'joinery_test' } as DatabaseInfo,
  { name: 'postgres' } as DatabaseInfo,
];
const MSSQL_DATABASES: DatabaseInfo[] = [
  { name: 'master' } as DatabaseInfo,
  { name: 'sales' } as DatabaseInfo,
];

const teardowns: (() => void)[] = [];

function setConnections(options: { readonly connected: readonly string[] }): void {
  connectionStore.setState({
    profiles: [PG, MSSQL],
    connectedProfileIds: new Set(options.connected),
    databasesByConnection: new Map([
      [PG.id, PG_DATABASES],
      [MSSQL.id, MSSQL_DATABASES],
    ]),
    selectedDatabaseByConnection: new Map(),
  } as never);
}

function openQueryTab(connectionId?: string, databaseName?: string): string {
  if (connectionId === undefined) {
    return tabStore.getState().openTab({ type: 'query', title: 'Query 1', icon: 'code' });
  }
  return tabStore.getState().openQueryTab(connectionId, databaseName ?? 'joinery_test', 'SELECT 1');
}

function mountChip(tabId: string) {
  return render(
    <TooltipProvider>
      <ConnectionContextChip tabId={tabId} />
    </TooltipProvider>
  );
}

function label(): string {
  return screen.getByTestId('query-context').textContent ?? '';
}

function tabOf(tabId: string) {
  return tabStore.getState().tabs.find(tab => tab.id === tabId);
}

beforeEach(() => {
  teardowns.push(
    setDiagnosticsSink({ error: () => undefined, warn: () => undefined }),
    // The chip reads the cached list; the only call it can make is one refresh when that list is
    // empty (`ensureDatabases`), which is `database.list`.
    installJoineryMock({ database: { list: vi.fn(() => Promise.resolve([])) } })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  tabStore.setState({ tabs: [], activeTabId: '' });
  connectionStore.setState({
    profiles: [],
    connectedProfileIds: new Set(),
    databasesByConnection: new Map(),
    selectedDatabaseByConnection: new Map(),
  } as never);
  vi.clearAllMocks();
});

describe('the label', () => {
  it('is the tab’s own connection and database, in the toolbar line’s exact form', () => {
    setConnections({ connected: [PG.id] });
    mountChip(openQueryTab(PG.id, 'joinery_test'));

    expect(label()).toBe('Test PG · joinery_test');
  });

  it('says what is missing when the tab points nowhere', () => {
    setConnections({ connected: [] });
    mountChip(openQueryTab());

    expect(label()).toBe('no connection · no database');
  });

  it('says “no connection” for a profile that has been deleted, not its id', () => {
    setConnections({ connected: [PG.id] });
    const tabId = openQueryTab(PG.id, 'joinery_test');
    connectionStore.setState({ profiles: [MSSQL] } as never);

    mountChip(tabId);
    expect(label()).toBe('no connection · joinery_test');
  });

  it('describes ITS tab, not the active one', () => {
    setConnections({ connected: [PG.id, MSSQL.id] });
    const first = openQueryTab(PG.id, 'joinery_test');
    // A second tab on the other server, activated. The chip under test still names its own.
    openQueryTab(MSSQL.id, 'sales');

    mountChip(first);
    expect(label()).toBe('Test PG · joinery_test');
  });
});

describe('the database menu', () => {
  it('lists the connection’s databases and marks the current one', async () => {
    const user = userEvent.setup();
    setConnections({ connected: [PG.id] });
    mountChip(openQueryTab(PG.id, 'joinery_test'));

    await user.click(screen.getByTestId('chip-connection-context'));

    expect(screen.getAllByTestId('chip-database-item').map(item => item.textContent)).toEqual([
      'joinery_test',
      'postgres',
    ]);
  });

  it('re-points the TAB, and the per-connection selection with it', async () => {
    const user = userEvent.setup();
    setConnections({ connected: [PG.id] });
    const tabId = openQueryTab(PG.id, 'joinery_test');
    mountChip(tabId);

    await user.click(screen.getByTestId('chip-connection-context'));
    await user.click(
      screen.getAllByTestId('chip-database-item').find(item => item.textContent === 'postgres') ??
        screen.getByTestId('chip-database-empty')
    );

    expect(tabOf(tabId)?.databaseName).toBe('postgres');
    expect(connectionStore.getState().selectedDatabaseByConnection.get(PG.id)).toBe('postgres');
    expect(label()).toBe('Test PG · postgres');
  });

  it('says there are none rather than showing an empty menu', async () => {
    const user = userEvent.setup();
    setConnections({ connected: [PG.id] });
    connectionStore.setState({ databasesByConnection: new Map() } as never);
    mountChip(openQueryTab(PG.id, 'joinery_test'));

    await user.click(screen.getByTestId('chip-connection-context'));
    expect(screen.getByTestId('chip-database-empty')).toBeTruthy();
  });
});

describe('the connection menu', () => {
  it('is absent with one connection open — there is nothing to choose between', async () => {
    const user = userEvent.setup();
    setConnections({ connected: [PG.id] });
    mountChip(openQueryTab(PG.id, 'joinery_test'));

    await user.click(screen.getByTestId('chip-connection-context'));
    expect(screen.queryByTestId('chip-connection-item')).toBeNull();
  });

  it('offers only CONNECTED profiles', async () => {
    const user = userEvent.setup();
    setConnections({ connected: [PG.id, MSSQL.id] });
    mountChip(openQueryTab(PG.id, 'joinery_test'));

    await user.click(screen.getByTestId('chip-connection-context'));
    expect(screen.getAllByTestId('chip-connection-item').map(item => item.textContent)).toEqual([
      'Test PG',
      'Prod MSSQL',
    ]);
  });

  it('switches the tab and re-resolves the database for the new server', async () => {
    const user = userEvent.setup();
    setConnections({ connected: [PG.id, MSSQL.id] });
    const tabId = openQueryTab(PG.id, 'joinery_test');
    mountChip(tabId);

    await user.click(screen.getByTestId('chip-connection-context'));
    await user.click(
      screen
        .getAllByTestId('chip-connection-item')
        .find(item => item.textContent === 'Prod MSSQL') ??
        screen.getByTestId('chip-database-empty')
    );

    // `sales` is the MSSQL profile's configured default AND is in its database list, which is stage 2
    // of `selectDefaultDatabaseFor` — NOT `joinery_test` carried over from the PostgreSQL server.
    expect(tabOf(tabId)?.connectionId).toBe(MSSQL.id);
    expect(tabOf(tabId)?.databaseName).toBe('sales');
    expect(label()).toBe('Prod MSSQL · sales');
  });
});
