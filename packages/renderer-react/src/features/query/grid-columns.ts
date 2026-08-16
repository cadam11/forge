/**
 * Result-set columns → AG Grid `ColDef`s, and the value/class formatting the cells use.
 *
 * Ported from `results-grid.component.ts:1276-1427` (`updateGrid`'s colDef block, `createColumnDef`,
 * `formatValue`, `getCellClass`, and the three type predicates). Extracted from the component rather
 * than inlined in it for two reasons that are the same reason: these are pure functions of a
 * `ColumnMetadata`, so they are the part of the grid a unit test can hold still — and the component
 * must build its `columnDefs` inside a `useMemo` keyed on `resultSet.columns`, which is only honest if
 * building them has no other inputs.
 *
 * ── The one deliberate divergence from the Angular output ─────────────────────────────────────
 *
 * Angular set `headerName` to `` `${column.name} 🔗` `` for a foreign-key column (`:1318`), and the
 * clipboard/export builders key their output off `headerName` — so a CSV header row and a JSON object
 * key both carried the emoji. That is data corruption for anything downstream of a copy: a script
 * looking for `customer_id` finds `customer_id 🔗`. The marker moves to where a marker belongs — the
 * `cell-fk` class (dotted underline, `results-grid-theme.css`) and the header tooltip, both of which
 * are still there — and `headerName` stays the column's actual name. Task 14 owns the FK preview
 * itself and can render a proper header component if the glyph is wanted back.
 */

import type { ColDef, ValueFormatterParams, ValueGetterParams } from 'ag-grid-community';
import type { ColumnMetadata } from '@joinery/shared';

/** Our own row-number column. Excluded from copy, export and auto-size, so its id is shared. */
export const ROW_NUMBER_COL_ID = 'rowNumber';

/** AG Grid's generated checkbox column. The id is the grid's, not ours — it is matched, never set. */
export const SELECTION_COL_ID = 'ag-Grid-SelectionColumn';

/** Neither of the two structural columns is data, so neither is ever copied or exported. */
export function isDataColumnId(colId: string): boolean {
  return colId !== ROW_NUMBER_COL_ID && colId !== SELECTION_COL_ID;
}

/**
 * A column's declared SQL type, lowercased.
 *
 * `type` is the field every provider sets; `dataType` is the alias `ColumnMetadata` also declares.
 * Both are read because a result set assembled by an older provider — or by a test fixture — may only
 * carry the alias, and the type predicates below must not silently treat every column as text when
 * that happens.
 */
function declaredType(column: ColumnMetadata): string {
  return (column.type ?? column.dataType ?? '').toLowerCase();
}

const NUMERIC_TYPES = [
  'int',
  'bigint',
  'smallint',
  'tinyint',
  'decimal',
  'numeric',
  'float',
  'real',
  'money',
  'smallmoney',
] as const;

const DATE_TYPES = [
  'date',
  'datetime',
  'datetime2',
  'smalldatetime',
  'time',
  'datetimeoffset',
] as const;

export function isNumericType(column: ColumnMetadata): boolean {
  const type = declaredType(column);
  return NUMERIC_TYPES.some(candidate => type.includes(candidate));
}

export function isBooleanType(column: ColumnMetadata): boolean {
  const type = declaredType(column);
  return type === 'bit' || type === 'boolean' || type === 'bool';
}

export function isDateType(column: ColumnMetadata): boolean {
  const type = declaredType(column);
  return DATE_TYPES.some(candidate => type.includes(candidate));
}

/**
 * What a cell shows. `NULL` for absent values — the grid paints it in the muted italic `cell-null`
 * treatment, which is how a real NULL is told apart from the string "NULL".
 *
 * Numbers go through `toLocaleString`, as they did in Angular: an integer with grouping separators,
 * a decimal capped at the column's `scale` (default 2). This is display only; every copy and export
 * path uses the raw value (`results-clipboard.ts`), so a pasted number is never locale-formatted.
 */
export function formatCellValue(value: unknown, column: ColumnMetadata): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: column.scale ?? 2,
    });
  }
  return String(value);
}

/**
 * The cell's classes: one for the value's shape, plus `cell-fk` when the column references another
 * table and this row has a value in it. Both are styled in `results-grid-theme.css` from tokens.
 */
