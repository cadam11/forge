/**
 * The column configuration, which is the part of the grid a test can hold still.
 *
 * Everything asserted here is a decision the Angular grid made from a column's declared SQL type
 * (`results-grid.component.ts:1306-1427`) — the width, the filter component, the alignment class, the
 * NULL treatment, the pinned primary key. They are worth pinning because they are invisible until they
 * are wrong: a `numeric` column that gets the text filter looks fine and sorts alphabetically.
 */

import { describe, expect, it } from 'vitest';
import type { ColumnMetadata } from '@joinery/shared';
import {
  DEFAULT_COL_DEF,
  ROW_NUMBER_COL_ID,
  SELECTION_COL_ID,
  buildColumnDef,
  buildColumnDefs,
  cellClassesFor,
  formatCellValue,
  headerTooltipFor,
  isBooleanType,
  isDataColumnId,
  isDateType,
  isNumericType,
} from './grid-columns';

const column = (overrides: Partial<ColumnMetadata> & { name: string }): ColumnMetadata => ({
  type: 'text',
  ...overrides,
});

describe('type predicates', () => {
  it('recognises the numeric families by substring, as the original did', () => {
    for (const type of ['int', 'bigint', 'INTEGER', 'numeric(10,2)', 'double precision']) {
      // 'double precision' contains none of the tokens — this is the one that must NOT match, and it
      // is the honest limitation of a substring test rather than a bug introduced by the port.
      expect(isNumericType(column({ name: 'n', type }))).toBe(type !== 'double precision');
    }
  });

  it('recognises bit / boolean / bool exactly', () => {
    expect(isBooleanType(column({ name: 'b', type: 'bit' }))).toBe(true);
    expect(isBooleanType(column({ name: 'b', type: 'BOOLEAN' }))).toBe(true);
    expect(isBooleanType(column({ name: 'b', type: 'bool' }))).toBe(true);
    // Not a substring match: `bit` inside `bigint` must not make it a checkbox column.
    expect(isBooleanType(column({ name: 'b', type: 'bigint' }))).toBe(false);
  });

  it('recognises the date families', () => {
    // PostgreSQL's spelling reaches the predicate through the `time` token, which is why the list is
    // matched by substring rather than by equality — `timestamptz` is a date column and must sort and
    // filter as one.
    expect(isDateType(column({ name: 'd', type: 'timestamp with time zone' }))).toBe(true);
    expect(isDateType(column({ name: 'd', type: 'date' }))).toBe(true);
    expect(isDateType(column({ name: 'd', type: 'datetime2' }))).toBe(true);
    expect(isDateType(column({ name: 'd', type: 'time' }))).toBe(true);
  });

  it('falls back to `dataType` when `type` is absent', () => {
    // A result set assembled by an older provider — or by a test fixture — carries only the alias.
    // Reading one field would silently treat every column as text.
    expect(isNumericType({ name: 'n', dataType: 'int' } as ColumnMetadata)).toBe(true);
  });
});

describe('formatCellValue', () => {
  it('shows NULL for absent values', () => {
    expect(formatCellValue(null, column({ name: 'x' }))).toBe('NULL');
    expect(formatCellValue(undefined, column({ name: 'x' }))).toBe('NULL');
  });

  it('ISO-formats dates and JSON-formats objects', () => {
    expect(formatCellValue(new Date('2026-08-16T12:00:00.000Z'), column({ name: 'x' }))).toBe(
      '2026-08-16T12:00:00.000Z'
    );
    expect(formatCellValue({ a: [1] }, column({ name: 'x' }))).toBe('{"a":[1]}');
  });

  it('groups integers and honours the column scale for decimals', () => {
    expect(formatCellValue(1234567, column({ name: 'n', type: 'int' }))).toBe(
      (1234567).toLocaleString()
    );
    expect(formatCellValue(1.23456, column({ name: 'n', type: 'numeric', scale: 3 }))).toBe(
      (1.23456).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })
    );
  });
});

describe('cellClassesFor', () => {
  it('marks NULLs, numbers, booleans and dates, one shape class each', () => {
    expect(cellClassesFor(null, column({ name: 'x', type: 'int' }))).toEqual(['cell-null']);
    expect(cellClassesFor(1, column({ name: 'x', type: 'int' }))).toEqual(['cell-number']);
    expect(cellClassesFor(true, column({ name: 'x', type: 'boolean' }))).toEqual(['cell-boolean']);
    expect(cellClassesFor('2026-08-16', column({ name: 'x', type: 'date' }))).toEqual([
      'cell-date',
    ]);
    expect(cellClassesFor('hi', column({ name: 'x' }))).toEqual([]);
  });

  it('adds cell-fk for a populated foreign key, and not for a NULL one', () => {
    const fk = column({
      name: 'customer_id',
      type: 'int',
      foreignKey: {
        referencedSchema: 'public',
        referencedTable: 'customers',
        referencedColumn: 'id',
      },
    });
    expect(cellClassesFor(7, fk)).toEqual(['cell-number', 'cell-fk']);
    // A NULL FK points at nothing, so it must not offer a link affordance.
    expect(cellClassesFor(null, fk)).toEqual(['cell-null']);
  });
});

