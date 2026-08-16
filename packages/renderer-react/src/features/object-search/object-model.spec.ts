/**
 * What opening a search result means, per engine — the half of the object search with a right answer.
 *
 * The Angular original emitted `SELECT TOP 1000 * FROM [schema].[name]` and `EXEC [schema].[name]` for
 * every engine (`object-search.component.ts:477,483`), which is a syntax error on PostgreSQL and MySQL,
 * and defaulted a missing schema to `'dbo'` (`:426`) — a T-SQL system schema — on all three. Both are
 * asserted fixed below.
 */

import { describe, expect, it } from 'vitest';
import type { ObjectMetadata } from '@joinery/shared';

import {
  OBJECT_FOLDERS,
  OBJECT_SEARCH_ROW_LIMIT,
  planObjectOpen,
  qualifiedName,
  SEARCHABLE_OBJECT_TYPES,
  toSearchableObject,
  type SearchableObject,
} from './object-model';

function metadata(name: string, schema: string, type = 'table'): ObjectMetadata {
  return { name, schema, type } as ObjectMetadata;
}

const TABLE_FOLDER = OBJECT_FOLDERS[0];

function tableIn(schema: string, name = 'orders'): SearchableObject {
  return {
    connectionId: 'c1',
    database: 'sales',
    schema,
    name,
    type: 'table',
    typeLabel: 'Table',
  };
}

describe('the folder table', () => {
  it('covers every searchable type, with the tree’s own paths', () => {
    expect(OBJECT_FOLDERS.map(folder => folder.type)).toEqual([...SEARCHABLE_OBJECT_TYPES]);
    // These strings are the `explorer.getChildren` paths the tree's folder nodes use
    // (`state/explorer-folders.ts`). Equal on purpose: a reveal has to land in the folder the search
    // read from.
    expect(OBJECT_FOLDERS.map(folder => folder.path)).toEqual([
      'tables',
      'views',
      'procedures',
      'functions',
    ]);
  });
});

describe('toSearchableObject', () => {
  it('keeps the schema the server gave', () => {
    const object = toSearchableObject(metadata('orders', 'sales'), TABLE_FOLDER!, {
      connectionId: 'c1',
      database: 'db',
      engine: 'postgresql',
    });
    expect(object.schema).toBe('sales');
    expect(object.typeLabel).toBe('Table');
  });

  it('defaults a missing schema per engine, not to dbo', () => {
    const forEngine = (engine: 'mssql' | 'postgresql' | 'mysql') =>
      toSearchableObject(metadata('orders', ''), TABLE_FOLDER!, {
        connectionId: 'c1',
        database: 'db',
        engine,
      }).schema;

    expect(forEngine('mssql')).toBe('dbo');
    expect(forEngine('postgresql')).toBe('public');
    // MySQL has no schema layer: an empty slot is the correct answer, and `dbo` was the bug.
    expect(forEngine('mysql')).toBe('');
  });
});

describe('qualifiedName', () => {
  it('joins schema and name, and drops the join when there is no schema', () => {
    expect(qualifiedName(tableIn('sales'))).toBe('sales.orders');
    expect(qualifiedName(tableIn(''))).toBe('orders');
  });
});

describe('planObjectOpen', () => {
  it('quotes and limits per engine for a table', () => {
    expect(planObjectOpen(tableIn('sales'), 'mssql').sql).toBe(
      `SELECT TOP ${OBJECT_SEARCH_ROW_LIMIT} * FROM [sales].[orders]`
    );
    expect(planObjectOpen(tableIn('sales'), 'postgresql').sql).toBe(
      `SELECT * FROM "sales"."orders" LIMIT ${OBJECT_SEARCH_ROW_LIMIT}`
    );
    // MySQL: one-part name, backticks.
    expect(planObjectOpen(tableIn(''), 'mysql').sql).toBe(
      `SELECT * FROM \`orders\` LIMIT ${OBJECT_SEARCH_ROW_LIMIT}`
    );
  });

  it('executes a table or view on open, and says so', () => {
    for (const type of ['table', 'view'] as const) {
      const plan = planObjectOpen({ ...tableIn('sales'), type }, 'postgresql');
      expect(plan.autoExecute).toBe(true);
      expect(plan.promise).toBe(`Top ${OBJECT_SEARCH_ROW_LIMIT}`);
    }
  });

  it('never executes a procedure or a function', () => {
    // Ruling 13's line: an affordance executes on open only when its label promises it. A `CALL` with
    // unknown arguments must not run itself.
    const procedure = planObjectOpen(
      { ...tableIn('sales', 'rebuild'), type: 'procedure' },
      'mssql'
    );
    expect(procedure.sql).toBe('EXEC [sales].[rebuild]');
    expect(procedure.autoExecute).toBe(false);

    const pgProcedure = planObjectOpen(
      { ...tableIn('sales', 'rebuild'), type: 'procedure' },
      'postgresql'
    );
    expect(pgProcedure.sql).toBe('CALL "sales"."rebuild"()');
    expect(pgProcedure.autoExecute).toBe(false);

    const fn = planObjectOpen({ ...tableIn('sales', 'total'), type: 'function' }, 'postgresql');
    expect(fn.sql).toBe('SELECT "sales"."total"()');
    expect(fn.autoExecute).toBe(false);
  });

  it('escapes a hostile identifier rather than concatenating it', () => {
    // The identifier comes from the server's own metadata, but it is still user-controlled data on a
    // database the user may not own — the threat model Task 14's review applied to FK previews.
    const plan = planObjectOpen(tableIn('sales', 'ord"ers'), 'postgresql');
    expect(plan.sql).toContain('"ord""ers"');
    const mssql = planObjectOpen(tableIn('sales', 'ord]ers'), 'mssql');
    expect(mssql.sql).toContain('[ord]]ers]');
  });
});
