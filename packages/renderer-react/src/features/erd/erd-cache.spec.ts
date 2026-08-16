/**
 * The diagram cache: its key, and the bound that stops it being a leak.
 *
 * It exists because Dockview unmounts a deactivated panel, so without it a tab switch costs a full
 * rebuild — see the module header. The two things worth asserting are the two that would break
 * silently: a key that conflates two different requests (you would see another table's diagram), and
 * an eviction order that never evicts (you would see nothing, for a session, until the memory ran out).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { ErdBuildResult } from './erd-adapter';
// `?raw` so the guard below reads the module's own source text, the same mechanism
// `markdown/sanitize-parity.spec.ts` uses. This package compiles without @types/node, so a
// filesystem read is not available here.
import CACHE_SOURCE from './erd-cache.ts?raw';
import {
  cachedErd,
  clearErdCache,
  erdCacheKey,
  forgetErd,
  MAX_CACHED_DIAGRAMS,
  rememberErd,
} from './erd-cache';

const result = (name: string): ErdBuildResult => ({
  nodes: [{ id: `dbo.${name}`, name, schemaName: 'dbo', fields: [] }],
  truncated: false,
});

beforeEach(clearErdCache);

describe('erdCacheKey', () => {
  it('is the same for the same request', () => {
    const request = {
      connectionId: 'c1',
      databaseName: 'db',
      tableName: 't',
      schema: 's',
      depth: 2,
    };
    expect(erdCacheKey(request)).toBe(erdCacheKey({ ...request }));
  });

  it('distinguishes a table-focused diagram from the whole database', () => {
    expect(erdCacheKey({ connectionId: 'c1', databaseName: 'db' })).not.toBe(
      erdCacheKey({ connectionId: 'c1', databaseName: 'db', tableName: 'orders' })
    );
  });

  it('distinguishes two depths of the same table', () => {
    const base = { connectionId: 'c1', databaseName: 'db', tableName: 'orders', schema: 'public' };
    expect(erdCacheKey({ ...base, depth: 1 })).not.toBe(erdCacheKey({ ...base, depth: 2 }));
  });

  it('distinguishes two connections to the same database name', () => {
    expect(erdCacheKey({ connectionId: 'c1', databaseName: 'db' })).not.toBe(
      erdCacheKey({ connectionId: 'c2', databaseName: 'db' })
    );
  });

  it('does not let a name containing a plausible separator collide with the next field', () => {
    // The reason the separator is a character no identifier can contain: a space, a colon and a dot
    // are all legal in a quoted identifier, so any of them would make these two the same key.
    for (const punctuation of [' ', ':', '.']) {
      expect(erdCacheKey({ connectionId: 'c1', databaseName: 'a', tableName: 'b' })).not.toBe(
        erdCacheKey({ connectionId: 'c1', databaseName: `a${punctuation}b` })
      );
    }
  });

  it('is built with a NUL written as an escape, never a literal NUL in the source', () => {
    // A raw NUL byte in a .ts file makes git classify it as binary: `git diff` prints "Binary files
    // differ" and `git grep` skips it, so every line of the module becomes invisible to review. The
    // first version of this file had two. The separator itself is unchanged.
    expect(CACHE_SOURCE).not.toContain('\u0000');
    expect(erdCacheKey({ connectionId: 'c1', databaseName: 'db' })).toContain('\u0000');
  });
});

describe('the cache', () => {
  it('returns what was remembered', () => {
    rememberErd('k', result('orders'));
    expect(cachedErd('k')?.nodes[0]?.name).toBe('orders');
  });

  it('is empty for an unknown key', () => {
    expect(cachedErd('nothing')).toBeUndefined();
  });

  it('forgets one entry, which is what Refresh does', () => {
    rememberErd('k', result('orders'));
    forgetErd('k');
    expect(cachedErd('k')).toBeUndefined();
  });

  it('never holds more than the bound', () => {
    for (let index = 0; index < MAX_CACHED_DIAGRAMS + 4; index += 1) {
      rememberErd(`k${index}`, result(`t${index}`));
    }

    const live = Array.from({ length: MAX_CACHED_DIAGRAMS + 4 }, (_value, index) =>
      cachedErd(`k${index}`)
    ).filter(entry => entry !== undefined);

    expect(live).toHaveLength(MAX_CACHED_DIAGRAMS);
  });

  it('evicts the oldest first', () => {
    for (let index = 0; index < MAX_CACHED_DIAGRAMS; index += 1) {
      rememberErd(`k${index}`, result(`t${index}`));
    }
    rememberErd('newest', result('newest'));

    expect(cachedErd('k0')).toBeUndefined();
    expect(cachedErd('k1')).toBeDefined();
    expect(cachedErd('newest')).toBeDefined();
  });

  it('moves a rewritten entry to the back of the eviction order', () => {
    // Otherwise a refreshed diagram would still be the next thing thrown away.
    for (let index = 0; index < MAX_CACHED_DIAGRAMS; index += 1) {
      rememberErd(`k${index}`, result(`t${index}`));
    }
    rememberErd('k0', result('t0-again'));
    rememberErd('newest', result('newest'));

    expect(cachedErd('k0')).toBeDefined();
    expect(cachedErd('k1')).toBeUndefined();
  });
});
