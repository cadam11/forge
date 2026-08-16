/**
 * Chip parity with the toolbar line it replaces.
 *
 * `TOOLBAR_LINE` is a transcription of `query-toolbar.tsx`'s expression as Task 10 shipped it, and
 * every case below asserts the chip's formatter against it. That is the whole point of this file: a
 * chip that resolved its target differently from the thing that executes would be a lie about where
 * the next F5 goes, and the failure mode is silent.
 */

import { describe, expect, it } from 'vitest';
import type { ConnectionProfile } from '@joinery/shared';

import type { Tab } from '../../state/tab';
import { formatQueryContext, resolveConnectionSwitch, resolveQueryContext } from './query-context';

/** `query-toolbar.tsx:115` as Task 10 wrote it. Do not "simplify" — it is the reference. */
const TOOLBAR_LINE = (connectionName: string | null, databaseName: string | null): string =>
  `${connectionName ?? 'no connection'} · ${databaseName ?? 'no database'}`;

const PROFILES: readonly ConnectionProfile[] = [
  {
    id: 'conn-1',
    name: 'Test PG',
    engine: 'postgresql',
    color: '#c0ffee',
  } as ConnectionProfile,
  { id: 'conn-2', name: 'Prod MSSQL', engine: 'mssql' } as ConnectionProfile,
];

function tabOf(overrides: Partial<Tab> = {}): Tab {
  return { id: 'tab-1', type: 'query', title: 'Query 1', icon: 'code', ...overrides };
}

describe('resolveQueryContext', () => {
  it('reads the tab’s own connection and database — the two fields execute reads', () => {
    const context = resolveQueryContext(
      tabOf({ connectionId: 'conn-1', databaseName: 'joinery_test' }),
      PROFILES
    );
    expect(context).toEqual({
      connectionId: 'conn-1',
      connectionName: 'Test PG',
      databaseName: 'joinery_test',
      engine: 'postgresql',
      color: '#c0ffee',
    });
  });

  it('is empty for a tab with no connection', () => {
    expect(resolveQueryContext(tabOf(), PROFILES)).toEqual({
      connectionId: null,
      connectionName: null,
      databaseName: null,
      engine: null,
      color: null,
    });
  });

  it('names no profile when the tab points at a deleted one, but keeps the id', () => {
    const context = resolveQueryContext(
      tabOf({ connectionId: 'gone', databaseName: 'x' }),
      PROFILES
    );
    expect(context.connectionId).toBe('gone');
    expect(context.connectionName).toBeNull();
    expect(context.engine).toBeNull();
  });

  it('is empty for no tab at all — a panel whose tab has just closed', () => {
    expect(resolveQueryContext(undefined, PROFILES).connectionName).toBeNull();
  });

  it('does not invent a colour for a profile without one', () => {
    expect(resolveQueryContext(tabOf({ connectionId: 'conn-2' }), PROFILES).color).toBeNull();
  });
});

describe('formatQueryContext — byte-for-byte with the toolbar line', () => {
  const cases: readonly (readonly [string | null, string | null])[] = [
    ['Test PG', 'joinery_test'],
    ['Test PG', null],
    [null, 'joinery_test'],
    [null, null],
    ['a · b', 'c'],
  ];

  for (const [connectionName, databaseName] of cases) {
    it(`matches for ${String(connectionName)} / ${String(databaseName)}`, () => {
      expect(formatQueryContext({ connectionName, databaseName })).toBe(
        TOOLBAR_LINE(connectionName, databaseName)
      );
    });
  }

  it('matches for every resolution the resolver can produce from a tab', () => {
    for (const tab of [
      tabOf({ connectionId: 'conn-1', databaseName: 'joinery_test' }),
      tabOf({ connectionId: 'conn-1' }),
      tabOf({ connectionId: 'gone', databaseName: 'joinery_test' }),
      tabOf(),
    ]) {
      const context = resolveQueryContext(tab, PROFILES);
      expect(formatQueryContext(context)).toBe(
        TOOLBAR_LINE(context.connectionName, context.databaseName)
      );
    }
  });
});

describe('resolveConnectionSwitch', () => {
  it('takes the new connection’s resolved default database, not the old tab’s', () => {
    expect(resolveConnectionSwitch('conn-2', id => (id === 'conn-2' ? 'master' : 'shop'))).toEqual({
      connectionId: 'conn-2',
      databaseName: 'master',
    });
  });

  it('clears the database when the new connection resolves to none', () => {
    expect(resolveConnectionSwitch('conn-2', () => null)).toEqual({
      connectionId: 'conn-2',
      // `undefined`, not `null`: `Tab.databaseName` is optional, and `updateTab` merges.
      databaseName: undefined,
    });
  });
});
