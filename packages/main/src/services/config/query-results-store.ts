/**
 * Query Results Storage
 * Stores query result snapshots with size limits and auto-pruning
 */

import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import type {
  QueryResultSnapshot,
  StoredResultSet,
  QueryResultHistoryFilter,
  ResultHistorySortOptions,
  PurgeOptions,
  PurgeResult,
  ResultStorageStats,
  ResultDiff,
  DiffOptions,
  DiffSummary,
  SchemaDiff,
  RowDiff,
  CellChange,
  ColumnDiff,
} from '@mj-forge/shared';
import type { QueryResult, ColumnMetadata } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';
import { SnapshotFileStore, type SnapshotMeta } from './snapshot-file-store';
import { dirname, join } from 'node:path';

const log = createLogger('QueryResults');

interface QueryResultsSchema {
  snapshots: QueryResultSnapshot[];
  version: number;
  lastCleanup: string;
}

const CONFIG = {
  MAX_STORAGE_SIZE_BYTES: 500 * 1024 * 1024, // 500 MB
  MAX_ROWS_PER_SNAPSHOT: 50000,
  MAX_SNAPSHOTS_PER_TAB: 50,
  DEFAULT_RETENTION_DAYS: 30,
  MIN_SNAPSHOTS_PER_TAB: 5,
  AUTO_CLEANUP_INTERVAL_HOURS: 24,
};

export class QueryResultsStore extends BaseSingleton {
  private files: SnapshotFileStore;

  /**
   * `baseDirOverride` exists for tests; production resolves the data dir
   * next to the legacy electron-store file and migrates it on first run.
   */
  constructor(baseDirOverride?: string) {
    super();
    if (baseDirOverride) {
      this.files = new SnapshotFileStore(baseDirOverride);
    } else {
      this.files = this.openWithLegacyMigration();
    }

    // Run cleanup on startup if needed
    this.maybeRunCleanup();
  }

  /**
   * One-time migration: the previous design held every snapshot in a single
   * electron-store JSON blob (seen at 51 MB in the wild), re-written
   * synchronously per query. Split it into file-per-snapshot storage, then
   * empty the legacy blob so this constructor is cheap forever after.
   */
  private openWithLegacyMigration(): SnapshotFileStore {
    const legacyStore = new Store<QueryResultsSchema>({
      name: 'query-results',
      defaults: {
        snapshots: [],
        version: 1,
        lastCleanup: new Date().toISOString(),
      },
    });
    const files = new SnapshotFileStore(join(dirname(legacyStore.path), 'query-results-data'));

    const legacy = legacyStore.get('snapshots', []);
    if (legacy.length > 0) {
      log.info(`Migrating ${legacy.length} snapshots from legacy blob to file-per-snapshot store`);
      for (let i = legacy.length - 1; i >= 0; i--) {
        files.add(legacy[i]);
      }
      files.setLastCleanup(legacyStore.get('lastCleanup') || new Date().toISOString());
      legacyStore.set('snapshots', []);
      log.info('Snapshot migration complete; legacy blob emptied');
    }
    return files;
  }

  /** Persist the metadata index now (quit path). */
  flush(): void {
    this.files.flushIndexSync();
  }

  /** Await outstanding snapshot file IO (tests + graceful shutdown). */
  settle(): Promise<void> {
    return this.files.settle();
  }

