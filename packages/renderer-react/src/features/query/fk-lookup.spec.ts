/**
 * FK resolution, which is the part of the row inspector that can be wrong silently.
 *
 * Three properties are asserted, in the order the feature depends on them:
 *
 *  1. `parseSingleTableSelect` names a table only when the answer is certain — every refusal case
 *     here is one where FK metadata attached to the parsed table would offer the user a link that
 *     does not exist in the rows they are looking at;
 *  2. `mergeEnrichedColumns` folds the catalogue's keys onto the driver's columns without touching
 *     the array the grid's `columnDefs` memo is keyed on;
 *  3. the generated SQL is correct **per engine**, which the Angular original and the main
 *     process's own FK handler both get wrong (T-SQL brackets everywhere).
 */

import { describe, expect, it } from 'vitest';
import type { ColumnMetadata } from '@joinery/shared';

import {
  fkLookupSql,
  fkOpenSql,
  fkTabTitle,
  fkTargetFor,
  mergeEnrichedColumns,
  parseSingleTableSelect,
  sqlLiteral,
  truncate,
  unquoteIdentifier,
  type EnrichedColumn,
} from './fk-lookup';

describe('parseSingleTableSelect', () => {
  it('names a bare table, defaulting the schema per engine', () => {
    expect(parseSingleTableSelect('SELECT * FROM customers', 'postgresql', 'shop')).toEqual({
      schema: 'public',
      table: 'customers',
    });
    expect(parseSingleTableSelect('SELECT * FROM Customers', 'mssql', 'shop')).toEqual({
      schema: 'dbo',
      table: 'Customers',
    });
  });

  it('uses the DATABASE as the schema on MySQL, which has no schema layer', () => {
    expect(parseSingleTableSelect('SELECT * FROM customers', 'mysql', 'shop')).toEqual({
      schema: 'shop',
      table: 'customers',
    });
  });

  it('reads a qualified name, and strips each engine’s quoting', () => {
    expect(parseSingleTableSelect('SELECT * FROM app_meta.entity', 'postgresql', 'db')).toEqual({
      schema: 'app_meta',
      table: 'entity',
    });
    expect(parseSingleTableSelect('SELECT * FROM [dbo].[Order Items]', 'mssql', 'db')).toEqual({
      schema: 'dbo',
      table: 'Order Items',
    });
    expect(parseSingleTableSelect('SELECT * FROM `shop`.`orders`', 'mysql', 'db')).toEqual({
      schema: 'shop',
      table: 'orders',
    });
    expect(
      parseSingleTableSelect('SELECT * FROM "public"."customers"', 'postgresql', 'db')
    ).toEqual({ schema: 'public', table: 'customers' });
  });

  it('survives the shapes a real query has: a column list, TOP/DISTINCT, functions, clauses', () => {
    const cases = [
      'SELECT id, email FROM customers ORDER BY id',
      'SELECT TOP 100 * FROM dbo.Orders WHERE id > 3',
      'SELECT DISTINCT country_code FROM customers',
      'SELECT id, upper(full_name) AS full_name FROM customers WHERE id <= 3',
      'SELECT COUNT(*) OVER () AS n, id FROM customers LIMIT 5',
      '-- a leading comment\nSELECT id\nFROM customers\n',
      'SELECT /* inline */ id FROM customers;',
    ];
    for (const sql of cases) {
      expect(parseSingleTableSelect(sql, 'postgresql', 'db')?.table, sql).toBeTypeOf('string');
    }
  });

  it('refuses everything whose row source is not one table', () => {
    const refused = [
      'UPDATE customers SET email = NULL',
      'INSERT INTO customers (id) VALUES (1)',
      'SELECT * FROM customers c JOIN orders o ON o.customer_id = c.id',
      'SELECT * FROM customers, orders',
      'SELECT * FROM customers c, orders o',
      'SELECT * FROM (SELECT 1 AS id) t',
      'SELECT * FROM customers UNION SELECT * FROM archived_customers',
      'SELECT * FROM shop.public.customers',
      'SELECT * FROM customers; SELECT * FROM orders',
      'WITH recent AS (SELECT 1) SELECT * FROM recent',
    ];
    for (const sql of refused) {
      expect(parseSingleTableSelect(sql, 'postgresql', 'db'), sql).toBeNull();
    }
  });

  it('is not fooled by the word JOIN inside a trailing clause', () => {
    // A refusal, and deliberately so: this parser is a heuristic, and the safe answer when the
    // word appears at all is "I do not know". Recorded as a test so the behaviour is a decision.
    expect(
      parseSingleTableSelect("SELECT * FROM customers WHERE note = 'join us'", 'mssql', 'db')
    ).toBeNull();
  });
});

