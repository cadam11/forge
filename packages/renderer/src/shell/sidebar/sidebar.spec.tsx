/**
 * The sidebar, mounted for real against the singleton stores and a partial bridge.
 *
 * What is worth asserting here, and why each one is a real risk rather than a restatement of the
 * code:
 *
 *  - **Lazy loading.** The whole reason the explorer is not a `<Tree>` over a fetched forest is
 *    that a SQL Server instance has 400 databases. So the first tree test asserts that seeding a
 *    server node fetches *nothing*, and that expanding it fetches exactly once.
 *  - **Capability gating on both paths.** A menu item that checks its capability inside its
 *    handler is still keyboard-selectable. These tests assert the `disabled` state on the item,
 *    which is what makes Radix refuse it from the keyboard too.
 *  - **Target routing.** The Angular sidebar's recurring bug was an action resolving "the active
 *    connection" instead of the node's own. Backup is asserted to carry the right-clicked node's
 *    connection id while a *different* connection is the focused one.
 *  - **The brand mark's middle bar.** FOLLOW-UPS 12 / J-32: the Angular mark hardcoded ivory
 *    there and vanished in light mode. A hardcoded hex in this SVG is the regression.
 *  - **Selector discipline.** A log entry must not re-render the sidebar.
 *
 * jsdom has no layout engine, so the virtualizer is fed a viewport the same way `ui/tree.spec.tsx`
 * does — see LAYOUT_FAKES.
 */

import { Profiler } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConnectionProfile, DatabaseInfo, ObjectMetadata } from '@joinery/shared';

import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import { subscribeCommand, type CommandId } from '../../commands';
import { IpcQueryProvider } from '../../ipc';
import { TooltipProvider } from '../../ui';
import { capabilitiesStore } from '../../state/capabilities';
import { connectionStore } from '../../state/connection';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { explorerStore } from '../../state/explorer';
import { logStore } from '../../state/logs';
import { tabStore } from '../../state/tab';
import { Sidebar } from './sidebar';

// ── the virtualizer's viewport ───────────────────────────────────────────────────────────────

const TREE_VIEWPORT = { width: 240, height: 768 };

/** Scoped to `role="tree"`, restored afterwards. See `ui/tree.spec.tsx` for the full reasoning. */
const LAYOUT_FAKES = [
  { owner: HTMLElement.prototype, name: 'offsetWidth', value: TREE_VIEWPORT.width },
  { owner: HTMLElement.prototype, name: 'offsetHeight', value: TREE_VIEWPORT.height },
  { owner: Element.prototype, name: 'clientHeight', value: TREE_VIEWPORT.height },
  { owner: Element.prototype, name: 'scrollHeight', value: TREE_VIEWPORT.height * 8 },
] as const;

const ORIGINAL_LAYOUT = LAYOUT_FAKES.map(fake =>
  Object.getOwnPropertyDescriptor(fake.owner, fake.name)
);

beforeAll(() => {
  for (const fake of LAYOUT_FAKES) {
    Object.defineProperty(fake.owner, fake.name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute('role') === 'tree' ? fake.value : 0;
      },
    });
  }
});

afterAll(() => {
  for (const [index, fake] of LAYOUT_FAKES.entries()) {
    const descriptor = ORIGINAL_LAYOUT[index];
    if (descriptor === undefined) throw new Error(`${fake.name} had no descriptor to restore`);
    Object.defineProperty(fake.owner, fake.name, descriptor);
  }
});

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────

const PG_ONE = 'pg-one';
const PG_TWO = 'pg-two';

function profile(id: string, name: string): ConnectionProfile {
  return {
    id,
    name,
    engine: 'postgresql',
    server: '127.0.0.1',
    port: 15432,
    authenticationType: 'sql',
    username: 'joinery',
    database: 'joinery_test',
    encrypt: false,
    trustServerCertificate: true,
    connectionTimeout: 15,
  };
}

const DATABASES: DatabaseInfo[] = [
  { name: 'joinery_test', state: 'online' },
  { name: 'postgres', state: 'online' },
] as unknown as DatabaseInfo[];

const SCHEMAS: ObjectMetadata[] = [
  { name: 'public', type: 'schema', schema: '' },
  { name: 'app_meta', type: 'schema', schema: '' },
] as unknown as ObjectMetadata[];

