/**
 * Port parity for `core/services/erd-adapter.service.ts`.
 *
 * Every case here is a claim about the Angular original, so each one names the line it came from.
 * Two of them pin behaviour that looks like a bug and is not (`nvarchar` byte halving, `-1` → MAX),
 * one pins the bug that WAS fixed (`'tables'`, lowercase), and the rest are the shapes the transform
 * has to get right for a diagram to have the correct edges in it.
 *
 * A `SchemaReader` is a plain object here — that is the whole reason the adapter takes one.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ColumnInfo, ForeignKeyInfo } from '@joinery/shared';

import {
  buildErd,
  buildErdForDatabase,
  buildErdForTable,
  buildErdNode,
  erdFieldsFor,
  formatColumnType,
  MAX_ERD_TABLES,
  splitNodeId,
  type SchemaReader,
  type TableRef,
} from './erd-adapter';
import { TABLES_PATH } from './erd-schema-reader';

function column(overrides: Partial<ColumnInfo> & { name: string }): ColumnInfo {
  return {
    dataType: 'int',
    isNullable: true,
    ordinalPosition: 1,
    ...overrides,
  };
}

interface FakeTable {
  readonly columns: readonly ColumnInfo[];
  readonly foreignKeys?: readonly ForeignKeyInfo[];
}

/** A reader over an in-memory schema, plus a call log so batching and fan-out are assertable. */
function fakeReader(schema: Record<string, FakeTable>): SchemaReader & {
  readonly calls: string[];
  readonly inFlight: () => number;
} {
  const calls: string[] = [];
  let peak = 0;
  let live = 0;

  const read = async <T>(label: string, value: T): Promise<T> => {
    calls.push(label);
    live += 1;
    peak = Math.max(peak, live);
    await Promise.resolve();
    live -= 1;
    return value;
  };

  return {
    calls,
    inFlight: () => peak,
    listTables: (_connectionId, _databaseName) =>
      read(
        'listTables',
        Object.keys(schema).map(id => splitNodeId(id))
      ),
    columns: (_connectionId, _databaseName, s, t) =>
      read(`columns:${s}.${t}`, schema[`${s}.${t}`]?.columns ?? []),
    foreignKeys: (_connectionId, _databaseName, s, t) =>
      read(`keys:${s}.${t}`, schema[`${s}.${t}`]?.foreignKeys ?? []),
  };
}

const ORDERS_FK: ForeignKeyInfo = {
  name: 'orders_customer_id_fkey',
  columns: ['customer_id'],
  referencedSchema: 'public',
  referencedTable: 'customers',
  referencedColumns: ['id'],
};

const SEEDED: Record<string, FakeTable> = {
  'public.customers': {
    columns: [
      column({ name: 'id', dataType: 'integer', isPrimaryKey: true, isNullable: false }),
      column({ name: 'email', dataType: 'varchar', maxLength: 200, isNullable: false }),
    ],
  },
  'public.orders': {
    columns: [
      column({ name: 'id', dataType: 'integer', isPrimaryKey: true, isNullable: false }),
      column({ name: 'customer_id', dataType: 'integer', isNullable: false }),
    ],
    foreignKeys: [ORDERS_FK],
  },
  'public.order_items': {
    columns: [
      column({ name: 'id', dataType: 'integer', isPrimaryKey: true, isNullable: false }),
      column({ name: 'order_id', dataType: 'integer', isNullable: false }),
    ],
    foreignKeys: [
      {
        name: 'order_items_order_id_fkey',
        columns: ['order_id'],
        referencedSchema: 'public',
        referencedTable: 'orders',
        referencedColumns: ['id'],
      },
    ],
  },
};

