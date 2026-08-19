/**
 * Server path arithmetic. Nine lines of index maths in the Angular original with a magic
 * `lastSlash <= 2`, and no test in the repo that could tell whether `C:\` went up to the drive list or
 * to a folder called `C`. This is that test.
 *
 * The POSIX cases are not hypothetical: SQL Server on Linux answers `getDefaultPaths` with
 * `/var/opt/mssql/data`, and the first version of this module hard-coded `\` — which built
 * `/var/opt/mssql/data\master_….bak` as the suggested destination. The Task 12 browser gate caught it
 * against the live container, and these are the assertions that keep it caught.
 */

import { describe, expect, it } from 'vitest';
import type { ServerFileEntry } from '@joinery/shared';

import {
  directoryOf,
  driveRootPath,
  fileNameOf,
  filterEntries,
  isDriveRoot,
  joinServerPath,
  parentServerPath,
  separatorOf,
  sortEntries,
  trimTrailingSeparator,
} from './server-path';

function entry(name: string, isDirectory: boolean): ServerFileEntry {
  return { name, path: `C:\\Backups\\${name}`, isDirectory, depth: 1 };
}

describe('separatorOf', () => {
  it('reads the separator off the path, defaulting to SQL Server’s own', () => {
    expect(separatorOf('C:\\Backups')).toBe('\\');
    expect(separatorOf('/var/opt/mssql/data')).toBe('/');
    // Nothing to read: `\` is what `xp_dirtree` speaks whatever the host OS is.
    expect(separatorOf('sales.bak')).toBe('\\');
    expect(separatorOf('')).toBe('\\');
    // Both present means something already appended the wrong one — stay on the character that is
    // actually in there rather than inventing a second.
    expect(separatorOf('/var/opt/mssql/data\\x.bak')).toBe('\\');
  });
});

describe('isDriveRoot', () => {
  it('accepts both spellings of a drive root and nothing below one', () => {
    expect(isDriveRoot('C:')).toBe(true);
    expect(isDriveRoot('C:\\')).toBe(true);
    expect(isDriveRoot('C:/')).toBe(true);
    expect(isDriveRoot('d:\\')).toBe(true);
    expect(isDriveRoot('C:\\Backups')).toBe(false);
    expect(isDriveRoot('')).toBe(false);
    expect(isDriveRoot('\\\\server\\share')).toBe(false);
  });

  it('accepts the POSIX root, for a Linux-hosted SQL Server', () => {
    expect(isDriveRoot('/')).toBe(true);
    expect(isDriveRoot('/var')).toBe(false);
  });
});

describe('trimTrailingSeparator', () => {
  it('leaves a drive root alone, because its separator is part of the name', () => {
    expect(trimTrailingSeparator('C:\\')).toBe('C:\\');
  });

  it('trims a folder’s trailing separator', () => {
    expect(trimTrailingSeparator('C:\\Backups\\')).toBe('C:\\Backups');
    expect(trimTrailingSeparator('C:\\Backups')).toBe('C:\\Backups');
  });
});

describe('joinServerPath', () => {
  it('never doubles the separator, whichever spelling the directory used', () => {
    expect(joinServerPath('C:\\Backups', 'sales.bak')).toBe('C:\\Backups\\sales.bak');
    expect(joinServerPath('C:\\Backups\\', 'sales.bak')).toBe('C:\\Backups\\sales.bak');
  });

  it('joins onto a drive root from either spelling', () => {
    expect(joinServerPath('C:\\', 'sales.bak')).toBe('C:\\sales.bak');
    // `C:sales.bak` is a RELATIVE path on Windows and names something else, so the separator is not
    // optional here.
    expect(joinServerPath('C:', 'sales.bak')).toBe('C:\\sales.bak');
  });

  it('keeps a POSIX directory POSIX — the bug the gate caught', () => {
    // `getDefaultPaths` on a Linux-hosted SQL Server answers this, and the first version produced
    // `/var/opt/mssql/data\master.bak`, which `BACKUP DATABASE TO DISK` would take literally.
    expect(joinServerPath('/var/opt/mssql/data', 'master.bak')).toBe(
      '/var/opt/mssql/data/master.bak'
    );
    expect(joinServerPath('/var/opt/mssql/data/', 'master.bak')).toBe(
      '/var/opt/mssql/data/master.bak'
    );
    expect(joinServerPath('/', 'master.bak')).toBe('/master.bak');
  });

  it('answers the bare name when there is no directory', () => {
    expect(joinServerPath('', 'sales.bak')).toBe('sales.bak');
  });
});

