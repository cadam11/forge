/**
 * The object search, mounted for real, over a mocked `explorer.getChildren`.
 *
 * The two things worth mounting a component to prove:
 *
 * 1. **opening a result opens the right tab** — the SQL comes from `planObjectOpen`, which is unit-tested
 *    on its own, so what this checks is that the tab is created against the object's OWN connection and
 *    database and that the auto-execute flag is the plan's;
 * 2. **revealing really reveals** — the `reveal-explorer-node` command reaches the shell's handler, which
 *    expands four levels of the real explorer store and leaves a reveal request for the sidebar's
 *    `TreeHandle`. That chain is asserted end to end here, because a reveal that resolved to nothing
 *    would look identical to a working one from inside the overlay.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConnectionProfile, DatabaseInfo, ObjectMetadata } from '@joinery/shared';

import { handlerCount } from '../../commands';
import { COMMAND_IDS } from '../../commands/registry';
import { IpcQueryProvider } from '../../ipc';
import { connectionStore } from '../../state/connection';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { explorerStore, selectNodeById } from '../../state/explorer';
import { tabStore } from '../../state/tab';
import { useWorkbenchStore, workbenchStore } from '../../state/workbench';
import { installJoineryMock } from '../../test/joinery-mock';
import { ShellCommands } from '../../shell/shell-commands';
import { Sidebar } from '../../shell/sidebar/sidebar';
import { TooltipProvider } from '../../ui';
import { ObjectSearch } from './object-search';

const CONNECTION = 'conn-1';
const DATABASE = 'sales';

const PROFILE: ConnectionProfile = {
  id: CONNECTION,
  name: 'Test PG',
  engine: 'postgresql',
  server: '127.0.0.1',
  port: 15432,
  authenticationType: 'sql',
  username: 'joinery',
  database: DATABASE,
  encrypt: false,
  trustServerCertificate: true,
  connectionTimeout: 15,
};

const TABLES: ObjectMetadata[] = [
  { name: 'orders', schema: 'public', type: 'table' },
  { name: 'orders_archive', schema: 'public', type: 'table' },
  { name: 'customers', schema: 'public', type: 'table' },
] as ObjectMetadata[];
const VIEWS: ObjectMetadata[] = [
  { name: 'order_totals', schema: 'public', type: 'view' },
] as ObjectMetadata[];
const PROCEDURES: ObjectMetadata[] = [
  { name: 'rebuild_totals', schema: 'public', type: 'procedure' },
] as ObjectMetadata[];
const SCHEMAS: ObjectMetadata[] = [
  { name: 'public', schema: '', type: 'schema' },
] as ObjectMetadata[];

const teardowns: (() => void)[] = [];
let getChildren: ReturnType<typeof vi.fn>;

/** Answers the four folder reads, the schema read the tree does, and the database list. */
function installBridge(): void {
  getChildren = vi.fn((_connectionId: string, _database: string, path: string) => {
    if (path === 'tables') return Promise.resolve(TABLES);
    if (path === 'views') return Promise.resolve(VIEWS);
    if (path === 'procedures') return Promise.resolve(PROCEDURES);
    if (path === 'functions') return Promise.resolve([]);
    if (path === 'schemas') return Promise.resolve(SCHEMAS);
    return Promise.resolve([]);
  });
  teardowns.push(
    installJoineryMock({
      explorer: { getChildren },
      database: {
        list: () => Promise.resolve([{ name: DATABASE, state: 'online' }] as DatabaseInfo[]),
      },
      // The reveal uncollapses the sidebar, and the workbench store persists its geometry on a 300ms
      // debounce — so the bridge has to still answer for `app.setState` after this test has finished.
      app: { setState: () => Promise.resolve(true), getState: () => Promise.resolve({}) },
    })
  );
}

