/**
 * Create and rename, from the command to the fan-out.
 *
 * ── What this file is really about ──────────────────────────────────────────────────────────
 *
 * Two things, and the second is the one the brief asks for:
 *
 *  1. **capability gating** — three entry points, one of which (the native menu) has no node to read a
 *     capability from, so the gate has to be here rather than only in the sidebar;
 *  2. **the invalidation fan-out** — four owners go stale when a database appears or is renamed, and the
 *     Angular renderer refreshed one of them. Each is asserted separately, because a fan-out that
 *     happens to update the visible one is exactly the bug that shipped: the ERD cache kept serving a
 *     diagram of the dropped database and nothing in the UI said otherwise.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FULL_CAPABILITIES } from '@joinery/shared';
import type {
  ConnectionProfile,
  CreateDatabaseOptions,
  DatabaseEngine,
  DatabaseInfo,
  DatabaseOperationResult,
  RenameDatabaseOptions,
} from '@joinery/shared';

import { dispatchCommand } from '../../commands';
import { IpcQueryProvider } from '../../ipc';
import { TooltipProvider } from '../../ui';
import { capabilitiesStore } from '../../state/capabilities';
import { connectionStore } from '../../state/connection';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { explorerStore } from '../../state/explorer';
import { logStore } from '../../state/logs';
import { tabStore } from '../../state/tab';
import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import { cachedErd, clearErdCache, erdCacheKey, rememberErd } from '../erd/erd-cache';
import type { ErdBuildResult } from '../erd/erd-adapter';
import { DatabaseDialogs } from './database-dialogs';

const CONNECTION = 'conn-1';

function profile(engine: DatabaseEngine): ConnectionProfile {
  return {
    id: CONNECTION,
    name: 'Test server',
    engine,
    server: '127.0.0.1',
    port: 15432,
    authenticationType: 'sql',
    username: 'joinery',
    database: 'joinery_test',
    encrypt: false,
    trustServerCertificate: true,
    connectionTimeout: 15,
  } as ConnectionProfile;
}

const databases = (...names: string[]): DatabaseInfo[] =>
  names.map(name => ({ name, state: 'online' })) as unknown as DatabaseInfo[];

interface BridgeCalls {
  readonly creates: CreateDatabaseOptions[];
  readonly renames: RenameDatabaseOptions[];
  /** Every `explorer.refreshNode` — the channel that drops the MAIN process's metadata caches. */
  readonly refreshes: { connectionId: string; databaseName: string; path: string }[];
  /** How many times the database list was re-read from the server. */
  listCalls: number;
  /** What that re-read answers. Reassigned by a test to simulate the server's new state. */
  listAnswer: DatabaseInfo[];
}

let calls: BridgeCalls;
const teardowns: (() => void)[] = [];
let toasts: string[] = [];

function installBridge(
  result: Partial<DatabaseOperationResult> = {},
  /** Makes the main-cache drop reject, which the fan-out must survive. */
  refreshFails = false
): void {
  const answer: DatabaseOperationResult = {
    success: true,
    tsql: 'CREATE DATABASE [reports]',
    ...result,
  };
  calls = { creates: [], renames: [], refreshes: [], listCalls: 0, listAnswer: databases('sales') };

  teardowns.push(
    installJoineryMock({
      database: {
        list: (_connectionId: string) => {
          calls.listCalls += 1;
          return Promise.resolve(calls.listAnswer);
        },
        create: (_connectionId: string, options: CreateDatabaseOptions) => {
          calls.creates.push(options);
          return Promise.resolve(answer);
        },
        rename: (_connectionId: string, options: RenameDatabaseOptions) => {
          calls.renames.push(options);
          return Promise.resolve(answer);
        },
      },
      explorer: {
        getChildren: () => Promise.resolve([]),
        refreshNode: (connectionId: string, databaseName: string, path: string) => {
          calls.refreshes.push({ connectionId, databaseName, path });
          return refreshFails
            ? Promise.reject(new Error(`database "${databaseName}" does not exist`))
            : Promise.resolve([]);
        },
      },
      logs: { append: () => Promise.resolve() },
    })
  );
}

