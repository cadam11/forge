/**
 * The clipboard formats, pinned byte for byte.
 *
 * This is a compatibility test, not a design test: `CopyFormat` is persisted, people paste this output
 * into spreadsheets and pipe it into scripts, and the Angular grid produced these exact strings for two
 * years. Every case below was read off `results-grid.component.ts:1568-1622` rather than invented, so a
 * failure here means the port changed the bytes — which is a bug even when the new bytes look nicer.
 */

import { describe, expect, it } from 'vitest';
import {
  buildClipboardText,
  buildDelimitedClipboard,
  buildJsonClipboard,
  copyScopeLabel,
  encodeDelimitedValue,
  formatValueForClipboard,
} from './results-clipboard';

const COLUMNS = [
  { id: 'id', header: 'id' },
  { id: 'email', header: 'email' },
] as const;

const ROWS = [
  { id: 1, email: 'a@example.com' },
  { id: 2, email: null },
] as const;

describe('formatValueForClipboard', () => {
  it('writes NULL for both absent forms', () => {
    expect(formatValueForClipboard(null)).toBe('NULL');
    expect(formatValueForClipboard(undefined)).toBe('NULL');
  });

  it('JSON-encodes objects and arrays, so a jsonb column survives a paste', () => {
    expect(formatValueForClipboard({ a: 1 })).toBe('{"a":1}');
    expect(formatValueForClipboard([1, 'two'])).toBe('[1,"two"]');
  });

  it('stringifies everything else without locale formatting', () => {
    // The grid DISPLAYS 1,234.5; the clipboard must carry 1234.5 or a spreadsheet reads two cells.
    expect(formatValueForClipboard(1234.5)).toBe('1234.5');
    expect(formatValueForClipboard(false)).toBe('false');
    expect(formatValueForClipboard(new Date('2026-08-16T00:00:00.000Z'))).toContain('2026');
  });
});

describe('encodeDelimitedValue — CSV is RFC 4180', () => {
  it('leaves an ordinary value unquoted', () => {
    expect(encodeDelimitedValue('plain', true)).toBe('plain');
  });

  it('quotes on a comma, a quote or a newline, and doubles inner quotes', () => {
    expect(encodeDelimitedValue('a,b', true)).toBe('"a,b"');
    expect(encodeDelimitedValue('say "hi"', true)).toBe('"say ""hi"""');
    expect(encodeDelimitedValue('two\nlines', true)).toBe('"two\nlines"');
    expect(encodeDelimitedValue('carriage\rreturn', true)).toBe('"carriage\rreturn"');
  });
});

describe('encodeDelimitedValue — TSV collapses instead of quoting', () => {
  it('replaces a run of tabs and newlines with one space', () => {
    // A spreadsheet paste has no quoting convention for a tab-separated cell, so an embedded tab
    // would silently become a new column.
    expect(encodeDelimitedValue('a\tb', false)).toBe('a b');
    expect(encodeDelimitedValue('a\r\n\r\nb', false)).toBe('a b');
    expect(encodeDelimitedValue('a,b', false)).toBe('a,b');
  });
});

describe('buildDelimitedClipboard', () => {
  it('writes the header row only when asked, and joins rows with \\n', () => {
    expect(buildDelimitedClipboard(ROWS, COLUMNS, '\t', true)).toBe(
      'id\temail\n1\ta@example.com\n2\tNULL'
    );
    expect(buildDelimitedClipboard(ROWS, COLUMNS, '\t', false)).toBe('1\ta@example.com\n2\tNULL');
  });

  it('quotes the header row too when the header itself needs it', () => {
    expect(buildDelimitedClipboard([{ 'a,b': 1 }], [{ id: 'a,b', header: 'a,b' }], ',', true)).toBe(
      '"a,b"\n1'
    );
  });

  it('reads values by column id, not by position, so a reordered grid still copies correctly', () => {
    const reversed = [
      { id: 'email', header: 'email' },
      { id: 'id', header: 'id' },
    ];
    expect(buildDelimitedClipboard(ROWS, reversed, ',', true)).toBe(
      'email,id\na@example.com,1\nNULL,2'
    );
  });
});

describe('buildJsonClipboard', () => {
  it('is an array of objects keyed by header, two-space indented', () => {
    expect(buildJsonClipboard(ROWS, COLUMNS)).toBe(
      `[
  {
    "id": 1,
    "email": "a@example.com"
  },
  {
    "id": 2,
    "email": null
  }
]`
    );
  });

  it('keeps JSON types rather than the clipboard string forms', () => {
    // The delimited formats write NULL; JSON writes null, and a number stays a number. A code
    // consumer is the whole point of the format.
    const parsed = JSON.parse(
      buildJsonClipboard(
        [{ n: 1.5, missing: undefined }],
        [
          { id: 'n', header: 'n' },
          { id: 'missing', header: 'missing' },
        ]
      )
    ) as { n: number; missing: null }[];
    expect(parsed[0]?.n).toBe(1.5);
    expect(parsed[0]?.missing).toBeNull();
  });
});

describe('buildClipboardText', () => {
  it('routes each format, and ignores includeHeaders for json', () => {
    const tsv = buildClipboardText({
      rows: ROWS,
      columns: COLUMNS,
      format: 'tsv',
      includeHeaders: true,
    });
    const csv = buildClipboardText({
      rows: ROWS,
      columns: COLUMNS,
      format: 'csv',
      includeHeaders: true,
    });
    const json = buildClipboardText({
      rows: ROWS,
      columns: COLUMNS,
      format: 'json',
      includeHeaders: false,
    });

    expect(tsv.split('\n')[0]).toBe('id\temail');
    expect(csv.split('\n')[0]).toBe('id,email');
    // `includeHeaders: false` did not remove the keys — for JSON the keys ARE the headers, which is
    // what settings.types.ts means by "ignored for json".
    expect(json).toContain('"email"');
  });
});

describe('copyScopeLabel', () => {
  it('says what was copied, and singularises', () => {
    expect(copyScopeLabel(3, true)).toBe('3 rows');
    expect(copyScopeLabel(1, true)).toBe('1 row');
    // No selection copies everything displayed, and the label is what makes that visible.
    expect(copyScopeLabel(412, false)).toBe('all 412 rows');
    expect(copyScopeLabel(1, false)).toBe('all 1 row');
  });
});
