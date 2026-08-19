/**
 * The tool-result readers. Pure, so this is the cheapest place to pin the shapes the main process's
 * tools actually return — and the shapes are what a `unknown` result forces the UI to guess at.
 */

import { describe, expect, it } from 'vitest';

import {
  formatConversationDate,
  formatToolArgs,
  formatToolJson,
  readTableResult,
  toolCellText,
} from './tool-result';

describe('readTableResult', () => {
  it('reads a `rows` result and derives the columns from the first row', () => {
    const table = readTableResult({
      rows: [
        { id: 1, email: 'a@x.test' },
        { id: 2, email: 'b@x.test' },
      ],
    });

    expect(table?.columns).toEqual(['id', 'email']);
    expect(table?.rows).toHaveLength(2);
    expect(table?.truncated).toBe(false);
    expect(table?.totalRows).toBe(0);
  });

  it('prefers a declared `columns` list over the keys of the first row', () => {
    // Which matters for a sparse first row: a `SELECT id, note` whose first note is absent would
    // otherwise lose the column entirely.
    const table = readTableResult({ columns: ['id', 'note'], rows: [{ id: 1 }] });

    expect(table?.columns).toEqual(['id', 'note']);
  });

  it('reads MSSQL’s `recordset` and a bare array', () => {
    expect(readTableResult({ recordset: [{ n: 1 }] })?.rows).toEqual([{ n: 1 }]);
    expect(readTableResult([{ n: 1 }])?.rows).toEqual([{ n: 1 }]);
  });

  it('carries the truncation the tool reported', () => {
    const table = readTableResult({ rows: [{ id: 1 }], truncated: true, rowCount: 8000 });

    expect(table?.truncated).toBe(true);
    expect(table?.totalRows).toBe(8000);
  });

  it('is null for anything that is not a table', () => {
    expect(readTableResult({ created: true })).toBeNull();
    expect(readTableResult('done')).toBeNull();
    expect(readTableResult(null)).toBeNull();
    expect(readTableResult(undefined)).toBeNull();
  });

  it('reads an empty row set as a table with no columns rather than as no table', () => {
    // A query that matched nothing still ran; "no rows" and "not a table" have to render differently.
    const table = readTableResult({ rows: [] });

    expect(table).not.toBeNull();
    expect(table?.columns).toEqual([]);
  });
});

describe('toolCellText', () => {
  it('says NULL for an absent value, matching the results grid', () => {
    expect(toolCellText(null)).toBe('NULL');
    expect(toolCellText(undefined)).toBe('NULL');
  });

  it('does not format numbers, because a tool result carries no column scale', () => {
    expect(toolCellText(1234567)).toBe('1234567');
    expect(toolCellText(1.5)).toBe('1.5');
  });

  it('stringifies dates, booleans and objects', () => {
    expect(toolCellText(new Date('2026-08-16T09:00:00.000Z'))).toBe('2026-08-16T09:00:00.000Z');
    expect(toolCellText(true)).toBe('true');
    expect(toolCellText({ a: 1 })).toBe('{"a":1}');
  });

  it('keeps the string "NULL" distinguishable from a real one only by the grid’s styling', () => {
    // Documented rather than solved: both render as NULL. The grid has `cell-null` for the difference
    // and a tool table has no column metadata to hang one off.
    expect(toolCellText('NULL')).toBe('NULL');
  });
});

describe('formatToolArgs', () => {
  it('lifts SQL out, so a confirmation shows the statement rather than JSON', () => {
    expect(formatToolArgs({ sql: 'DROP TABLE orders', database: 'shop' })).toBe(
      'DROP TABLE orders'
    );
  });

  it('pretty-prints everything else', () => {
    expect(formatToolArgs({ table: 'orders' })).toBe('{\n  "table": "orders"\n}');
  });

  it('survives missing arguments', () => {
    expect(formatToolArgs(undefined)).toBe('{}');
  });

  it('does not lift a non-string `sql`', () => {
    expect(formatToolArgs({ sql: 42 })).toContain('"sql": 42');
  });
});

describe('formatToolJson', () => {
  it('reports the cut rather than silently truncating', () => {
    const big = { note: 'x'.repeat(6000) };
    const { text, cut } = formatToolJson(big);

    expect(cut).toBe(true);
    expect(text).toHaveLength(4000);
  });

  it('leaves a small result whole', () => {
    expect(formatToolJson({ ok: true })).toEqual({ text: '{\n  "ok": true\n}', cut: false });
  });
});

describe('formatConversationDate', () => {
  const now = new Date('2026-08-16T12:00:00.000Z');

  it('names today, yesterday and this week', () => {
    expect(formatConversationDate('2026-08-16T09:00:00.000Z', now)).toBe('Today');
    expect(formatConversationDate('2026-08-15T09:00:00.000Z', now)).toBe('Yesterday');
    expect(formatConversationDate('2026-08-12T09:00:00.000Z', now)).toBe('4d ago');
  });

  it('falls back to a date past a week', () => {
    expect(formatConversationDate('2026-07-04T09:00:00.000Z', now)).toBe('Jul 4');
  });

  it('reads a future timestamp as today rather than as a negative day count', () => {
    // A clock skew between two machines syncing a profile is enough to produce one.
    expect(formatConversationDate('2026-08-17T09:00:00.000Z', now)).toBe('Today');
  });

  it('is empty for an unparseable timestamp', () => {
    expect(formatConversationDate('not a date', now)).toBe('');
  });
});
