import { describe, expect, it } from 'vitest';

import {
  ALL_SECTIONS,
  POSTGRES_REFUSAL,
  buildDiffQuery,
  canCompareDatabases,
  type DiffSections,
} from './diff-query';

const sections = (overrides: Partial<DiffSections> = {}): DiffSections => ({
  tables: false,
  views: false,
  routines: false,
  indexes: false,
  ...overrides,
});

function sqlOf(input: Parameters<typeof buildDiffQuery>[0]): string {
  const built = buildDiffQuery(input);
  if (!built.ok) throw new Error(built.reason);
  return built.sql;
}

describe('canCompareDatabases', () => {
  it('is false for PostgreSQL and true for the other two', () => {
    expect(canCompareDatabases('postgresql')).toBe(false);
    expect(canCompareDatabases('mssql')).toBe(true);
    expect(canCompareDatabases('mysql')).toBe(true);
  });
});

describe('buildDiffQuery — refusals', () => {
  it('refuses PostgreSQL with the reason, not with T-SQL', () => {
    // The Angular defect: it emitted bracketed three-part T-SQL for whatever engine was focused, so this
    // exact call produced a query tab that could not parse.
    const built = buildDiffQuery({
      engine: 'postgresql',
      source: 'a',
      target: 'b',
      sections: ALL_SECTIONS,
    });
    expect(built).toEqual({ ok: false, reason: POSTGRES_REFUSAL });
  });

  it('refuses the same database on both sides', () => {
    const built = buildDiffQuery({
      engine: 'mssql',
      source: 'same',
      target: 'same',
      sections: ALL_SECTIONS,
    });
    expect(built.ok).toBe(false);
  });

  it('refuses a missing side', () => {
    expect(
      buildDiffQuery({ engine: 'mssql', source: '', target: 'b', sections: ALL_SECTIONS }).ok
    ).toBe(false);
    expect(
      buildDiffQuery({ engine: 'mssql', source: 'a', target: '  ', sections: ALL_SECTIONS }).ok
    ).toBe(false);
  });

  it('refuses a request with nothing selected, rather than emitting a header and no query', () => {
    const built = buildDiffQuery({
      engine: 'mssql',
      source: 'a',
      target: 'b',
      sections: sections(),
    });
    expect(built).toEqual({ ok: false, reason: 'Choose at least one thing to compare.' });
  });
});

describe('buildDiffQuery — SQL Server', () => {
  it('emits only the sections asked for', () => {
    const tablesOnly = sqlOf({
      engine: 'mssql',
      source: 'prod',
      target: 'staging',
      sections: sections({ tables: true }),
    });
    expect(tablesOnly).toContain('TABLES AND COLUMNS');
    expect(tablesOnly).not.toContain('VIEWS');
    expect(tablesOnly).not.toContain('sys.indexes');

    const indexesOnly = sqlOf({
      engine: 'mssql',
      source: 'prod',
      target: 'staging',
      sections: sections({ indexes: true }),
    });
    expect(indexesOnly).toContain('sys.indexes');
    expect(indexesOnly).not.toContain('INFORMATION_SCHEMA.TABLES');
  });

  it('names both databases three-part, which is the thing SQL Server can do', () => {
    const sql = sqlOf({
      engine: 'mssql',
      source: 'prod',
      target: 'staging',
      sections: ALL_SECTIONS,
    });
    expect(sql).toContain('[prod].INFORMATION_SCHEMA.TABLES');
    expect(sql).toContain('[staging].INFORMATION_SCHEMA.TABLES');
  });

  it('escapes a bracket in a database name, in identifiers and in literals', () => {
    const sql = sqlOf({
      engine: 'mssql',
      source: 'od]d',
      target: "qu'ote",
      sections: sections({ tables: true }),
    });
    expect(sql).toContain('[od]]d]');
    expect(sql).toContain("'qu''ote only'");
    // And never the raw form, which is what the Angular interpolation produced.
    expect(sql).not.toContain('[od]d]');
  });

  it('compares functions as well as procedures', () => {
    // The Angular section filtered `ROUTINE_TYPE = 'PROCEDURE'` under a checkbox that did not say so.
    const sql = sqlOf({
      engine: 'mssql',
      source: 'a',
      target: 'b',
      sections: sections({ routines: true }),
    });
    expect(sql).toContain('INFORMATION_SCHEMA.ROUTINES');
    expect(sql).not.toContain("ROUTINE_TYPE = 'PROCEDURE'");
    // The type is compared rather than filtered, so a procedure and a function of the same name are two
    // different objects.
    expect(sql).toContain('t.ROUTINE_TYPE = s.ROUTINE_TYPE');
  });

  it('matches an index by its table as well as its name', () => {
    // Index names are not unique per database in SQL Server, so `WHERE t.name = s.name` alone reported
    // `IX_created_at` on `orders` as present because `invoices` also had one.
    const sql = sqlOf({
      engine: 'mssql',
      source: 'a',
      target: 'b',
      sections: sections({ indexes: true }),
    });
    expect(sql).toContain('ti.name = si.name AND tt.name = st.name');
    expect(sql).toContain('SCHEMA_NAME(tt.schema_id) = SCHEMA_NAME(st.schema_id)');
  });

  it('carries no timestamp, so regenerating produces the same text', () => {
    const first = sqlOf({ engine: 'mssql', source: 'a', target: 'b', sections: ALL_SECTIONS });
    const second = sqlOf({ engine: 'mssql', source: 'a', target: 'b', sections: ALL_SECTIONS });
    expect(first).toBe(second);
    expect(first).not.toMatch(/Generated \d/);
  });
});

describe('buildDiffQuery — MySQL', () => {
  it('compares two TABLE_SCHEMA values instead of two three-part names', () => {
    const sql = sqlOf({
      engine: 'mysql',
      source: 'prod',
      target: 'staging',
      sections: ALL_SECTIONS,
    });
    expect(sql).toContain("s.TABLE_SCHEMA IN ('prod', 'staging')");
    // The T-SQL-only spellings must be absent, or this is the Angular bug with a different label.
    expect(sql).not.toContain('[prod]');
    expect(sql).not.toContain('ISNULL(');
    expect(sql).not.toContain('FULL OUTER JOIN');
    expect(sql).not.toContain('sys.indexes');
  });

  it('reads indexes from information_schema.STATISTICS, one row per index', () => {
    const sql = sqlOf({
      engine: 'mysql',
      source: 'a',
      target: 'b',
      sections: sections({ indexes: true }),
    });
    expect(sql).toContain('information_schema.STATISTICS');
    // STATISTICS has a row per index COLUMN; without this every multi-column index is reported twice.
    expect(sql).toContain('s.SEQ_IN_INDEX = 1');
  });

  it('escapes quotes in a schema name', () => {
    const sql = sqlOf({
      engine: 'mysql',
      source: "it's",
      target: 'b',
      sections: sections({ views: true }),
    });
    expect(sql).toContain("'it''s'");
  });
});
