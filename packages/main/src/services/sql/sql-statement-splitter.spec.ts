/**
 * Unit tests for the top-level SQL statement splitter. Pin the parsing
 * rules so that future changes to handle dollar quoting / quoted
 * identifiers / comments / etc. don't accidentally start splitting
 * mid-statement.
 */

import { describe, expect, it } from 'vitest';
import { splitTopLevelStatements } from './sql-statement-splitter';

describe('splitTopLevelStatements', () => {
  it('returns an empty array for empty input', () => {
    expect(splitTopLevelStatements('')).toEqual([]);
    expect(splitTopLevelStatements('   ')).toEqual([]);
    expect(splitTopLevelStatements(';;;')).toEqual([]);
  });

  it('returns a single statement when there are no separators', () => {
    expect(splitTopLevelStatements('SELECT 1')).toEqual(['SELECT 1']);
  });

  it('splits on top-level semicolons and trims each statement', () => {
    expect(splitTopLevelStatements('SELECT 1;\n\nSELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('preserves the kick-connections + DROP DATABASE batch the PG dialect emits', () => {
    const sql =
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'foo' AND pid <> pg_backend_pid();\n\n` +
      `DROP DATABASE "foo";`;
    expect(splitTopLevelStatements(sql)).toEqual([
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'foo' AND pid <> pg_backend_pid()`,
      `DROP DATABASE "foo"`,
    ]);
  });

  it('does not split on a semicolon inside a single-quoted string', () => {
    const sql = `SELECT 'a;b;c'; SELECT 2;`;
    expect(splitTopLevelStatements(sql)).toEqual([`SELECT 'a;b;c'`, 'SELECT 2']);
  });

  it('handles doubled-quote escapes inside string literals', () => {
    const sql = `SELECT 'O''Reilly; sons'; SELECT 2;`;
    expect(splitTopLevelStatements(sql)).toEqual([`SELECT 'O''Reilly; sons'`, 'SELECT 2']);
  });

  it('does not split on a semicolon inside a double-quoted identifier', () => {
    const sql = `SELECT * FROM "weird;name"; SELECT 2;`;
    expect(splitTopLevelStatements(sql)).toEqual([`SELECT * FROM "weird;name"`, 'SELECT 2']);
  });

  it('does not split on a semicolon inside a -- line comment', () => {
    const sql = `SELECT 1; -- next: SELECT 999;\nSELECT 2;`;
    expect(splitTopLevelStatements(sql)).toEqual(['SELECT 1', `-- next: SELECT 999;\nSELECT 2`]);
  });

  it('does not split on a semicolon inside a /* block */ comment', () => {
    const sql = `SELECT 1; /* split? ; not here */ SELECT 2;`;
    expect(splitTopLevelStatements(sql)).toEqual(['SELECT 1', `/* split? ; not here */ SELECT 2`]);
  });

  it('does not split inside a PG dollar-quoted block', () => {
    const sql =
      `CREATE FUNCTION bump() RETURNS void AS $body$\nBEGIN\n  RAISE NOTICE 'one; two';\nEND;\n$body$ LANGUAGE plpgsql;\n` +
      `SELECT 1;`;
    const parts = splitTopLevelStatements(sql);
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain('CREATE FUNCTION');
    expect(parts[0]).toContain('$body$');
    expect(parts[0]).not.toContain(';\nSELECT 1'); // didn't bleed into next statement
    expect(parts[1]).toBe('SELECT 1');
  });

  it('handles tag-less dollar quoting ($$...$$)', () => {
    const sql = `DO $$ BEGIN RAISE NOTICE 'a;b'; END $$;\nSELECT 1;`;
    const parts = splitTopLevelStatements(sql);
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain('DO $$');
    expect(parts[1]).toBe('SELECT 1');
  });

  it('drops empty statements created by trailing or doubled separators', () => {
    expect(splitTopLevelStatements('SELECT 1;;\nSELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
    expect(splitTopLevelStatements(';SELECT 1;')).toEqual(['SELECT 1']);
  });
});
