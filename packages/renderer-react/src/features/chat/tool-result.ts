/**
 * Reading what a tool call returned, and formatting what it was asked to do.
 *
 * A tool result crosses IPC as `unknown` (`ToolCallResult.result`), because the registry's tools
 * return whatever their operation returns — a row set from `run_query`, a `{ created: true }` from
 * `create_table`, a bare array from a list operation. So the shape has to be *read* rather than
 * typed, and this file is the one place that does it.
 *
 * ── Why one reader instead of the Angular five ─────────────────────────────────────────────
 *
 * `chat-panel.component.ts` had `isTableResult`, `getResultColumns`, `getResultRows`,
 * `isResultTruncated` and `getResultTotalRows`, all called FROM THE TEMPLATE — so
 * `getResultColumns(tc.result)` ran once per header cell and again once per cell of every row
 * (`:207,215`), each call re-deriving the column list by `Object.keys` on the first row. A 50×8
 * result therefore re-derived the columns 458 times per change-detection pass. One reader that
 * returns the whole shape once, memoised by the component that renders it, costs one pass.
 *
 * The recognition rules are the Angular ones, unchanged: `rows`, `recordset`, or the value itself
 * being an array; an explicit `columns` array wins over the keys of the first row; `truncated ===
 * true` and `rowCount` describe the cut.
 */

/** A tool result that can be shown as a table. */
export interface TableResult {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
  /** The tool cut the result short, so `rows` is a prefix of `totalRows`. */
  readonly truncated: boolean;
  /** How many rows there were before the cut. 0 when the tool did not say. */
  readonly totalRows: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function rowsOf(result: unknown): readonly Record<string, unknown>[] | null {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const record = asRecord(result);
  if (record === null) return null;
  if (Array.isArray(record['rows'])) return record['rows'] as Record<string, unknown>[];
  if (Array.isArray(record['recordset'])) return record['recordset'] as Record<string, unknown>[];
  return null;
}

/**
 * The table inside a tool result, or `null` when there is no table in it.
 *
 * `null` rather than a `{ isTable: false }` arm: the caller's other branch renders the raw JSON, so
 * "no table" is the absence of this shape rather than a variant of it.
 */
export function readTableResult(result: unknown): TableResult | null {
  const rows = rowsOf(result);
  if (rows === null) return null;

  const record = asRecord(result);
  const declared = record === null ? undefined : record['columns'];
  const columns = Array.isArray(declared)
    ? declared.map(column => String(column))
    : Object.keys(rows[0] ?? {});

  return {
    columns,
    rows,
    truncated: record?.['truncated'] === true,
    totalRows: typeof record?.['rowCount'] === 'number' ? record['rowCount'] : 0,
  };
}

/**
 * What one cell shows. Mirrors `features/query/grid-columns.ts:formatCellValue` in the one respect
 * a reader has to see — **`NULL` for an absent value**, so a real NULL is told apart from the string
 * — and deliberately does not mirror its number formatting: that function takes `ColumnMetadata` for
 * the decimal scale, and a tool result carries no column metadata at all. A locale-grouped number
 * here would be a guess dressed as a format.
 */
export function toolCellText(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The arguments a tool was called with, as the confirmation card shows them.
 *
 * `sql` is lifted out of the object because that is the argument a user is being asked to approve —
 * reading `DROP TABLE orders` out of a JSON blob with escaped newlines is how a confirmation stops
 * being one. Every other tool gets pretty-printed JSON. Ported from `formatToolArgs` (`:1530`).
 */
export function formatToolArgs(args: Record<string, unknown> | undefined): string {
  const sql = args?.['sql'];
  if (typeof sql === 'string') return sql;
  return JSON.stringify(args ?? {}, null, 2);
}

/** How much of a tool result is pretty-printed before the card truncates it. */
const JSON_PREVIEW_LIMIT = 4000;

/**
 * A non-table result, pretty-printed and bounded.
 *
 * The bound is the difference from Angular's `{{ tc.result | json }}`: a tool that returns a large
 * object put every character of it into the DOM inside a `<pre>` with no cap. The cut is announced
 * rather than silent.
 */
export function formatToolJson(result: unknown): { readonly text: string; readonly cut: boolean } {
  const text = JSON.stringify(result, null, 2) ?? String(result);
  if (text.length <= JSON_PREVIEW_LIMIT) return { text, cut: false };
  return { text: text.slice(0, JSON_PREVIEW_LIMIT), cut: true };
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * A conversation's age, as the list shows it: Today / Yesterday / `3d ago` / `Mar 4`.
 *
 * `now` is a parameter so the boundaries are testable without mocking the clock. Ported from
 * `formatDate` (`:1518`), including its `en-US` month/day format for the older-than-a-week case.
 */
export function formatConversationDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const days = Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
