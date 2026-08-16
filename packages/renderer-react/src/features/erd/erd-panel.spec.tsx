/**
 * The ERD tab: what it shows in each state, and the four wires out of it.
 *
 * The bridge is a real (partial) `window.joinery` rather than an injected reader, because the wire
 * from `ipcSchemaReader` to `explorer.getChildren('tables')` is one of the things worth pinning — it
 * is the exact call the Angular adapter got wrong (`'Tables'`, which the main process does not match).
 * The spec asserts the literal that reaches the bridge.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnInfo, ForeignKeyInfo, ObjectMetadata } from '@joinery/shared';

import { subscribeCommand } from '../../commands';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { tabStore, type Tab } from '../../state/tab';
import { TooltipProvider } from '../../ui';
import { installJoineryMock } from '../../test/joinery-mock';
import { clearErdCache } from './erd-cache';
import { ErdSurface } from './erd-panel';

const TABLES: readonly ObjectMetadata[] = [
  { name: 'customers', type: 'table', schema: 'public' },
  { name: 'orders', type: 'table', schema: 'public' },
  { name: 'order_items', type: 'table', schema: 'public' },
];

const COLUMNS: Record<string, readonly ColumnInfo[]> = {
  customers: [
    { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true, ordinalPosition: 1 },
    { name: 'email', dataType: 'varchar', maxLength: 200, isNullable: false, ordinalPosition: 2 },
  ],
  orders: [
    { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true, ordinalPosition: 1 },
    { name: 'customer_id', dataType: 'integer', isNullable: false, ordinalPosition: 2 },
  ],
  order_items: [
    { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true, ordinalPosition: 1 },
    { name: 'order_id', dataType: 'integer', isNullable: false, ordinalPosition: 2 },
  ],
};

const KEYS: Record<string, readonly ForeignKeyInfo[]> = {
  orders: [
    {
      name: 'orders_customer_id_fkey',
      columns: ['customer_id'],
      referencedSchema: 'public',
      referencedTable: 'customers',
      referencedColumns: ['id'],
    },
  ],
  order_items: [
    {
      name: 'order_items_order_id_fkey',
      columns: ['order_id'],
      referencedSchema: 'public',
      referencedTable: 'orders',
      referencedColumns: ['id'],
    },
  ],
};

/** What the fake bridge was asked, and one switch for making it fail. Reset in `beforeEach`. */
const bridge: {
  readonly childrenPaths: string[];
  readonly columnCalls: string[];
  failColumns: boolean;
} = {
  childrenPaths: [],
  columnCalls: [],
  failColumns: false,
};

function erdTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 'tab-erd',
    type: 'erd',
    title: 'ERD: joinery_test',
    icon: 'account_tree',
    connectionId: 'c1',
    databaseName: 'joinery_test',
    ...overrides,
  };
}

function mount(tab: Tab | undefined) {
  return render(
    <TooltipProvider>
      <ErdSurface tab={tab} />
    </TooltipProvider>
  );
}

const teardowns: (() => void)[] = [];