beforeEach(() => {
  installBridge();
  teardowns.push(
    setDiagnosticsSink({ error: () => undefined, warn: () => undefined }),
    setNotifier({
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warning: () => undefined,
    })
  );
  connectionStore.setState({
    profiles: [PROFILE],
    connectedProfileIds: new Set([CONNECTION]),
    databasesByConnection: new Map([
      [CONNECTION, [{ name: DATABASE, state: 'online' }] as unknown as DatabaseInfo[]],
    ]),
    selectedDatabaseByConnection: new Map([[CONNECTION, DATABASE]]),
  });
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  tabStore.getState().closeAllTabs();
  explorerStore.getState().clear();
  workbenchStore.getState().setSidebarCollapsed(false);
  connectionStore.setState({
    profiles: [],
    connectedProfileIds: new Set(),
    databasesByConnection: new Map(),
    selectedDatabaseByConnection: new Map(),
  });
  for (const id of COMMAND_IDS) expect(handlerCount(id)).toBe(0);
});

/** The overlay, plus the shell's real command handlers — the reveal's consumer is one of them. */
function mount() {
  const rendered = render(
    <IpcQueryProvider>
      <TooltipProvider>
        <ShellCommands />
        <ObjectSearch />
      </TooltipProvider>
    </IpcQueryProvider>
  );
  teardowns.push(rendered.unmount);
  return rendered;
}

/** `app-shell.tsx`'s own conditional: the sidebar does not exist while the pane is collapsed. */
function CollapsibleSidebar() {
  const collapsed = useWorkbenchStore(state => state.sidebarCollapsed);
  return collapsed ? null : <Sidebar />;
}

/** The overlay, the shell's handlers, and a sidebar that mounts and unmounts with the pane. */
function mountWithSidebar() {
  const rendered = render(
    <IpcQueryProvider>
      <TooltipProvider>
        <ShellCommands />
        <ObjectSearch />
        <CollapsibleSidebar />
      </TooltipProvider>
    </IpcQueryProvider>
  );
  teardowns.push(rendered.unmount);
  return rendered;
}

async function open(): Promise<void> {
  await userEvent.keyboard('{Meta>}p{/Meta}');
  await screen.findByTestId('objsearch-overlay');
  // The four folder reads resolve asynchronously; the rows are what proves they landed.
  await waitFor(() => expect(screen.queryAllByTestId('objsearch-row').length).toBeGreaterThan(0));
}

function rowNames(): string[] {
  return screen
    .getAllByTestId('objsearch-row')
    .map(row => within(row).getByTestId('objsearch-row-name').textContent ?? '');
}

function rowFor(name: string): HTMLElement {
  const found = screen
    .getAllByTestId('objsearch-row')
    .find(row => within(row).getByTestId('objsearch-row-name').textContent === name);
  if (found === undefined) throw new Error(`no row for ${name}`);
  return found;
}

