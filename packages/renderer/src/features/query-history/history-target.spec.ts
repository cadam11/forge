/**
 * The target resolution, including the Angular defect it corrects.
 */

import { describe, expect, it } from 'vitest';

import { resolveHistoryTarget } from './history-target';

const base = {
  entryConnectionId: 'server-a',
  entryDatabase: 'sales',
  isConnected: (id: string) => id === 'server-a',
  fallbackConnectionId: 'server-b' as string | null,
  fallbackDatabase: () => 'default-db' as string | null,
};

describe('resolveHistoryTarget', () => {
  it('opens on the connection the entry was recorded against', () => {
    // The bug this replaces: `QueryHistoryService.openInNewTab` used the FOCUSED connection, so an
    // entry from server A opened pointed at server B while showing A's database name.
    expect(resolveHistoryTarget(base)).toEqual({
      connectionId: 'server-a',
      databaseName: 'sales',
      redirected: false,
    });
  });

  it('falls back to the workbench when that server is gone, and says it redirected', () => {
    const target = resolveHistoryTarget({ ...base, isConnected: () => false });
    expect(target).toEqual({
      connectionId: 'server-b',
      // The database name is kept: the user asked for THAT query, and a same-named database on the
      // fallback server is the closest honest reading of it.
      databaseName: 'sales',
      redirected: true,
    });
  });

  it('uses the fallback database only when the entry has none', () => {
    // An entry written before the field existed. Its own server is still the right target.
    expect(resolveHistoryTarget({ ...base, entryDatabase: '' })).toEqual({
      connectionId: 'server-a',
      databaseName: 'default-db',
      redirected: false,
    });
  });

  it('answers null with nothing connected at all', () => {
    expect(
      resolveHistoryTarget({ ...base, isConnected: () => false, fallbackConnectionId: null })
    ).toBeNull();
  });

  it('answers null when neither the entry nor the fallback names a database', () => {
    // Refusing beats opening a tab with no database: the query would fail on execute with a message
    // about the statement rather than about the missing target.
    expect(
      resolveHistoryTarget({ ...base, entryDatabase: '', fallbackDatabase: () => null })
    ).toBeNull();
  });
});