describe('parentServerPath', () => {
  it('goes up one folder', () => {
    expect(parentServerPath('C:\\Backups\\Nightly')).toBe('C:\\Backups');
    expect(parentServerPath('C:\\Backups\\Nightly\\')).toBe('C:\\Backups');
  });

  it('goes from a first-level folder to the drive’s BROWSABLE root, not to a bare letter', () => {
    // `C:` is not a path the listing call can read; `C:\` is. This is the case the Angular
    // `lastSlash <= 2` branch existed for and got right by accident.
    expect(parentServerPath('C:\\Backups')).toBe('C:\\');
  });

  it('answers null at a drive root, which the browser renders as the drive list', () => {
    expect(parentServerPath('C:\\')).toBeNull();
    expect(parentServerPath('C:')).toBeNull();
  });

  it('answers null for the drive list itself', () => {
    expect(parentServerPath('')).toBeNull();
  });

  it('walks a POSIX tree, stopping at the root rather than at the drive list', () => {
    expect(parentServerPath('/var/opt/mssql/data')).toBe('/var/opt/mssql');
    expect(parentServerPath('/var/opt/mssql/data/')).toBe('/var/opt/mssql');
    // `/var`'s parent is `/`, not `''` — `''` would jump straight to the drive list.
    expect(parentServerPath('/var')).toBe('/');
    expect(parentServerPath('/')).toBeNull();
  });
});

describe('directoryOf / fileNameOf', () => {
  it('splits a full file path', () => {
    expect(directoryOf('C:\\Backups\\sales.bak')).toBe('C:\\Backups');
    expect(fileNameOf('C:\\Backups\\sales.bak')).toBe('sales.bak');
  });

  it('keeps a file at a drive root browsable', () => {
    expect(directoryOf('C:\\sales.bak')).toBe('C:\\');
    expect(fileNameOf('C:\\sales.bak')).toBe('sales.bak');
  });

  it('answers the empty drive list for an empty path', () => {
    expect(directoryOf('')).toBe('');
    expect(fileNameOf('')).toBe('');
  });

  it('treats a bare name as having no directory', () => {
    expect(directoryOf('sales.bak')).toBe('');
    expect(fileNameOf('sales.bak')).toBe('sales.bak');
  });

  it('splits a POSIX path', () => {
    expect(directoryOf('/var/opt/mssql/data/master.bak')).toBe('/var/opt/mssql/data');
    expect(fileNameOf('/var/opt/mssql/data/master.bak')).toBe('master.bak');
    expect(directoryOf('/master.bak')).toBe('/');
  });
});

describe('driveRootPath', () => {
  it('makes a drive letter browsable, idempotently', () => {
    expect(driveRootPath('C:')).toBe('C:\\');
    expect(driveRootPath('C:\\')).toBe('C:\\');
  });
});

describe('sortEntries', () => {
  it('puts directories first, then names in order', () => {
    const sorted = sortEntries([
      entry('zeta.bak', false),
      entry('alpha.bak', false),
      entry('Nightly', true),
      entry('Archive', true),
    ]);
    expect(sorted.map(item => item.name)).toEqual(['Archive', 'Nightly', 'alpha.bak', 'zeta.bak']);
  });

  it('does not mutate its input, which comes from a query cache', () => {
    // `Array.prototype.sort` is in-place, and the Angular original sorted the cached array itself.
    const input = [entry('b.bak', false), entry('a.bak', false)];
    sortEntries(input);
    expect(input.map(item => item.name)).toEqual(['b.bak', 'a.bak']);
  });
});

describe('filterEntries', () => {
  const listing = [
    entry('Nightly', true),
    entry('sales.bak', false),
    entry('sales.mdf', false),
    entry('SALES.BAK', false),
  ];

  it('keeps every directory whatever the filter, so navigation still works', () => {
    const filtered = filterEntries(listing, 'bak');
    expect(filtered.map(item => item.name)).toEqual(['Nightly', 'sales.bak', 'SALES.BAK']);
  });

  it('is a no-op with no extension, which is what save mode passes', () => {
    // See the function's own note: filtering a SAVE browser both hides useful context and compounds
    // `server-filesystem.ts:112`'s BIT-as-boolean bug into an unnavigable, apparently-empty folder.
    expect(filterEntries(listing, undefined).map(item => item.name)).toEqual(
      listing.map(item => item.name)
    );
  });

  it('matches case-insensitively and accepts the dot either way', () => {
    expect(filterEntries(listing, '.bak')).toHaveLength(3);
    expect(filterEntries(listing, 'BAK')).toHaveLength(3);
  });

  it('keeps everything when no extension is named', () => {
    expect(filterEntries(listing, undefined)).toHaveLength(4);
  });

  it('does not mutate its input', () => {
    filterEntries(listing, 'bak');
    expect(listing).toHaveLength(4);
  });
});
