/**
 * Engine → dialect, both vocabularies, and the formatter's options.
 *
 * The mapping was written twice in the Angular component with no test on either copy, and the two
 * vocabularies differ in exactly the place a reader would get it wrong: MSSQL is Monaco's `sql` and
 * `sql-formatter`'s `tsql`.
 */

import { describe, expect, it } from 'vitest';
import { formatSql, formatterLanguageFor, monacoLanguageFor } from './sql-dialect';

describe('monacoLanguageFor', () => {
  it('maps each engine to its tokenizer', () => {
    expect(monacoLanguageFor('mssql')).toBe('sql');
    expect(monacoLanguageFor('postgresql')).toBe('pgsql');
    expect(monacoLanguageFor('mysql')).toBe('mysql');
  });

  it('falls back to T-SQL for an absent engine', () => {
    // A query tab can exist before its connection resolves; `sql` is the Angular default.
    expect(monacoLanguageFor(undefined)).toBe('sql');
  });
});

describe('formatterLanguageFor', () => {
  it('spells MSSQL `tsql`, not `sql`', () => {
    expect(formatterLanguageFor('mssql')).toBe('tsql');
    expect(formatterLanguageFor(undefined)).toBe('tsql');
  });

  it('maps the other two by name', () => {
    expect(formatterLanguageFor('postgresql')).toBe('postgresql');
    expect(formatterLanguageFor('mysql')).toBe('mysql');
  });
});

describe('formatSql', () => {
  it('uppercases keywords and breaks clauses onto their own lines', () => {
    expect(formatSql('select a,b from t where a=1', 'postgresql')).toBe(
      'SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  a = 1'
    );
  });

  it('uppercases data types and functions, per the ported options', () => {
    expect(formatSql('select cast(a as int) from t', 'mssql')).toContain('CAST');
    expect(formatSql('select cast(a as int) from t', 'mssql')).toContain('INT');
  });

  it('indents with two spaces regardless of the editor tab size', () => {
    // Deliberately not derived from `EditorSettings.tabSize` — see the note in `sql-dialect.ts`.
    expect(formatSql('select a from t', 'mysql')).toContain('\n  a');
  });

  it('puts two blank lines between statements', () => {
    expect(formatSql('select 1; select 2;', 'postgresql')).toBe('SELECT\n  1;\n\n\nSELECT\n  2;');
  });

  it('throws on SQL it cannot parse, so the caller can say why', () => {
    // The caller puts the message in a toast. `sql-formatter` names the token it choked on.
    expect(() => formatSql('select from where )(', 'postgresql')).toThrow();
  });
});
