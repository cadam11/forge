/**
 * Dropping the MAIN process's metadata caches — the half of an invalidation the renderer's own caches
 * cannot reach.
 *
 * ── Why this exists, and why it is one named function ────────────────────────────────────────
 *
 * `MetadataService` holds six `ObjectCache`s (databases, schemas, tables, views, procedures,
 * functions), each keyed by connection and database with a 60s TTL
 * (`packages/main/src/services/sql/metadata.ts:31-89`). Every list a user sees — the explorer's
 * children, the ERD's table set, Monaco's completions — is served through them, so a change the
 * renderer makes or observes is invisible until one of them expires.
 *
 * There **is** a door: `IPC_CHANNELS.EXPLORER.REFRESH_NODE` calls
 * `metadataService.invalidateConnection(connectionId)` — which drops the whole per-connection prefix
 * of all five list caches — and only then re-reads (`packages/main/src/ipc/explorer.ipc.ts:113-153`).
 * It was on the preload bridge since before this rewrite and **nothing in either renderer ever called
 * it**, which is why "Refresh" only ever re-ran the renderer's side of the read.
 *
 * The invalidation is per-CONNECTION; `databaseName` and the path only decide which list is re-warmed
 * on the way back, and the returned children are deliberately discarded here — the caller's own reload
 * is what puts them on screen. `'tables'` is the path asked for because the table list is the one every
 * other reader (ERD, completions, object tab) sits behind.
 *
 * One function rather than an `ipc().explorer.refreshNode(…)` at each call site: the argument order is
 * three positional strings, two of which are interchangeable to the type-checker.
 */

import { ipc } from './api';

/**
 * Drop every per-connection metadata list cache in the main process, then leave.
 *
 * **Rejects** rather than reporting: the caller decides. In particular the re-read that follows the
 * invalidation can fail on its own (a database dropped out from under `databaseName` is the ordinary
 * case) while the invalidation itself has already happened, so a rejection here is worth logging and
 * never worth abandoning the surrounding refresh for.
 */
export async function dropMainMetadataCaches(
  connectionId: string,
  databaseName: string
): Promise<void> {
  // Both are interpolated into cache keys and into `USE`/`\c` on the way through main; an empty one
  // would ask the server about a database with no name.
  if (connectionId === '' || databaseName === '') {
    throw new Error('dropMainMetadataCaches needs both a connection and a database');
  }
  await ipc().explorer.refreshNode(connectionId, databaseName, 'tables');
}
