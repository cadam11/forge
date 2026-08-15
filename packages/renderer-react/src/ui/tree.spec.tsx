import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Table2 } from 'lucide-react';

import { ContextMenuContent, ContextMenuItem } from './context-menu';
import { setDiagnosticsSink } from '../state/diagnostics';
import { flattenTree, Tree, type TreeNode } from './tree';

/**
 * The tree is virtualized, keyboard-driven and controlled, and each of those three is a way to
 * be subtly broken:
 *
 * - virtualized: if the virtualizer measures 0 rows, everything below renders nothing and every
 *   assertion that only looked for absence would pass. So the first test here counts rows.
 * - keyboard: `aria-activedescendant` is the observable, not `document.activeElement` — the
 *   tree keeps a single tabstop on its scroll container precisely because a focused row can be
 *   unmounted at any scroll position.
 * - controlled: expansion is a callback, so ArrowRight is asserted as "asked its owner to
 *   expand", not as "expanded itself".
 */

const NODES: readonly TreeNode[] = [
  {
    id: 'server',
    label: 'localhost',
    hasChildren: true,
    children: [
      {
        id: 'db',
        label: 'analytics',
        hasChildren: true,
        children: [
          { id: 'table-a', label: 'dim_customer', icon: Table2, meta: '18.4k' },
          { id: 'table-b', label: 'fact_order', icon: Table2 },
        ],
      },
      { id: 'lazy', label: 'staging', hasChildren: true },
    ],
  },
];

function activeDescendant(): string | null {
  return screen.getByRole('tree').getAttribute('aria-activedescendant');
}

function rowLabels(): string[] {
  return screen.getAllByTestId('tree-row').map(row => row.getAttribute('data-node-id') ?? '');
}

interface HarnessProps {
  readonly initialExpanded?: readonly string[];
  readonly onSelect?: (node: TreeNode) => void;
  readonly onActivate?: (node: TreeNode) => void;
  readonly onExpandedChange?: (id: string, expanded: boolean) => void;
  readonly loadingIds?: ReadonlySet<string>;
  readonly withContextMenu?: boolean;
}

/** Controlled, like the real explorer: the harness owns expansion and selection. */
function TreeHarness({
  initialExpanded = ['server', 'db'],
  onSelect,
  onActivate,
  onExpandedChange,
  loadingIds,
  withContextMenu = false,
}: HarnessProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(initialExpanded)
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  return (
    <Tree
      aria-label="Object explorer"
      data-testid="tree"
      nodes={NODES}
      expandedIds={expandedIds}
      loadingIds={loadingIds}
      selectedId={selectedId}
      onSelect={node => {
        setSelectedId(node.id);
        onSelect?.(node);
      }}
      onActivate={onActivate}
      onExpandedChange={(id, expanded) => {
        onExpandedChange?.(id, expanded);
        setExpandedIds(current => {
          const next = new Set(current);
          if (expanded) {
            next.add(id);
          } else {
            next.delete(id);
          }
          return next;
        });
      }}
      renderContextMenu={
        withContextMenu
          ? node =>
              node.id === 'table-a' ? (
                <ContextMenuContent>
                  <ContextMenuItem>Select top 1000</ContextMenuItem>
                </ContextMenuContent>
              ) : null
          : undefined
      }
    />
  );
}

describe('flattenTree', () => {
  it('shows only the roots when nothing is expanded', () => {
    const rows = flattenTree(NODES, new Set());

    expect(rows).toHaveLength(1);
    expect(rows[0]?.node.id).toBe('server');
    expect(rows[0]?.expandable).toBe(true);
    expect(rows[0]?.expanded).toBe(false);
    expect(rows[0]?.parentId).toBeUndefined();
  });

  it('walks depth-first in the caller’s order', () => {
    const rows = flattenTree(NODES, new Set(['server', 'db']));

    expect(rows.map(row => row.node.id)).toEqual(['server', 'db', 'table-a', 'table-b', 'lazy']);
    expect(rows.map(row => row.depth)).toEqual([0, 1, 2, 2, 1]);
  });

  it('records the parent, which is what ArrowLeft walks up', () => {
    const rows = flattenTree(NODES, new Set(['server', 'db']));

    expect(rows.find(row => row.node.id === 'table-a')?.parentId).toBe('db');
    expect(rows.find(row => row.node.id === 'lazy')?.parentId).toBe('server');
  });

  it('treats a node with unfetched children as expandable but yields no rows for them', () => {
    const rows = flattenTree(NODES, new Set(['server', 'lazy']));

    const lazy = rows.find(row => row.node.id === 'lazy');
    expect(lazy?.expandable).toBe(true);
    expect(lazy?.expanded).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it('infers expandability from loaded children when hasChildren is absent', () => {
    const nodes: readonly TreeNode[] = [
      { id: 'parent', label: 'p', children: [{ id: 'child', label: 'c' }] },
      { id: 'leaf', label: 'l' },
    ];
    const rows = flattenTree(nodes, new Set());

    expect(rows[0]?.expandable).toBe(true);
    expect(rows[1]?.expandable).toBe(false);
  });
});

describe('flattenTree — the depth cap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops at the cap and reports it instead of flattening forever', () => {
    const warn = vi.fn();
    const restore = setDiagnosticsSink({ error: vi.fn(), warn });

    // 40 levels, all expanded. A cycle in the caller's data looks exactly like this.
    let deepest: TreeNode = { id: 'node-39', label: 'leaf' };
    const expanded = new Set<string>(['node-39']);
    for (let level = 38; level >= 0; level -= 1) {
      deepest = { id: `node-${level}`, label: `level ${level}`, children: [deepest] };
      expanded.add(`node-${level}`);
    }

    const rows = flattenTree([deepest], expanded);

    expect(rows).toHaveLength(32);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('depth 32');
    restore();
  });
});

