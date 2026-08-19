/**
 * The execute-scope rules. These are the part of the query tab most likely to run the WRONG SQL, and in
 * the Angular renderer they were reachable only through a live Monaco instance, so nothing covered them.
 */

import { describe, expect, it } from 'vitest';
import { statementAtCursor, textToExecute } from './statements';

const lines = (sql: string): string[] => sql.split('\n');

describe('statementAtCursor', () => {
  it('returns the whole buffer when there is no boundary', () => {
    expect(statementAtCursor(lines('select 1\nfrom t'), 1)).toBe('select 1\nfrom t');
  });

  it('ends a statement on the line carrying the semicolon', () => {
    // The semicolon belongs to the statement it terminates.
    expect(statementAtCursor(lines('select 1;\nselect 2;'), 1)).toBe('select 1;');
  });

  it('starts the statement after the previous semicolon', () => {
    expect(statementAtCursor(lines('select 1;\nselect 2;'), 2)).toBe('select 2;');
  });

  it('excludes a GO line from both sides', () => {
    const sql = 'select 1\nGO\nselect 2\nGO\nselect 3';
    expect(statementAtCursor(lines(sql), 1)).toBe('select 1');
    expect(statementAtCursor(lines(sql), 3)).toBe('select 2');
    expect(statementAtCursor(lines(sql), 5)).toBe('select 3');
  });

  it('matches GO case-insensitively and with surrounding whitespace', () => {
    expect(statementAtCursor(lines('select 1\n  go  \nselect 2'), 3)).toBe('select 2');
  });

  it('does not treat GO inside a statement as a boundary', () => {
    // `GO` alone on its line is the batch separator; `go` as part of an identifier is not.
    expect(statementAtCursor(lines('select going\nfrom t'), 1)).toBe('select going\nfrom t');
  });

  it('trims the statement it returns', () => {
    expect(statementAtCursor(lines('select 1;\n\n  select 2  '), 3)).toBe('select 2');
  });

  it('clamps a caret line outside the buffer instead of returning nothing', () => {
    expect(statementAtCursor(lines('select 1'), 99)).toBe('select 1');
    expect(statementAtCursor(lines('select 1'), 0)).toBe('select 1');
  });

  it('is empty for an empty buffer', () => {
    expect(statementAtCursor([], 1)).toBe('');
  });

  it('keeps the whole line when a semicolon is mid-line — the documented limitation', () => {
    // Boundaries are line-granular, which the original said out loud. `select 1; select 2` is ONE
    // statement to this code. Asserted so the limitation is a decision rather than a surprise.
    expect(statementAtCursor(lines('select 1; select 2'), 1)).toBe('select 1; select 2');
  });
});

describe('textToExecute', () => {
  const source = { value: 'select 1;\nselect 2;', selection: '', cursorLine: 2 };

  it('sends the whole buffer under the `all` scope', () => {
    expect(textToExecute(source, 'all')).toBe('select 1;\nselect 2;');
  });

  it('sends the statement at the caret under `currentStatement`', () => {
    expect(textToExecute(source, 'currentStatement')).toBe('select 2;');
  });

  it('prefers a selection over either scope', () => {
    const selected = { ...source, selection: 'select 42' };
    expect(textToExecute(selected, 'all')).toBe('select 42');
    expect(textToExecute(selected, 'currentStatement')).toBe('select 42');
  });

  it('treats a whitespace-only selection as a real selection', () => {
    // Monaco's `isEmpty()` is a zero-WIDTH check, so this is what the original did — and it matters:
    // the caller's `!sql.trim()` guard then says "No query to execute" instead of silently running the
    // whole buffer because a blank line happened to be selected.
    expect(textToExecute({ ...source, selection: '   ' }, 'all')).toBe('   ');
  });
});
