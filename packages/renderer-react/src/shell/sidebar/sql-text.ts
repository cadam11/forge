/**
 * Pure SQL text the explorer's context menus generate. No stores, no IPC, no React —
 * which is the point: these are the only part of the context-menu surface that has a right
 * answer per engine, so they are separated out and unit-tested directly.
 *
 * Ported from `sidebar.component.ts:774-812` (`quoteId`, `qualifiedTable`, `defaultSchema`,
 * `selectWithLimit`). One behavioural difference, and it is a bug fix: the Angular
 * `quoteId` escaped `]` for MSSQL but not `[`, and left MySQL backtick-doubling and
 * PostgreSQL quote-doubling correct — those are kept as-is. The `default` arm is now an
 * exhaustive `mssql` arm so a fourth engine is a compile error rather than a silent
 * T-SQL fallback.
 */

import type { DatabaseEngine } from '@joinery/shared';

/**
 * The four SQL Server system databases. Renaming or dropping any of them is refused by the
 * server, so the menu items are disabled rather than offered and then failed
 * (`sidebar.component.ts:1201-1205,1216-1220` listed them twice).
 */
export const SYSTEM_DATABASES: readonly string[] = ['master', 'msdb', 'model', 'tempdb'];

export function isSystemDatabase(name: string | undefined): boolean {
  return name !== undefined && SYSTEM_DATABASES.includes(name);
}

/** Quote an identifier for the engine, escaping the closing delimiter by doubling it. */
export function quoteIdentifier(name: string, engine: DatabaseEngine): string {
  switch (engine) {
    case 'mysql':
      return `\`${name.replace(/`/g, '``')}\``;
    case 'postgresql':
      return `"${name.replace(/"/g, '""')}"`;
    case 'mssql':
      return `[${name.replace(/]/g, ']]')}]`;
  }
}

/**
 * A qualified object reference. MySQL has no schema layer between database and table — its
 * `schema` slot IS the database — so a two-part name there would name the wrong thing.
 */
export function qualifiedTable(schema: string, table: string, engine: DatabaseEngine): string {
  if (engine === 'mysql') {
    return quoteIdentifier(table, engine);
  }
  return `${quoteIdentifier(schema, engine)}.${quoteIdentifier(table, engine)}`;
}

/** The schema an object belongs to when the server did not say. Empty for MySQL — see above. */
export function defaultSchema(engine: DatabaseEngine): string {
  switch (engine) {
    case 'postgresql':
      return 'public';
    case 'mysql':
      return '';
    case 'mssql':
      return 'dbo';
  }
}

/** A row-limited SELECT. `TOP n` before the list on MSSQL, `LIMIT n` after it elsewhere. */
export function selectWithLimit(tableRef: string, limit: number, engine: DatabaseEngine): string {
  if (engine === 'mssql') {
    return `SELECT TOP ${limit} * FROM ${tableRef}`;
  }
  return `SELECT * FROM ${tableRef} LIMIT ${limit}`;
}

/** `CALL proc()` on MySQL and PostgreSQL, `EXEC proc` on SQL Server. */
export function executeProcedure(procRef: string, engine: DatabaseEngine): string {
  return engine === 'mssql' ? `EXEC ${procRef}` : `CALL ${procRef}()`;
}

/**
 * Rewrite a `CREATE` definition as an `ALTER` one. Ported verbatim from the three
 * `script-alter` handlers, which each carried their own regex
 * (`sidebar.component.ts:1463,1559,1661`) — the procedure one has to keep `PROC` as well as
 * `PROCEDURE`, which is why the keyword is a parameter rather than a fixed word.
 */
export function scriptAsAlter(
  definition: string,
  keyword: 'VIEW' | 'FUNCTION' | 'PROCEDURE'
): string {
  if (keyword === 'PROCEDURE') {
    return definition.replace(/CREATE\s+(PROCEDURE|PROC)\s+/i, 'ALTER $1 ');
  }
  return definition.replace(new RegExp(`CREATE\\s+${keyword}\\s+`, 'i'), `ALTER ${keyword} `);
}