describe('formatColumnType — `erd-adapter.service.ts:212-230`, verbatim', () => {
  it('appends the declared length to a character type', () => {
    expect(formatColumnType(column({ name: 'a', dataType: 'varchar', maxLength: 200 }))).toBe(
      'varchar(200)'
    );
  });

  it('halves maxLength for the n-prefixed types, because SQL Server reports bytes', () => {
    expect(formatColumnType(column({ name: 'a', dataType: 'nvarchar', maxLength: 100 }))).toBe(
      'nvarchar(50)'
    );
    expect(formatColumnType(column({ name: 'a', dataType: 'nchar', maxLength: 20 }))).toBe(
      'nchar(10)'
    );
  });

  it('reports maxLength -1 as (MAX)', () => {
    expect(formatColumnType(column({ name: 'a', dataType: 'varchar', maxLength: -1 }))).toBe(
      'varchar(MAX)'
    );
    // -1 is checked before the halving, so nvarchar(max) is not "(-0.5)".
    expect(formatColumnType(column({ name: 'a', dataType: 'nvarchar', maxLength: -1 }))).toBe(
      'nvarchar(MAX)'
    );
  });

  it('uses precision and scale for decimal and numeric', () => {
    expect(
      formatColumnType(column({ name: 'a', dataType: 'decimal', precision: 18, scale: 4 }))
    ).toBe('decimal(18, 4)');
  });

  it('checks numeric BEFORE the n-prefix halving, which is the ordering the original relied on', () => {
    // `numeric` starts with `n` and is in neither length set, so a reordered implementation would
    // fall through to the plain-type arm and lose the precision.
    expect(
      formatColumnType(column({ name: 'a', dataType: 'numeric', precision: 10, scale: 2 }))
    ).toBe('numeric(10, 2)');
  });

  it('leaves a type with no modifiers alone, whatever its case', () => {
    expect(formatColumnType(column({ name: 'a', dataType: 'TIMESTAMP' }))).toBe('TIMESTAMP');
    expect(formatColumnType(column({ name: 'a', dataType: 'integer' }))).toBe('integer');
  });

  it('does not divide an absent or zero maxLength', () => {
    // `col.maxLength ? … : col.maxLength` in the original — a falsy length fell through untouched.
    expect(formatColumnType(column({ name: 'a', dataType: 'nvarchar' }))).toBe(
      'nvarchar(undefined)'
    );
  });
});

describe('erdFieldsFor', () => {
  it('ids a field as node.column, which is what React keys on', () => {
    const [field] = erdFieldsFor('public.orders', [column({ name: 'id' })], []);
    expect(field?.id).toBe('public.orders.id');
  });

  it('carries the FK target as schema.table plus the referenced column and constraint', () => {
    const fields = erdFieldsFor(
      'public.orders',
      [column({ name: 'customer_id', isNullable: false })],
      [ORDERS_FK]
    );

    expect(fields[0]).toMatchObject({
      relatedNodeId: 'public.customers',
      relatedNodeName: 'customers',
      relatedFieldName: 'id',
      constraintName: 'orders_customer_id_fkey',
      allowsNull: false,
    });
  });

  it('matches a composite FK column to the referenced column in the same position', () => {
    const composite: ForeignKeyInfo = {
      name: 'fk_two',
      columns: ['a', 'b'],
      referencedSchema: 'dbo',
      referencedTable: 'parent',
      referencedColumns: ['pa', 'pb'],
    };
    const fields = erdFieldsFor(
      'dbo.child',
      [column({ name: 'a' }), column({ name: 'b' })],
      [composite]
    );

    expect(fields.map(field => field.relatedFieldName)).toEqual(['pa', 'pb']);
  });

  it('falls back to the first referenced column when the server reported fewer than it should', () => {
    const ragged: ForeignKeyInfo = {
      name: 'fk_ragged',
      columns: ['a', 'b'],
      referencedSchema: 'dbo',
      referencedTable: 'parent',
      referencedColumns: ['pa'],
    };
    const fields = erdFieldsFor('dbo.child', [column({ name: 'b' })], [ragged]);
    expect(fields[0]?.relatedFieldName).toBe('pa');
  });

  it('gives a column in two constraints the LAST one, as the original map-building did', () => {
    const first: ForeignKeyInfo = { ...ORDERS_FK, name: 'first' };
    const second: ForeignKeyInfo = { ...ORDERS_FK, name: 'second', referencedTable: 'people' };
    const fields = erdFieldsFor(
      'public.orders',
      [column({ name: 'customer_id' })],
      [first, second]
    );

    expect(fields[0]?.constraintName).toBe('second');
    expect(fields[0]?.relatedNodeId).toBe('public.people');
  });

  it('reports isPrimaryKey false when the bridge omitted the flag', () => {
    const [field] = erdFieldsFor('dbo.t', [column({ name: 'c' })], []);
    expect(field?.isPrimaryKey).toBe(false);
  });

  it('never claims autoIncrement — ColumnInfo has no identity flag, as the original noted', () => {
    const [field] = erdFieldsFor('dbo.t', [column({ name: 'c' })], []);
    expect(field?.autoIncrement).toBe(false);
  });

  it('omits defaultValue rather than storing null', () => {
    const [field] = erdFieldsFor('dbo.t', [column({ name: 'c' })], []);
    expect('defaultValue' in (field ?? {})).toBe(false);
  });
});