describe('buildColumnDef', () => {
  it('keeps the column name as the header — the FK glyph does NOT go in it', () => {
    // The Angular version set `${name} 🔗`, and the clipboard/export builders key off headerName —
    // so a CSV header and a JSON key both carried the emoji. See grid-columns.ts's header.
    const definition = buildColumnDef(
      column({
        name: 'customer_id',
        type: 'int',
        foreignKey: {
          referencedSchema: 'public',
          referencedTable: 'customers',
          referencedColumn: 'id',
        },
      })
    );
    expect(definition.headerName).toBe('customer_id');
    expect(definition.headerTooltip).toContain('FK → public.customers.id');
  });

  it('gives each type family its own width and filter', () => {
    expect(buildColumnDef(column({ name: 'n', type: 'int' }))).toMatchObject({
      width: 120,
      type: 'numericColumn',
      filter: 'agNumberColumnFilter',
    });
    expect(buildColumnDef(column({ name: 'd', type: 'date' }))).toMatchObject({
      width: 180,
      filter: 'agDateColumnFilter',
    });
    expect(buildColumnDef(column({ name: 'b', type: 'bit' })).width).toBe(80);
    // A short varchar gets a width proportional to its declared length…
    expect(buildColumnDef(column({ name: 's', type: 'varchar', maxLength: 20 })).width).toBe(160);
    // …and anything long or unbounded gets a floor instead of a width, so it can stretch.
    const wide = buildColumnDef(column({ name: 's', type: 'varchar', maxLength: 4000 }));
    expect(wide.width).toBeUndefined();
    expect(wide.minWidth).toBe(150);
  });

  it('pins a primary key to the left', () => {
    expect(buildColumnDef(column({ name: 'id', type: 'int', isPrimaryKey: true })).pinned).toBe(
      'left'
    );
    expect(buildColumnDef(column({ name: 'id', type: 'int' })).pinned).toBeUndefined();
  });

  it('formats through the column it was built for', () => {
    const definition = buildColumnDef(column({ name: 'n', type: 'numeric', scale: 0 }));
    const formatter = definition.valueFormatter;
    if (typeof formatter !== 'function') throw new Error('expected a formatter function');
    expect(formatter({ value: null } as never)).toBe('NULL');
  });
});

describe('headerTooltipFor', () => {
  it('names the type, the reference and the key, one per line', () => {
    expect(
      headerTooltipFor(
        column({
          name: 'id',
          type: 'int',
          isPrimaryKey: true,
          foreignKey: {
            referencedSchema: 'app_meta',
            referencedTable: 'application',
            referencedColumn: 'id',
          },
        })
      )
    ).toBe('id (int)\nFK → app_meta.application.id\nPrimary Key');
  });
});

describe('buildColumnDefs', () => {
  const columns = [column({ name: 'id', type: 'int' }), column({ name: 'email' })];

  it('prepends the ordinal column when the setting asks for it', () => {
    const withNumbers = buildColumnDefs(columns, { showRowNumbers: true });
    expect(withNumbers).toHaveLength(3);
    expect(withNumbers[0]?.colId).toBe(ROW_NUMBER_COL_ID);
    expect(withNumbers[0]).toMatchObject({ pinned: 'left', sortable: false, filter: false });
  });

  it('honours showRowNumbers: false — the Angular grid ignored the setting entirely', () => {
    const withoutNumbers = buildColumnDefs(columns, { showRowNumbers: false });
    expect(withoutNumbers).toHaveLength(2);
    expect(withoutNumbers.map(definition => definition.field)).toEqual(['id', 'email']);
  });

  it('numbers the DISPLAYED position, so the gutter still reads 1..n after a sort', () => {
    const [ordinal] = buildColumnDefs(columns, { showRowNumbers: true });
    const getter = ordinal?.valueGetter;
    if (typeof getter !== 'function') throw new Error('expected a value getter function');
    expect(getter({ node: { rowIndex: 0 } } as never)).toBe(1);
    expect(getter({ node: { rowIndex: 41 } } as never)).toBe(42);
    // A node with no index at all (a detail row, a loading placeholder) prints nothing.
    expect(getter({ node: { rowIndex: null } } as never)).toBe('');
  });
});

describe('isDataColumnId', () => {
  it('excludes the ordinal gutter and AG Grid’s checkbox column from copy and export', () => {
    expect(isDataColumnId('email')).toBe(true);
    expect(isDataColumnId(ROW_NUMBER_COL_ID)).toBe(false);
    expect(isDataColumnId(SELECTION_COL_ID)).toBe(false);
  });
});

describe('DEFAULT_COL_DEF', () => {
  it('is sortable, filterable, floating-filtered and resizable — the Angular default', () => {
    expect(DEFAULT_COL_DEF).toEqual({
      sortable: true,
      filter: true,
      floatingFilter: true,
      resizable: true,
      minWidth: 80,
      suppressSizeToFit: false,
    });
  });
});
