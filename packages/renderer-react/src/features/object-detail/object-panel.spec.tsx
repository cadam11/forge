/**
 * The object tab, mounted the way Dockview mounts it.
 *
 * Two properties are what this file exists for, and both were defects in the surface it replaces:
 *
 *  - **a failed read is not an empty object.** Angular's loader turned every rejection into `[]`, so a
 *    permissions error rendered "No columns found";
 *  - **two object tabs are two results.** The Angular component was a singleton keyed on the ACTIVE tab
 *    with a `loadedTabId` field as its cache, so opening a second object tab refetched and the first
 *    tab's data was gone.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IDockviewPanelProps } from 'dockview-react';
import type { ForeignKeyInfo, IndexInfo, ObjectDefinition } from '@joinery/shared';

import { IpcQueryProvider } from '../../ipc';
import { TooltipProvider } from '../../ui';
import { connectionStore } from '../../state/connection';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { tabStore } from '../../state/tab';
import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import type { EnrichedColumn } from '../query/fk-lookup';
import { ObjectPanel } from './object-panel';

const CONNECTION = 'conn-1';

const COLUMNS: EnrichedColumn[] = [
  {
    name: 'id',
    type: 'int',
    nullable: false,
    maxLength: null,
    precision: null,
    scale: null,
    isPrimaryKey: true,
    isIdentity: true,
    defaultValue: null,
    foreignKey: null,
  },
  {
    name: 'customer_id',
    type: 'int',
    nullable: true,
    maxLength: null,
    precision: null,
    scale: null,
    isPrimaryKey: false,
    isIdentity: false,
    defaultValue: null,
    foreignKey: {
      referencedSchema: 'public',
      referencedTable: 'customers',
      referencedColumn: 'id',
      constraintName: 'fk_orders_customer',
    },
  },
];

const INDEXES: IndexInfo[] = [
  { name: 'pk_orders', type: 'clustered', columns: ['id'], isUnique: true, isPrimaryKey: true },
];

const KEYS: ForeignKeyInfo[] = [
  {
    name: 'fk_orders_customer',
    columns: ['customer_id'],
    referencedSchema: 'public',
    referencedTable: 'customers',
    referencedColumns: ['id'],
    onDelete: 'cascade',
  },
];

const teardowns: (() => void)[] = [];
let columnCalls = 0;

interface BridgeOptions {
  readonly columnsFail?: boolean;
  readonly columns?: EnrichedColumn[];
  readonly definition?: string;
}

function installBridge(options: BridgeOptions = {}): void {
  columnCalls = 0;
  teardowns.push(
    installJoineryMock({
      explorer: {
        getEnrichedColumns: () => {
          columnCalls += 1;
          if (options.columnsFail === true) {
            return Promise.reject(new Error('permission denied for relation orders'));
          }
          return Promise.resolve(options.columns ?? COLUMNS);
        },
        getTableIndexes: () => Promise.resolve(INDEXES),
        getTableKeys: () => Promise.resolve(KEYS),
        getDefinition: () =>
          Promise.resolve({
            objectType: 'view',
            schema: 'public',
            name: 'v_orders',
            definition: options.definition ?? 'CREATE VIEW v_orders AS SELECT 1',
          } as ObjectDefinition),
        scriptTableAsCreate: () => Promise.resolve('CREATE TABLE orders (id int)'),
      },
    })
  );
}

/** Dockview mounts a panel with `params.tabId` and nothing else. */
function panelProps(tabId: string): IDockviewPanelProps {
  return { params: { tabId }, api: { id: tabId } } as unknown as IDockviewPanelProps;
}

function mountPanel(tabId: string) {
  return render(
    <IpcQueryProvider>
      <TooltipProvider>
        <ObjectPanel {...panelProps(tabId)} />
      </TooltipProvider>
    </IpcQueryProvider>
  );
}

function openObjectTab(name: string, type = 'table'): string {
  return tabStore.getState().openObjectTab(CONNECTION, 'sales', name, type, 'public');
}

/** The visible table's cells, row by row. */
function rowCells(): string[][] {
  return screen
    .getAllByTestId('object-detail-row')
    .map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent ?? ''));
}

beforeEach(() => {
  teardowns.push(
    setDiagnosticsSink({ error: () => undefined, warn: () => undefined }),
    setNotifier({
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warning: () => undefined,
    })
  );
  tabStore.setState({ tabs: [], activeTabId: '' });
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  tabStore.setState({ tabs: [], activeTabId: '' });
  connectionStore.setState({ profiles: [], connectedProfileIds: new Set() });
});