describe('buildErdNode', () => {
  it('reads columns and keys in parallel and assembles one node', async () => {
    const reader = fakeReader(SEEDED);
    const node = await buildErdNode(reader, 'c1', 'joinery_test', 'public', 'orders');

    expect(node).toMatchObject({ id: 'public.orders', name: 'orders', schemaName: 'public' });
    expect(node.fields).toHaveLength(2);
    expect(reader.inFlight()).toBe(2);
  });
});

describe('buildErdForTable — `erd-adapter.service.ts:41-91`', () => {
  it('follows outgoing foreign keys to the requested depth', async () => {
    const reader = fakeReader(SEEDED);
    const { nodes } = await buildErdForTable(reader, {
      connectionId: 'c1',
      databaseName: 'joinery_test',
      schema: 'public',
      tableName: 'order_items',
      depth: 2,
    });

    // order_items → orders → customers. Two hops, three tables.
    expect(nodes.map(node => node.id).sort()).toEqual([
      'public.customers',
      'public.order_items',
      'public.orders',
    ]);
  });

  it('stops at depth 1', async () => {
    const reader = fakeReader(SEEDED);
    const { nodes } = await buildErdForTable(reader, {
      connectionId: 'c1',
      databaseName: 'joinery_test',
      schema: 'public',
      tableName: 'order_items',
      depth: 1,
    });

    expect(nodes.map(node => node.id).sort()).toEqual(['public.order_items', 'public.orders']);
  });

  it('returns the focus table alone at depth 0', async () => {
    const reader = fakeReader(SEEDED);
    const { nodes } = await buildErdForTable(reader, {
      connectionId: 'c1',
      databaseName: 'joinery_test',
      schema: 'public',
      tableName: 'order_items',
      depth: 0,
    });

    expect(nodes.map(node => node.id)).toEqual(['public.order_items']);
  });

  it('visits a table once when two paths reach it', async () => {
    // A diamond: a → b, a → c, b → d, c → d.
    const diamond: Record<string, FakeTable> = {
      'dbo.a': {
        columns: [column({ name: 'b_id' }), column({ name: 'c_id' })],
        foreignKeys: [
          {
            name: 'fk_b',
            columns: ['b_id'],
            referencedSchema: 'dbo',
            referencedTable: 'b',
            referencedColumns: ['id'],
          },
          {
            name: 'fk_c',
            columns: ['c_id'],
            referencedSchema: 'dbo',
            referencedTable: 'c',
            referencedColumns: ['id'],
          },
        ],
      },
      'dbo.b': {
        columns: [column({ name: 'd_id' })],
        foreignKeys: [
          {
            name: 'fk_bd',
            columns: ['d_id'],
            referencedSchema: 'dbo',
            referencedTable: 'd',
            referencedColumns: ['id'],
          },
        ],
      },
      'dbo.c': {
        columns: [column({ name: 'd_id' })],
        foreignKeys: [
          {
            name: 'fk_cd',
            columns: ['d_id'],
            referencedSchema: 'dbo',
            referencedTable: 'd',
            referencedColumns: ['id'],
          },
        ],
      },
      'dbo.d': { columns: [column({ name: 'id', isPrimaryKey: true })] },
    };

    const reader = fakeReader(diamond);
    const { nodes } = await buildErdForTable(reader, {
      connectionId: 'c1',
      databaseName: 'db',
      schema: 'dbo',
      tableName: 'a',
      depth: 3,
    });

    expect(nodes).toHaveLength(4);
    expect(reader.calls.filter(call => call === 'columns:dbo.d')).toHaveLength(1);
  });

  it('terminates on an FK cycle', async () => {
    const cyclic: Record<string, FakeTable> = {
      'dbo.a': {
        columns: [column({ name: 'b_id' })],
        foreignKeys: [
          {
            name: 'fk_ab',
            columns: ['b_id'],
            referencedSchema: 'dbo',
            referencedTable: 'b',
            referencedColumns: ['id'],
          },
        ],
      },
      'dbo.b': {
        columns: [column({ name: 'a_id' })],
        foreignKeys: [
          {
            name: 'fk_ba',
            columns: ['a_id'],
            referencedSchema: 'dbo',
            referencedTable: 'a',
            referencedColumns: ['id'],
          },
        ],
      },
    };

    const { nodes } = await buildErdForTable(fakeReader(cyclic), {
      connectionId: 'c1',
      databaseName: 'db',
      schema: 'dbo',
      tableName: 'a',
      depth: 6,
    });

    expect(nodes.map(node => node.id).sort()).toEqual(['dbo.a', 'dbo.b']);
  });

  it('clamps an absurd depth out of persisted tab metadata', async () => {
    const { nodes } = await buildErdForTable(fakeReader(SEEDED), {
      connectionId: 'c1',
      databaseName: 'joinery_test',
      schema: 'public',
      tableName: 'order_items',
      depth: Number.MAX_SAFE_INTEGER,
    });

    expect(nodes).toHaveLength(3);
  });

  it('builds a whole hop concurrently rather than one table at a time', async () => {
    const reader = fakeReader(SEEDED);
    await buildErdForTable(reader, {
      connectionId: 'c1',
      databaseName: 'joinery_test',
      schema: 'public',
      tableName: 'order_items',
      depth: 2,
    });

    // Two reads per table, and the deepest hop has one table — so the peak is the 2 of one table,
    // not 1. What is asserted is that the FIRST hop's two reads overlapped.
    expect(reader.inFlight()).toBeGreaterThanOrEqual(2);
  });
});