/** What the "Tables" folder returns, for the one test that needs an object node's menu. */
const TABLES: ObjectMetadata[] = [
  { name: 'customers', type: 'table', schema: 'public' },
] as unknown as ObjectMetadata[];

interface BridgeSpies {
  readonly listDatabases: ReturnType<typeof vi.fn>;
  readonly getChildren: ReturnType<typeof vi.fn>;
  /** `explorer.refreshNode` — the channel that drops the MAIN process's metadata caches. */
  readonly refreshNode: ReturnType<typeof vi.fn>;
  /** Bridge calls in the order they were made, so "before the reload" is provable. */
  readonly order: string[];
}

const teardowns: (() => void)[] = [];
let bridge: BridgeSpies;

function installBridge(): BridgeSpies {
  const order: string[] = [];
  const listDatabases = vi.fn(() => {
    order.push('database.list');
    return Promise.resolve(DATABASES);
  });
  const getChildren = vi.fn(() => Promise.resolve(SCHEMAS));
  const refreshNode = vi.fn(() => {
    order.push('explorer.refreshNode');
    return Promise.resolve([]);
  });
  teardowns.push(
    installJoineryMock({
      connection: { list: () => Promise.resolve([]) },
      database: { list: listDatabases },
      explorer: { getChildren, refreshNode },
    })
  );
  return { listDatabases, getChildren, refreshNode, order };
}

/** Two profiles, both open, with `PG_TWO` the most recently connected — i.e. the focused one. */
function seedTwoOpenConnections(): void {
  connectionStore.setState({
    profiles: [profile(PG_ONE, 'PG One'), profile(PG_TWO, 'PG Two')],
    connectedProfileIds: new Set([PG_ONE, PG_TWO]),
    databasesByConnection: new Map([
      [PG_ONE, DATABASES],
      [PG_TWO, DATABASES],
    ]),
  });
  explorerStore.getState().addServerNode(PG_ONE, 'PG One');
  explorerStore.getState().addServerNode(PG_TWO, 'PG Two');
}

function mountSidebar(onRender?: () => void) {
  return render(
    <IpcQueryProvider>
      <TooltipProvider>
        <Profiler id="sidebar" onRender={() => onRender?.()}>
          <Sidebar />
        </Profiler>
      </TooltipProvider>
    </IpcQueryProvider>
  );
}

/** Records every dispatch of one command id. */
function watchCommand<Id extends CommandId>(id: Id): { calls: unknown[] } {
  const record: { calls: unknown[] } = { calls: [] };
  teardowns.push(
    subscribeCommand(id, payload => {
      record.calls.push(payload);
    })
  );
  return record;
}

/**
 * A menu item's disabled state as Radix records it.
 *
 * `aria-disabled` rather than a `disabled` property: Radix's menu items are `div`s with
 * `role="menuitem"`, and `aria-disabled` is both what a screen reader reads and what its own
 * keyboard navigation skips — one flag for both paths, which is the property these tests are for.
 * `null` means enabled.
 */
function ariaDisabled(element: HTMLElement): string | null {
  return element.getAttribute('aria-disabled');
}

function rowByLabel(label: string): HTMLElement {
  const rows = screen
    .getAllByTestId('tree-row')
    .filter(row => within(row).getByTestId('tree-row-label').textContent === label);
  const row = rows[0];
  if (row === undefined) throw new Error(`no tree row labelled ${label}`);
  return row;
}

beforeEach(() => {
  bridge = installBridge();
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));
  teardowns.push(
    setNotifier({
      success: () => undefined,
      info: () => undefined,
      warning: () => undefined,
      error: () => undefined,
    })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  explorerStore.getState().clear();
  capabilitiesStore.setState({ byConnection: new Map() });
  connectionStore.setState({
    profiles: [],
    connectedProfileIds: new Set(),
    databasesByConnection: new Map(),
    selectedDatabaseByConnection: new Map(),
    healthByConnection: new Map(),
    loadingDatabases: false,
  });
  tabStore.setState({ tabs: [], activeTabId: '' });
  logStore.getState().clear();
  vi.clearAllMocks();
});

// ── the frame ────────────────────────────────────────────────────────────────────────────────

