/**
 * The per-engine SQL the context menus generate. Pure functions, so this is the cheapest place in
 * the task to pin the three-engine behaviour that would otherwise only be visible by connecting to
 * three servers.
 */

import { describe, expect, it } from 'vitest';
import {
  SYSTEM_DATABASES,
  defaultSchema,
  executeProcedure,
  isSystemDatabase,
  qualifiedTable,
  quoteIdentifier,
  scriptAsAlter,
  selectWithLimit,
} from './sql-text';

describe('quoteIdentifier', () => {
  it('uses each engine’s own delimiter', () => {
    expect(quoteIdentifier('orders', 'mssql')).toBe('[orders]');
    expect(quoteIdentifier('orders', 'postgresql')).toBe('"orders"');
    expect(quoteIdentifier('orders', 'mysql')).toBe('`orders`');
  });

  it('escapes the closing delimiter by doubling it', () => {
    // The injection case: an identifier a user could actually create.
    expect(quoteIdentifier('we]rd', 'mssql')).toBe('[we]]rd]');
    expect(quoteIdentifier('we"rd', 'postgresql')).toBe('"we""rd"');
    expect(quoteIdentifier('we`rd', 'mysql')).toBe('`we``rd`');
  });
});

describe('qualifiedTable', () => {
  it('is two-part on SQL Server and PostgreSQL', () => {
    expect(qualifiedTable('sales', 'orders', 'mssql')).toBe('[sales].[orders]');
    expect(qualifiedTable('public', 'orders', 'postgresql')).toBe('"public"."orders"');
  });

  it('is one-part on MySQL, whose schema slot IS the database', () => {
    expect(qualifiedTable('joinery_test', 'orders', 'mysql')).toBe('`orders`');
  });
});

describe('defaultSchema', () => {
  it('answers per engine, with MySQL empty', () => {
    expect(defaultSchema('mssql')).toBe('dbo');
    expect(defaultSchema('postgresql')).toBe('public');
    expect(defaultSchema('mysql')).toBe('');
  });
});

describe('selectWithLimit', () => {
  it('puts TOP before the list on SQL Server and LIMIT after it elsewhere', () => {
    expect(selectWithLimit('[a].[b]', 1000, 'mssql')).toBe('SELECT TOP 1000 * FROM [a].[b]');
    expect(selectWithLimit('"a"."b"', 200, 'postgresql')).toBe('SELECT * FROM "a"."b" LIMIT 200');
    expect(selectWithLimit('`b`', 200, 'mysql')).toBe('SELECT * FROM `b` LIMIT 200');
  });
});

describe('executeProcedure', () => {
  it('is EXEC on SQL Server and CALL elsewhere', () => {
    expect(executeProcedure('[dbo].[p]', 'mssql')).toBe('EXEC [dbo].[p]');
    expect(executeProcedure('"public"."p"', 'postgresql')).toBe('CALL "public"."p"()');
    expect(executeProcedure('`p`', 'mysql')).toBe('CALL `p`()');
  });
});

describe('scriptAsAlter', () => {
  it('rewrites the leading CREATE for each object kind', () => {
    expect(scriptAsAlter('CREATE VIEW v AS SELECT 1', 'VIEW')).toBe('ALTER VIEW v AS SELECT 1');
    expect(scriptAsAlter('create   function f()', 'FUNCTION')).toBe('ALTER FUNCTION f()');
  });

  it('keeps the abbreviated PROC keyword the server actually returned', () => {
    // The reason the keyword is a parameter: `CREATE PROC` is legal T-SQL and a naive
    // `CREATE PROCEDURE` replacement leaves it as a CREATE, which then fails as "already exists".
    expect(scriptAsAlter('CREATE PROC p AS SELECT 1', 'PROCEDURE')).toBe(
      'ALTER PROC p AS SELECT 1'
    );
    expect(scriptAsAlter('CREATE PROCEDURE p AS SELECT 1', 'PROCEDURE')).toBe(
      'ALTER PROCEDURE p AS SELECT 1'
    );
  });

  it('leaves a definition it does not recognise alone', () => {
    expect(scriptAsAlter('-- view definition not available', 'VIEW')).toBe(
      '-- view definition not available'
    );
  });
});

describe('isSystemDatabase', () => {
  it('names the four SQL Server system databases and nothing else', () => {
    expect(SYSTEM_DATABASES).toEqual(['master', 'msdb', 'model', 'tempdb']);
    for (const name of SYSTEM_DATABASES) {
      expect(isSystemDatabase(name)).toBe(true);
    }
    expect(isSystemDatabase('joinery_test')).toBe(false);
    expect(isSystemDatabase(undefined)).toBe(false);
  });
});
