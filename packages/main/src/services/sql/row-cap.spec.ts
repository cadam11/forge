import { describe, expect, it } from 'vitest';
import type { QueryResult } from '@mj-forge/shared';
import { applyRowCap } from './row-cap';

function result(rowsPerSet: number[]): QueryResult {
  return {
    queryId: 'q',
    success: true,
    executionTime: 1,
    resultSets: rowsPerSet.map(n => ({
      columns: [{ name: 'a', type: 'int' }],
      rows: Array.from({ length: n }, (_, i) => ({ a: i })),
      rowCount: n,
    })),
  };
}

describe('applyRowCap', () => {
  it('returns the result untouched when under the cap', () => {
    const r = result([5]);
    expect(applyRowCap(r, 10)).toBe(r);
  });

  it('returns the result untouched when no cap is set', () => {
    const r = result([5]);
    expect(applyRowCap(r, undefined)).toBe(r);
    expect(applyRowCap(r, 0)).toBe(r);
    expect(applyRowCap(r, -1)).toBe(r);
  });

  it('truncates oversized sets, marks them, and preserves the true count', () => {
    const capped = applyRowCap(result([25, 3]), 10);

    const [big, small] = capped.resultSets!;
    expect(big.rows).toHaveLength(10);
    expect(big.truncated).toBe(true);
    expect(big.rowCount).toBe(25);

    expect(small.rows).toHaveLength(3);
    expect(small.truncated).toBeUndefined();
  });

  it('handles results without resultSets', () => {
    const r: QueryResult = { queryId: 'q', success: false, executionTime: 0 };
    expect(applyRowCap(r, 10)).toBe(r);
  });
});
