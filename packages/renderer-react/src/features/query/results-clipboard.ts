/**
 * The three clipboard formats, byte for byte as the Angular grid produced them.
 *
 * Ported from `results-grid.component.ts:1568-1622` (`buildJsonClipboard`, `buildDelimitedClipboard`,
 * `encodeDelimitedValue`, `formatValueForClipboard`). This file is deliberately pure and deliberately
 * boring: `CopyFormat` is a persisted user setting (`settings.types.ts:33`) and people paste this
 * output into spreadsheets and feed it to scripts, so the encoding is a compatibility surface, not a
 * design decision. Every rule below is Angular's rule, and `results-clipboard.spec.ts` pins each one.
 *
 *   tsv   tab-separated, embedded tabs/newlines collapsed to a space so the row structure survives
 *         a paste into Excel or Sheets. Optional header row.
 *   csv   RFC 4180: quoted only when the value contains a comma, a quote or a newline; inner quotes
 *         doubled. Optional header row.
 *   json  an array of objects keyed by column header, pretty-printed with two spaces. `includeHeaders`
 *         does not apply — the keys *are* the headers, which is why the settings type says the flag is
 *         "ignored for json".
 *
 * Values are formatted for the clipboard, NOT for display: `NULL` for absent, `JSON.stringify` for
 * objects, `String(value)` for everything else. A number reaches the clipboard as `1234.5`, never as
 * the grid's locale-grouped `1,234.5` — see `grid-columns.ts:formatCellValue` for the display side.
 */

import type { CopyFormat } from '@joinery/shared';

/** One copied column: the row key to read, and the header to write. */
export interface ClipboardColumn {
  readonly id: string;
  readonly header: string;
}

export type ClipboardRow = Record<string, unknown>;

/** `NULL` for absent, JSON for objects, `String` for the rest. Angular's `formatValueForClipboard`. */
export function formatValueForClipboard(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * RFC 4180 quoting for CSV; tab/CR/LF runs collapsed to one space for TSV.
 *
 * The TSV branch is not laziness about quoting — a spreadsheet paste has no quoting convention for a
 * tab-separated cell, so an embedded tab would silently become a new column. Collapsing is the only
 * lossless-looking option, and it is what the Angular grid did.
 */
export function encodeDelimitedValue(value: string, isCsv: boolean): string {
  if (isCsv) {
    if (!/[",\n\r]/.test(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value.replace(/[\t\r\n]+/g, ' ');
}

export function buildDelimitedClipboard(
  rows: readonly ClipboardRow[],
  columns: readonly ClipboardColumn[],
  delimiter: ',' | '\t',
  includeHeaders: boolean
): string {
  const isCsv = delimiter === ',';
  const lines: string[] = [];
  if (includeHeaders) {
    lines.push(columns.map(column => encodeDelimitedValue(column.header, isCsv)).join(delimiter));
  }
  for (const row of rows) {
    lines.push(
      columns
        .map(column => encodeDelimitedValue(formatValueForClipboard(row[column.id]), isCsv))
        .join(delimiter)
    );
  }
  return lines.join('\n');
}

/**
 * An array of objects, keyed by header.
 *
 * `?? null` rather than leaving the key out: a JSON consumer reading `row.email` wants `null`, not
 * `undefined`-shaped absence, and every row must have the same keys for the array to be tabular.
 * Note this is the one format that does NOT run values through `formatValueForClipboard` — a number
 * stays a JSON number and a null stays a JSON null, which is Angular's behaviour and the only useful
 * one for a code consumer.
 */
export function buildJsonClipboard(
  rows: readonly ClipboardRow[],
  columns: readonly ClipboardColumn[]
): string {
  const projected = rows.map(row => {
    const object: Record<string, unknown> = {};
    for (const column of columns) object[column.header] = row[column.id] ?? null;
    return object;
  });
  return JSON.stringify(projected, null, 2);
}

/** The one entry point the grid calls. `includeHeaders` is ignored for `json`. */
export function buildClipboardText(options: {
  readonly rows: readonly ClipboardRow[];
  readonly columns: readonly ClipboardColumn[];
  readonly format: CopyFormat;
  readonly includeHeaders: boolean;
}): string {
  const { rows, columns, format, includeHeaders } = options;
  if (format === 'json') return buildJsonClipboard(rows, columns);
  return buildDelimitedClipboard(rows, columns, format === 'csv' ? ',' : '\t', includeHeaders);
}

/**
 * What the confirmation toast calls the thing that was copied.
 *
 * Ported from `:1523-1533`, including the rule behind it: with nothing selected, the button copies
 * ALL displayed rows rather than silently copying nothing (Craig's request, recorded in that comment).
 * The label is what makes the difference visible — "3 rows" vs "all 412 rows".
 */
export function copyScopeLabel(count: number, fromSelection: boolean): string {
  const plural = count === 1 ? 'row' : 'rows';
  return fromSelection ? `${count} ${plural}` : `all ${count} ${plural}`;
}
