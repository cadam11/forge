/**
 * A `ResultDiff` as something a panel can render: counts, schema changes, and a bounded,
 * deterministically-ordered list of changed rows with their cell-level before/after.
 *
 * ── Who computes the diff, and why it is not this file ────────────────────────────────────────
 *
 * The main process does (`config/query-results-store.ts:353-615`), reached through
 * `queryResults.compareSnapshots`. That is deliberate and is not a thing to "fix" here: the rows
 * live on disk main-side (`getSnapshots` returns metadata only — `:177-181`), so a renderer-side
 * diff would mean shipping two whole result sets across IPC to re-derive an answer main can produce
 * from the files it already has open. What this renderer owns is the presentation, and that is what
 * is unit-tested here.
 *
 * Three properties of main's algorithm the panel has to be built around, because they are visible:
 *
 *  1. **Rows are matched by KEY, not by position** (`inferKeyColumns` at `:524-543`: a column named
 *     `id`, else the first `*id`-ish column, else the first column). So a result set whose rows came
 *     back in a different order with the same keys is `unchanged` throughout — `identical` is true
 *     and the panel says "no differences", which is the honest answer for a set with no ORDER BY.
 *  2. **`rowDiffs` arrives in compare-set order with the removed rows appended** (`:569-612`), which
 *     is an order no user asked for. `buildDiffView` sorts.
 *  3. **The comparison is capped at 10,000 rows per side** and only ever covers the FIRST result set
 *     (`:364-369`). Both are main's limits, restated in the panel's own copy rather than hidden.
 */

import type { ResultDiff, RowDiff } from '@joinery/shared';

/** How many changed rows the panel renders. Everything past this is counted, not drawn. */
export const DIFF_ROW_LIMIT = 200;

/** How many changed cells one row shows before "+N more". A 200-column row is not a diff. */
export const DIFF_CELL_LIMIT = 12;

export type DiffRowKind = 'added' | 'removed' | 'modified';