describe('unquoteIdentifier', () => {
  it('undoes each delimiter’s own doubling', () => {
    expect(unquoteIdentifier('[weird]]name]')).toBe('weird]name');
    expect(unquoteIdentifier('`back``tick`')).toBe('back`tick');
    expect(unquoteIdentifier('"quo""ted"')).toBe('quo"ted');
    expect(unquoteIdentifier('plain')).toBe('plain');
  });
});

describe('mergeEnrichedColumns', () => {
  const driverColumns: readonly ColumnMetadata[] = [
    { name: 'id', type: 'int4' },
    { name: 'CUSTOMER_ID', type: 'int4' },
    { name: 'computed', type: 'text' },
  ];

  const enriched: readonly EnrichedColumn[] = [
    {
      name: 'id',
      type: 'integer',
      nullable: false,
      maxLength: null,
      precision: 32,
      scale: 0,
      isPrimaryKey: true,
      isIdentity: true,
      defaultValue: "nextval('orders_id_seq')",
      foreignKey: null,
    },
    {
      name: 'customer_id',
      type: 'integer',
      nullable: false,
      maxLength: null,
      precision: 32,
      scale: 0,
      isPrimaryKey: false,
      isIdentity: false,
      defaultValue: null,
      foreignKey: {
        referencedSchema: 'public',
        referencedTable: 'customers',
        referencedColumn: 'id',
        constraintName: 'orders_customer_id_fkey',
      },
    },
  ];

  it('matches case-insensitively and folds the catalogue’s keys in', () => {
    const merged = mergeEnrichedColumns(driverColumns, enriched);

    expect(merged[0]).toMatchObject({ isPrimaryKey: true, isIdentity: true, nullable: false });
    expect(merged[1]?.foreignKey).toEqual({
      referencedSchema: 'public',
      referencedTable: 'customers',
      referencedColumn: 'id',
      constraintName: 'orders_customer_id_fkey',
    });
  });

  it('keeps the DRIVER’s type, which is what the grid formats from', () => {
    const merged = mergeEnrichedColumns(driverColumns, enriched);
    expect(merged[0]?.type).toBe('int4');
  });

  it('leaves a column the catalogue does not know untouched', () => {
    const merged = mergeEnrichedColumns(driverColumns, enriched);
    expect(merged[2]).toEqual({ name: 'computed', type: 'text' });
  });

  it('never mutates the array the grid’s memo is keyed on', () => {
    const input: ColumnMetadata[] = [{ name: 'id', type: 'int4' }];
    const merged = mergeEnrichedColumns(input, enriched);
    expect(merged).not.toBe(input);
    expect(input[0]).toEqual({ name: 'id', type: 'int4' });
  });

  it('returns the columns unchanged when the catalogue answered with nothing', () => {
    expect(mergeEnrichedColumns(driverColumns, [])).toEqual(driverColumns);
  });
});