function seed(engine: DatabaseEngine = 'postgresql', manageable = true): void {
  connectionStore.setState({
    profiles: [profile(engine)],
    connectedProfileIds: new Set([CONNECTION]),
    databasesByConnection: new Map([[CONNECTION, databases('sales')]]),
  });
  capabilitiesStore.getState().setCapabilities(CONNECTION, {
    capabilities: { ...FULL_CAPABILITIES, supportsDatabaseManagement: manageable },
  });
  explorerStore.getState().addServerNode(CONNECTION, 'Test server');
}

function mountHost(): void {
  render(
    <IpcQueryProvider>
      <TooltipProvider>
        <DatabaseDialogs />
      </TooltipProvider>
    </IpcQueryProvider>
  );
}

/** A cached diagram of `databaseName`, so the fan-out has something to drop. */
function seedErdCache(databaseName: string, tableName?: string): string {
  const key = erdCacheKey({ connectionId: CONNECTION, databaseName, tableName });
  rememberErd(key, { nodes: [], edges: [], truncated: false } as unknown as ErdBuildResult);
  return key;
}

async function typeName(name: string): Promise<void> {
  const field = screen.getByTestId('database-name-input');
  await userEvent.clear(field);
  await userEvent.type(field, name);
}

beforeEach(() => {
  toasts = [];
  clearErdCache();
  teardowns.push(
    setDiagnosticsSink({ error: () => undefined, warn: () => undefined }),
    setNotifier({
      success: text => toasts.push(text),
      error: text => toasts.push(text),
      info: text => toasts.push(text),
      warning: text => toasts.push(text),
    })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  clearErdCache();
  explorerStore.getState().clear();
  connectionStore.setState({ profiles: [], connectedProfileIds: new Set() });
  capabilitiesStore.getState().clearCapabilities(CONNECTION);
  tabStore.setState({ tabs: [], activeTabId: '' });
  logStore.getState().clear();
});

describe('capability gating', () => {
  it('refuses all three entry points on an engine without database management', async () => {
    installBridge();
    seed('postgresql', false);
    mountHost();

    dispatchCommand('create-database');
    dispatchCommand('create-database-on-server', { connectionId: CONNECTION });
    dispatchCommand('rename-database', { connectionId: CONNECTION, databaseName: 'sales' });

    expect(screen.queryByTestId('create-database-dialog')).toBeNull();
    expect(screen.queryByTestId('rename-database-dialog')).toBeNull();
    // Three refusals, each naming the server rather than failing silently.
    expect(toasts.filter(text => text.includes('does not support'))).toHaveLength(3);
  });

  it('refuses the targetless command with nothing connected, and says what to do', () => {
    installBridge();
    connectionStore.setState({ profiles: [], connectedProfileIds: new Set() });
    mountHost();

    dispatchCommand('create-database');

    expect(screen.queryByTestId('create-database-dialog')).toBeNull();
    expect(toasts.join('\n')).toContain('Connect to a server');
  });
});

describe('the create dialog', () => {
  it('offers the recovery model on SQL Server and sends it', async () => {
    installBridge();
    seed('mssql');
    mountHost();
    dispatchCommand('create-database-on-server', { connectionId: CONNECTION });
    await screen.findByTestId('create-database-dialog');

    await typeName('reports');
    await userEvent.click(screen.getByTestId('create-database-recovery'));
    await userEvent.click(await screen.findByRole('option', { name: /Full/ }));
    await userEvent.click(screen.getByTestId('database-dialog-submit'));

    await waitFor(() => expect(calls.creates).toHaveLength(1));
    expect(calls.creates[0]).toEqual({ name: 'reports', recoveryModel: 'full' });
  });

  it('hides the recovery model off SQL Server, and omits the field entirely', async () => {
    // Not rendered-and-ignored: a control that persists and changes nothing is the J-44 defect.
    installBridge();
    seed('postgresql');
    mountHost();
    dispatchCommand('create-database-on-server', { connectionId: CONNECTION });
    await screen.findByTestId('create-database-dialog');

    expect(screen.queryByTestId('create-database-recovery')).toBeNull();

    await typeName('reports');
    await userEvent.click(screen.getByTestId('database-dialog-submit'));
    await waitFor(() => expect(calls.creates).toHaveLength(1));
    expect(calls.creates[0]).toEqual({ name: 'reports' });
  });

  it('says why a name is unusable instead of only greying the button', async () => {
    installBridge();
    seed();
    mountHost();
    dispatchCommand('create-database-on-server', { connectionId: CONNECTION });
    await screen.findByTestId('create-database-dialog');

    await typeName('my database');
    expect(screen.getByTestId('database-dialog-submit').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/letters, numbers and underscores/i)).toBeTruthy();

    // And the collision case names the existing database.
    await typeName('sales');
    expect(screen.getByText('This server already has a database called sales.')).toBeTruthy();
  });

  it('catches a collision against a list that arrives AFTER the dialog opens', async () => {
    // `taken` is a subscription, not a `getState()` read during render. The native menu and the palette
    // can open this dialog on a server whose database list is still in flight (nothing has touched its
    // picker yet), and a snapshot taken at that moment is empty for the dialog's whole life — so the
    // collision check silently stops existing exactly when the round trip is slowest.
    installBridge();
    seed();
    connectionStore.setState({ databasesByConnection: new Map() });
    mountHost();
    dispatchCommand('create-database-on-server', { connectionId: CONNECTION });
    await screen.findByTestId('create-database-dialog');

    await typeName('sales');
    // Nothing known yet, so nothing to collide with: the name is usable as far as the renderer knows.
    expect(screen.getByTestId('database-dialog-submit').hasAttribute('disabled')).toBe(false);

    // The list lands, the way `loadDatabases` delivers it.
    connectionStore.setState({
      databasesByConnection: new Map([[CONNECTION, databases('sales')]]),
    });

    await waitFor(() =>
      expect(screen.getByText('This server already has a database called sales.')).toBeTruthy()
    );
    expect(screen.getByTestId('database-dialog-submit').hasAttribute('disabled')).toBe(true);
    expect(calls.creates).toHaveLength(0);
  });

  it('shows the server’s own refusal in the dialog and stays open', async () => {
    installBridge({ success: false, error: 'permission denied for CREATE DATABASE' });
    seed();
    mountHost();
    dispatchCommand('create-database-on-server', { connectionId: CONNECTION });
    await screen.findByTestId('create-database-dialog');

    await typeName('reports');
    await userEvent.click(screen.getByTestId('database-dialog-submit'));

    const band = await screen.findByTestId('database-operation-error');
    expect(band.textContent).toBe('permission denied for CREATE DATABASE');
    expect(screen.getByTestId('create-database-dialog')).toBeTruthy();
  });

  it('logs the statement the main process ran', async () => {
    // CLAUDE.md's SQL-transparency rule: a CREATE DATABASE must not be the one write whose SQL nobody
    // can see.
    installBridge({ tsql: 'CREATE DATABASE "reports"' });
    seed();
    mountHost();
    dispatchCommand('create-database-on-server', { connectionId: CONNECTION });
    await screen.findByTestId('create-database-dialog');

    await typeName('reports');
    await userEvent.click(screen.getByTestId('database-dialog-submit'));

    await waitFor(() => expect(calls.creates).toHaveLength(1));
    const logged = logStore.getState().entries.find(item => item.tag === 'Database');
    expect(logged?.detail).toBe('CREATE DATABASE "reports"');
  });
});

