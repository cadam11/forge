/**
 * A small bounded cache of built diagrams, keyed by the request that built them.
 *
 * This exists because **Dockview unmounts a panel when its tab is deactivated**, so without it every
 * switch away from an ERD tab and back would rebuild the whole diagram: two IPC calls per table, up
 * to 400 tables. The Angular component had the same problem and answered it with a field —
 * `if (this.currentTabId === tab.id && this.nodes().length > 0) return;` (`erd.component.ts:548`) —
 * which worked only because Golden Layout kept its components alive. A component-local guard cannot
 * survive an unmount, so the cache is module-level, exactly as `features/chat/chat-store-host.ts` is
 * and for the same reason.
 *
 * Bounded, because a session-long unbounded map of a few hundred nodes each is a leak with a
 * different name. Eight entries is more ERD tabs than anyone has open, and eviction is
 * insertion-order (a `Map` iterates in insertion order, and `remember` re-inserts on write so a
 * refreshed entry moves to the back).
 *
 * NOT keyed by tab id: two tabs on the same table of the same database are the same diagram, and a
 * tab whose database changed is a different one.
 */

import type { ErdBuildResult, ErdRequest } from './erd-adapter';

export const MAX_CACHED_DIAGRAMS = 8;

const cache = new Map<string, ErdBuildResult>();

/**
 * A NUL byte separates the fields of a cache key, and it is spelled as the escape `\u0000` — never
 * typed literally into this file. A raw NUL in the source makes git classify the file as binary,
 * which hides every one of its lines from `git diff`, `git grep` and PR review.
 *
 * A NUL rather than `:` or `.` because every other part of the key is a user-chosen identifier that
 * may contain any printable character: a schema called `a:b` must not collide with a database `a`
 * and a schema `b`. A NUL can appear in none of them.
 */
const KEY_SEPARATOR = '\u0000';

/** The identity of a request. */
export function erdCacheKey(request: ErdRequest): string {
  return [
    request.connectionId,
    request.databaseName,
    request.tableName ?? '',
    request.schema ?? '',
    String(request.depth ?? ''),
  ].join(KEY_SEPARATOR);
}

export function cachedErd(key: string): ErdBuildResult | undefined {
  return cache.get(key);
}

export function rememberErd(key: string, result: ErdBuildResult): void {
  // Delete first so a rewrite moves the entry to the back of the eviction order.
  cache.delete(key);
  cache.set(key, result);

  // A `while` rather than an `if`: the bound holds even if MAX_CACHED_DIAGRAMS is lowered later,
  // and the loop is bounded by the map's own size.
  while (cache.size > MAX_CACHED_DIAGRAMS) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
}

/** Refresh: drop this diagram so the next read rebuilds it. */
export function forgetErd(key: string): void {
  cache.delete(key);
}

/**
 * Drop **every** diagram of one database — the whole-database one and each table-focused one.
 *
 * Task 19a's create/rename fan-out needs this, and a single `forgetErd(key)` cannot serve it: the
 * caller there has a connection and a database name and no idea which of the eight cache slots are
 * diagrams of it. Prefix-matching the key is safe because the separator is a NUL, which none of the
 * fields may contain — so `db` cannot match `db2`, and a connection id is never a prefix of another
 * field's value.
 *
 * Why a rename needs it in *both* directions: the old name's diagrams describe a database that no
 * longer answers to that name, and the new name's are whatever a *previous* database of that name left
 * behind. The second is the one that shows a user tables that are not there.
 */
export function forgetErdForDatabase(connectionId: string, databaseName: string): void {
  const prefix = `${connectionId}${KEY_SEPARATOR}${databaseName}${KEY_SEPARATOR}`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** For specs, which must not inherit another spec's diagrams. */
export function clearErdCache(): void {
  cache.clear();
}
