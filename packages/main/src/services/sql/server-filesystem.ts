/**
 * Server Filesystem Service
 * Provides methods to browse the SQL Server's file system
 */

import type {
  ServerDrive,
  ServerFileEntry,
  ServerDefaultPaths,
  BackupHistoryEntry,
} from '@joinery/shared';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';
import { ConnectionPoolManager } from './connection-pool';

const log = createLogger('ServerFS');

/**
 * Validates and sanitizes a server filesystem path.
 * Rejects paths with SQL injection patterns.
 */
function sanitizeServerPath(inputPath: string): string {
  // Must look like a valid Windows path (drive letter or UNC)
  if (!/^[A-Za-z]:\\|^\\\\/.test(inputPath)) {
    throw new Error(`Invalid server path: ${inputPath}`);
  }
  // Reject semicolons, SQL comments, and other injection patterns
  if (/[;]|--|\bEXEC\b|\bDROP\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bSELECT\b/i.test(inputPath)) {
    throw new Error('Path contains invalid characters');
  }
  // Escape single quotes for N-string literals
  return inputPath.replace(/'/g, "''");
}

/**
 * Validates a SQL Server identifier (database name, etc.)
 * Only allows alphanumeric, underscore, space, hyphen, and dot.
 */
function sanitizeIdentifier(name: string): string {
  if (!/^[\w\s.-]+$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return name.replace(/'/g, "''");
}

export class ServerFilesystemService extends BaseSingleton {
  private poolManager: ConnectionPoolManager;

  constructor() {
    super();
    this.poolManager = ConnectionPoolManager.getInstance();
  }

  /**
   * Get available drives on the SQL Server
   */
  async getDrives(connectionId: string): Promise<ServerDrive[]> {
    const sql = `EXEC xp_fixeddrives;`;

    const result = await this.poolManager.query<{
      drive: string;
      'MB free': number;
    }>(connectionId, sql);

    return result.recordset.map(row => ({
      drive: `${row.drive}:`,
      freeSpaceMB: row['MB free'],
    }));
  }

  /**
   * List directory contents on the SQL Server
   * Uses xp_dirtree which returns subdirectories and files
   */
  async listDirectory(
    connectionId: string,
    path: string,
    includeFiles = true
  ): Promise<ServerFileEntry[]> {
    // Normalize path - ensure it ends with backslash for directories
    const normalizedPath = path.endsWith('\\') ? path : `${path}\\`;
    const safePath = sanitizeServerPath(normalizedPath);

    // xp_dirtree parameters: path, depth (0=recursive), include_files (1=yes)
    const sql = `
      CREATE TABLE #DirectoryTree (
        subdirectory NVARCHAR(512),
        depth INT,
        isfile BIT
      );

      INSERT INTO #DirectoryTree
      EXEC xp_dirtree @path = N'${safePath}', @depth = 1, @file = ${includeFiles ? 1 : 0};

      SELECT subdirectory as name, depth, isfile
      FROM #DirectoryTree
      ORDER BY isfile, subdirectory;

      DROP TABLE #DirectoryTree;
    `;

    try {
      const result = await this.poolManager.query<{
        name: string;
        depth: number;
        isfile: number;
      }>(connectionId, sql);

      return result.recordset.map(row => ({
        name: row.name,
        path: `${normalizedPath}${row.name}`,
        isDirectory: row.isfile === 0,
        depth: row.depth,
      }));
    } catch (error) {
      // If the directory doesn't exist or access denied, return empty
      log.error('Error listing directory:', error);
      return [];
    }
  }

  /**
   * Get SQL Server's default paths for data, log, and backup files
   */
  async getDefaultPaths(connectionId: string): Promise<ServerDefaultPaths> {
    const sql = `
      SELECT
        SERVERPROPERTY('InstanceDefaultDataPath') as DataPath,
        SERVERPROPERTY('InstanceDefaultLogPath') as LogPath,
        SERVERPROPERTY('InstanceDefaultBackupPath') as BackupPath;
    `;

    const result = await this.poolManager.query<{
      DataPath: string | null;
      LogPath: string | null;
      BackupPath: string | null;
    }>(connectionId, sql);

    const row = result.recordset[0];

    // Fallback to querying registry if server properties return null
    const dataPath = row?.DataPath || '';
    const logPath = row?.LogPath || '';
    let backupPath = row?.BackupPath || '';

    // If backup path is empty, try to get it from master database location
    if (!backupPath) {
      try {
        const backupSql = `
          SELECT TOP 1 physical_name
          FROM master.sys.database_files
          WHERE type = 0;
        `;
        const backupResult = await this.poolManager.query<{ physical_name: string }>(
          connectionId,
          backupSql
        );
        if (backupResult.recordset[0]) {
          // Extract directory from file path
          const filePath = backupResult.recordset[0].physical_name;
          backupPath = filePath.substring(0, filePath.lastIndexOf('\\') + 1);
        }
      } catch {
        // Ignore errors
      }
    }

    return {
      dataPath: dataPath || 'C:\\',
      logPath: logPath || dataPath || 'C:\\',
      backupPath: backupPath || dataPath || 'C:\\',
    };
  }

  /**
   * Get backup history for a database
   */
  async getBackupHistory(
    connectionId: string,
    databaseName?: string,
    limit = 50
  ): Promise<BackupHistoryEntry[]> {
    const whereClause = databaseName
      ? `WHERE bs.database_name = N'${sanitizeIdentifier(databaseName)}'`
      : '';

    const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 50)));

    const sql = `
      SELECT TOP ${safeLimit}
        bs.database_name as databaseName,
        CASE bs.type
          WHEN 'D' THEN 'Full'
          WHEN 'I' THEN 'Differential'
          WHEN 'L' THEN 'Log'
          WHEN 'F' THEN 'File or Filegroup'
          WHEN 'G' THEN 'Differential File'
          WHEN 'P' THEN 'Partial'
          WHEN 'Q' THEN 'Differential Partial'
          ELSE 'Unknown'
        END as backupType,
        bs.backup_start_date as backupStartDate,
        bs.backup_finish_date as backupFinishDate,
        bs.backup_size as backupSizeBytes,
        bs.compressed_backup_size as compressedSizeBytes,
        bmf.physical_device_name as physicalDeviceName,
        bs.server_name as serverName,
        bs.recovery_model as recoveryModel,
        bs.user_name as userName,
        bs.first_lsn as firstLsn,
        bs.last_lsn as lastLsn,
        bs.description as description
      FROM msdb.dbo.backupset bs
      INNER JOIN msdb.dbo.backupmediafamily bmf ON bs.media_set_id = bmf.media_set_id
      ${whereClause}
      ORDER BY bs.backup_finish_date DESC;
    `;

    const result = await this.poolManager.query<{
      databaseName: string;
      backupType: string;
      backupStartDate: Date;
      backupFinishDate: Date;
      backupSizeBytes: number;
      compressedSizeBytes: number | null;
      physicalDeviceName: string;
      serverName: string;
      recoveryModel: string;
      userName: string;
      firstLsn: string | null;
      lastLsn: string | null;
      description: string | null;
    }>(connectionId, sql);

    return result.recordset.map(row => ({
      databaseName: row.databaseName,
      backupType: row.backupType,
      backupStartDate: row.backupStartDate?.toISOString() || '',
      backupFinishDate: row.backupFinishDate?.toISOString() || '',
      backupSizeBytes: Number(row.backupSizeBytes) || 0,
      compressedSizeBytes: row.compressedSizeBytes ? Number(row.compressedSizeBytes) : undefined,
      physicalDeviceName: row.physicalDeviceName,
      serverName: row.serverName,
      recoveryModel: row.recoveryModel,
      userName: row.userName,
      firstLsn: row.firstLsn || undefined,
      lastLsn: row.lastLsn || undefined,
      description: row.description || undefined,
    }));
  }

  /**
   * Check if a path exists on the server
   */
  async pathExists(connectionId: string, path: string): Promise<boolean> {
    const safePath = sanitizeServerPath(path);
    const sql = `
      DECLARE @exists INT;
      EXEC master.dbo.xp_fileexist N'${safePath}', @exists OUTPUT;
      SELECT @exists as exists;
    `;

    try {
      const result = await this.poolManager.query<{ exists: number }>(connectionId, sql);
      return result.recordset[0]?.exists === 1;
    } catch {
      return false;
    }
  }

  /**
   * Get the parent directory of a path
   */
  getParentPath(path: string): string {
    // Remove trailing backslash if present
    const normalizedPath = path.endsWith('\\') ? path.slice(0, -1) : path;
    const lastSlash = normalizedPath.lastIndexOf('\\');

    if (lastSlash <= 2) {
      // We're at root (e.g., "C:")
      return normalizedPath.substring(0, 2) + '\\';
    }

    return normalizedPath.substring(0, lastSlash);
  }
}
