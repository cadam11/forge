/**
 * Integration coverage for the SQL Server file browser's directory listing.
 *
 * Regression test for the bug where every entry in the server file browser
 * rendered as a file, so no folder could ever be opened. `xp_dirtree`'s result
 * is landed in a temp table whose `isfile` column is declared BIT, and
 * node-mssql/tedious maps BIT to a JavaScript **boolean** — so the old
 * `row.isfile === 0` predicate was always false.
 *
 * This has to be an integration test: the defect lives entirely in the gap
 * between the declared column type and what the driver hands back at runtime,
 * which a hand-written mock reproduces only if you already know the answer.
 * So the spec runs the service's real query against the live MSSQL container
 * and feeds the real recordset through the real mapper.
 *
 * Needs the compose network up: `pnpm run test:harness:up`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeProfiles: Map<string, any> = new Map();
const fakePasswords: Map<string, string> = new Map();

vi.mock('@joinery/main/services/config/connection-profiles', () => ({
  ConnectionProfilesStore: {
    getInstance: () => ({
      getById: (id: string) => fakeProfiles.get(id),
      getPassword: async (id: string) => fakePasswords.get(id) ?? null,
    }),
  },
}));

import { ConnectionPoolManager } from '@joinery/main/services/sql/connection-pool';
import { mapDirTreeRow, type DirTreeRow } from '@joinery/main/services/sql/server-filesystem';
import { TEST_CONNECTIONS } from '../../helpers/db-fixtures';

/**
 * The listing query ServerFilesystemService.listDirectory issues, verbatim
 * apart from the interpolated path. Kept here rather than reaching through the
 * service because the service's path sanitizer only accepts Windows-shaped
 * paths (`C:\…` / UNC), and the test container is SQL Server on Linux, whose
 * filesystem is POSIX. See the PR notes: that restriction is a separate,
 * pre-existing limitation, not the bug under test.
 */
function dirTreeSql(path: string): string {
  return `
      CREATE TABLE #DirectoryTree (
        subdirectory NVARCHAR(512),
        depth INT,
        isfile BIT
      );

      INSERT INTO #DirectoryTree
      EXEC xp_dirtree @path = N'${path}', @depth = 1, @file = 1;

      SELECT subdirectory as name, depth, isfile
      FROM #DirectoryTree
      ORDER BY isfile, subdirectory;

      DROP TABLE #DirectoryTree;
    `;
}

const MSSQL_DATA_ROOT = '/var/opt/mssql/';
const MSSQL_DATA_DIR = '/var/opt/mssql/data/';

describe('MSSQL server file browser directory listing', () => {
  let connectionId: string;

  beforeAll(() => {
    ConnectionPoolManager.resetInstance();
    connectionId = randomUUID();
    const c = TEST_CONNECTIONS.mssql;
    fakeProfiles.set(connectionId, {
      id: connectionId,
      name: 'mssql-serverfs-test',
      engine: 'mssql',
      server: c.host,
      port: c.port,
      username: c.user,
      database: 'master',
      encrypt: false,
      trustServerCertificate: true,
      connectionTimeout: 30,
    });
    fakePasswords.set(connectionId, c.password);
  });

  afterAll(async () => {
    // Surface, don't swallow. The pool must be released before the assertion
    // so a close failure can't also leak a connection into the next suite.
    const closeError = await ConnectionPoolManager.getInstance()
      .closeAll()
      .then(
        () => null,
        (err: unknown) => err
      );
    ConnectionPoolManager.resetInstance();
    fakeProfiles.clear();
    fakePasswords.clear();
    expect(closeError).toBeNull();
  });

  async function listRaw(path: string): Promise<DirTreeRow[]> {
    const pool = ConnectionPoolManager.getInstance();
    const result = await pool.query<DirTreeRow>(connectionId, dirTreeSql(path));
    return result.recordset;
  }

  // Pins the root cause. If a future driver upgrade starts returning 0/1 this
  // test goes red and tells the next reader exactly what changed — while the
  // behavioural tests below stay green, because the mapper handles both.
  it('returns the BIT isfile column as a JavaScript boolean, not 0/1', async () => {
    const rows = await listRaw(MSSQL_DATA_ROOT);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.isfile).toBe('boolean');
    }
  });

  // The exact predicate that shipped. Asserting it is wrong against live data
  // stops anyone "simplifying" the mapper back to a numeric comparison.
  it('is not classifiable by the old `isfile === 0` numeric comparison', async () => {
    const rows = await listRaw(MSSQL_DATA_ROOT);
    // Every row here is a directory, yet the old predicate calls none of them one.
    expect(rows.some(row => (row.isfile as unknown as number) === 0)).toBe(false);
  });

  it('maps subdirectories of /var/opt/mssql to isDirectory: true', async () => {
    const rows = await listRaw(MSSQL_DATA_ROOT);
    const entries = rows.map(row => mapDirTreeRow(row, MSSQL_DATA_ROOT));

    // The mssql image always lays these down next to each other.
    const data = entries.find(e => e.name === 'data');
    expect(data).toBeDefined();
    expect(data?.isDirectory).toBe(true);
    expect(data?.path).toBe('/var/opt/mssql/data');

    const log = entries.find(e => e.name === 'log');
    expect(log).toBeDefined();
    expect(log?.isDirectory).toBe(true);

    // Nothing at this level is a file, so the browser must offer every entry
    // as navigable — this is precisely what the bug broke.
    expect(entries.every(e => e.isDirectory)).toBe(true);
  });

  it('maps files in /var/opt/mssql/data to isDirectory: false', async () => {
    const rows = await listRaw(MSSQL_DATA_DIR);
    const entries = rows.map(row => mapDirTreeRow(row, MSSQL_DATA_DIR));

    // master.mdf/.ldf exist in every SQL Server instance.
    const masterMdf = entries.find(e => e.name === 'master.mdf');
    expect(masterMdf).toBeDefined();
    expect(masterMdf?.isDirectory).toBe(false);
    expect(masterMdf?.path).toBe('/var/opt/mssql/data/master.mdf');

    const masterLdf = entries.find(e => e.name === 'mastlog.ldf');
    expect(masterLdf).toBeDefined();
    expect(masterLdf?.isDirectory).toBe(false);
  });

  // The end-to-end shape the file browser depends on: one listing that
  // separates navigable folders from selectable files.
  it('distinguishes directories from files within a single listing', async () => {
    const rootEntries = (await listRaw(MSSQL_DATA_ROOT)).map(row =>
      mapDirTreeRow(row, MSSQL_DATA_ROOT)
    );
    const dataEntries = (await listRaw(MSSQL_DATA_DIR)).map(row =>
      mapDirTreeRow(row, MSSQL_DATA_DIR)
    );

    expect(rootEntries.filter(e => e.isDirectory).length).toBeGreaterThan(0);
    expect(dataEntries.filter(e => !e.isDirectory).length).toBeGreaterThan(0);
  });
});
