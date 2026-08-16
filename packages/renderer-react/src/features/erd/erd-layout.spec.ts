/**
 * Layout determinism, node geometry and the two cases the Angular hand-rolled layout got wrong.
 *
 * The determinism assertions are the load-bearing ones: a diagram whose boxes move when you press
 * refresh is not a diagram, and dagre is only deterministic if the insertion order is — which is why
 * `layoutErd` sorts. Both halves are asserted: same input twice, and the same schema shuffled.
 */

import { describe, expect, it } from 'vitest';

import {
  edgePath,
  erdNodeHeight,
  erdNodeRows,
  HEADER_HEIGHT,
  layoutErd,
  MAX_NODE_HEIGHT,
  MAX_NODE_ROWS,
  NODE_WIDTH,
  ROW_HEIGHT,
  topRoundedRectPath,
  truncateLabel,
} from './erd-layout';
import type { ErdField, ErdNode } from './erd-model';

function field(overrides: Partial<ErdField> & { name: string }): ErdField {
  return {
    id: `n.${overrides.name}`,
    type: 'integer',
    isPrimaryKey: false,
    allowsNull: true,
    autoIncrement: false,
    ...overrides,
  };
}

function table(id: string, fields: readonly ErdField[]): ErdNode {
  const dot = id.indexOf('.');
  return {
    id,
    name: id.slice(dot + 1),
    schemaName: id.slice(0, dot),
    fields: fields.map(f => ({ ...f, id: `${id}.${f.name}` })),
  };
}

/** order_items → orders → customers, order_items → products. The seeded PostgreSQL fixture. */
const SEEDED: readonly ErdNode[] = [
  table('public.products', [field({ name: 'id', isPrimaryKey: true }), field({ name: 'sku' })]),
  table('public.customers', [field({ name: 'id', isPrimaryKey: true }), field({ name: 'email' })]),
  table('public.orders', [
    field({ name: 'id', isPrimaryKey: true }),
    field({
      name: 'customer_id',
      relatedNodeId: 'public.customers',
      relatedNodeName: 'customers',
      relatedFieldName: 'id',
    }),
    field({ name: 'status' }),
  ]),
  table('public.order_items', [
    field({ name: 'id', isPrimaryKey: true }),
    field({
      name: 'order_id',
      relatedNodeId: 'public.orders',
      relatedNodeName: 'orders',
      relatedFieldName: 'id',
    }),
    field({
      name: 'product_id',
      relatedNodeId: 'public.products',
      relatedNodeName: 'products',
      relatedFieldName: 'id',
    }),
  ]),
];

describe('erdNodeRows', () => {
  it('lists primary keys first, then foreign keys', () => {
    const rows = erdNodeRows(SEEDED[3] as ErdNode);
    expect(rows.map(row => (row.kind === 'more' ? 'more' : `${row.kind}:${row.name}`))).toEqual([
      'pk:id',
      'fk:order_id',
      'fk:product_id',
    ]);
  });

  it('counts the columns it did not show', () => {
    const rows = erdNodeRows(SEEDED[2] as ErdNode);
    // orders has 3 columns; id and customer_id are keys, status is not.
    expect(rows.at(-1)).toEqual({ kind: 'more', hidden: 1 });
  });

  it('shows nothing but a count for a table with no keys at all', () => {
    const rows = erdNodeRows(table('dbo.log', [field({ name: 'message' })]));
    expect(rows).toEqual([{ kind: 'more', hidden: 1 }]);
  });

  it('never exceeds the row budget the max height allows, and says how many it dropped', () => {
    const keys = Array.from({ length: MAX_NODE_ROWS + 8 }, (_value, index) =>
      field({ name: `k${index}`, isPrimaryKey: true })
    );
    const rows = erdNodeRows(table('dbo.wide', keys));

    expect(rows).toHaveLength(MAX_NODE_ROWS);
    // The last slot is spent on the count, so MAX_NODE_ROWS - 1 keys are named.
    expect(rows.at(-1)).toEqual({ kind: 'more', hidden: keys.length - (MAX_NODE_ROWS - 1) });
  });

  it('carries the FK target name, for the diagram to label a row with', () => {
    const rows = erdNodeRows(SEEDED[3] as ErdNode);
    const fk = rows.find(row => row.kind === 'fk');
    expect(fk).toMatchObject({ target: 'orders' });
  });
});