beforeEach(() => {
  clearErdCache();
  bridge.childrenPaths.length = 0;
  bridge.columnCalls.length = 0;
  bridge.failColumns = false;

  teardowns.push(
    setDiagnosticsSink({ error: () => undefined, warn: () => undefined }),
    setNotifier({
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warning: () => undefined,
    }),
    installJoineryMock({
      explorer: {
        getChildren: async (_connectionId: string, _database: string, path: string) => {
          bridge.childrenPaths.push(path);
          return path === 'tables' ? [...TABLES] : [];
        },
        getTableColumns: async (
          _connectionId: string,
          _database: string,
          _schema: string,
          table: string
        ) => {
          bridge.columnCalls.push(table);
          if (bridge.failColumns) throw new Error('permission denied for schema public');
          return [...(COLUMNS[table] ?? [])];
        },
        getTableKeys: async (
          _connectionId: string,
          _database: string,
          _schema: string,
          table: string
        ) => [...(KEYS[table] ?? [])],
      },
    })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  tabStore.getState().closeAllTabs();
});

const nodeIds = () =>
  screen
    .getAllByTestId('erd-node')
    .map(element => element.getAttribute('data-erd-node-id'))
    .sort();

describe('the states', () => {
  it('is idle with no tab', () => {
    mount(undefined);
    expect(screen.getByTestId('erd-idle')).toBeTruthy();
  });

  it('is idle when the tab names no database', () => {
    mount(erdTab({ databaseName: undefined }));
    expect(screen.getByTestId('erd-idle')).toBeTruthy();
  });

  it('shows a spinner while the schema is being read', () => {
    mount(erdTab());
    expect(screen.getByTestId('erd-loading')).toBeTruthy();
  });

  it('draws the seeded tables for a whole-database diagram', async () => {
    mount(erdTab());

    await waitFor(() => expect(screen.getByTestId('erd-canvas')).toBeTruthy());
    expect(nodeIds()).toEqual(['public.customers', 'public.order_items', 'public.orders']);
  });

  it('asks the explorer for the lowercase `tables` path', async () => {
    mount(erdTab());
    await waitFor(() => expect(screen.getByTestId('erd-canvas')).toBeTruthy());

    // The fixed bug, asserted where it actually reaches the bridge.
    expect(bridge.childrenPaths).toEqual(['tables']);
  });

  it('shows the failure and offers a retry', async () => {
    bridge.failColumns = true;
    mount(erdTab());

    await waitFor(() => expect(screen.getByTestId('erd-error')).toBeTruthy());
    expect(screen.getByTestId('erd-error').textContent).toContain('permission denied');
    expect(screen.getByTestId('erd-retry')).toBeTruthy();
  });

  it('retries the read from the error state', async () => {
    const user = userEvent.setup();
    bridge.failColumns = true;
    mount(erdTab());
    await waitFor(() => expect(screen.getByTestId('erd-error')).toBeTruthy());

    bridge.failColumns = false;
    await user.click(screen.getByTestId('erd-retry'));

    await waitFor(() => expect(screen.getByTestId('erd-canvas')).toBeTruthy());
  });

  it('says so when the database has no tables', async () => {
    bridge.childrenPaths.length = 0;
    teardowns.push(
      installJoineryMock({
        explorer: {
          getChildren: async () => [],
          getTableColumns: async () => [],
          getTableKeys: async () => [],
        },
      })
    );

    mount(erdTab());
    await waitFor(() => expect(screen.getByTestId('erd-empty')).toBeTruthy());
  });
});

describe('the table-focused diagram', () => {
  const focused = () =>
    erdTab({
      id: 'tab-focus',
      metadata: { tableName: 'order_items', schema: 'public', focusDepth: 2 },
    });

  it('follows the foreign keys to the requested depth, without listing the database', async () => {
    mount(focused());

    await waitFor(() => expect(screen.getByTestId('erd-canvas')).toBeTruthy());
    expect(nodeIds()).toEqual(['public.customers', 'public.order_items', 'public.orders']);
    expect(bridge.childrenPaths).toEqual([]);
  });

  it('titles itself after the table, and a database diagram after the database', async () => {
    const view = mount(focused());
    expect(screen.getByTestId('erd-toolbar').textContent).toContain('Relationships: order_items');
    view.unmount();

    mount(erdTab());
    expect(screen.getByTestId('erd-toolbar').textContent).toContain('Database ERD: joinery_test');
  });

  it('opens with the focus table selected, and its details showing', async () => {
    mount(focused());

    await waitFor(() => expect(screen.getByTestId('erd-details')).toBeTruthy());
    expect(screen.getByTestId('erd-details').textContent).toContain('order_items');
  });
});

describe('the details rail', () => {
  async function openRail() {
    const user = userEvent.setup();
    mount(erdTab());
    await waitFor(() => expect(screen.getByTestId('erd-canvas')).toBeTruthy());

    const orders = screen
      .getAllByTestId('erd-node')
      .find(element => element.getAttribute('data-erd-node-id') === 'public.orders');
    if (orders !== undefined) await user.click(orders);

    return { user, rail: screen.getByTestId('erd-details') };
  }

  it('opens on a single click and lists every column, keys and non-keys alike', async () => {
    const { rail } = await openRail();

    // The DIAGRAM shows keys only; the rail shows the whole table.
    expect(within(rail).getAllByTestId('erd-column-row')).toHaveLength(2);
    expect(rail.textContent).toContain('customer_id');
  });

  it('lists the relationships and marks the ones the diagram holds', async () => {
    const { rail } = await openRail();
    const rows = within(rail).getAllByTestId('erd-relationship-row');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-erd-present')).toBe('true');
    expect(rows[0]?.getAttribute('data-erd-target')).toBe('public.customers');
  });

  it('moves the selection when a relationship is clicked', async () => {
    const { user, rail } = await openRail();

    await user.click(within(rail).getAllByTestId('erd-relationship-row')[0] as HTMLElement);

    await waitFor(() =>
      expect(screen.getByTestId('erd-details').textContent).toContain('customers')
    );
  });

  it('closes', async () => {
    const { user, rail } = await openRail();
    await user.click(within(rail).getByTestId('erd-details-close'));

    expect(screen.queryByTestId('erd-details')).toBeNull();
  });

  it('opens the table’s own object tab', async () => {
    const { user, rail } = await openRail();
    await user.click(within(rail).getByTestId('erd-details-open-object'));

    const opened = tabStore.getState().tabs.find(tab => tab.type === 'object');
    expect(opened).toMatchObject({
      title: 'orders',
      connectionId: 'c1',
      databaseName: 'joinery_test',
    });
    expect(opened?.metadata).toMatchObject({ schema: 'public', objectType: 'table' });
  });

  it('reveals the table in the explorer through the existing command', async () => {
    const revealed: unknown[] = [];
    teardowns.push(
      subscribeCommand('reveal-explorer-node', payload => {
        revealed.push(payload);
      })
    );

    const { user, rail } = await openRail();
    await user.click(within(rail).getByTestId('erd-details-reveal'));

    expect(revealed).toEqual([
      {
        connectionId: 'c1',
        databaseName: 'joinery_test',
        schema: 'public',
        objectName: 'orders',
        objectType: 'table',
      },
    ]);
  });

  it('does NOT reveal on selection — four IPC round trips per click is not what a click means', async () => {
    const revealed: unknown[] = [];
    teardowns.push(
      subscribeCommand('reveal-explorer-node', payload => {
        revealed.push(payload);
      })
    );

    await openRail();

    expect(revealed).toEqual([]);
  });
});

describe('the toolbar', () => {
  it('reports the zoom level', async () => {
    mount(erdTab());
    await waitFor(() => expect(screen.getByTestId('erd-canvas')).toBeTruthy());

    // jsdom reports a 0x0 host, so `fitTransform` returns the identity — 100%.
    expect(screen.getByTestId('erd-zoom-level').textContent).toBe('100%');
  });

  it('zooms in and out', async () => {
    const user = userEvent.setup();
    mount(erdTab());
    await waitFor(() => expect(screen.getByTestId('erd-canvas')).toBeTruthy());

    await user.click(screen.getByTestId('erd-zoom-in'));
    expect(screen.getByTestId('erd-zoom-level').textContent).toBe('120%');

    await user.click(screen.getByTestId('erd-zoom-out'));
    expect(screen.getByTestId('erd-zoom-level').textContent).toBe('100%');
  });

  it('resets the zoom', async () => {
    const user = userEvent.setup();
    mount(erdTab());
    await waitFor(() => expect(screen.getByTestId('erd-canvas')).toBeTruthy());

    await user.click(screen.getByTestId('erd-zoom-in'));
    await user.click(screen.getByTestId('erd-zoom-reset'));

    expect(screen.getByTestId('erd-zoom-level').textContent).toBe('100%');
  });

  it('writes the transform onto the content group rather than through a React prop', async () => {
    const user = userEvent.setup();
    mount(erdTab());
    await waitFor(() => expect(screen.getByTestId('erd-canvas')).toBeTruthy());

    await user.click(screen.getByTestId('erd-zoom-in'));

    // The imperative write is the perf posture for 200 tables; if it regressed to a prop, React
    // would overwrite it with the throttled value and this would be the identity transform.
    const group = screen.getByTestId('erd-canvas').querySelector('svg > g');
    expect(group?.getAttribute('transform')).toContain('scale(1.2)');
  });

  it('refreshes by rebuilding the diagram', async () => {
    const user = userEvent.setup();
    mount(erdTab());
    await waitFor(() => expect(screen.getByTestId('erd-canvas')).toBeTruthy());
    const before = bridge.columnCalls.length;

    await user.click(screen.getByTestId('erd-refresh'));

    await waitFor(() => expect(bridge.columnCalls.length).toBeGreaterThan(before));
  });
});

describe('the gesture surface attaches to a canvas that mounts late', () => {
  /**
   * The regression this pins cost two e2e failures and is invisible in a happy-path render.
   *
   * `useErdViewport` is called by the PANEL and its host ref is attached by the CANVAS, which the panel
   * does not render until the schema resolves. With a ref object, every effect in the hook ran once —
   * during the spinner, with a null ref — returned early, and never re-ran: no `ResizeObserver`, so the
   * viewport stayed 0×0 and fit-on-load did nothing, and no wheel listener, so the diagram could not be
   * zoomed by wheel or trackpad at all. A callback ref is the fix, and this is the test that keeps it.
   */
  it('zooms on a wheel event delivered after the canvas appeared', async () => {
    mount(erdTab());
    // The spinner first, which is the whole point: the host does not exist yet.
    expect(screen.getByTestId('erd-loading')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('erd-canvas')).toBeTruthy());

    screen
      .getByTestId('erd-canvas')
      .dispatchEvent(
        new WheelEvent('wheel', { deltaY: -300, clientX: 40, clientY: 40, bubbles: true })
      );

    await waitFor(() => expect(screen.getByTestId('erd-zoom-level').textContent).not.toBe('100%'));
  });
});

