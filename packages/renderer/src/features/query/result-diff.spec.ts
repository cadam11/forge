/**
 * The diff view model, over crafted `ResultDiff`s.
 *
 * The inputs here are literal `ResultDiff` objects, in the exact shape
 * `config/query-results-store.ts:compareSnapshots` produces — including its unordered `rowDiffs`
 * (compare-set order with the removed rows appended) and its `unchanged` entries, which carry no
 * row data at all. That is the honest unit boundary: main owns the comparison, this file owns what
 * a user reads, and re-implementing main's matching in a test helper would be an oracle that agrees
 * with itself. The comparison ITSELF is exercised against real snapshots in
 * `tests/e2e-react/result-history.spec.ts`, including the reordered case, whose behaviour
 * (key-matched, therefore unchanged) is asserted in both tiers.
 */

import { describe, expect, it } from 'vitest';
import type { ResultDiff, RowDiff } from '@joinery/shared';

import {
  buildDiffView,
  diffValueText,
  DIFF_CELL_LIMIT,
  DIFF_ROW_LIMIT,
  rowLabel,
} from './result-diff';

/** A `ResultDiff` with the row diffs supplied and the summary counted off them, as main counts it. */
function diffOf(rowDiffs: readonly RowDiff[], overrides: Partial<ResultDiff> = {}): ResultDiff {
  const count = (type: RowDiff['type']) => rowDiffs.filter(row => row.type === type).length;
  return {
    summary: {
      totalBaseRows: count('removed') + count('modified') + count('unchanged'),
      totalCompareRows: count('added') + count('modified') + count('unchanged'),
      addedRows: count('added'),
      removedRows: count('removed'),
      modifiedRows: count('modified'),
      unchangedRows: count('unchanged'),
      columnsAdded: 0,
      columnsRemoved: 0,
      columnsModified: 0,
      ...overrides.summary,
    },
    schemaDiff: {
      addedColumns: [],
      removedColumns: [],
      modifiedColumns: [],
      columnOrderChanged: false,
      ...overrides.schemaDiff,
    },
    rowDiffs: [...rowDiffs],
    metadata: {
      baseSnapshot: { id: 'base-1', executedAt: '2026-08-15T10:00:00.000Z', rowCount: 3 },
      compareSnapshot: { id: 'cmp-1', executedAt: '2026-08-15T10:05:00.000Z', rowCount: 3 },
      comparisonTimeMs: 2,
      ...overrides.metadata,
    },
  };
}

const UNCHANGED: RowDiff = { type: 'unchanged', rowIndex: 0, keyValues: { id: 1 } };

const ADDED: RowDiff = {
  type: 'added',
  rowIndex: 3,
  keyValues: { id: 4 },
  compareRow: { id: 4, email: 'new@x.test' },
};

const REMOVED: RowDiff = {
  type: 'removed',
  rowIndex: 2,
  keyValues: { id: 3 },
  baseRow: { id: 3, email: 'gone@x.test' },
};

const MODIFIED: RowDiff = {
  type: 'modified',
  rowIndex: 1,
  keyValues: { id: 2 },
  baseRow: { id: 2, email: 'old@x.test', note: null },
  compareRow: { id: 2, email: 'new@x.test', note: 'hi' },
  cellChanges: [
    { column: 'email', baseValue: 'old@x.test', compareValue: 'new@x.test' },
    { column: 'note', baseValue: null, compareValue: 'hi' },
  ],
};

describe('buildDiffView — the four row cases', () => {
  const view = buildDiffView(diffOf([ADDED, MODIFIED, UNCHANGED, REMOVED]));

  it('counts every kind, from main’s summary', () => {
    expect(view.counts).toMatchObject({ added: 1, removed: 1, modified: 1, unchanged: 1 });
  });

  it('drops the unchanged rows from what is drawn, and counts the rest', () => {
    expect(view.totalChanges).toBe(3);
    expect(view.rows.map(row => row.kind)).toEqual(['modified', 'removed', 'added']);
  });

  it('orders changed rows by row index, whatever order main appended them in', () => {
    expect(view.rows.map(row => row.rowIndex)).toEqual([1, 2, 3]);
  });

  it('labels a row by its key values', () => {
    expect(view.rows.map(row => row.label)).toEqual(['id=2', 'id=3', 'id=4']);
  });

  it('shows only the CHANGED cells of a modified row, both sides', () => {
    const modified = view.rows[0];
    expect(modified?.cells).toEqual([
      { column: 'email', before: 'old@x.test', after: 'new@x.test' },
      { column: 'note', before: 'NULL', after: 'hi' },
    ]);
  });

  it('shows an added row against an absent side, and a removed row the other way round', () => {
    const removed = view.rows[1];
    const added = view.rows[2];
    expect(removed?.cells).toEqual([
      { column: 'id', before: '3', after: null },
      { column: 'email', before: 'gone@x.test', after: null },
    ]);
    expect(added?.cells).toEqual([
      { column: 'id', before: null, after: '4' },
      { column: 'email', before: null, after: 'new@x.test' },
    ]);
  });

  it('is not identical', () => {
    expect(view.identical).toBe(false);
  });

  it('carries both snapshots’ metadata so the panel can name what it compared', () => {
    expect(view.base.id).toBe('base-1');
    expect(view.compare.executedAt).toBe('2026-08-15T10:05:00.000Z');
  });
});