describe('Tree — rendering', () => {
  it('renders its rows at all', () => {
    render(<TreeHarness />);

    // If this ever returns [], every negative assertion in this file becomes vacuous. It is
    // load-bearing on the layout shim in `test/setup.ts`: jsdom reports every element as 0px
    // tall and the virtualizer believes it.
    expect(rowLabels()).toEqual(['server', 'db', 'table-a', 'table-b', 'lazy']);
  });

  it('exposes the ARIA tree shape', () => {
    render(<TreeHarness />);

    const tree = screen.getByRole('tree');
    expect(tree.getAttribute('aria-label')).toBe('Object explorer');
    expect(tree.getAttribute('tabindex')).toBe('0');

    const rows = screen.getAllByTestId('tree-row');
    expect(rows[0]?.getAttribute('aria-level')).toBe('1');
    expect(rows[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(rows[2]?.getAttribute('aria-level')).toBe('3');
    // A leaf carries no aria-expanded at all, rather than aria-expanded="false".
    expect(rows[2]?.getAttribute('aria-expanded')).toBeNull();
  });

  it('shows a spinner in place of the twisty while children load', () => {
    render(<TreeHarness loadingIds={new Set(['lazy'])} />);

    expect(screen.getByTestId('tree-row-loading')).toBeDefined();
    const lazyRow = screen.getAllByTestId('tree-row').at(-1);
    expect(lazyRow?.querySelector('[data-testid="tree-row-twisty"]')).toBeNull();
  });

  it('truncates long labels rather than pushing the metadata out of the rail', () => {
    render(<TreeHarness />);

    const label = screen
      .getAllByTestId('tree-row')[2]
      ?.querySelector('[data-testid="tree-row-label"]');
    expect(label?.className).toContain('truncate');
    expect(label?.className).toContain('min-w-0');
  });
});

describe('Tree — keyboard', () => {
  it('starts on the first row and walks down', async () => {
    render(<TreeHarness />);
    screen.getByRole('tree').focus();

    await userEvent.keyboard('{ArrowDown}');
    expect(activeDescendant()).toBe('tree-row-db');

    await userEvent.keyboard('{ArrowDown}');
    expect(activeDescendant()).toBe('tree-row-table-a');
  });

  it('walks back up and stops at the top', async () => {
    render(<TreeHarness />);
    screen.getByRole('tree').focus();

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(activeDescendant()).toBe('tree-row-db');

    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(activeDescendant()).toBe('tree-row-server');
  });

  it('jumps to the ends with Home and End', async () => {
    render(<TreeHarness />);
    screen.getByRole('tree').focus();

    await userEvent.keyboard('{End}');
    expect(activeDescendant()).toBe('tree-row-lazy');

    await userEvent.keyboard('{Home}');
    expect(activeDescendant()).toBe('tree-row-server');
  });

  it('asks its owner to expand a collapsed row with ArrowRight', async () => {
    const onExpandedChange = vi.fn();
    render(<TreeHarness initialExpanded={['server']} onExpandedChange={onExpandedChange} />);
    screen.getByRole('tree').focus();

    // server, then db (collapsed).
    await userEvent.keyboard('{ArrowDown}{ArrowRight}');

    expect(onExpandedChange).toHaveBeenCalledWith('db', true);
    expect(rowLabels()).toContain('table-a');
  });

  it('steps into an already-expanded row with ArrowRight', async () => {
    const onExpandedChange = vi.fn();
    render(<TreeHarness onExpandedChange={onExpandedChange} />);
    screen.getByRole('tree').focus();

    // 'db' is already expanded, so ArrowRight moves rather than toggling.
    await userEvent.keyboard('{ArrowDown}{ArrowRight}');

    expect(activeDescendant()).toBe('tree-row-table-a');
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it('collapses an expanded row with ArrowLeft', async () => {
    const onExpandedChange = vi.fn();
    render(<TreeHarness onExpandedChange={onExpandedChange} />);
    screen.getByRole('tree').focus();

    await userEvent.keyboard('{ArrowDown}{ArrowLeft}');

    expect(onExpandedChange).toHaveBeenCalledWith('db', false);
    expect(rowLabels()).not.toContain('table-a');
  });

  it('walks to the parent with ArrowLeft on a leaf', async () => {
    render(<TreeHarness />);
    screen.getByRole('tree').focus();

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowLeft}');

    expect(activeDescendant()).toBe('tree-row-db');
  });

  it('does nothing on ArrowRight at a leaf', async () => {
    const onExpandedChange = vi.fn();
    render(<TreeHarness onExpandedChange={onExpandedChange} />);
    screen.getByRole('tree').focus();

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}');

    expect(onExpandedChange).not.toHaveBeenCalled();
    expect(activeDescendant()).toBe('tree-row-table-a');
  });

  it('selects with Space and activates with Enter', async () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    render(<TreeHarness onSelect={onSelect} onActivate={onActivate} />);
    screen.getByRole('tree').focus();

    await userEvent.keyboard('{ArrowDown}{ArrowDown} ');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'table-a' }));
    expect(onActivate).not.toHaveBeenCalled();

    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'table-a' }));
  });

  it('does not move focus by moving selection', async () => {
    const onSelect = vi.fn();
    render(<TreeHarness onSelect={onSelect} />);
    screen.getByRole('tree').focus();

    await userEvent.keyboard('{ArrowDown}{ArrowDown}');

    // Focus and selection are separate: arrows move focus only, so nothing is selected yet.
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('Tree — pointer', () => {
  it('selects on a row click', async () => {
    const onSelect = vi.fn();
    render(<TreeHarness onSelect={onSelect} />);

    await userEvent.click(screen.getAllByTestId('tree-row')[2]!);

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'table-a' }));
    expect(screen.getAllByTestId('tree-row')[2]?.getAttribute('aria-selected')).toBe('true');
  });

  it('toggles on a twisty click without selecting', async () => {
    const onSelect = vi.fn();
    const onExpandedChange = vi.fn();
    render(<TreeHarness onSelect={onSelect} onExpandedChange={onExpandedChange} />);

    const dbRow = screen.getAllByTestId('tree-row')[1]!;
    await userEvent.click(dbRow.querySelector('[data-testid="tree-row-twisty"]')!);

    expect(onExpandedChange).toHaveBeenCalledWith('db', false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('activates on a double click', async () => {
    const onActivate = vi.fn();
    render(<TreeHarness onActivate={onActivate} />);

    await userEvent.dblClick(screen.getAllByTestId('tree-row')[2]!);

    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'table-a' }));
  });

  it('ignores clicks on a disabled row', async () => {
    const onSelect = vi.fn();
    const nodes: readonly TreeNode[] = [{ id: 'locked', label: 'restricted', disabled: true }];
    render(
      <Tree
        aria-label="Explorer"
        nodes={nodes}
        expandedIds={new Set()}
        onExpandedChange={vi.fn()}
        onSelect={onSelect}
      />
    );

    await userEvent.click(screen.getByTestId('tree-row'));

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId('tree-row').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Tree — context menus', () => {
  it('opens the caller’s menu on the rows that have one', async () => {
    render(<TreeHarness withContextMenu />);

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.contextMenu(screen.getAllByTestId('tree-row')[2]!);

    expect(screen.getByRole('menuitem', { name: 'Select top 1000' })).toBeDefined();
  });

  it('opens nothing on the rows that return null', async () => {
    render(<TreeHarness withContextMenu />);

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.contextMenu(screen.getAllByTestId('tree-row')[3]!);

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps every row a direct child of the tree, menu or not', () => {
    render(<TreeHarness withContextMenu />);

    // The context-menu wrapper must not add an element between the tree and its treeitems, or
    // the tree's ownership of them breaks.
    const sizer = screen.getAllByTestId('tree-row')[0]?.parentElement;
    expect(sizer?.getAttribute('role')).toBe('presentation');
    expect(sizer?.parentElement?.getAttribute('role')).toBe('tree');
    for (const row of screen.getAllByTestId('tree-row')) {
      expect(row.parentElement).toBe(sizer);
    }
  });
});
