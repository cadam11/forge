import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SqlGlotClient } from '../../../packages/main/src/services/sql/sqlglot/sqlglot-client';
import type { TranspileResult } from '../../../packages/main/src/services/sql/sqlglot/types';

/**
 * Equivalence proof for the vendored sqlglot client.
 *
 * tests/fixtures/sqlglot/transpile-fixtures.json records the exact output of
 * @memberjunction/sqlglot-ts BEFORE it was vendored. These tests replay the same
 * inputs through the vendored client and require identical output — that is the
 * evidence the port changed nothing users can observe.
 *
 * Requires Python 3 with sqlglot, fastapi, uvicorn and pydantic. Skipped (not
 * failed) when they are absent, matching the backup CLI integration tests.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_PATH = path.join(REPO_ROOT, 'resources', 'python', 'sqlglot-server.py');
const FIXTURES_PATH = path.join(
  REPO_ROOT,
  'tests',
  'fixtures',
  'sqlglot',
  'transpile-fixtures.json'
);

interface Fixture {
  id: string;
  input: string;
  fromDialect: string;
  toDialect: string;
  success: boolean;
  sql: string;
  statements: string[];
  errors: string[];
  warnings: string[];
}

const fixtureFile = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as {
  capturedFrom: string;
  sqlglotVersion: string;
  cases: Fixture[];
};

/**
 * Find an interpreter with the required modules. FORGE_PYTHON lets a developer
 * point at a venv; otherwise the usual names are tried.
 */
function findPython(): string | null {
  const candidates = [process.env.FORGE_PYTHON, 'python3', 'python'].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-c', 'import sqlglot, fastapi, uvicorn, pydantic'], {
        stdio: 'ignore',
      });
      return candidate;
    } catch {
      // Missing interpreter or missing modules — try the next candidate.
    }
  }
  return null;
}