describe('buildDiffView — the reordered case', () => {
  /**
   * Two runs of the same query with no ORDER BY. Main matches rows by key, so every row comes back
   * `unchanged` with a different `rowIndex` — there is no "moved" kind and no false positive.
   */
  const view = buildDiffView(
    diffOf([
      { type: 'unchanged', rowIndex: 2, keyValues: { id: 1 } },
      { type: 'unchanged', rowIndex: 0, keyValues: { id: 2 } },
      { type: 'unchanged', rowIndex: 1, keyValues: { id: 3 } },
    ])
  );

  it('reports no changes at all', () => {
    expect(view.rows).toEqual([]);
    expect(view.totalChanges).toBe(0);
    expect(view.counts.unchanged).toBe(3);
  });

  it('is identical', () => {
    expect(view.identical).toBe(true);
  });
});

describe('buildDiffView — schema changes', () => {
  const view = buildDiffView(
    diffOf([UNCHANGED], {
      schemaDiff: {
        addedColumns: ['nickname'],
        removedColumns: ['legacy_id'],
        modifiedColumns: [{ name: 'total', baseType: 'int4', compareType: 'numeric' }],
        columnOrderChanged: true,
      },
    })
  );

  it('renames the two sides of a retyped column to before/after', () => {
    expect(view.schema.modified).toEqual([{ name: 'total', before: 'int4', after: 'numeric' }]);
  });

  it('is not identical even with no row changes — the columns moved', () => {
    expect(view.schema.changed).toBe(true);
    expect(view.identical).toBe(false);
  });

  it('a column order change alone still counts as a schema change', () => {
    const reordered = buildDiffView(
      diffOf([UNCHANGED], {
        schemaDiff: {
          addedColumns: [],
          removedColumns: [],
          modifiedColumns: [],
          columnOrderChanged: true,
        },
      })
    );
    expect(reordered.schema.changed).toBe(true);
    expect(reordered.identical).toBe(false);
  });
});

describe('buildDiffView — the bounds', () => {
  it('draws at most the row limit and counts the remainder', () => {
    const many = Array.from({ length: DIFF_ROW_LIMIT + 25 }, (_, index): RowDiff => ({
      type: 'added',
      rowIndex: index,
      keyValues: { id: index },
      compareRow: { id: index },
    }));
    const view = buildDiffView(diffOf(many));

    expect(view.rows).toHaveLength(DIFF_ROW_LIMIT);
    expect(view.totalChanges).toBe(DIFF_ROW_LIMIT + 25);
    expect(view.hiddenRows).toBe(25);
  });

  it('draws at most the cell limit within one row and counts the remainder', () => {
    const wide: RowDiff = {
      type: 'modified',
      rowIndex: 0,
      keyValues: { id: 1 },
      cellChanges: Array.from({ length: DIFF_CELL_LIMIT + 3 }, (_, index) => ({
        column: `c${index}`,
        baseValue: index,
        compareValue: index + 1,
      })),
    };
    const [row] = buildDiffView(diffOf([wide])).rows;

    expect(row?.cells).toHaveLength(DIFF_CELL_LIMIT);
    expect(row?.hiddenCells).toBe(3);
  });

  it('takes an explicit limit, which is how the panel’s “show all” works', () => {
    const view = buildDiffView(diffOf([ADDED, MODIFIED, REMOVED]), { rows: 1 });
    expect(view.rows).toHaveLength(1);
    expect(view.hiddenRows).toBe(2);
  });
});

describe('the edges main’s own output has', () => {
  it('survives a modified row with no cellChanges array', () => {
    const [row] = buildDiffView(diffOf([{ type: 'modified', rowIndex: 0 }])).rows;
    expect(row?.cells).toEqual([]);
    expect(row?.label).toBe('row 1');
  });

  it('survives an added row with no compareRow', () => {
    const [row] = buildDiffView(diffOf([{ type: 'added', rowIndex: 5 }])).rows;
    expect(row?.cells).toEqual([]);
    expect(row?.label).toBe('row 6');
  });

  it('labels a composite key with every part', () => {
    expect(rowLabel({ type: 'added', rowIndex: 0, keyValues: { id: 1, region: 'eu' } })).toBe(
      'id=1 · region=eu'
    );
  });

  it('orders two changes at the same index deterministically', () => {
    const same = (type: RowDiff['type']): RowDiff => ({ type, rowIndex: 4, keyValues: { id: 9 } });
    const view = buildDiffView(diffOf([same('removed'), same('added'), same('modified')]));
    expect(view.rows.map(row => row.kind)).toEqual(['modified', 'added', 'removed']);
  });

  it('has an empty view for a diff with no rows at all', () => {
    const view = buildDiffView(diffOf([]));
    expect(view.identical).toBe(true);
    expect(view.counts).toMatchObject({ added: 0, removed: 0, modified: 0, unchanged: 0 });
  });
});

describe('diffValueText', () => {
  it('spells NULL out — a diff arrow with nothing after it says nothing', () => {
    expect(diffValueText(null)).toBe('NULL');
    expect(diffValueText(undefined)).toBe('NULL');
  });

  it('is ISO for a date and JSON for an object, both on one line', () => {
    expect(diffValueText(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01T00:00:00.000Z');
    expect(diffValueText({ a: 1 })).toBe('{"a":1}');
  });

  it('keeps false and 0 distinguishable from NULL', () => {
    expect(diffValueText(false)).toBe('false');
    expect(diffValueText(0)).toBe('0');
  });
});