  /**
   * Save a query result snapshot
   */
  saveSnapshot(
    tabId: string,
    sql: string,
    connectionId: string,
    database: string,
    result: QueryResult
  ): QueryResultSnapshot {
    // Truncate rows if necessary
    const resultSets: StoredResultSet[] = (result.resultSets || []).map(rs => {
      const rows =
        rs.rows.length > CONFIG.MAX_ROWS_PER_SNAPSHOT
          ? rs.rows.slice(0, CONFIG.MAX_ROWS_PER_SNAPSHOT)
          : rs.rows;

      return {
        columns: rs.columns,
        rowCount: rs.rowCount || rows.length,
        rows,
        checksum: this.calculateChecksum(rows),
      };
    });

    // Calculate total row count and storage size
    const totalRowCount = resultSets.reduce((sum, rs) => sum + rs.rowCount, 0);
    const storageSizeBytes = this.calculateSize(resultSets);

    const snapshot: QueryResultSnapshot = {
      id: uuidv4(),
      tabId,
      sql: sql.substring(0, 10000), // Limit SQL size
      connectionId,
      database,
      executedAt: new Date().toISOString(),
      executionTimeMs: result.executionTimeMs || result.executionTime || 0,
      success: result.success,
      error: result.error,
      totalRowCount,
      storageSizeBytes,
      resultSets,
    };

    // Add to beginning (most recent first)
    this.files.add(snapshot);

    // Enforce per-tab limit
    const tabSnapshots = this.files.listMeta().filter(s => s.tabId === tabId);
    if (tabSnapshots.length > CONFIG.MAX_SNAPSHOTS_PER_TAB) {
      // Remove oldest unpinned snapshots for this tab
      const toRemove = tabSnapshots
        .filter(s => !s.isPinned)
        .slice(CONFIG.MAX_SNAPSHOTS_PER_TAB - 1);
      this.files.remove(toRemove.map(s => s.id));
    }

    // Check total storage and cleanup if needed
    this.enforceStorageLimit();

    return snapshot;
  }

  /**
   * Get snapshots with optional filtering and sorting
   */
  getSnapshots(
    filter?: QueryResultHistoryFilter,
    sort?: ResultHistorySortOptions
  ): QueryResultSnapshot[] {
    // Metadata only — resultSets stay on disk. Callers that need rows fetch
    // the single snapshot by id (GET_SNAPSHOT); the renderer hydrates on view.
    let snapshots: QueryResultSnapshot[] = this.files
      .listMeta()
      .map(m => ({ ...m, resultSets: [] as StoredResultSet[] }));

    // Apply filters
    if (filter) {
      if (filter.tabId) {
        snapshots = snapshots.filter(s => s.tabId === filter.tabId);
      }
      if (filter.connectionId) {
        snapshots = snapshots.filter(s => s.connectionId === filter.connectionId);
      }
      if (filter.database) {
        snapshots = snapshots.filter(
          s => s.database.toLowerCase() === filter.database!.toLowerCase()
        );
      }
      if (filter.startDate) {
        const start = new Date(filter.startDate);
        snapshots = snapshots.filter(s => new Date(s.executedAt) >= start);
      }
      if (filter.endDate) {
        const end = new Date(filter.endDate);
        snapshots = snapshots.filter(s => new Date(s.executedAt) <= end);
      }
      if (filter.successOnly) {
        snapshots = snapshots.filter(s => s.success);
      }
      if (filter.offset && filter.offset > 0) {
        snapshots = snapshots.slice(filter.offset);
      }
      if (filter.limit && filter.limit > 0) {
        snapshots = snapshots.slice(0, filter.limit);
      }
    }

    // Apply sorting
    if (sort) {
      const multiplier = sort.order === 'asc' ? 1 : -1;
      snapshots.sort((a, b) => {
        const aVal = a[sort.field];
        const bVal = b[sort.field];
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return aVal.localeCompare(bVal) * multiplier;
        }
        return ((aVal as number) - (bVal as number)) * multiplier;
      });
    }

