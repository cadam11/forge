/**
 * One row, as fields — the pure half of the row inspector.
 *
 * Ported from `row-detail-panel.component.ts`'s `columnDetails` computed (`:1037-1059`), its two
 * formatters (`:1128-1147`) and `formatColumnType` (`:1149-1168`). Extracted from the component for
 * the reason `grid-columns.ts` was: these are pure functions of a row and its columns, so they are
 * the part a unit test can hold still, and the component's `useMemo` over them is only honest if
 * building a field has no other input.
 *
 * Two corrections to the port, both visible to a user:
 *
 *  - **`NULL` is not a value.** Angular formatted an absent value as the string `NULL` and *then*
 *    asked whether it was null, so the copy-value action put the four characters `NULL` on the
 *    clipboard for an empty cell. `valueText` returns the empty string for a NULL, and the panel
 *    paints the word from the `cell-null` treatment instead — the same distinction the grid draws
 *    (`grid-columns.ts:formatCellValue` is display-only; the clipboard uses raw values).
 *  - **Truncation is marked in the string, not beside it.** The template rendered a separate
 *    `<span class="truncated-indicator">...</span>` next to a value that had been cut at exactly 100
 *    characters, which reads as three literal dots of data. `truncate` appends one ellipsis.
 */

import type { ColumnMetadata } from '@joinery/shared';

import { fkTargetFor, truncate, type FkTarget } from './fk-lookup';

/** How much of a value the field list shows before the ellipsis. The rest is one click away. */
export const FIELD_PREVIEW_LENGTH = 120;

export interface RowField {
  readonly name: string;
  /** The declared type, with length or precision when the column carries one. */
  readonly type: string;
  readonly rawValue: unknown;
  /** The whole value as text — what Copy puts on the clipboard and what expanding shows. */
  readonly fullValue: string;
  /** The first `FIELD_PREVIEW_LENGTH` characters, ellipsised when there are more. */
  readonly previewValue: string;
  readonly isNull: boolean;
  readonly isTruncated: boolean;
  readonly isPrimaryKey: boolean;
  readonly isIdentity: boolean;
  /** `undefined` when the catalogue was never consulted — absent, not "nullable: false". */
  readonly nullable: boolean | undefined;
  readonly defaultValue: string | undefined;
  /** Where this cell points, when it points anywhere and has a value to point with. */
  readonly foreignKey: FkTarget | null;
  /** `schema.table.column`, for the FK badge's title. Present whenever the column references one. */
  readonly reference: string | null;
}

/** Every field of one row, in the result set's column order. */
export function buildRowFields(
  row: Record<string, unknown>,
  columns: readonly ColumnMetadata[]
): RowField[] {
  return columns.map(column => {
    const rawValue = row[column.name];
    const isNull = rawValue === null || rawValue === undefined;
    const fullValue = isNull ? '' : valueText(rawValue);
    const previewValue = truncate(fullValue, FIELD_PREVIEW_LENGTH);
    const reference = column.foreignKey;

    return {
      name: column.name,
      type: formatColumnType(column),
      rawValue,
      fullValue,
      previewValue,
      isNull,
      isTruncated: previewValue !== fullValue,
      isPrimaryKey: column.isPrimaryKey === true,
      isIdentity: column.isIdentity === true,
      nullable: column.nullable,
      defaultValue: column.defaultValue,
      foreignKey: fkTargetFor(column, rawValue),
      reference:
        reference === undefined
          ? null
          : `${reference.referencedSchema}.${reference.referencedTable}.${reference.referencedColumn}`,
    };
  });
}

/**
 * A value as text. Dates go out as ISO, objects as indented JSON (a `jsonb` column is the common
 * case and reading it on one line is not reading it), everything else through `String`.
 *
 * NULL is the empty string here on purpose — see the module header.
 */
export function valueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

/**
 * The declared type, with the length or precision the catalogue reported.
 *
 * Ported including its two guards: `2147483647` is what SQL Server reports for `varchar(max)` and is
 * never printed, and `-1` is the other spelling of the same thing (`:1153-1159`).
 */
export function formatColumnType(column: ColumnMetadata): string {
  // Truthiness rather than `??`: a provider that set `type: ''` has said nothing, and `dataType` is
  // the alias `ColumnMetadata` declares for exactly that case (`grid-columns.ts:declaredType`).
  const type = column.type || column.dataType || 'unknown';
  const lower = type.toLowerCase();

  const length = column.maxLength;
  if (length !== undefined && length !== 0 && length !== 2147483647 && LENGTH_TYPES.has(lower)) {
    return `${type}(${length === -1 ? 'MAX' : length})`;
  }

  const precision = column.precision;
  if (precision !== undefined && precision > 0 && PRECISION_TYPES.has(lower)) {
    return column.scale === undefined || column.scale === 0
      ? `${type}(${precision})`
      : `${type}(${precision},${column.scale})`;
  }

  return type;
}

/**
 * The types a length belongs on. A `Set` of exact names rather than Angular's `includes` scan,
 * which matched `nvarchar` inside `nvarchar` but also `char` inside `character varying` — and then
 * printed PostgreSQL's `character varying(2147483647)`-shaped nonsense for a `text` column whose
 * reported length happened to be non-zero.
 */
const LENGTH_TYPES = new Set([
  'char',
  'nchar',
  'varchar',
  'nvarchar',
  'binary',
  'varbinary',
  'character',
  'character varying',
  'bpchar',
]);

const PRECISION_TYPES = new Set(['decimal', 'numeric', 'money', 'smallmoney']);

/**
 * The whole row as `name: value` lines — the Copy-all payload (`:1116-1126`).
 *
 * A NULL is written as the word NULL here, unlike a single-field copy: a line reading `email:` in a
 * block of them is ambiguous between "empty string" and "absent", and this text is for a human.
 */
export function rowAsText(fields: readonly RowField[]): string {
  return fields
    .map(field => `${field.name}: ${field.isNull ? 'NULL' : field.fullValue}`)
    .join('\n');
}
