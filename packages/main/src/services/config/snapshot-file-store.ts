/**
 * File-per-snapshot storage engine for query result snapshots.
 *
 * Layout under `baseDir`:
 *   index.json   — small metadata index (everything except resultSets)
 *   <id>.json    — one full QueryResultSnapshot per file
 *
 * Why: the previous design kept every snapshot in one electron-store JSON
 * blob (observed at 51 MB on a real profile), re-serialized and written
 * synchronously on every query, and parsed whole at startup. Here startup
 * reads only the index; each save writes only its own file, asynchronously.
 *
 * Threading model: metadata mutations are synchronous and in-memory; file
 * and index writes are async and tracked, with `settle()` (tests/shutdown)
 * and `flushIndexSync()` (quit path) as the synchronization points. `load()`
 * consults the in-flight cache first, so a snapshot is always readable the
 * moment `add()` returns.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  promises as fsp,
} from 'node:fs';
import { join } from 'node:path';
import type { QueryResultSnapshot } from '@joinery/shared';
import { createLogger } from '../../utils/logger';
import { createTrailingDebounce, type TrailingDebounce } from '../../utils/trailing-debounce';

const log = createLogger('SnapshotFiles');

export type SnapshotMeta = Omit<QueryResultSnapshot, 'resultSets'>;

interface SnapshotIndex {
  version: number;
  lastCleanup: string;
  entries: SnapshotMeta[];
}

const INDEX_FILE = 'index.json';
const INDEX_DEBOUNCE_MS = 250;

export class SnapshotFileStore {
  private readonly baseDir: string;
  private index: SnapshotIndex;
  private readonly persistIndex: TrailingDebounce;
  /** Full snapshots whose file write hasn't settled yet. */
  private readonly inFlight = new Map<string, QueryResultSnapshot>();
  /** Outstanding async file operations (writes + unlinks). */
  private readonly pendingOps = new Set<Promise<unknown>>();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    mkdirSync(baseDir, { recursive: true });
    this.index = this.readIndex();
    this.persistIndex = createTrailingDebounce(() => this.writeIndexNow(), INDEX_DEBOUNCE_MS);
  }

  private readIndex(): SnapshotIndex {
    const empty: SnapshotIndex = {
      version: 2,
      lastCleanup: new Date().toISOString(),
      entries: [],
    };
    const indexPath = join(this.baseDir, INDEX_FILE);
    if (!existsSync(indexPath)) {
      return empty;
    }
    try {
      const parsed = JSON.parse(readFileSync(indexPath, 'utf-8')) as SnapshotIndex;
      if (!Array.isArray(parsed.entries)) {
        throw new Error('index.entries is not an array');
      }
      return parsed;
    } catch (error) {
      log.error('Corrupt snapshot index — starting empty (files can be swept later):', error);
      return empty;
    }
  }

  private writeIndexNow(): void {
    try {
      writeFileSync(join(this.baseDir, INDEX_FILE), JSON.stringify(this.index));
    } catch (error) {
      log.error('Failed to write snapshot index:', error);
    }
  }

  private track<T>(op: Promise<T>): void {
    const tracked: Promise<unknown> = op
      .catch(error => log.error('Snapshot file operation failed:', error))
      .finally(() => this.pendingOps.delete(tracked));
    this.pendingOps.add(tracked);
  }

  private filePath(id: string): string {
    // Snapshot ids are UUIDs we generate; keep the guard anyway so a
    // corrupted index can never produce a path outside baseDir.
    if (!/^[A-Za-z0-9-]+$/.test(id)) {
      throw new Error(`SnapshotFileStore: invalid snapshot id ${JSON.stringify(id)}`);
    }
    return join(this.baseDir, `${id}.json`);
  }

  /** Metadata copies, in index order (most recent first). */
  listMeta(): SnapshotMeta[] {
    return this.index.entries.map(e => ({ ...e }));
  }

  add(snapshot: QueryResultSnapshot): void {
    const { resultSets: _resultSets, ...meta } = snapshot;
    this.index.entries.unshift(meta);
    this.inFlight.set(snapshot.id, snapshot);

    const write = fsp
      .writeFile(this.filePath(snapshot.id), JSON.stringify(snapshot))
      .finally(() => this.inFlight.delete(snapshot.id));
    this.track(write);
    this.persistIndex.call();
  }

  load(id: string): QueryResultSnapshot | null {
    const pending = this.inFlight.get(id);
    if (pending) {
      return pending;
    }
    if (!this.index.entries.some(e => e.id === id)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(this.filePath(id), 'utf-8')) as QueryResultSnapshot;
    } catch (error) {
      log.error(`Failed to load snapshot ${id}:`, error);
      return null;
    }
  }

  remove(ids: string[]): number {
    const idSet = new Set(ids);
    const removed = this.index.entries.filter(e => idSet.has(e.id));
    if (removed.length === 0) {
      return 0;
    }
    this.index.entries = this.index.entries.filter(e => !idSet.has(e.id));
    for (const entry of removed) {
      this.inFlight.delete(entry.id);
      this.track(fsp.rm(this.filePath(entry.id), { force: true }));
    }
    this.persistIndex.call();
    return removed.length;
  }

  update(id: string, patch: Partial<SnapshotMeta>): boolean {
    const entry = this.index.entries.find(e => e.id === id);
    if (!entry) {
      return false;
    }
    Object.assign(entry, patch);
    this.persistIndex.call();
    return true;
  }

  getLastCleanup(): string {
    return this.index.lastCleanup;
  }

  setLastCleanup(iso: string): void {
    this.index.lastCleanup = iso;
    this.persistIndex.call();
  }

  /** Unlink snapshot files that are no longer referenced by the index. */
  async removeOrphans(): Promise<void> {
    const known = new Set(this.index.entries.map(e => `${e.id}.json`));
    known.add(INDEX_FILE);
    for (const file of readdirSync(this.baseDir)) {
      if (file.endsWith('.json') && !known.has(file)) {
        await fsp
          .rm(join(this.baseDir, file), { force: true })
          .catch(error => log.error(`Failed to sweep orphan ${file}:`, error));
      }
    }
  }

  /** Await all outstanding file IO and persist the index. */
  async settle(): Promise<void> {
    // Bounded: ops only drain unless callers keep adding concurrently.
    for (let round = 0; this.pendingOps.size > 0; round++) {
      if (round >= 1000) {
        throw new Error('SnapshotFileStore.settle: pending operations never drained');
      }
      await Promise.all([...this.pendingOps]);
    }
    this.persistIndex.cancel();
    this.writeIndexNow();
  }

  /** Synchronous index persist for the quit path (file writes are tracked separately). */
  flushIndexSync(): void {
    this.persistIndex.cancel();
    this.writeIndexNow();
  }
}