describe('the sidebar frame', () => {
  it('paints the brand mark’s middle bar from a theme token, not a hex', () => {
    mountSidebar();

    const middle = screen.getByTestId('sidebar-brand-mark-mid');
    // `fill-fg` is ivory under ink and ink under ivory, which is exactly the difference between
    // docs/brand/assets/mark-on-dark.svg and mark-on-light.svg. This is the J-32 guard: the
    // Angular mark hardcoded `#f2efe7` and was invisible on the light chrome.
    expect(middle.getAttribute('class')).toContain('fill-fg');
    expect(screen.getByTestId('sidebar-brand-mark').outerHTML).not.toMatch(/fill="#/);
  });

  it('shows the explorer empty state, and its action asks for the connection dialog', async () => {
    const dialog = watchCommand('open-connection-dialog');
    mountSidebar();

    expect(screen.getByTestId('sidebar-empty')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-tree')).toBeNull();

    await userEvent.click(screen.getByTestId('sidebar-empty-connect'));
    expect(dialog.calls).toHaveLength(1);
  });

  it('hides the connection and database pickers until there is something to pick', () => {
    mountSidebar();
    expect(screen.queryByTestId('sidebar-connection-trigger')).toBeNull();
    expect(screen.queryByTestId('sidebar-database-trigger')).toBeNull();
  });

  it('disables every connection-dependent footer action while nothing is connected', () => {
    mountSidebar();
    for (const testId of [
      'sidebar-new-query',
      'sidebar-refresh',
      'sidebar-backup',
      'sidebar-restore',
    ]) {
      expect(screen.getByTestId(testId)).toHaveProperty('disabled', true);
    }
    // The assistant toggle is not connection-dependent and must stay live.
    expect(screen.getByTestId('sidebar-toggle-chat')).toHaveProperty('disabled', false);
  });
});

// ── the connection picker ────────────────────────────────────────────────────────────────────

describe('the connection picker', () => {
  it('offers a connect row for a closed profile and a focus row for an open one', async () => {
    connectionStore.setState({
      profiles: [profile(PG_ONE, 'PG One'), profile(PG_TWO, 'PG Two')],
      connectedProfileIds: new Set([PG_TWO]),
    });
    mountSidebar();

    await userEvent.click(screen.getByTestId('sidebar-connection-trigger'));
    const menu = await screen.findByTestId('sidebar-connection-menu');

    expect(within(menu).getByTestId('sidebar-connection-connect').textContent).toContain(
      'Connect: PG One'
    );
    expect(within(menu).getByTestId('sidebar-connection-focus').textContent).toContain('PG Two');
  });

  it('marks a connection whose heartbeat is failing', async () => {
    connectionStore.setState({
      profiles: [profile(PG_TWO, 'PG Two')],
      connectedProfileIds: new Set([PG_TWO]),
      healthByConnection: new Map([[PG_TWO, false]]),
    });
    mountSidebar();

    await userEvent.click(screen.getByTestId('sidebar-connection-trigger'));
    expect(await screen.findByTestId('sidebar-connection-unhealthy')).toBeTruthy();
  });

  it('does not mark a healthy one, so the warning means something', async () => {
    connectionStore.setState({
      profiles: [profile(PG_TWO, 'PG Two')],
      connectedProfileIds: new Set([PG_TWO]),
      healthByConnection: new Map([[PG_TWO, true]]),
    });
    mountSidebar();

    await userEvent.click(screen.getByTestId('sidebar-connection-trigger'));
    await screen.findByTestId('sidebar-connection-menu');
    expect(screen.queryByTestId('sidebar-connection-unhealthy')).toBeNull();
  });
});

// ── the database picker ──────────────────────────────────────────────────────────────────────

describe('the database picker', () => {
  it('shows the database ⌘N would use before the user has picked one', async () => {
    seedTwoOpenConnections();
    // Nothing in `selectedDatabaseByConnection`: the state a freshly-connected server is in.
    mountSidebar();

    // The profile's configured default, because it is in the list the server returned.
    expect(screen.getByTestId('sidebar-database-trigger').textContent).toContain('joinery_test');
    // …and the actions that need a database are therefore live, rather than dead until the user
    // opens a picker to confirm what the app was already going to do.
    expect(screen.getByTestId('sidebar-backup')).toHaveProperty('disabled', false);
  });

  it('lets an explicit pick win over the resolved default', async () => {
    seedTwoOpenConnections();
    mountSidebar();

    await userEvent.click(screen.getByTestId('sidebar-database-trigger'));
    const menu = await screen.findByTestId('sidebar-database-menu');
    await userEvent.click(
      within(menu)
        .getAllByTestId('sidebar-database-item')
        .filter(item => item.textContent?.includes('postgres'))[0] as HTMLElement
    );

    await waitFor(() =>
      expect(screen.getByTestId('sidebar-database-trigger').textContent).toContain('postgres')
    );
    // Written for the focused connection only — `PG_TWO` is the most recent one.
    expect(connectionStore.getState().selectedDatabaseByConnection.get(PG_TWO)).toBe('postgres');
    expect(connectionStore.getState().selectedDatabaseByConnection.has(PG_ONE)).toBe(false);
  });
});

// ── the lazy tree ────────────────────────────────────────────────────────────────────────────

describe('the explorer tree', () => {
  it('renders a server row per open connection and fetches nothing', () => {
    seedTwoOpenConnections();
    mountSidebar();

    expect(screen.getAllByTestId('tree-row')).toHaveLength(2);
    expect(rowByLabel('PG One').getAttribute('aria-level')).toBe('1');
    // The lazy contract: expandable, and not yet fetched.
    expect(rowByLabel('PG One').getAttribute('aria-expanded')).toBe('false');
    expect(bridge.listDatabases).not.toHaveBeenCalled();
  });

  it('fetches a server’s databases once, on expand, and only for that server', async () => {
    seedTwoOpenConnections();
    mountSidebar();

    await userEvent.click(within(rowByLabel('PG One')).getByTestId('tree-row-twisty'));

    await waitFor(() => expect(screen.getAllByTestId('tree-row')).toHaveLength(4));
    expect(bridge.listDatabases).toHaveBeenCalledTimes(1);
    expect(bridge.listDatabases).toHaveBeenCalledWith(PG_ONE);
    expect(rowByLabel('joinery_test').getAttribute('aria-level')).toBe('2');
  });

  it('fetches a database’s schemas only when that database is expanded', async () => {
    seedTwoOpenConnections();
    mountSidebar();

    await userEvent.click(within(rowByLabel('PG One')).getByTestId('tree-row-twisty'));
    await waitFor(() => expect(screen.getAllByTestId('tree-row')).toHaveLength(4));
    expect(bridge.getChildren).not.toHaveBeenCalled();

    await userEvent.click(within(rowByLabel('joinery_test')).getByTestId('tree-row-twisty'));
    await waitFor(() => expect(bridge.getChildren).toHaveBeenCalledTimes(1));
    expect(bridge.getChildren).toHaveBeenCalledWith(PG_ONE, 'joinery_test', 'schemas');
    expect(rowByLabel('public').getAttribute('aria-level')).toBe('3');
  });

  it('selects on click without expanding — the Angular double-toggle is gone', async () => {
    seedTwoOpenConnections();
    mountSidebar();

    await userEvent.click(within(rowByLabel('PG One')).getByTestId('tree-row-label'));

    expect(explorerStore.getState().selectedNodeId).toBe(`server-${PG_ONE}`);
    expect(bridge.listDatabases).not.toHaveBeenCalled();
    expect(rowByLabel('PG One').getAttribute('aria-expanded')).toBe('false');
  });
});

// ── context menus ────────────────────────────────────────────────────────────────────────────

/** Expands `PG One` and returns once its two databases are on screen. */
async function expandFirstServer(): Promise<void> {
  await userEvent.click(within(rowByLabel('PG One')).getByTestId('tree-row-twisty'));
  await waitFor(() => expect(screen.getAllByTestId('tree-row')).toHaveLength(4));
}

describe('Refresh, and the caches it is expected to clear', () => {
  /**
   * The fix: both Refresh affordances now drop the MAIN process's metadata caches first.
   *
   * `explorer.refreshNode` has been on the preload bridge since before this rewrite and NEITHER
   * renderer ever called it, so a Refresh only ever re-ran the renderer's half of the read and got
   * `MetadataService`'s 60s-TTL answer back. See `src/ipc/main-metadata-cache.ts`.
   */
  it('drops main’s caches before re-reading the database list', async () => {
    seedTwoOpenConnections();
    mountSidebar();

    await userEvent.click(screen.getByTestId('sidebar-refresh'));

    await waitFor(() => expect(bridge.refreshNode).toHaveBeenCalled());
    // The focused connection, and its default database — which is only what main re-warms on the way
    // back; the invalidation itself is per-connection.
    expect(bridge.refreshNode).toHaveBeenCalledWith(PG_TWO, 'joinery_test', 'tables');
    // Order is the point: `database.list` reads THROUGH the cache being dropped, so dropping it
    // afterwards would leave the app showing the answer the refresh existed to replace.
    await waitFor(() => expect(bridge.order).toContain('database.list'));
    expect(bridge.order.indexOf('explorer.refreshNode')).toBeLessThan(
      bridge.order.indexOf('database.list')
    );
  });

  it('drops them from the context menu’s Refresh too, for the node’s own connection', async () => {
    seedTwoOpenConnections();
    mountSidebar();

    fireEvent.contextMenu(rowByLabel('PG One'));
    const menu = await screen.findByTestId('sidebar-node-menu');
    await userEvent.click(within(menu).getByTestId('sidebar-menu-refresh'));

    // PG_ONE, not the focused connection: "Refresh" on a node means that node's server.
    await waitFor(() =>
      expect(bridge.refreshNode).toHaveBeenCalledWith(PG_ONE, 'joinery_test', 'tables')
    );
  });
});

describe('context menus', () => {
  it('gives a server node its own menu and selects the row it opened on', async () => {
    seedTwoOpenConnections();
    mountSidebar();

    fireEvent.contextMenu(rowByLabel('PG One'));
    const menu = await screen.findByTestId('sidebar-node-menu');

    expect(within(menu).getByTestId('sidebar-menu-disconnect')).toBeTruthy();
    await waitFor(() => expect(explorerStore.getState().selectedNodeId).toBe(`server-${PG_ONE}`));
  });

  it('disables backup and restore when the engine does not support them', async () => {
    seedTwoOpenConnections();
    capabilitiesStore.getState().setCapabilities(PG_ONE, {
      capabilities: {
        supportsMultipleDatabases: true,
        supportsDatabaseManagement: true,
        supportsStoredProcedures: true,
        supportsTriggers: true,
        supportsBackupRestore: false,
      },
    });
    mountSidebar();
    await expandFirstServer();

    fireEvent.contextMenu(rowByLabel('joinery_test'));
    const menu = await screen.findByTestId('sidebar-node-menu');

    // `aria-disabled` is what Radix sets, and it is also what makes the item unreachable by
    // arrow key — the pointer and keyboard paths cannot disagree because there is one flag.
    expect(ariaDisabled(within(menu).getByTestId('sidebar-menu-backup'))).toBe('true');
    expect(ariaDisabled(within(menu).getByTestId('sidebar-menu-restore'))).toBe('true');
    // The capability is specific: renaming is still allowed here.
    expect(ariaDisabled(within(menu).getByTestId('sidebar-menu-rename-database'))).toBeNull();
  });

  it('enables them on a fully capable connection', async () => {
    seedTwoOpenConnections();
    mountSidebar();
    await expandFirstServer();

    fireEvent.contextMenu(rowByLabel('joinery_test'));
    const menu = await screen.findByTestId('sidebar-node-menu');

    expect(ariaDisabled(within(menu).getByTestId('sidebar-menu-backup'))).toBeNull();
    expect(ariaDisabled(within(menu).getByTestId('sidebar-menu-restore'))).toBeNull();
  });

  it('refuses to rename a system database whatever the engine says', async () => {
    connectionStore.setState({
      profiles: [profile(PG_ONE, 'PG One')],
      connectedProfileIds: new Set([PG_ONE]),
    });
    explorerStore.getState().addServerNode(PG_ONE, 'PG One');
    // A server whose database list contains one of the four SQL Server system databases.
    bridge.listDatabases.mockResolvedValueOnce([{ name: 'master', state: 'online' }]);
    mountSidebar();
    await userEvent.click(within(rowByLabel('PG One')).getByTestId('tree-row-twisty'));
    await waitFor(() => expect(screen.getAllByTestId('tree-row')).toHaveLength(2));

    fireEvent.contextMenu(rowByLabel('master'));
    const menu = await screen.findByTestId('sidebar-node-menu');

    expect(ariaDisabled(within(menu).getByTestId('sidebar-menu-rename-database'))).toBe('true');
  });

  /**
   * J-104. `delete-database` and `show-object-properties` have no subscriber, and
   * `commands/bus.ts:warnUnhandled` only warns under `import.meta.env.DEV` — so while these items
   * existed, clicking them in a packaged build did nothing, silently. The ids stay registered; the
   * affordances do not. These two tests are the guard that keeps them gone until a handler exists.
   *
   * Each asserts a sibling item is still present, so it cannot pass by finding no menu at all.
   */
  it('offers no Delete… on a database menu, because nothing handles delete-database', async () => {
    seedTwoOpenConnections();
    mountSidebar();
    await expandFirstServer();

    fireEvent.contextMenu(rowByLabel('joinery_test'));
    const menu = await screen.findByTestId('sidebar-node-menu');

    expect(within(menu).getByTestId('sidebar-menu-rename-database')).toBeTruthy();
    expect(within(menu).queryByTestId('sidebar-menu-delete-database')).toBeNull();
  });

  it('offers no Properties… on an object menu, because nothing handles show-object-properties', async () => {
    seedTwoOpenConnections();
    mountSidebar();
    await expandFirstServer();

    // server → database → schema → "Tables" → table. Only the database and folder expands hit the
    // bridge; the schema's folders are built locally from `schemaFolderDefs`.
    await userEvent.click(within(rowByLabel('joinery_test')).getByTestId('tree-row-twisty'));
    await waitFor(() => expect(rowByLabel('public')).toBeTruthy());
    await userEvent.click(within(rowByLabel('public')).getByTestId('tree-row-twisty'));
    await waitFor(() => expect(rowByLabel('Tables')).toBeTruthy());
    bridge.getChildren.mockResolvedValueOnce(TABLES);
    await userEvent.click(within(rowByLabel('Tables')).getByTestId('tree-row-twisty'));
    await waitFor(() => expect(rowByLabel('customers')).toBeTruthy());

    fireEvent.contextMenu(rowByLabel('customers'));
    const menu = await screen.findByTestId('sidebar-node-menu');

    expect(within(menu).getByTestId('sidebar-menu-relationships')).toBeTruthy();
    expect(within(menu).queryByTestId('sidebar-menu-properties')).toBeNull();
  });

  it('routes Backup at the node’s own connection, not the focused one', async () => {
    const backup = watchCommand('backup-database');
    seedTwoOpenConnections();
    mountSidebar();
    // `PG Two` is the most recently connected, so it is the focused connection. The database
    // being right-clicked belongs to `PG One` — the routing bug the Angular
    // `overrideConnectionId` parameter existed to patch at every call site.
    await expandFirstServer();

    fireEvent.contextMenu(rowByLabel('joinery_test'));
    const menu = await screen.findByTestId('sidebar-node-menu');
    await userEvent.click(within(menu).getByTestId('sidebar-menu-backup'));

    expect(backup.calls).toEqual([{ connectionId: PG_ONE, databaseName: 'joinery_test' }]);
  });

  it('gives a leaf detail node no menu at all', async () => {
    seedTwoOpenConnections();
    mountSidebar();
    await expandFirstServer();

    // A database row has a menu; the tree only wraps rows whose `renderContextMenu` returned
    // something, so the absence below is the primitive reporting "no menu" rather than an empty one.
    fireEvent.contextMenu(rowByLabel('joinery_test'));
    await screen.findByTestId('sidebar-node-menu');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('sidebar-node-menu')).toBeNull());

    // `schema` is not in TYPES_WITH_MENU either — expand a database and right-click one.
    await userEvent.click(within(rowByLabel('joinery_test')).getByTestId('tree-row-twisty'));
    await waitFor(() => expect(bridge.getChildren).toHaveBeenCalled());
    fireEvent.contextMenu(rowByLabel('public'));
    expect(screen.queryByTestId('sidebar-node-menu')).toBeNull();
  });
});

// ── selector discipline ──────────────────────────────────────────────────────────────────────

describe('subscription isolation', () => {
  it('does not re-render when an unrelated store is written', async () => {
    seedTwoOpenConnections();
    let renders = 0;
    mountSidebar(() => {
      renders += 1;
    });
    await waitFor(() => expect(screen.getAllByTestId('tree-row')).toHaveLength(2));

    const before = renders;
    // `push`, not `addLocal`: the latter also forwards the entry to the main process, and this
    // test's partial bridge has no `logs` namespace. What is being tested is the store write.
    logStore.getState().push({
      id: 'log-1',
      timestamp: Date.now(),
      level: 'info',
      tag: 'test',
      message: 'nothing to do with the sidebar',
      source: 'renderer',
    });
    expect(renders).toBe(before);

    // …and it DOES re-render for something it subscribes to, so the assertion above is not
    // passing because the counter is broken.
    explorerStore.getState().selectNode(`server-${PG_ONE}`);
    await waitFor(() => expect(renders).toBeGreaterThan(before));
  });
});
