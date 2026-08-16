/**
 * The row inspector's field model. Every case here is one a user can see in a cell.
 */

import { describe, expect, it } from 'vitest';
import type { ColumnMetadata } from '@joinery/shared';

import {
  buildRowFields,
  FIELD_PREVIEW_LENGTH,
  formatColumnType,
  rowAsText,
  valueText,
} from './row-detail';

const COLUMNS: readonly ColumnMetadata[] = [
  { name: 'id', type: 'int4', isPrimaryKey: true, isIdentity: true, nullable: false },
  {
    name: 'customer_id',
    type: 'int4',
    nullable: false,
    foreignKey: {
      referencedSchema: 'public',
      referencedTable: 'customers',
      referencedColumn: 'id',
    },
  },
  { name: 'note', type: 'text', nullable: true, defaultValue: "''::text" },
  { name: 'payload', type: 'jsonb', nullable: true },
];

describe('buildRowFields', () => {
  const fields = buildRowFields({ id: 12, customer_id: 3, note: null, payload: { a: 1 } }, COLUMNS);

  it('keeps the column order and names', () => {
    expect(fields.map(field => field.name)).toEqual(['id', 'customer_id', 'note', 'payload']);
  });

  it('marks the primary key and the identity flag', () => {
    expect(fields[0]).toMatchObject({ isPrimaryKey: true, isIdentity: true, nullable: false });
  });

  it('resolves the FK target and labels the reference', () => {
    expect(fields[1]?.foreignKey).toEqual({
      schema: 'public',
      table: 'customers',
      column: 'id',
      value: 3,
    });
    expect(fields[1]?.reference).toBe('public.customers.id');
  });

  it('reports a NULL as null with an EMPTY value, not the word', () => {
    expect(fields[2]).toMatchObject({ isNull: true, fullValue: '', previewValue: '' });
  });

  it('has no FK target for a NULL FK column', () => {
    const nulled = buildRowFields({ id: 1, customer_id: null }, COLUMNS);
    expect(nulled[1]?.foreignKey).toBeNull();
    // The reference itself is still named: the column DOES point somewhere, this row just does not.
    expect(nulled[1]?.reference).toBe('public.customers.id');
  });

  it('indents an object value so a jsonb column is readable', () => {
    expect(fields[3]?.fullValue).toBe('{\n  "a": 1\n}');
  });

  it('ellipsises a long value once, and says it did', () => {
    const long = 'x'.repeat(FIELD_PREVIEW_LENGTH + 40);
    const [field] = buildRowFields({ note: long }, [{ name: 'note', type: 'text' }]);
    expect(field?.isTruncated).toBe(true);
    expect(field?.previewValue).toBe(`${'x'.repeat(FIELD_PREVIEW_LENGTH)}…`);
    expect(field?.fullValue).toBe(long);
  });

  it('does not mark a value that fits as truncated', () => {
    const [field] = buildRowFields({ note: 'short' }, [{ name: 'note', type: 'text' }]);
    expect(field?.isTruncated).toBe(false);
  });

  it('leaves nullability undefined when the catalogue was never consulted', () => {
    const [field] = buildRowFields({ note: 'x' }, [{ name: 'note', type: 'text' }]);
    expect(field?.nullable).toBeUndefined();
  });

  it('reads a column the row has no key for as NULL rather than throwing', () => {
    const [field] = buildRowFields({}, [{ name: 'missing', type: 'text' }]);
    expect(field?.isNull).toBe(true);
  });
});

describe('valueText', () => {
  it('is ISO for a Date', () => {
    expect(valueText(new Date('2026-08-15T00:00:00.000Z'))).toBe('2026-08-15T00:00:00.000Z');
  });

  it('is empty for an absent value', () => {
    expect(valueText(null)).toBe('');
    expect(valueText(undefined)).toBe('');
  });

  it('keeps a false and a zero, which are values', () => {
    expect(valueText(false)).toBe('false');
    expect(valueText(0)).toBe('0');
  });
});

describe('formatColumnType', () => {
  it('adds a length only to the types a length belongs on', () => {
    expect(formatColumnType({ name: 'a', type: 'varchar', maxLength: 40 })).toBe('varchar(40)');
    expect(formatColumnType({ name: 'a', type: 'text', maxLength: 40 })).toBe('text');
  });

  it('prints MAX rather than SQL Server’s two sentinels', () => {
    expect(formatColumnType({ name: 'a', type: 'nvarchar', maxLength: -1 })).toBe('nvarchar(MAX)');
    expect(formatColumnType({ name: 'a', type: 'nvarchar', maxLength: 2147483647 })).toBe(
      'nvarchar'
    );
  });

  it('adds precision and scale to a decimal', () => {
    expect(formatColumnType({ name: 'a', type: 'numeric', precision: 12, scale: 2 })).toBe(
      'numeric(12,2)'
    );
    expect(formatColumnType({ name: 'a', type: 'numeric', precision: 12, scale: 0 })).toBe(
      'numeric(12)'
    );
  });

  it('does not put an integer’s reported precision on it', () => {
    expect(formatColumnType({ name: 'a', type: 'int4', precision: 32, scale: 0 })).toBe('int4');
  });

  it('falls back to the alias, then to a word', () => {
    expect(formatColumnType({ name: 'a', type: '', dataType: 'uuid' })).toBe('uuid');
    expect(formatColumnType({ name: 'a', type: '' })).toBe('unknown');
  });
});

describe('rowAsText', () => {
  it('writes one name: value line per field, naming NULLs', () => {
    const fields = buildRowFields({ id: 1, customer_id: 2, note: null }, COLUMNS.slice(0, 3));
    expect(rowAsText(fields)).toBe('id: 1\ncustomer_id: 2\nnote: NULL');
  });
});