describe('the object tab', () => {
  it('names the object and shows its real columns', async () => {
    installBridge();
    const tabId = openObjectTab('orders');
    mountPanel(tabId);

    expect(screen.getByTestId('object-title').textContent).toBe('public.orders');
    expect(screen.getByTestId('object-type').textContent).toBe('table');

    await waitFor(() => expect(screen.getAllByTestId('object-detail-row')).toHaveLength(2));
    const cells = rowCells();
    expect(cells[0]).toEqual(['id', 'int', 'no', 'PK · identity', '', '']);
    // The two facts the Angular tab could not show at all.
    expect(cells[1]).toEqual(['customer_id', 'int', 'yes', '', '', 'public.customers.id']);
  });

  it('counts the rows in each tab label', async () => {
    installBridge();
    mountPanel(openObjectTab('orders'));

    await waitFor(() =>
      expect(screen.getByTestId('object-tab-columns').textContent).toContain('2')
    );
    expect(screen.getByTestId('object-tab-indexes').textContent).toContain('1');
    expect(screen.getByTestId('object-tab-keys').textContent).toContain('1');
  });

  it('shows the indexes and the foreign keys on their own tabs', async () => {
    installBridge();
    mountPanel(openObjectTab('orders'));
    await waitFor(() => expect(screen.getAllByTestId('object-detail-row')).toHaveLength(2));

    await userEvent.click(screen.getByTestId('object-tab-indexes'));
    await waitFor(() =>
      expect(rowCells()[0]).toEqual(['pk_orders', 'clustered · primary', 'id', 'yes'])
    );

    await userEvent.click(screen.getByTestId('object-tab-keys'));
    // A whole constraint with its referential action — which per-column FK badges cannot express.
    await waitFor(() =>
      expect(rowCells()[0]).toEqual([
        'fk_orders_customer',
        'customer_id',
        'public.customers (id)',
        'ON DELETE CASCADE',
      ])
    );
  });

  it('reports a failed read as a failure, not as an object with no columns', async () => {
    installBridge({ columnsFail: true });
    mountPanel(openObjectTab('orders'));

    const failure = await screen.findByTestId('object-columns-error');
    expect(failure.textContent).toContain('permission denied for relation orders');
    // And NOT the empty state, which is what Angular showed for this.
    expect(screen.queryByTestId('object-columns-empty')).toBeNull();
  });

  it('says "no columns" when the catalogue really has none', async () => {
    installBridge({ columns: [] });
    mountPanel(openObjectTab('orders'));

    await screen.findByTestId('object-columns-empty');
    expect(screen.queryByTestId('object-columns-error')).toBeNull();
  });

  it('offers no Definition tab for a table, and no Columns tab for a procedure', async () => {
    installBridge();
    const { unmount } = mountPanel(openObjectTab('orders', 'table'));
    expect(screen.queryByTestId('object-tab-definition')).toBeNull();
    unmount();

    mountPanel(openObjectTab('sp_rebuild', 'procedure'));
    expect(screen.queryByTestId('object-tab-columns')).toBeNull();
    expect(screen.getByTestId('object-tab-definition')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('object-definition-sql').textContent).toContain('CREATE VIEW')
    );
  });

  it('does not fetch columns for an object type that has none', async () => {
    installBridge();
    mountPanel(openObjectTab('sp_rebuild', 'procedure'));
    await screen.findByTestId('object-definition-sql');
    expect(columnCalls).toBe(0);
  });

  it('holds one result per object rather than one for the active tab', async () => {
    // The Angular singleton refetched on every switch and could only hold the active tab's data.
    //
    // ONE provider across the three mounts, because that is the app: `IpcQueryProvider` builds its
    // client on mount, so a fresh provider per mount would prove nothing about the cache either way.
    installBridge();
    const orders = openObjectTab('orders');
    const customers = openObjectTab('customers');

    const { rerender } = render(
      <IpcQueryProvider>
        <TooltipProvider>
          <ObjectPanel {...panelProps(orders)} />
        </TooltipProvider>
      </IpcQueryProvider>
    );
    await waitFor(() => expect(columnCalls).toBe(1));

    const show = (tabId: string) =>
      rerender(
        <IpcQueryProvider>
          <TooltipProvider>
            <ObjectPanel {...panelProps(tabId)} />
          </TooltipProvider>
        </IpcQueryProvider>
      );

    show(customers);
    await waitFor(() => expect(columnCalls).toBe(2));

    // Back to the first: served from the query cache, so no third round trip.
    show(orders);
    await waitFor(() => expect(screen.getAllByTestId('object-detail-row')).toHaveLength(2));
    expect(columnCalls).toBe(2);
  });

  it('re-reads on Refresh', async () => {
    installBridge();
    mountPanel(openObjectTab('orders'));
    await waitFor(() => expect(columnCalls).toBe(1));

    await userEvent.click(screen.getByTestId('object-refresh'));
    await waitFor(() => expect(columnCalls).toBe(2));
  });

  it('says so when the tab has lost its object rather than fetching with empty strings', () => {
    installBridge();
    const tabId = tabStore.getState().openQueryTab(CONNECTION, 'sales');
    mountPanel(tabId);

    expect(screen.getByTestId('panel-object').textContent).toContain('No object');
    expect(columnCalls).toBe(0);
  });
});