describe('the create fan-out', () => {
  it('updates the explorer, the picker and the ERD cache, and closes', async () => {
    installBridge();
    seed();
    calls = { ...calls, listAnswer: databases('sales', 'reports') };
    // A diagram of a PREVIOUS database of this name. This is the one the Angular renderer kept serving.
    const staleWholeDatabase = seedErdCache('reports');
    const staleTable = seedErdCache('reports', 'orders');
    const otherDatabase = seedErdCache('sales');

    mountHost();
    dispatchCommand('create-database-on-server', { connectionId: CONNECTION });
    await screen.findByTestId('create-database-dialog');
    await typeName('reports');
    await userEvent.click(screen.getByTestId('database-dialog-submit'));

    await waitFor(() => expect(screen.queryByTestId('create-database-dialog')).toBeNull());

    // 1. the explorer tree has the node.
    const server = explorerStore.getState().rootNodes[0];
    expect(server?.children?.map(child => child.databaseName)).toContain('reports');
    // 2. the picker's list was re-read from the server.
    expect(calls.listCalls).toBeGreaterThan(0);
    // 3. every cached diagram of that NAME is gone, and only those.
    expect(cachedErd(staleWholeDatabase)).toBeUndefined();
    expect(cachedErd(staleTable)).toBeUndefined();
    expect(cachedErd(otherDatabase)).toBeDefined();
    // 4. MAIN's metadata caches were dropped, for this connection and naming the new database. Without
    //    this the two reloads above re-read main's 60s-TTL answer and the fan-out ends with the
    //    renderer correct and the process it asks stale.
    expect(calls.refreshes).toContainEqual({
      connectionId: CONNECTION,
      databaseName: 'reports',
      path: 'tables',
    });
    // 5. the user was told.
    expect(toasts.join('\n')).toContain('Created reports');
  });

  it('goes on refreshing when the main-cache drop rejects', async () => {
    // The re-warm can fail on its own — a database dropped out from under the name is the ordinary
    // case — and main has already invalidated by the time it can. The reloads must still happen.
    installBridge({}, true);
    seed();
    calls = { ...calls, listAnswer: databases('sales', 'reports') };

    mountHost();
    dispatchCommand('create-database-on-server', { connectionId: CONNECTION });
    await screen.findByTestId('create-database-dialog');
    await typeName('reports');
    await userEvent.click(screen.getByTestId('database-dialog-submit'));

    await waitFor(() => expect(screen.queryByTestId('create-database-dialog')).toBeNull());
    expect(calls.listCalls).toBeGreaterThan(0);
    expect(toasts.join('\n')).toContain('Created reports');
  });
});