/** One column's before/after. `null` for a side the row does not exist on. */
export interface DiffCell {
  readonly column: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface DiffRowView {
  readonly kind: DiffRowKind;
  /** `id=3`, or `row 4` when the diff carried no key values. Stable enough to be a React key. */
  readonly label: string;
  readonly rowIndex: number;
  readonly cells: readonly DiffCell[];
  /** Changed cells beyond `DIFF_CELL_LIMIT`. Zero unless the row is very wide. */
  readonly hiddenCells: number;
}

export interface DiffCounts {
  readonly added: number;
  readonly removed: number;
  readonly modified: number;
  readonly unchanged: number;
  readonly baseRows: number;
  readonly compareRows: number;
}

export interface DiffSchemaView {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly modified: readonly {
    readonly name: string;
    readonly before: string;
    readonly after: string;
  }[];
  readonly orderChanged: boolean;
  readonly changed: boolean;
}

export interface DiffView {
  readonly counts: DiffCounts;
  readonly schema: DiffSchemaView;
  readonly rows: readonly DiffRowView[];
  /** Added + removed + modified, before the cap. */
  readonly totalChanges: number;
  /** Changed rows the cap left out. */
  readonly hiddenRows: number;
  /** No row changed and no column changed — the two sets say the same thing. */
  readonly identical: boolean;
  readonly base: { readonly id: string; readonly executedAt: string; readonly rowCount: number };
  readonly compare: { readonly id: string; readonly executedAt: string; readonly rowCount: number };
}

/**
 * Kind order within one row index, so two rows that changed at the same position always render in
 * the same order. Modified first because it is the case with the most to read.
 */
const KIND_RANK: Record<DiffRowKind, number> = { modified: 0, added: 1, removed: 2 };

export function buildDiffView(
  diff: ResultDiff,
  limits: { readonly rows?: number; readonly cells?: number } = {}
): DiffView {
  const rowLimit = limits.rows ?? DIFF_ROW_LIMIT;
  const cellLimit = limits.cells ?? DIFF_CELL_LIMIT;

  const changed = diff.rowDiffs.filter(isChanged).sort(compareRowDiffs);
  const rows = changed.slice(0, rowLimit).map(row => toRowView(row, cellLimit));

  const summary = diff.summary;
  const schema: DiffSchemaView = {
    added: diff.schemaDiff.addedColumns,
    removed: diff.schemaDiff.removedColumns,
    modified: diff.schemaDiff.modifiedColumns.map(column => ({
      name: column.name,
      before: column.baseType,
      after: column.compareType,
    })),
    orderChanged: diff.schemaDiff.columnOrderChanged,
    changed:
      diff.schemaDiff.addedColumns.length > 0 ||
      diff.schemaDiff.removedColumns.length > 0 ||
      diff.schemaDiff.modifiedColumns.length > 0 ||
      diff.schemaDiff.columnOrderChanged,
  };

  return {
    counts: {
      added: summary.addedRows,
      removed: summary.removedRows,
      modified: summary.modifiedRows,
      unchanged: summary.unchangedRows,
      baseRows: summary.totalBaseRows,
      compareRows: summary.totalCompareRows,
    },
    schema,
    rows,
    totalChanges: changed.length,
    hiddenRows: Math.max(0, changed.length - rows.length),
    // Read off the row diffs rather than the summary: the summary is main's arithmetic over the same
    // list, and the list is what the panel drew. If they ever disagree, the drawn one is the truth.
    identical: changed.length === 0 && !schema.changed,
    base: diff.metadata.baseSnapshot,
    compare: diff.metadata.compareSnapshot,
  };
}

function isChanged(row: RowDiff): boolean {
  return row.type !== 'unchanged';
}

function compareRowDiffs(left: RowDiff, right: RowDiff): number {
  if (left.rowIndex !== right.rowIndex) return left.rowIndex - right.rowIndex;
  const rank = KIND_RANK[left.type as DiffRowKind] - KIND_RANK[right.type as DiffRowKind];
  if (rank !== 0) return rank;
  return rowLabel(left).localeCompare(rowLabel(right));
}

function toRowView(row: RowDiff, cellLimit: number): DiffRowView {
  const kind = row.type as DiffRowKind;
  const cells = cellsFor(row, kind);
  return {
    kind,
    label: rowLabel(row),
    rowIndex: row.rowIndex,
    cells: cells.slice(0, cellLimit),
    hiddenCells: Math.max(0, cells.length - cellLimit),
  };
}

/**
 * What to show for one changed row.
 *
 * A **modified** row shows only the cells that changed, which is what `cellChanges` carries. An
 * **added** or **removed** row shows the whole row against nothing, because "what appeared" is the
 * change — the side that does not exist is `null` rather than an empty string, so the panel can
 * paint an absence differently from a NULL.
 */
function cellsFor(row: RowDiff, kind: DiffRowKind): DiffCell[] {
  if (kind === 'modified') {
    return (row.cellChanges ?? []).map(change => ({
      column: change.column,
      before: diffValueText(change.baseValue),
      after: diffValueText(change.compareValue),
    }));
  }
  const source = kind === 'added' ? row.compareRow : row.baseRow;
  if (source === undefined) return [];
  return Object.entries(source).map(([column, value]) => ({
    column,
    before: kind === 'added' ? null : diffValueText(value),
    after: kind === 'added' ? diffValueText(value) : null,
  }));
}

/** `id=3`, `id=3 · region=eu` for a composite key, `row N` when there are no key values. */
export function rowLabel(row: RowDiff): string {
  const keys = Object.entries(row.keyValues ?? {});
  if (keys.length === 0) return `row ${row.rowIndex + 1}`;
  return keys.map(([column, value]) => `${column}=${diffValueText(value)}`).join(' · ');
}

/**
 * A cell value as one line of diff text.
 *
 * `NULL` is spelled out here — unlike the row inspector, where an empty field is painted as a
 * treatment. A diff is a comparison of two texts, and `→` with nothing after it says nothing.
 */
export function diffValueText(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
