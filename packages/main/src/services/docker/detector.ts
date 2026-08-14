/**
 * Docker Detector Service
 * Detects SQL Server containers running in Docker
 */

import Dockerode from 'dockerode';
import type {
  DockerContainer,
  DockerVolumeMapping,
  DockerDetectionResult,
  StartContainerResult,
  PathTranslation,
  ContainerState,
} from '@forgedb/shared';
import { BaseSingleton } from '../../utils/singleton';

export class DockerDetector extends BaseSingleton {
  private docker: Dockerode;

  constructor() {
    super();
    this.docker = new Dockerode({ socketPath: '/var/run/docker.sock' });
  }

  /**
   * Check if Docker is running
   */
  async isDockerRunning(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Detect SQL Server containers
   */
  async detect(): Promise<DockerDetectionResult> {
    try {
      const isRunning = await this.isDockerRunning();

      if (!isRunning) {
        return {
          dockerRunning: false,
          containers: [],
          error: 'Docker is not running. Please start Docker Desktop.',
        };
      }

      const containers = await this.docker.listContainers({ all: true });
      const sqlContainers: DockerContainer[] = [];

      for (const container of containers) {
        const imageLower = container.Image.toLowerCase();
        const isSqlServer =
          imageLower.includes('mssql') ||
          imageLower.includes('sqlserver') ||
          imageLower.includes('azure-sql-edge');
        const isPostgres =
          imageLower.includes('postgres') ||
          imageLower.includes('postgresql') ||
          imageLower.includes('postgis');
        const isMySQL = imageLower.includes('mysql') || imageLower.includes('mariadb');

        const isDatabase = isSqlServer || isPostgres || isMySQL;

        if (isDatabase) {
          const defaultPort = isPostgres ? 5432 : isMySQL ? 3306 : 1433;
          const portBinding = container.Ports.find(p => p.PrivatePort === defaultPort);

          const volumeMappings: DockerVolumeMapping[] = (container.Mounts || [])
            .filter(m => m.Type === 'bind')
            .map(m => ({
              hostPath: m.Source || '',
              containerPath: m.Destination || '',
              mode: (m.Mode || 'rw') as 'rw' | 'ro',
            }));

          sqlContainers.push({
            id: container.Id,
            name: container.Names[0]?.replace(/^\//, '') || 'unknown',
            image: container.Image,
            state: container.State as ContainerState,
            status: container.Status,
            port: portBinding?.PublicPort || null,
            hostBinding: portBinding?.IP || '0.0.0.0',
            volumeMappings,
            created: new Date(container.Created * 1000).toISOString(),
          });
        }
      }

      return {
        dockerRunning: true,
        containers: sqlContainers,
      };
    } catch (error) {
      return {
        dockerRunning: false,
        containers: [],
        error: error instanceof Error ? error.message : 'Failed to detect Docker containers',
      };
    }
  }

  /**
   * Get volume mappings for a specific container
   */
  async getVolumeMappings(containerId: string): Promise<DockerVolumeMapping[]> {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();

      return (info.Mounts || [])
        .filter(m => m.Type === 'bind')
        .map(m => ({
          hostPath: m.Source || '',
          containerPath: m.Destination || '',
          mode: (m.Mode || 'rw') as 'rw' | 'ro',
        }));
    } catch {
      return [];
    }
  }

  /**
   * Start a stopped container
   */
  async startContainer(containerId: string): Promise<StartContainerResult> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.start();

      return {
        success: true,
        containerId,
      };
    } catch (error) {
      return {
        success: false,
        containerId,
        error: error instanceof Error ? error.message : 'Failed to start container',
      };
    }
  }

  /**
   * Stop a running container
   */
  async stopContainer(containerId: string): Promise<StartContainerResult> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop();

      return {
        success: true,
        containerId,
      };
    } catch (error) {
      return {
        success: false,
        containerId,
        error: error instanceof Error ? error.message : 'Failed to stop container',
      };
    }
  }

  /**
   * Create a new SQL Server container
   */
  async createContainer(options: {
    name: string;
    password: string;
    port: number;
    image?: string;
    acceptEula?: boolean;
  }): Promise<StartContainerResult> {
    try {
      const image = options.image || 'mcr.microsoft.com/mssql/server:2022-latest';

      // Pull image if not available
      try {
        await this.docker.getImage(image).inspect();
      } catch {
        // Image not found, pull it
        const stream = await this.docker.pull(image);
        // Wait for pull to complete
        await new Promise<void>((resolve, reject) => {
          this.docker.modem.followProgress(stream, (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      const container = await this.docker.createContainer({
        Image: image,
        name: options.name,
        Env: [
          options.acceptEula !== false ? 'ACCEPT_EULA=Y' : '',
          `MSSQL_SA_PASSWORD=${options.password}`,
        ].filter(Boolean),
        HostConfig: {
          PortBindings: {
            '1433/tcp': [{ HostPort: String(options.port) }],
          },
        },
        ExposedPorts: {
          '1433/tcp': {},
        },
      });

      await container.start();

      return {
        success: true,
        containerId: container.id,
      };
    } catch (error) {
      return {
        success: false,
        containerId: '',
        error: error instanceof Error ? error.message : 'Failed to create container',
      };
    }
  }

  /**
   * Translate a local path to a container path using volume mappings
   */
  translatePath(localPath: string, mappings: DockerVolumeMapping[]): PathTranslation {
    // Normalize path separators
    const normalizedLocal = localPath.replace(/\\/g, '/');

    for (const mapping of mappings) {
      const normalizedHost = mapping.hostPath.replace(/\\/g, '/');

      if (normalizedLocal.startsWith(normalizedHost)) {
        const relativePath = normalizedLocal.slice(normalizedHost.length);
        const containerPath = mapping.containerPath + relativePath;

        return {
          localPath,
          containerPath,
          isAccessible: true,
        };
      }
    }

    // Path is not mapped
    return {
      localPath,
      containerPath: localPath,
      isAccessible: false,
      suggestion: `Mount the directory as a volume. Example: -v "${localPath}:/var/opt/mssql/backups"`,
    };
  }

  /**
   * Get default backup path in container based on database engine
   */
  getDefaultBackupPath(engine: string = 'mssql'): string {
    if (engine === 'postgresql') return '/var/lib/postgresql/backups';
    if (engine === 'mysql') return '/var/lib/mysql/backups';
    return '/var/opt/mssql/backups';
  }

  /**
   * Get default data path in container based on database engine
   */
  getDefaultDataPath(engine: string = 'mssql'): string {
    if (engine === 'postgresql') return '/var/lib/postgresql/data';
    if (engine === 'mysql') return '/var/lib/mysql';
    return '/var/opt/mssql/data';
  }
}
