/**
 * Docker Volume Mapper - Translates paths between host and container
 */

import type { VolumeMapping, PathTranslation } from '@joinery/shared';
import * as path from 'path';
import * as fs from 'fs';

export class VolumeMapper {
  private volumeMappings: VolumeMapping[] = [];

  constructor(volumeMappings?: VolumeMapping[]) {
    this.volumeMappings = volumeMappings || [];
  }

  /**
   * Set volume mappings from a Docker container
   */
  setMappings(mappings: VolumeMapping[]): void {
    this.volumeMappings = mappings;
  }

  /**
   * Translate a local (host) path to a container path
   */
  translateToContainer(localPath: string): PathTranslation {
    const normalizedLocal = path.normalize(localPath);

    for (const mapping of this.volumeMappings) {
      const normalizedHost = path.normalize(mapping.hostPath);

      if (normalizedLocal.startsWith(normalizedHost)) {
        const relativePath = normalizedLocal.substring(normalizedHost.length);
        const containerPath = path.posix.join(
          mapping.containerPath,
          relativePath.replace(/\\/g, '/')
        );

        return {
          localPath: normalizedLocal,
          containerPath,
          isAccessible: true,
        };
      }
    }

    // Path is not within any mounted volume
    return {
      localPath: normalizedLocal,
      containerPath: normalizedLocal,
      isAccessible: false,
      suggestion: this.getSuggestion(normalizedLocal),
    };
  }

  /**
   * Translate a container path to a local (host) path
   */
  translateToLocal(containerPath: string): PathTranslation {
    const normalizedContainer = containerPath.replace(/\\/g, '/');

    for (const mapping of this.volumeMappings) {
      const normalizedMountPoint = mapping.containerPath.replace(/\\/g, '/');

      if (normalizedContainer.startsWith(normalizedMountPoint)) {
        const relativePath = normalizedContainer.substring(normalizedMountPoint.length);
        const localPath = path.join(mapping.hostPath, relativePath);

        return {
          localPath,
          containerPath: normalizedContainer,
          isAccessible: this.isPathAccessible(localPath),
        };
      }
    }

    // Path is not within any mounted volume
    return {
      localPath: containerPath,
      containerPath: normalizedContainer,
      isAccessible: false,
      suggestion: 'This path is not accessible from the host machine.',
    };
  }

  /**
   * Check if a local path is accessible (exists and is readable)
   */
  isPathAccessible(localPath: string): boolean {
    try {
      fs.accessSync(path.dirname(localPath), fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a path is within a mounted volume
   */
  isPathMounted(localPath: string): boolean {
    const normalizedLocal = path.normalize(localPath);

    for (const mapping of this.volumeMappings) {
      const normalizedHost = path.normalize(mapping.hostPath);
      if (normalizedLocal.startsWith(normalizedHost)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get a suggestion for how to make a path accessible
   */
  private getSuggestion(localPath: string): string {
    const dir = path.dirname(localPath);

    if (this.volumeMappings.length === 0) {
      return `No volume mappings found. Mount a volume to access files from the container. Example:
docker run -v "${dir}:/data" ...`;
    }

    const mountPoints = this.volumeMappings
      .map(m => `  ${m.hostPath} -> ${m.containerPath}`)
      .join('\n');

    return `Path is not within any mounted volume.

Current volume mappings:
${mountPoints}

To access this file, either:
1. Move it to a mounted directory, or
2. Add a new volume mount: docker run -v "${dir}:/data" ...`;
  }

  /**
   * Get default backup path for a database
   */
  getDefaultBackupPath(databaseName: string): PathTranslation {
    // Try to find a mounted volume for backups
    const backupMapping = this.volumeMappings.find(
      m =>
        m.containerPath.includes('backup') ||
        m.containerPath.includes('bak') ||
        m.containerPath === '/var/opt/mssql/data'
    );

    if (backupMapping) {
      const fileName = `${databaseName}_${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
      const containerPath = path.posix.join(backupMapping.containerPath, fileName);
      const localPath = path.join(backupMapping.hostPath, fileName);

      return {
        localPath,
        containerPath,
        isAccessible: true,
      };
    }

    // Default to /var/opt/mssql/data which is often mounted
    const fileName = `${databaseName}_${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    return {
      localPath: fileName,
      containerPath: `/var/opt/mssql/data/${fileName}`,
      isAccessible: false,
      suggestion:
        'No backup volume found. Consider mounting a backup directory when starting SQL Server.',
    };
  }

  /**
   * Validate a backup destination path
   */
  validateBackupDestination(localPath: string): {
    valid: boolean;
    containerPath?: string;
    error?: string;
  } {
    const translation = this.translateToContainer(localPath);

    if (!translation.isAccessible) {
      return {
        valid: false,
        error: translation.suggestion || 'Path is not accessible from the SQL Server container.',
      };
    }

    // Check if directory exists and is writable
    const dir = path.dirname(localPath);
    try {
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      return {
        valid: false,
        error: `Directory does not exist or is not writable: ${dir}`,
      };
    }

    return {
      valid: true,
      containerPath: translation.containerPath,
    };
  }

  /**
   * Validate a restore source path
   */
  validateRestoreSource(localPath: string): {
    valid: boolean;
    containerPath?: string;
    error?: string;
  } {
    // Check if file exists
    if (!fs.existsSync(localPath)) {
      return {
        valid: false,
        error: `Backup file does not exist: ${localPath}`,
      };
    }

    const translation = this.translateToContainer(localPath);

    if (!translation.isAccessible) {
      return {
        valid: false,
        error: translation.suggestion || 'Path is not accessible from the SQL Server container.',
      };
    }

    return {
      valid: true,
      containerPath: translation.containerPath,
    };
  }
}

// Singleton instance for non-Docker connections (pass-through)
export class PassThroughVolumeMapper extends VolumeMapper {
  constructor() {
    super([]);
  }

  override translateToContainer(localPath: string): PathTranslation {
    return {
      localPath,
      containerPath: localPath,
      isAccessible: this.isPathAccessible(localPath),
    };
  }

  override translateToLocal(containerPath: string): PathTranslation {
    return {
      localPath: containerPath,
      containerPath,
      isAccessible: this.isPathAccessible(containerPath),
    };
  }
}
