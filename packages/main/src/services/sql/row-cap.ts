/**
 * Enforces the user's maxRowsToDisplay setting on query results before they
 * cross IPC. The full array otherwise travels to the renderer even though
 * the grid caps what a human can usefully scroll; truncating main-side
 * bounds both the structured-clone cost and renderer memory. `rowCount`
 * keeps the true received count so the grid can show "first N of M".
 */

import type { QueryResult, ResultSet } from '@forgedb/shared';

export function applyRowCap(result: QueryResult, maxRows?: number): QueryResult {
  if (!maxRows || maxRows <= 0 || !result.resultSets?.length) {
    return result;
  }

  let changed = false;
  const capped: ResultSet[] = result.resultSets.map(rs => {
    if (rs.rows.length <= maxRows) {
      return rs;
    }
    changed = true;
    return {
      ...rs,
      rowCount: rs.rowCount ?? rs.rows.length,
      rows: rs.rows.slice(0, maxRows),
      truncated: true,
    };
  });

  return changed ? { ...result, resultSets: capped } : result;
}