describe('sqlLiteral', () => {
  it('quotes strings per engine, doubling the closing quote', () => {
    expect(sqlLiteral("O'Brien", 'mssql')).toBe("N'O''Brien'");
    expect(sqlLiteral("O'Brien", 'postgresql')).toBe("'O''Brien'");
    expect(sqlLiteral("O'Brien", 'mysql')).toBe("'O''Brien'");
  });

  it('doubles backslashes on MySQL only — it is the one engine that escapes them by default', () => {
    expect(sqlLiteral(String.raw`a\b`, 'mysql')).toBe(String.raw`'a\\b'`);
    expect(sqlLiteral(String.raw`a\b`, 'postgresql')).toBe(String.raw`'a\b'`);
    expect(sqlLiteral(String.raw`a\b`, 'mssql')).toBe(String.raw`N'a\b'`);
  });

  it('closes the injection route a quoted terminator would open', () => {
    expect(sqlLiteral("1'; DROP TABLE customers; --", 'postgresql')).toBe(
      "'1''; DROP TABLE customers; --'"
    );
  });

  it('writes numbers and bigints bare, and non-finite ones as NULL', () => {
    expect(sqlLiteral(42, 'postgresql')).toBe('42');
    expect(sqlLiteral(-1.5, 'mssql')).toBe('-1.5');
    expect(sqlLiteral(10n, 'mysql')).toBe('10');
    expect(sqlLiteral(Number.NaN, 'postgresql')).toBe('NULL');
    expect(sqlLiteral(Number.POSITIVE_INFINITY, 'postgresql')).toBe('NULL');
  });

  it('spells booleans the way each engine understands them', () => {
    expect(sqlLiteral(true, 'postgresql')).toBe('TRUE');
    expect(sqlLiteral(false, 'postgresql')).toBe('FALSE');
    expect(sqlLiteral(true, 'mssql')).toBe('1');
    expect(sqlLiteral(false, 'mysql')).toBe('0');
  });

  it('sends a Date as ISO, not as its locale string', () => {
    expect(sqlLiteral(new Date('2026-08-15T12:34:56.000Z'), 'postgresql')).toBe(
      "'2026-08-15T12:34:56.000Z'"
    );
  });

  it('is NULL for absent values', () => {
    expect(sqlLiteral(null, 'postgresql')).toBe('NULL');
    expect(sqlLiteral(undefined, 'mssql')).toBe('NULL');
  });

  it('sends an object as JSON', () => {
    expect(sqlLiteral({ a: 1 }, 'postgresql')).toBe(`'{"a":1}'`);
  });
});

describe('fkLookupSql', () => {
  const target = { schema: 'public', table: 'customers', column: 'id', value: 3 };

  it('caps to one row the way each engine spells it', () => {
    expect(fkLookupSql(target, 'postgresql')).toBe(
      'SELECT * FROM "public"."customers" WHERE "id" = 3 LIMIT 1'
    );
    expect(fkLookupSql({ ...target, schema: 'dbo', table: 'Customers' }, 'mssql')).toBe(
      'SELECT TOP 1 * FROM [dbo].[Customers] WHERE [id] = 3'
    );
  });

  it('omits the schema on MySQL, where a two-part name would name a database', () => {
    expect(fkLookupSql({ ...target, schema: 'shop' }, 'mysql')).toBe(
      'SELECT * FROM `customers` WHERE `id` = 3 LIMIT 1'
    );
  });

  it('quotes an identifier that carries the delimiter itself', () => {
    expect(fkLookupSql({ ...target, table: 'we"ird' }, 'postgresql')).toContain('"we""ird"');
  });

  it('is a multi-line, uncapped SELECT when it is going into a tab', () => {
    expect(fkOpenSql(target, 'postgresql')).toBe(
      'SELECT *\nFROM "public"."customers"\nWHERE "id" = 3'
    );
  });
});

describe('fkTargetFor', () => {
  const column: ColumnMetadata = {
    name: 'customer_id',
    type: 'int4',
    foreignKey: {
      referencedSchema: 'public',
      referencedTable: 'customers',
      referencedColumn: 'id',
    },
  };

  it('resolves a column that references another table', () => {
    expect(fkTargetFor(column, 7)).toEqual({
      schema: 'public',
      table: 'customers',
      column: 'id',
      value: 7,
    });
  });

  it('is null for a NULL value — there is nothing to follow', () => {
    expect(fkTargetFor(column, null)).toBeNull();
    expect(fkTargetFor(column, undefined)).toBeNull();
  });

  it('is null for a column with no reference', () => {
    expect(fkTargetFor({ name: 'id', type: 'int4' }, 1)).toBeNull();
  });
});

describe('titles and truncation', () => {
  it('names the tab after the table and the value', () => {
    expect(fkTabTitle({ schema: 'public', table: 'customers', column: 'id', value: 3 })).toBe(
      'customers · 3'
    );
  });

  it('shortens a long value rather than filling the tab strip with it', () => {
    const title = fkTabTitle({
      schema: 'public',
      table: 'customers',
      column: 'email',
      value: 'a'.repeat(80),
    });
    expect(title).toBe(`customers · ${'a'.repeat(24)}…`);
  });

  it('leaves a short string alone', () => {
    expect(truncate('short', 24)).toBe('short');
  });
});