describe('the rename fan-out', () => {
  it('moves the node, re-points open tabs and drops both names from the ERD cache', async () => {
    installBridge({ tsql: 'ALTER DATABASE [sales] MODIFY NAME = [revenue]' });
    seed();
    calls = { ...calls, listAnswer: databases('revenue') };
    explorerStore.getState().addDatabaseNodeLocal(CONNECTION, 'sales');
    const oldDiagram = seedErdCache('sales');
    const newNameDiagram = seedErdCache('revenue');
    const queryTab = tabStore.getState().openQueryTab(CONNECTION, 'sales', 'select 1');

    mountHost();
    dispatchCommand('rename-database', { connectionId: CONNECTION, databaseName: 'sales' });
    await screen.findByTestId('rename-database-dialog');

    // Pre-filled with the current name, and refusing it as an answer.
    expect((screen.getByTestId('database-name-input') as HTMLInputElement).value).toBe('sales');
    expect(screen.getByTestId('database-current-name').textContent).toBe('sales');
    expect(screen.getByTestId('database-dialog-submit').hasAttribute('disabled')).toBe(true);

    await typeName('revenue');
    await userEvent.click(screen.getByTestId('database-dialog-submit'));
    await waitFor(() => expect(calls.renames).toHaveLength(1));

    // `closeConnections` is what makes the rename possible on SQL Server at all.
    expect(calls.renames[0]).toEqual({
      currentName: 'sales',
      newName: 'revenue',
      closeConnections: true,
    });

    await waitFor(() => expect(screen.queryByTestId('rename-database-dialog')).toBeNull());

    // 1. the picker's copy of the list.
    const listed = connectionStore.getState().databasesByConnection.get(CONNECTION);
    expect(listed?.map(database => database.name)).toContain('revenue');
    // 2. the tab followed the rename rather than being closed or left stale.
    expect(tabStore.getState().tabs.find(tab => tab.id === queryTab)?.databaseName).toBe('revenue');
    expect(tabStore.getState().getTabContent(queryTab)).toBe('select 1');
    // 3. BOTH names are dropped from the diagram cache — the old one is gone, and the new one may be a
    //    previous tenant of that name.
    expect(cachedErd(oldDiagram)).toBeUndefined();
    expect(cachedErd(newNameDiagram)).toBeUndefined();
    // 4. main's metadata caches were dropped, naming the NEW database — the old one is gone, so asking
    //    main to re-warm its table list would be a guaranteed failure.
    expect(calls.refreshes).toContainEqual({
      connectionId: CONNECTION,
      databaseName: 'revenue',
      path: 'tables',
    });
    // 5. the statement is in the Output panel.
    expect(logStore.getState().entries.find(item => item.tag === 'Database')?.detail).toBe(
      'ALTER DATABASE [sales] MODIFY NAME = [revenue]'
    );
  });
});
