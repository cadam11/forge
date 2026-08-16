/**
 * `mapExplorerTree` on its own — the store-shape → primitive-shape translation.
 *
 * Worth its own tests rather than only being exercised through the mounted sidebar, because two of
 * its properties are invisible in a rendered tree and both are load-bearing:
 *
 *  - `children: undefined` versus `children: []`. The primitive reads the first as "not fetched"
 *    and the second as "fetched and empty"; collapsing the two would either make a loaded-empty
 *    folder look expandable forever or make an unfetched one look like a leaf.
 *  - expansion comes from `node.isExpanded`, not from the store's `expandedNodeIds` set. The two
 *    can disagree, and the test below is the disagreement.
 */

import { describe, expect, it } from 'vitest';
import { mapExplorerTree } from './explorer-tree';
import type { TreeNode as ExplorerNode } from '../../state/explorer';

function node(partial: Partial<ExplorerNode> & Pick<ExplorerNode, 'id' | 'name'>): ExplorerNode {
  return {
    type: 'folder',
    icon: 'folder',
    path: partial.name,
    hasChildren: false,
    isExpanded: false,
    isLoading: false,
    ...partial,
  };
}

describe('mapExplorerTree', () => {
  it('keeps an unfetched expandable node expandable and childless', () => {
    const { nodes } = mapExplorerTree([
      node({ id: 'server-a', name: 'Server A', type: 'server', hasChildren: true }),
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.hasChildren).toBe(true);
    // Not `[]`: an empty array would tell the primitive the fetch has happened and returned nothing.
    expect(nodes[0]?.children).toBeUndefined();
  });

  it('distinguishes a fetched-empty folder from an unfetched one', () => {
    const { nodes } = mapExplorerTree([
      node({ id: 'f1', name: 'Views', hasChildren: true, children: [] }),
      node({ id: 'f2', name: 'Tables', hasChildren: true }),
    ]);

    expect(nodes[0]?.children).toEqual([]);
    expect(nodes[1]?.children).toBeUndefined();
  });

  it('reads expansion from the per-node flag the store always maintains', () => {
    // The divergence: `refreshNode` sets `isExpanded: true` without adding the id to
    // `expandedNodeIds` (state/explorer.ts), and `renameDatabaseNodeLocal` clears the flag while
    // leaving the id in the set. Reading the flag is what makes both cases render correctly.
    const { expandedIds } = mapExplorerTree([
      node({
        id: 'db-1',
        name: 'joinery_test',
        type: 'database',
        hasChildren: true,
        isExpanded: true,
        children: [node({ id: 'schema-1', name: 'public', type: 'schema', hasChildren: true })],
      }),
    ]);

    expect([...expandedIds]).toEqual(['db-1']);
  });

  it('collects the ids whose children are in flight, at any depth', () => {
    const { loadingIds } = mapExplorerTree([
      node({
        id: 'server-a',
        name: 'Server A',
        type: 'server',
        hasChildren: true,
        isExpanded: true,
        children: [
          node({ id: 'db-1', name: 'one', type: 'database', hasChildren: true, isLoading: true }),
          node({ id: 'db-2', name: 'two', type: 'database', hasChildren: true }),
        ],
      }),
    ]);

    expect([...loadingIds]).toEqual(['db-1']);
  });

  it('indexes every node it visited so a row can find its own store node', () => {
    const { byId } = mapExplorerTree([
      node({
        id: 'server-a',
        name: 'Server A',
        type: 'server',
        hasChildren: true,
        isExpanded: true,
        children: [node({ id: 'db-1', name: 'one', type: 'database', hasChildren: true })],
      }),
    ]);

    expect([...byId.keys()].sort()).toEqual(['db-1', 'server-a']);
    expect(byId.get('db-1')?.type).toBe('database');
  });

  it('puts a loaded child count in the metadata slot for folders only', () => {
    const { nodes } = mapExplorerTree([
      node({
        id: 'folder-tables',
        name: 'Tables',
        type: 'folder',
        hasChildren: true,
        isExpanded: true,
        children: [
          node({ id: 'obj-1', name: 'orders', type: 'table', hasChildren: true }),
          node({ id: 'obj-2', name: 'customers', type: 'table', hasChildren: true }),
        ],
      }),
    ]);

    expect(nodes[0]?.meta).toBe('2');
    // A count next to a table name would read as a row count, which it is not.
    expect(nodes[0]?.children?.[0]?.meta).toBeUndefined();
  });

  it('marks a primary-key column with a different glyph from an ordinary one', () => {
    const { nodes } = mapExplorerTree([
      node({
        id: 'columns',
        name: 'Columns',
        type: 'columns_folder',
        hasChildren: true,
        isExpanded: true,
        children: [
          node({
            id: 'col-id',
            name: 'id',
            type: 'column',
            columnInfo: { name: 'id', isPrimaryKey: true } as ExplorerNode['columnInfo'],
          }),
          node({ id: 'col-name', name: 'name', type: 'column' }),
        ],
      }),
    ]);

    const [pk, plain] = nodes[0]?.children ?? [];
    expect(pk?.icon).toBeDefined();
    expect(plain?.icon).toBeDefined();
    expect(pk?.icon).not.toBe(plain?.icon);
  });

  it('stops descending at the depth cap rather than following a cycle forever', () => {
    // A parent that lists itself as its own child is what a buggy loader would produce; the cap is
    // the "bound every loop" guard, and hitting it must terminate rather than blow the stack.
    const cyclic: ExplorerNode = node({
      id: 'loop',
      name: 'loop',
      hasChildren: true,
      isExpanded: true,
    });
    (cyclic as { children?: readonly ExplorerNode[] }).children = [cyclic];

    const { nodes } = mapExplorerTree([cyclic]);

    let depth = 0;
    let cursor = nodes[0];
    while (cursor?.children?.[0] !== undefined && depth < 100) {
      cursor = cursor.children[0];
      depth += 1;
    }
    expect(depth).toBeLessThan(32);
    expect(cursor?.children).toBeUndefined();
  });
});