describe('the object search', () => {
  it('opens on ⌘P and lists every folder’s objects', async () => {
    mount();
    await open();

    expect(rowNames()).toEqual(
      expect.arrayContaining([
        'public.orders',
        'public.orders_archive',
        'public.customers',
        'public.order_totals',
        'public.rebuild_totals',
      ])
    );
    // Four reads, one per folder, and each is keyed on its own path — not one call re-filtered.
    expect(getChildren.mock.calls.map(call => call[2]).sort()).toEqual([
      'functions',
      'procedures',
      'tables',
      'views',
    ]);
  });

  it('ranks the exact name above its prefixed neighbour', async () => {
    mount();
    await open();

    await userEvent.type(screen.getByTestId('objsearch-input'), 'orders');
    await waitFor(() => expect(rowNames()[0]).toBe('public.orders'));
    // Exact, then prefix, then the scattered subsequence: `order_totals` contains o-r-d-e-r…s in order,
    // so it is a real (weak) match and belongs last rather than nowhere.
    expect(rowNames()).toEqual(['public.orders', 'public.orders_archive', 'public.order_totals']);
    // The Fuse-at-0.4 failure that is now impossible: "customers" is not a match for "orders".
    expect(rowNames()).not.toContain('public.customers');
  });

  it('states what opening a row will do, per object kind', async () => {
    mount();
    await open();

    expect(within(rowFor('public.orders')).getByTestId('objsearch-row-promise').textContent).toBe(
      'Top 1000'
    );
    expect(
      within(rowFor('public.rebuild_totals')).getByTestId('objsearch-row-promise').textContent
    ).toBe('Call');
  });

  it('opens a table in a query tab against its own connection and database', async () => {
    mount();
    await open();

    await userEvent.click(rowFor('public.orders'));

    const tabs = tabStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.connectionId).toBe(CONNECTION);
    expect(tabs[0]?.databaseName).toBe(DATABASE);
    expect(tabStore.getState().getTabContent(tabs[0]?.id ?? '')).toBe(
      'SELECT * FROM "public"."orders" LIMIT 1000'
    );
    // The label promised "Top 1000", so it runs — the same rule the sidebar's identical item follows.
    expect(tabs[0]?.autoExecute).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('objsearch-overlay')).toBeNull());
  });

  it('opens a procedure as text, without running it', async () => {
    mount();
    await open();

    await userEvent.click(rowFor('public.rebuild_totals'));

    const tab = tabStore.getState().tabs[0];
    expect(tabStore.getState().getTabContent(tab?.id ?? '')).toBe(
      'CALL "public"."rebuild_totals"()'
    );
    expect(tab?.autoExecute ?? false).toBe(false);
  });

  it('reveals a table in the explorer, expanding four levels and asking the tree to scroll', async () => {
    // The tree has to have a server node to expand into — the state after connecting.
    explorerStore.getState().addServerNode(CONNECTION, 'Test PG');
    mount();
    await open();

    await userEvent.click(within(rowFor('public.orders')).getByTestId('objsearch-row-reveal'));

    // The end of the chain: the object's own node id is what the sidebar is asked to scroll to. Getting
    // here means server → database → schema → folder all expanded and the object node was found.
    await waitFor(() =>
      expect(explorerStore.getState().revealRequest).toBe(
        `obj-${CONNECTION}-${DATABASE}-public.orders`
      )
    );
    expect(explorerStore.getState().selectedNodeId).toBe(
      `obj-${CONNECTION}-${DATABASE}-public.orders`
    );
    // Asserted on the node's own `isExpanded`, which is what the tree reads. It used to read the
    // store's `expandedNodeIds` set — a second copy of the same fact that Task 20 deleted, because
    // nothing but this line consumed it and it could disagree with the flag (`renameDatabaseNodeLocal`
    // clears `isExpanded` and never touched the set).
    expect(
      selectNodeById(`folder-${CONNECTION}-${DATABASE}-public-tables`)(explorerStore.getState())
        ?.isExpanded
    ).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('objsearch-overlay')).toBeNull());
  });

  it('uncollapses the sidebar before revealing, because a hidden pane cannot show anything', async () => {
    explorerStore.getState().addServerNode(CONNECTION, 'Test PG');
    workbenchStore.getState().setSidebarCollapsed(true);
    mount();
    await open();

    await userEvent.click(within(rowFor('public.orders')).getByTestId('objsearch-row-reveal'));

    await waitFor(() => expect(workbenchStore.getState().sidebarCollapsed).toBe(false));
    // And the reveal still happened: the request survives a pane that was closed when it was made,
    // which is why it is store state rather than a callback into an unmounted component.
    await waitFor(() => expect(explorerStore.getState().revealRequest).not.toBeNull());
  });

  /**
   * The other half of the test above.
   *
   * That one proves the request SURVIVES a collapsed pane. This one proves something consumes it when
   * the pane comes back: the sidebar's reveal effect runs on mount, finds the waiting request, asks the
   * `TreeHandle` to scroll to it, takes keyboard focus, and clears the request. Without this, "the
   * sidebar honours a reveal made while it was closed" was a claim about a component nothing in the
   * suite mounted — the request could have sat in the store forever and every assertion still passed.
   *
   * `CollapsibleSidebar` is `app-shell.tsx`'s own conditional (`sidebarCollapsed ? null : <Sidebar/>`),
   * restated because that is the mount behaviour under test.
   */
  it('consumes a reveal request that was waiting while the pane was collapsed', async () => {
    const warnings: string[] = [];
    teardowns.push(
      setDiagnosticsSink({ error: () => undefined, warn: context => warnings.push(context) })
    );
    explorerStore.getState().addServerNode(CONNECTION, 'Test PG');
    mountWithSidebar();
    await open();

    // A real reveal first, so the tree's four levels are expanded and the object node exists in the
    // flattened row list — the state a user is in when they reveal a second time.
    await userEvent.click(within(rowFor('public.orders')).getByTestId('objsearch-row-reveal'));
    const nodeId = `obj-${CONNECTION}-${DATABASE}-public.orders`;
    await waitFor(() => expect(explorerStore.getState().revealRequest).toBeNull());
    expect(await screen.findByTestId('sidebar')).not.toBeNull();

    // Now close the pane and make a request into the void.
    workbenchStore.getState().setSidebarCollapsed(true);
    await waitFor(() => expect(screen.queryByTestId('sidebar')).toBeNull());
    explorerStore.getState().requestReveal(nodeId);
    // Nothing is mounted to honour it, and it is still there — which is the whole reason it is store
    // state rather than a call into a `TreeHandle`.
    expect(explorerStore.getState().revealRequest).toBe(nodeId);

    workbenchStore.getState().setSidebarCollapsed(false);
    await screen.findByTestId('sidebar');

    // Consumed at mount: cleared, and the tree took focus so the arrow keys carry on from the revealed
    // row. `scrollToId` warns when it is handed an id no row has, so the absence of that warning is
    // what says the scroll resolved to a real row rather than doing nothing.
    await waitFor(() => expect(explorerStore.getState().revealRequest).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('tree'));
    expect(warnings.filter(context => context.includes('cannot reveal'))).toEqual([]);
  });

  it('reveals with ⌘⏎ without also opening a tab', async () => {
    explorerStore.getState().addServerNode(CONNECTION, 'Test PG');
    mount();
    await open();

    await userEvent.type(screen.getByTestId('objsearch-input'), 'orders');
    await waitFor(() => expect(rowNames()[0]).toBe('public.orders'));
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');

    await waitFor(() => expect(explorerStore.getState().revealRequest).not.toBeNull());
    // The chord is claimed in the capture phase, so cmdk's own Enter handling never runs — otherwise a
    // reveal would ALSO open a tab.
    expect(tabStore.getState().tabs).toHaveLength(0);
  });

  it('says what is missing when nothing is connected', async () => {
    connectionStore.setState({ profiles: [], connectedProfileIds: new Set() });
    mount();

    await userEvent.keyboard('{Meta>}p{/Meta}');
    await screen.findByTestId('objsearch-overlay');

    expect(screen.getByTestId('objsearch-disconnected').textContent).toContain(
      'Connect to a server'
    );
    expect(screen.queryAllByTestId('objsearch-row')).toHaveLength(0);
    // And nothing was asked of the bridge — the queries are disabled, not failing.
    expect(getChildren).not.toHaveBeenCalled();
  });

  it('says a failed metadata read failed, instead of showing an empty database', async () => {
    // The Angular version caught per folder and returned `[]`, so a permissions error and an empty
    // schema looked identical. `diagnostics` gets the cause; the row gets the message.
    const reported: string[] = [];
    teardowns.push(
      setDiagnosticsSink({
        error: context => reported.push(context),
        warn: () => undefined,
      })
    );
    getChildren.mockImplementation(() =>
      Promise.reject(new Error('permission denied for schema public'))
    );

    mount();
    await userEvent.keyboard('{Meta>}p{/Meta}');
    await screen.findByTestId('objsearch-overlay');

    await waitFor(() =>
      expect(screen.getByTestId('objsearch-empty-reason').textContent).toContain(
        'permission denied for schema public'
      )
    );
    expect(reported.some(context => context.includes('object index'))).toBe(true);
  });

  it('says so when a search matches nothing', async () => {
    mount();
    await open();

    await userEvent.type(screen.getByTestId('objsearch-input'), 'zzqqxv');
    await waitFor(() => expect(screen.queryAllByTestId('objsearch-row')).toHaveLength(0));
    expect(screen.getByTestId('objsearch-empty').textContent).toContain('zzqqxv');
  });

  it('counts what it shows out of what it loaded', async () => {
    mount();
    await open();

    expect(screen.getByTestId('objsearch-count').textContent).toBe(`5 of 5 in ${DATABASE}`);
    await userEvent.type(screen.getByTestId('objsearch-input'), 'orders');
    await waitFor(() =>
      expect(screen.getByTestId('objsearch-count').textContent).toBe(`3 of 5 in ${DATABASE}`)
    );
  });
});