export function cellClassesFor(value: unknown, column: ColumnMetadata): string[] {
  const classes: string[] = [];

  if (value === null || value === undefined) classes.push('cell-null');
  else if (isNumericType(column)) classes.push('cell-number');
  else if (isBooleanType(column)) classes.push('cell-boolean');
  else if (isDateType(column)) classes.push('cell-date');

  if (column.foreignKey !== undefined && value !== null && value !== undefined) {
    classes.push('cell-fk');
  }

  return classes;
}

/** The header's `title` attribute: the type, the FK target, and whether it is a key. */
export function headerTooltipFor(column: ColumnMetadata): string {
  const lines = [`${column.name} (${column.type ?? column.dataType ?? 'unknown'})`];
  if (column.foreignKey !== undefined) {
    const target = column.foreignKey;
    lines.push(
      `FK → ${target.referencedSchema}.${target.referencedTable}.${target.referencedColumn}`
    );
  }
  if (column.isPrimaryKey === true) lines.push('Primary Key');
  return lines.join('\n');
}

/** One data column. Width, filter type and alignment all follow from the declared SQL type. */
export function buildColumnDef(column: ColumnMetadata): ColDef {
  const colDef: ColDef = {
    field: column.name,
    // See the header: the name, not the name plus a link glyph.
    headerName: column.name,
    headerTooltip: headerTooltipFor(column),
    valueFormatter: (params: ValueFormatterParams) => formatCellValue(params.value, column),
    cellClass: params => cellClassesFor(params.value, column),
  };

  if (isNumericType(column)) {
    colDef.width = 120;
    colDef.type = 'numericColumn';
    colDef.filter = 'agNumberColumnFilter';
  } else if (isBooleanType(column)) {
    colDef.width = 80;
    colDef.filter = 'agTextColumnFilter';
  } else if (isDateType(column)) {
    colDef.width = 180;
    colDef.filter = 'agDateColumnFilter';
  } else if (column.maxLength !== undefined && column.maxLength > 0 && column.maxLength < 50) {
    colDef.width = Math.max(100, column.maxLength * 8);
    colDef.filter = 'agTextColumnFilter';
  } else {
    colDef.minWidth = 150;
    colDef.filter = 'agTextColumnFilter';
  }

  // A primary key is what a reader scans back to, so it stays on screen while they scroll right.
  if (column.isPrimaryKey === true) colDef.pinned = 'left';

  return colDef;
}

/**
 * The row-number column: the displayed (post-sort, post-filter) ordinal, pinned left, never sorted,
 * filtered, resized or copied.
 *
 * "Displayed" is only true with a partner: `node.rowIndex` IS the displayed index, but AG Grid does not
 * re-run a value getter for a row it merely re-positions, so the Angular grid's gutter kept its original
 * numbers and a descending sort read `5 4 3 2 1` down the # column. `<ResultsGrid>`'s `refreshOrdinals`
 * re-runs this getter on `sortChanged` and `filterChanged`; without it this column is decorative.
 */
export function rowNumberColumnDef(): ColDef {
  return {
    colId: ROW_NUMBER_COL_ID,
    headerName: '#',
    valueGetter: (params: ValueGetterParams) =>
      params.node?.rowIndex === null || params.node?.rowIndex === undefined
        ? ''
        : params.node.rowIndex + 1,
    width: 60,
    maxWidth: 80,
    pinned: 'left',
    sortable: false,
    filter: false,
    resizable: false,
    cellClass: 'row-number-cell',
    suppressSizeToFit: true,
    // Nothing in a generated ordinal is worth putting on the clipboard.
    suppressColumnsToolPanel: true,
  };
}

/**
 * Every column the grid shows, in order.
 *
 * `showRowNumbers` is `GridSettings.showRowNumbers`, which the Angular grid declared and then
 * ignored — the ordinal column was unconditional (`:1279-1291`). Honouring it here is the smaller
 * change: the setting already exists, is already persisted, and already has a name in the settings
 * type.
 */
export function buildColumnDefs(
  columns: readonly ColumnMetadata[],
  options: { readonly showRowNumbers: boolean }
): ColDef[] {
  const dataColumns = columns.map(column => buildColumnDef(column));
  return options.showRowNumbers ? [rowNumberColumnDef(), ...dataColumns] : dataColumns;
}

/** `defaultColDef`, ported verbatim from `:1243-1250`. Module-scoped so its identity is stable. */
export const DEFAULT_COL_DEF: ColDef = {
  sortable: true,
  filter: true,
  floatingFilter: true,
  resizable: true,
  minWidth: 80,
  suppressSizeToFit: false,
};