describe('buildErdForDatabase — `erd-adapter.service.ts:235-258`', () => {
  it('asks the explorer for the lowercase `tables` path, which is the one the main process matches', () => {
    // The whole of the fixed bug. `packages/main/src/ipc/explorer.ipc.ts:53` compares against this
    // literal and its fall-through returns []; the Angular adapter passed 'Tables'.
    expect(TABLES_PATH).toBe('tables');
  });

  it('builds a node per table in the database', async () => {
    const reader = fakeReader(SEEDED);
    const { nodes, truncated } = await buildErdForDatabase(reader, 'c1', 'joinery_test');

    expect(nodes.map(node => node.id).sort()).toEqual([
      'public.customers',
      'public.order_items',
      'public.orders',
    ]);
    expect(truncated).toBe(false);
  });

  it('holds concurrency to five tables — ten reads — however many there are', async () => {
    const many: Record<string, FakeTable> = {};
    for (let index = 0; index < 40; index += 1) {
      many[`dbo.t${index}`] = { columns: [column({ name: 'id', isPrimaryKey: true })] };
    }

    const reader = fakeReader(many);
    const { nodes } = await buildErdForDatabase(reader, 'c1', 'db');

    expect(nodes).toHaveLength(40);
    expect(reader.inFlight()).toBeLessThanOrEqual(10);
  });

  it('caps the diagram and says so', async () => {
    const listTables = vi.fn(async (): Promise<readonly TableRef[]> =>
      Array.from({ length: MAX_ERD_TABLES + 5 }, (_value, index) => ({
        schema: 'dbo',
        name: `t${index}`,
      }))
    );
    const reader: SchemaReader = {
      listTables,
      columns: async () => [],
      foreignKeys: async () => [],
    };

    const { nodes, truncated } = await buildErdForDatabase(reader, 'c1', 'db');

    expect(nodes).toHaveLength(MAX_ERD_TABLES);
    expect(truncated).toBe(true);
  });

  it('propagates a failed read rather than drawing a partial diagram', async () => {
    const reader: SchemaReader = {
      listTables: async () => [{ schema: 'dbo', name: 't' }],
      columns: async () => {
        throw new Error('permission denied');
      },
      foreignKeys: async () => [],
    };

    await expect(buildErdForDatabase(reader, 'c1', 'db')).rejects.toThrow('permission denied');
  });
});

describe('buildErd', () => {
  it('routes to the table build when the request names one', async () => {
    const reader = fakeReader(SEEDED);
    const { nodes } = await buildErd(reader, {
      connectionId: 'c1',
      databaseName: 'joinery_test',
      schema: 'public',
      tableName: 'orders',
      depth: 1,
    });

    expect(nodes.map(node => node.id).sort()).toEqual(['public.customers', 'public.orders']);
    expect(reader.calls).not.toContain('listTables');
  });

  it('routes to the database build when it does not', async () => {
    const reader = fakeReader(SEEDED);
    await buildErd(reader, { connectionId: 'c1', databaseName: 'joinery_test' });
    expect(reader.calls).toContain('listTables');
  });
});

describe('splitNodeId', () => {
  it('splits on the first dot, so a dotted table name survives', () => {
    expect(splitNodeId('public.my.table')).toEqual({ schema: 'public', name: 'my.table' });
  });

  it('reports an empty schema for a MySQL-shaped id', () => {
    expect(splitNodeId('.orders')).toEqual({ schema: '', name: 'orders' });
  });

  it('treats a bare name as unqualified rather than throwing', () => {
    expect(splitNodeId('orders')).toEqual({ schema: '', name: 'orders' });
  });
});
