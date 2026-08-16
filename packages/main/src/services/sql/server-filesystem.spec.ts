/**
 * Unit coverage for the xp_dirtree row mapper.
 *
 * Regression guard for the server file browser bug where every entry — folders
 * included — rendered as a file, so no directory could ever be opened. The
 * temp table declares `isfile BIT`, and node-mssql/tedious maps BIT to a
 * JavaScript boolean; the old `row.isfile === 0` test is therefore always
 * false. These cases pin both the boolean form the real driver returns and the
 * numeric form a different driver or a hand-rolled mock might produce.
 */

import { describe, expect, it } from 'vitest';

import { mapDirTreeRow } from './server-filesystem';

describe('mapDirTreeRow', () => {
  describe('boolean BIT (what node-mssql/tedious actually returns)', () => {
    it('treats isfile=false as a directory', () => {
      const entry = mapDirTreeRow({ name: 'Backups', depth: 1, isfile: false }, 'C:\\');
      expect(entry.isDirectory).toBe(true);
    });

    it('treats isfile=true as a file', () => {
      const entry = mapDirTreeRow({ name: 'db.bak', depth: 1, isfile: true }, 'C:\\');
      expect(entry.isDirectory).toBe(false);
    });
  });

  describe('numeric BIT', () => {
    it('treats isfile=0 as a directory', () => {
      const entry = mapDirTreeRow({ name: 'Backups', depth: 1, isfile: 0 }, 'C:\\');
      expect(entry.isDirectory).toBe(true);
    });

    it('treats isfile=1 as a file', () => {
      const entry = mapDirTreeRow({ name: 'db.bak', depth: 1, isfile: 1 }, 'C:\\');
      expect(entry.isDirectory).toBe(false);
    });
  });

  it('joins the entry name onto the already-normalized parent path', () => {
    const entry = mapDirTreeRow({ name: 'nightly.bak', depth: 2, isfile: true }, 'C:\\Backups\\');
    expect(entry).toEqual({
      name: 'nightly.bak',
      path: 'C:\\Backups\\nightly.bak',
      isDirectory: false,
      depth: 2,
    });
  });
});
