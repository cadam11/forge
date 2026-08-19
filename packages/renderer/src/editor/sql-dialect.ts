/**
 * Engine → dialect, for the two places a dialect matters in the editor: which Monaco tokenizer paints
 * the SQL, and which grammar `sql-formatter` parses it with.
 *
 * One module for both because they are the same decision with two vocabularies, and keeping them
 * apart is how the Angular renderer ended up with the mapping written twice —
 * `getEditorLanguage()` at `query.component.ts:1258-1263` and the `language` ternary inside
 * `formatSql()` at `:2373-2375` — with no shared source and no test on either.
 *
 * Both mappings are the Angular ones, unchanged: MSSQL is Monaco's `sql` (its tokenizer is T-SQL:
 * `keyword.try`, `NOLOCK`, `@@variables`) and `sql-formatter`'s `tsql`.
 */

import type { DatabaseEngine } from '@joinery/shared';
import { format as formatSqlText } from 'sql-formatter';

/** The three Monaco language ids this app registers models under. */
export type SqlLanguageId = 'sql' | 'pgsql' | 'mysql';

/** Monaco's tokenizer id. `sql` is T-SQL and is the fallback for an unknown or absent engine. */
export function monacoLanguageFor(engine: DatabaseEngine | undefined): SqlLanguageId {
  if (engine === 'postgresql') return 'pgsql';
  if (engine === 'mysql') return 'mysql';
  return 'sql';
}

/** `sql-formatter`'s grammar id. Same shape, different vocabulary — `tsql`, not `sql`. */
export function formatterLanguageFor(
  engine: DatabaseEngine | undefined
): 'tsql' | 'postgresql' | 'mysql' {
  if (engine === 'postgresql') return 'postgresql';
  if (engine === 'mysql') return 'mysql';
  return 'tsql';
}

/**
 * Formats SQL, or throws whatever `sql-formatter` threw.
 *
 * Options verbatim from `query.component.ts:2376-2384`. Deliberately NOT derived from
 * `EditorSettings.tabSize`: the formatter's two-space indent is a house style for stored SQL, the
 * editor's tab size is a typing preference, and coupling them would mean a user who prefers 4-space
 * tabs silently reformats every query they touch. Recorded here because the temptation is obvious.
 *
 * Throwing rather than returning a result union: the one caller has a toast to show and a
 * `notification.error` to fire, exactly as the Angular version did, and a union would just be
 * unwrapped at that call site.
 */
export function formatSql(sql: string, engine: DatabaseEngine | undefined): string {
  return formatSqlText(sql, {
    language: formatterLanguageFor(engine),
    tabWidth: 2,
    useTabs: false,
    keywordCase: 'upper',
    dataTypeCase: 'upper',
    functionCase: 'upper',
    linesBetweenQueries: 2,
  });
}