/** The sqlglot version the fixtures were recorded against, or null if unavailable. */
function installedSqlglotVersion(python: string): string | null {
  try {
    return execFileSync(python, ['-c', 'import sqlglot; print(sqlglot.__version__)'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

const python = findPython();
const describeIfPython = python ? describe : describe.skip;

if (!python) {
  console.warn(
    '[sqlglot] skipping equivalence tests — no Python with sqlglot/fastapi/uvicorn/pydantic found. ' +
      'Set FORGE_PYTHON to an interpreter that has them.'
  );
}

describeIfPython('vendored SqlGlotClient — equivalence with the replaced dependency', () => {
  let client: SqlGlotClient;
  let versionMatches = false;

  beforeAll(async () => {
    const installed = installedSqlglotVersion(python!);
    versionMatches = installed === fixtureFile.sqlglotVersion;
    if (!versionMatches) {
      console.warn(
        `[sqlglot] installed sqlglot ${installed} != recorded ${fixtureFile.sqlglotVersion}. ` +
          'Exact-output assertions are relaxed; the dialect-invariant assertions still run.'
      );
    }
    client = new SqlGlotClient({
      serverPath: SERVER_PATH,
      pythonPath: python!,
      startupTimeoutMs: 30000,
    });
    await client.start();
  }, 60000);

  afterAll(async () => {
    await client?.stop();
  });

  it('starts and reports a port', () => {
    expect(client.IsRunning).toBe(true);
    expect(client.Port).toBeGreaterThan(0);
  });

  // One test per recorded case, so a failure names the construct that broke.
  for (const fixture of fixtureFile.cases) {
    it(`reproduces "${fixture.id}" (${fixture.fromDialect} -> ${fixture.toDialect})`, async () => {
      const result: TranspileResult = await client.transpile(fixture.input, {
        fromDialect: fixture.fromDialect,
        toDialect: fixture.toDialect,
        pretty: true,
        errorLevel: 'WARN',
      });

      expect(result.success).toBe(fixture.success);

      if (versionMatches) {
        expect(result.sql).toBe(fixture.sql);
        expect(result.statements).toEqual(fixture.statements);
        expect(result.errors).toEqual(fixture.errors);
      }
    });
  }
});

describeIfPython('vendored SqlGlotClient — dialect invariants', () => {
  let client: SqlGlotClient;

  beforeAll(async () => {
    client = new SqlGlotClient({
      serverPath: SERVER_PATH,
      pythonPath: python!,
      startupTimeoutMs: 30000,
    });
    await client.start();
  }, 60000);

  afterAll(async () => {
    await client?.stop();
  });

  /**
   * Properties that hold regardless of sqlglot version, so this suite keeps
   * meaning after an upgrade makes the exact-output fixtures stale.
   */
  const INVARIANTS: Array<[string, string, string, string, RegExp]> = [
    ['TOP becomes LIMIT', 'SELECT TOP 10 * FROM users', 'tsql', 'postgres', /LIMIT 10/],
    ['ISNULL becomes COALESCE', "SELECT ISNULL(a, '') FROM t", 'tsql', 'postgres', /COALESCE/],
    [
      'GETDATE becomes CURRENT_TIMESTAMP',
      'SELECT GETDATE()',
      'tsql',
      'postgres',
      /CURRENT_TIMESTAMP/,
    ],
    ['brackets become double quotes', 'SELECT [a b] FROM [c d]', 'tsql', 'postgres', /"a b"/],
    ['brackets become backticks', 'SELECT [a b] FROM [c d]', 'tsql', 'mysql', /`a b`/],
    ['backticks become double quotes', 'SELECT `a b` FROM `c d`', 'mysql', 'postgres', /"a b"/],
    ['LIMIT becomes TOP', 'SELECT * FROM users LIMIT 10', 'postgres', 'tsql', /TOP 10/],
  ];

  for (const [name, sql, from, to, expected] of INVARIANTS) {
    it(name, async () => {
      const result = await client.transpile(sql, {
        fromDialect: from,
        toDialect: to,
        pretty: true,
        errorLevel: 'WARN',
      });
      expect(result.success).toBe(true);
      expect(result.sql).toMatch(expected);
    });
  }

  it('round-trips tsql -> postgres -> tsql back to a TOP clause', async () => {
    const toPg = await client.transpile('SELECT TOP 5 name FROM users', {
      fromDialect: 'tsql',
      toDialect: 'postgres',
      pretty: false,
      errorLevel: 'WARN',
    });
    const back = await client.transpile(toPg.sql, {
      fromDialect: 'postgres',
      toDialect: 'tsql',
      pretty: false,
      errorLevel: 'WARN',
    });
    expect(back.sql).toMatch(/TOP 5/);
  });
});

describeIfPython('vendored SqlGlotClient — lifecycle', () => {
  it('rejects transpiling before start()', async () => {
    const client = new SqlGlotClient({ serverPath: SERVER_PATH, pythonPath: python! });
    await expect(
      client.transpile('SELECT 1', { fromDialect: 'tsql', toDialect: 'postgres' })
    ).rejects.toThrow(/not running/);
  });

  it('start() is idempotent and keeps the same port', async () => {
    const client = new SqlGlotClient({
      serverPath: SERVER_PATH,
      pythonPath: python!,
      startupTimeoutMs: 30000,
    });
    try {
      await client.start();
      const port = client.Port;
      await client.start();
      expect(client.Port).toBe(port);
    } finally {
      await client.stop();
    }
  }, 60000);

  it('stop() leaves the client restartable', async () => {
    const client = new SqlGlotClient({
      serverPath: SERVER_PATH,
      pythonPath: python!,
      startupTimeoutMs: 30000,
    });
    try {
      await client.start();
      await client.stop();
      expect(client.IsRunning).toBe(false);

      await client.start();
      expect(client.IsRunning).toBe(true);
    } finally {
      await client.stop();
    }
  }, 60000);

  it('stop() on a client that never started is a no-op', async () => {
    const client = new SqlGlotClient({ serverPath: SERVER_PATH, pythonPath: python! });
    await expect(client.stop()).resolves.toBeUndefined();
  });
});

describe('vendored SqlGlotClient — configuration errors (no Python needed)', () => {
  it('refuses to construct without an explicit serverPath', () => {
    // Upstream auto-detected this and silently resolved inside app.asar.
    expect(() => new SqlGlotClient({} as never)).toThrow(/requires an explicit serverPath/);
  });

  it('names the missing script rather than blaming Python', async () => {
    const client = new SqlGlotClient({ serverPath: '/nonexistent/sqlglot-server.py' });
    await expect(client.start()).rejects.toThrow(/server script not found/);
  });

  it('ships the server script outside any asar archive', () => {
    expect(SERVER_PATH).not.toMatch(/app\.asar/);
    expect(() => readFileSync(SERVER_PATH, 'utf8')).not.toThrow();
  });
});