    return snapshots;
  }

  /**
   * Get a single snapshot by ID
   */
  getSnapshot(id: string): QueryResultSnapshot | null {
    return this.files.load(id);
  }

  /**
   * Delete a single snapshot
   */
  deleteSnapshot(id: string): boolean {
    return this.files.remove([id]) === 1;
  }

  /**
   * Delete multiple snapshots
   */
  deleteSnapshots(ids: string[]): number {
    return this.files.remove(ids);
  }

  /**
   * Pin a snapshot (exclude from auto-purge)
   */
  pinSnapshot(id: string): boolean {
    return this.updateSnapshot(id, { isPinned: true });
  }

  /**
   * Unpin a snapshot
   */
  unpinSnapshot(id: string): boolean {
    return this.updateSnapshot(id, { isPinned: false });
  }

  /**
   * Set label for a snapshot
   */
  labelSnapshot(id: string, label: string): boolean {
    return this.updateSnapshot(id, { label: label || undefined });
  }

  /**
   * Get storage statistics
   */
  getStorageStats(): ResultStorageStats {
    const snapshots = this.files.listMeta();

    const totalSizeBytes = snapshots.reduce((sum, s) => sum + s.storageSizeBytes, 0);
    const snapshotsByTab: Record<string, number> = {};

    for (const s of snapshots) {
      snapshotsByTab[s.tabId] = (snapshotsByTab[s.tabId] || 0) + 1;
    }

    const sortedByDate = [...snapshots].sort(
      (a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime()
    );

    return {
      totalSnapshots: snapshots.length,
      totalSizeBytes,
      oldestSnapshot: sortedByDate[0]?.executedAt || null,
      newestSnapshot: sortedByDate[sortedByDate.length - 1]?.executedAt || null,
      snapshotsByTab,
    };
  }

  /**
   * Purge snapshots based on options
   */
  purge(options: PurgeOptions): PurgeResult {
    const snapshots = this.files.listMeta();
    const originalCount = snapshots.length;
    const originalSize = snapshots.reduce((sum, s) => sum + s.storageSizeBytes, 0);

    // Filter snapshots to delete
    let toDelete: SnapshotMeta[] = [];

    if (options.olderThan) {
      const cutoff = new Date(options.olderThan);
      toDelete = snapshots.filter(s => {
        if (options.skipPinned && s.isPinned) return false;
        return new Date(s.executedAt) < cutoff;
      });
    }

    if (options.tabId) {
      const tabSnapshots = snapshots.filter(s => s.tabId === options.tabId);
      const toKeep = options.keepMinPerTab || 0;

      if (tabSnapshots.length > toKeep) {
        // Keep most recent, delete older ones
        const sorted = [...tabSnapshots].sort(
          (a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime()
        );
        const deleteFromTab = sorted.slice(toKeep).filter(s => {
          if (options.skipPinned && s.isPinned) return false;
          return true;
        });
        toDelete = [...toDelete, ...deleteFromTab];
      }
    }

    // Remove duplicates
    const deleteIds = new Set(toDelete.map(s => s.id));
    this.files.remove([...deleteIds]);

    const newSnapshots = snapshots.filter(s => !deleteIds.has(s.id));
    const remainingSize = newSnapshots.reduce((sum, s) => sum + s.storageSizeBytes, 0);

    return {
      deletedCount: originalCount - newSnapshots.length,
      freedBytes: originalSize - remainingSize,
      remainingCount: newSnapshots.length,
      remainingBytes: remainingSize,
    };
  }

  /**
   * Compare two snapshots and return diff
   */
  compareSnapshots(baseId: string, compareId: string, options?: DiffOptions): ResultDiff | null {
    const baseSnapshot = this.getSnapshot(baseId);
    const compareSnapshot = this.getSnapshot(compareId);

    if (!baseSnapshot || !compareSnapshot) {
      return null;
    }

    const startTime = Date.now();

    // Get first result set from each (most common case)
    const baseResultSet = baseSnapshot.resultSets[0];
    const compareResultSet = compareSnapshot.resultSets[0];

    if (!baseResultSet || !compareResultSet) {
      return null;
    }

    // Compare schemas
    const schemaDiff = this.compareSchemas(
      baseResultSet.columns,
      compareResultSet.columns,
      options
    );

    // Identify key columns
    const keyColumns = options?.keyColumns || this.inferKeyColumns(baseResultSet.columns);

    // Compare rows
    const rowDiffs = this.compareRows(
      baseResultSet.rows,
      compareResultSet.rows,
      keyColumns,
      options
    );

    // Build summary
    const summary = this.buildSummary(rowDiffs, schemaDiff);

    return {
      summary,
      schemaDiff,
      rowDiffs: options?.changesOnly ? rowDiffs.filter(r => r.type !== 'unchanged') : rowDiffs,
      metadata: {
        baseSnapshot: {
          id: baseSnapshot.id,
          executedAt: baseSnapshot.executedAt,
          rowCount: baseSnapshot.totalRowCount,
        },
        compareSnapshot: {
          id: compareSnapshot.id,
          executedAt: compareSnapshot.executedAt,
          rowCount: compareSnapshot.totalRowCount,
        },
        comparisonTimeMs: Date.now() - startTime,
      },
    };
  }

  // Private helpers

  private updateSnapshot(id: string, updates: Partial<SnapshotMeta>): boolean {
    return this.files.update(id, updates);
  }

  private calculateChecksum(data: Record<string, unknown>[]): string {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex').substring(0, 16);
  }

  private calculateSize(resultSets: StoredResultSet[]): number {
    return JSON.stringify(resultSets).length;
  }

  private maybeRunCleanup(): void {
    const lastCleanup = this.files.getLastCleanup();
    if (!lastCleanup) {
      this.runCleanup();
      return;
    }

    const hoursSinceCleanup = (Date.now() - new Date(lastCleanup).getTime()) / (1000 * 60 * 60);

    if (hoursSinceCleanup >= CONFIG.AUTO_CLEANUP_INTERVAL_HOURS) {
      this.runCleanup();
    }
  }

  private runCleanup(): void {
    // Remove snapshots older than retention period
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CONFIG.DEFAULT_RETENTION_DAYS);

    this.purge({
      olderThan: cutoffDate.toISOString(),
      skipPinned: true,
      keepMinPerTab: CONFIG.MIN_SNAPSHOTS_PER_TAB,
    });

    // Sweep files a crashed run may have left without index entries.
    void this.files.removeOrphans();

    this.files.setLastCleanup(new Date().toISOString());
  }

  private enforceStorageLimit(): void {
    const stats = this.getStorageStats();

    if (stats.totalSizeBytes > CONFIG.MAX_STORAGE_SIZE_BYTES) {
      // Remove oldest unpinned snapshots until under limit
      const snapshots = this.files.listMeta();
      const sorted = [...snapshots]
        .filter(s => !s.isPinned)
        .sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime());

      let currentSize = stats.totalSizeBytes;
      const toDelete: string[] = [];

      for (const s of sorted) {
        if (currentSize <= CONFIG.MAX_STORAGE_SIZE_BYTES) break;
        toDelete.push(s.id);
        currentSize -= s.storageSizeBytes;
      }

      if (toDelete.length > 0) {
        this.deleteSnapshots(toDelete);
      }
    }
  }

  private compareSchemas(
    baseColumns: ColumnMetadata[],
    compareColumns: ColumnMetadata[],
    options?: DiffOptions
  ): SchemaDiff {
    const baseNames = new Set(baseColumns.map(c => c.name));
    const compareNames = new Set(compareColumns.map(c => c.name));

    const addedColumns = compareColumns.filter(c => !baseNames.has(c.name)).map(c => c.name);

    const removedColumns = baseColumns.filter(c => !compareNames.has(c.name)).map(c => c.name);

    const modifiedColumns: ColumnDiff[] = [];
    for (const baseCol of baseColumns) {
      const compareCol = compareColumns.find(c => c.name === baseCol.name);
      if (compareCol && baseCol.type !== compareCol.type) {
        modifiedColumns.push({
          name: baseCol.name,
          baseType: baseCol.type,
          compareType: compareCol.type,
        });
      }
    }

    // Check column order if not ignoring
    let columnOrderChanged = false;
    if (!options?.ignoreColumnOrder) {
      const baseOrder = baseColumns.map(c => c.name).join(',');
      const compareOrder = compareColumns.map(c => c.name).join(',');
      columnOrderChanged = baseOrder !== compareOrder;
    }

    return {
      addedColumns,
      removedColumns,
      modifiedColumns,
      columnOrderChanged,
    };
  }

  private inferKeyColumns(columns: ColumnMetadata[]): string[] {
    // Look for ID columns
    const idColumn = columns.find(c => c.name.toLowerCase() === 'id' || c.isPrimaryKey);

    if (idColumn) {
      return [idColumn.name];
    }

    // Look for columns ending in _id or Id
    const idLikeColumn = columns.find(
      c => c.name.toLowerCase().endsWith('id') || c.name.endsWith('Id')
    );

    if (idLikeColumn) {
      return [idLikeColumn.name];
    }

    // Default to first column
    return columns.length > 0 ? [columns[0].name] : [];
  }

  private compareRows(
    baseRows: Record<string, unknown>[],
    compareRows: Record<string, unknown>[],
    keyColumns: string[],
    options?: DiffOptions
  ): RowDiff[] {
    const maxRows = options?.maxRows || 10000;
    const diffs: RowDiff[] = [];

    // Build index of base rows by key
    const baseIndex = new Map<string, { index: number; row: Record<string, unknown> }>();
    for (let i = 0; i < Math.min(baseRows.length, maxRows); i++) {
      const key = this.getRowKey(baseRows[i], keyColumns);
      baseIndex.set(key, { index: i, row: baseRows[i] });
    }

    // Build index of compare rows by key
    const compareIndex = new Map<string, { index: number; row: Record<string, unknown> }>();
    for (let i = 0; i < Math.min(compareRows.length, maxRows); i++) {
      const key = this.getRowKey(compareRows[i], keyColumns);
      compareIndex.set(key, { index: i, row: compareRows[i] });
    }

    // Find added and modified rows
    for (const [key, { index, row }] of compareIndex) {
      const baseEntry = baseIndex.get(key);

      if (!baseEntry) {
        // Added row
        diffs.push({
          type: 'added',
          rowIndex: index,
          keyValues: this.extractKeyValues(row, keyColumns),
          compareRow: row,
        });
      } else {
        // Check if modified
        const cellChanges = this.compareRowValues(baseEntry.row, row);
        if (cellChanges.length > 0) {
          diffs.push({
            type: 'modified',
            rowIndex: index,
            keyValues: this.extractKeyValues(row, keyColumns),
            cellChanges,
            baseRow: baseEntry.row,
            compareRow: row,
          });
        } else {
          diffs.push({
            type: 'unchanged',
            rowIndex: index,
            keyValues: this.extractKeyValues(row, keyColumns),
          });
        }
      }
    }

    // Find removed rows
    for (const [key, { index, row }] of baseIndex) {
      if (!compareIndex.has(key)) {
        diffs.push({
          type: 'removed',
          rowIndex: index,
          keyValues: this.extractKeyValues(row, keyColumns),
          baseRow: row,
        });
      }
    }

    return diffs;
  }

  private getRowKey(row: Record<string, unknown>, keyColumns: string[]): string {
    return keyColumns.map(col => JSON.stringify(row[col])).join('|');
  }

  private extractKeyValues(
    row: Record<string, unknown>,
    keyColumns: string[]
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const col of keyColumns) {
      values[col] = row[col];
    }
    return values;
  }

  private compareRowValues(
    baseRow: Record<string, unknown>,
    compareRow: Record<string, unknown>
  ): CellChange[] {
    const changes: CellChange[] = [];
    const allKeys = new Set([...Object.keys(baseRow), ...Object.keys(compareRow)]);

    for (const key of allKeys) {
      const baseValue = baseRow[key];
      const compareValue = compareRow[key];

      if (JSON.stringify(baseValue) !== JSON.stringify(compareValue)) {
        changes.push({
          column: key,
          baseValue,
          compareValue,
        });
      }
    }

    return changes;
  }

  private buildSummary(rowDiffs: RowDiff[], schemaDiff: SchemaDiff): DiffSummary {
    return {
      totalBaseRows: rowDiffs.filter(r => r.type !== 'added').length,
      totalCompareRows: rowDiffs.filter(r => r.type !== 'removed').length,
      addedRows: rowDiffs.filter(r => r.type === 'added').length,
      removedRows: rowDiffs.filter(r => r.type === 'removed').length,
      modifiedRows: rowDiffs.filter(r => r.type === 'modified').length,
      unchangedRows: rowDiffs.filter(r => r.type === 'unchanged').length,
      columnsAdded: schemaDiff.addedColumns.length,
      columnsRemoved: schemaDiff.removedColumns.length,
      columnsModified: schemaDiff.modifiedColumns.length,
    };
  }
}
