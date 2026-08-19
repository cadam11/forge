/**
 * What the model is told about a result set, and the three quick questions the panel offers.
 *
 * Split out of the panel because it is the part with rules: how many rows leave the machine, which
 * columns are named, and what happens to a row whose value is a 4MB blob. A component cannot be tested
 * for those; a function can.
 *
 * ── The sample is CAPPED and the cap is the point ────────────────────────────────────────────
 *
 * `AnalysisRequest.resultSummary.sampleRows` goes to a third-party model API. The Angular panel sent
 * `resultSet.rows.slice(0, 10)` verbatim, which is the right row count and the wrong values: a `bytea`
 * column, a 30KB JSON document or a stored credential went out at full length, ten times over. Every
 * value is clamped here, and the clamp is stated in the request so the model is not left guessing why a
 * string ends mid-word.
 *
 * This is not a security boundary — the user asked for the analysis and the whole point is that the rows
 * leave. It is a proportionality one: ten rows of a wide table should not be a megabyte of egress, and a
 * truncated value cannot carry a whole secret.
 */

import type { AnalysisRequest, ResultSet } from '@joinery/shared';

/** How many rows the model is shown. The Angular figure, kept. */
export const SAMPLE_ROW_LIMIT = 10;

/**
 * How long one sampled value may be, in characters.
 *
 * 200 is enough for a sentence, an id, a timestamp or a short JSON object — everything a model needs to
 * tell what a column holds — and far short of a document.
 */
export const SAMPLE_VALUE_LIMIT = 200;

/** One of the panel's preset questions. */
export interface QuickAnalysis {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
}

/**
 * The three the Angular panel offered, with their prompts unchanged. They are here rather than in the
 * component so the panel's spec can assert that the button it clicked sent the prompt it names.
 */
export const QUICK_ANALYSES: readonly QuickAnalysis[] = [
  {
    id: 'summarize',
    label: 'Summarize',
    prompt: 'Provide a brief summary of these query results. What are the key findings?',
  },
  {
    id: 'patterns',
    label: 'Find patterns',
    prompt: 'Identify any interesting patterns, trends, or anomalies in these results.',
  },
  {
    id: 'suggestions',
    label: 'Suggest follow-ups',
    prompt: 'Based on these results, what follow-up queries or investigations would you suggest?',
  },
];

/**
 * A sampled cell. Long values are cut and marked; `null` and `undefined` stay themselves, because
 * "this column is mostly null" is a real finding and `''` would hide it.
 */
export function sampleValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  // A Date reaches the model as an ISO string rather than as `{}`, which is what `JSON.stringify` of a
  // Date inside an IPC-structured-cloned object would otherwise produce here.
  if (value instanceof Date) return value.toISOString();
  const text = typeof value === 'string' ? value : safeStringify(value);
  if (text.length <= SAMPLE_VALUE_LIMIT) return text;
  return `${text.slice(0, SAMPLE_VALUE_LIMIT)}… (${text.length} chars, truncated)`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // A cyclic or unserializable value: describe it rather than throw out of a click handler.
    return '[unserializable value]';
  }
}

/**
 * The request for one analysis.
 *
 * `rowCount` is the TRUE count (`resultSet.rowCount`), not `rows.length`, so a model asked about a
 * 2,000,000-row answer that the grid capped at 1,000 is told the real size. The Angular version had this
 * right and it is worth keeping right: "summarize these results" answered about 1,000 rows when there
 * were two million is a wrong answer that looks like a right one.
 */
export function buildAnalysisRequest(input: {
  readonly sql: string;
  readonly resultSet: ResultSet;
  readonly prompt: string;
}): AnalysisRequest {
  const { sql, resultSet, prompt } = input;
  return {
    sql,
    resultSummary: {
      columnCount: resultSet.columns.length,
      rowCount: resultSet.rowCount ?? resultSet.rows.length,
      columns: resultSet.columns.map(column => ({ name: column.name, type: column.type })),
      sampleRows: resultSet.rows.slice(0, SAMPLE_ROW_LIMIT).map(row => {
        const sampled: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) sampled[key] = sampleValue(value);
        return sampled;
      }),
    },
    prompt,
  };
}