describe('erdNodeHeight', () => {
  it('is header + padding + rows', () => {
    expect(erdNodeHeight(3)).toBe(HEADER_HEIGHT + 8 + 3 * ROW_HEIGHT);
  });

  it('is one row tall for an empty table rather than a sliver', () => {
    expect(erdNodeHeight(0)).toBe(erdNodeHeight(1));
  });

  it('never exceeds the max height, which is the clamp the original applied to the box but not the rows', () => {
    expect(erdNodeHeight(500)).toBeLessThanOrEqual(MAX_NODE_HEIGHT);
  });
});

describe('layoutErd', () => {
  it('is empty for an empty schema', () => {
    expect(layoutErd([])).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
  });

  it('places every node and reports the diagram extent', () => {
    const layout = layoutErd(SEEDED);

    expect(layout.nodes).toHaveLength(4);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    for (const node of layout.nodes) {
      expect(node.width).toBe(NODE_WIDTH);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it('gives x/y as the top-left corner, not dagre’s centre', () => {
    const layout = layoutErd([SEEDED[0] as ErdNode]);
    const [only] = layout.nodes;
    // A single node sits at the margin, so its top-left is the margin — a centre would be
    // margin + half the box.
    expect(only?.x).toBe(40);
    expect(only?.y).toBe(40);
  });

  it('routes one edge per foreign key, with at least two points', () => {
    const layout = layoutErd(SEEDED);

    expect(layout.edges.map(edge => edge.link.id).sort()).toEqual([
      'public.order_items.order_id',
      'public.order_items.product_id',
      'public.orders.customer_id',
    ]);
    for (const edge of layout.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('produces identical geometry for the same schema, twice', () => {
    expect(JSON.stringify(layoutErd(SEEDED))).toBe(JSON.stringify(layoutErd(SEEDED)));
  });

  it('produces identical geometry when the same schema arrives in a different order', () => {
    const shuffled = [SEEDED[3], SEEDED[1], SEEDED[0], SEEDED[2]] as ErdNode[];
    const positions = (nodes: readonly ErdNode[]) =>
      layoutErd(nodes)
        .nodes.map(node => `${node.node.id}@${node.x},${node.y}`)
        .sort();

    expect(positions(shuffled)).toEqual(positions(SEEDED));
  });

  it('ranks a chain left to right by default', () => {
    const layout = layoutErd(SEEDED);
    const at = (id: string) => layout.nodes.find(node => node.node.id === id);

    // order_items → orders → customers, so each parent is to the right of its child.
    expect(at('public.orders')?.x ?? 0).toBeGreaterThan(at('public.order_items')?.x ?? 0);
    expect(at('public.customers')?.x ?? 0).toBeGreaterThan(at('public.orders')?.x ?? 0);
  });

  it('ranks top to bottom when asked', () => {
    const layout = layoutErd(SEEDED, { rankDir: 'TB' });
    const at = (id: string) => layout.nodes.find(node => node.node.id === id);

    expect(at('public.orders')?.y ?? 0).toBeGreaterThan(at('public.order_items')?.y ?? 0);
  });

  it('terminates on an FK cycle — the case the hand-rolled BFS re-enqueued forever', () => {
    const cyclic = [
      table('dbo.a', [
        field({ name: 'id', isPrimaryKey: true }),
        field({ name: 'b_id', relatedNodeId: 'dbo.b', relatedFieldName: 'id' }),
      ]),
      table('dbo.b', [
        field({ name: 'id', isPrimaryKey: true }),
        field({ name: 'a_id', relatedNodeId: 'dbo.a', relatedFieldName: 'id' }),
      ]),
    ];

    const layout = layoutErd(cyclic);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(2);
  });

  it('routes a self-reference without dropping it', () => {
    const selfRef = [
      table('dbo.employee', [
        field({ name: 'id', isPrimaryKey: true }),
        field({
          name: 'manager_id',
          relatedNodeId: 'dbo.employee',
          relatedNodeName: 'employee',
          relatedFieldName: 'id',
        }),
      ]),
    ];

    const layout = layoutErd(selfRef);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]?.link.isSelfReference).toBe(true);
    expect((layout.edges[0]?.points.length ?? 0) >= 2).toBe(true);
  });

  it('keeps two foreign keys between the same pair of tables as two edges', () => {
    // The case an unnamed `setEdge` would collapse into one.
    const twice = [
      table('dbo.parent', [field({ name: 'id', isPrimaryKey: true })]),
      table('dbo.child', [
        field({ name: 'id', isPrimaryKey: true }),
        field({ name: 'a_id', relatedNodeId: 'dbo.parent', relatedFieldName: 'id' }),
        field({ name: 'b_id', relatedNodeId: 'dbo.parent', relatedFieldName: 'id' }),
      ]),
    ];

    expect(layoutErd(twice).edges).toHaveLength(2);
  });

  it('draws no edge for a column that is both PK and FK, which is the ported filter', () => {
    const shared = [
      table('dbo.parent', [field({ name: 'id', isPrimaryKey: true })]),
      table('dbo.detail', [
        field({
          name: 'id',
          isPrimaryKey: true,
          relatedNodeId: 'dbo.parent',
          relatedFieldName: 'id',
        }),
      ]),
    ];

    expect(layoutErd(shared).edges).toHaveLength(0);
  });

  it('lays out 200 tables', () => {
    // Task 23's perf target. This asserts it completes and stays sane, not that it is fast — the
    // measurement belongs to that task's sweep, not to a unit test with a wall clock in it.
    const many: ErdNode[] = [];
    for (let index = 0; index < 200; index += 1) {
      const parent =
        index === 0
          ? []
          : [
              field({
                name: 'parent_id',
                relatedNodeId: `dbo.t${index - 1}`,
                relatedFieldName: 'id',
              }),
            ];
      many.push(table(`dbo.t${index}`, [field({ name: 'id', isPrimaryKey: true }), ...parent]));
    }

    const layout = layoutErd(many);
    expect(layout.nodes).toHaveLength(200);
    expect(layout.edges).toHaveLength(199);
  });
});

describe('path builders', () => {
  it('rounds only the top corners of the header bar', () => {
    const path = topRoundedRectPath(180, 28, 4);
    expect(path.startsWith('M 0 28')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    // Two arcs, both at the top.
    expect(path.match(/A /g)).toHaveLength(2);
  });

  it('never rounds more than half the width', () => {
    expect(topRoundedRectPath(6, 28, 40)).toContain('A 3 3');
  });

  it('is a polyline through the routed points, at two decimals', () => {
    expect(
      edgePath([
        { x: 1.239, y: 2 },
        { x: 3, y: 4 },
      ])
    ).toBe('M 1.24 2 L 3 4');
  });

  it('is empty rather than malformed for a degenerate route', () => {
    expect(edgePath([{ x: 1, y: 2 }])).toBe('');
    expect(edgePath([])).toBe('');
  });
});

describe('truncateLabel', () => {
  it('leaves a label inside the budget alone', () => {
    expect(truncateLabel('customer_id', 12)).toBe('customer_id');
    expect(truncateLabel('exactlytwelve', 13)).toBe('exactlytwelve');
  });

  it('never returns more characters than the budget, ellipsis included', () => {
    expect(truncateLabel('a_very_long_column_name', 12)).toBe('a_very_long…');
    expect([...truncateLabel('a_very_long_column_name', 12)]).toHaveLength(12);
  });

  it('counts code points, so an emoji-bearing name is not cut in half', () => {
    // `.length` would report 2 for the surrogate pair and slice between its halves.
    expect(truncateLabel('ab🍎cd', 4)).toBe('ab🍎…');
  });

  it('is empty for a zero budget rather than a lone ellipsis', () => {
    expect(truncateLabel('anything', 0)).toBe('');
  });
});