describe('double-clicking a node', () => {
  it('opens its object tab', async () => {
    const user = userEvent.setup();
    mount(erdTab());
    await waitFor(() => expect(screen.getByTestId('erd-canvas')).toBeTruthy());

    const items = screen
      .getAllByTestId('erd-node')
      .find(element => element.getAttribute('data-erd-node-id') === 'public.order_items');
    if (items !== undefined) await user.dblClick(items);

    expect(tabStore.getState().tabs.find(tab => tab.type === 'object')?.title).toBe('order_items');
  });
});

describe('a truncated diagram', () => {
  it('says the diagram is partial', async () => {
    const many: ObjectMetadata[] = Array.from({ length: 405 }, (_value, index) => ({
      name: `t${index}`,
      type: 'table',
      schema: 'public',
    }));
    teardowns.push(
      installJoineryMock({
        explorer: {
          getChildren: async () => many,
          getTableColumns: async () => [],
          getTableKeys: async () => [],
        },
      })
    );

    mount(erdTab());

    await waitFor(() => expect(screen.getByTestId('erd-truncated')).toBeTruthy(), {
      timeout: 10_000,
    });
    expect(screen.getByTestId('erd-truncated').textContent).toContain('400');
  });
});

describe('two ERD tabs', () => {
  it('each reads its own tab’s database, never the active one', async () => {
    const databases: string[] = [];
    teardowns.push(
      installJoineryMock({
        explorer: {
          getChildren: async (_connectionId: string, database: string) => {
            databases.push(database);
            return [{ name: 'only', type: 'table', schema: 'public' }] satisfies ObjectMetadata[];
          },
          getTableColumns: async () => [],
          getTableKeys: async () => [],
        },
      })
    );

    render(
      <TooltipProvider>
        <ErdSurface tab={erdTab({ id: 'a', databaseName: 'db_a' })} />
        <ErdSurface tab={erdTab({ id: 'b', databaseName: 'db_b' })} />
      </TooltipProvider>
    );

    await waitFor(() => expect(databases.length).toBeGreaterThanOrEqual(2));
    expect([...databases].sort()).toEqual(['db_a', 'db_b']);
  });
});
