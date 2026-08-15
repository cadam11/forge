/**
 * Docker-related type definitions
 */

export type ContainerState = 'running' | 'exited' | 'paused' | 'created' | 'restarting' | 'dead';

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  status: string;
  port?: number | null;
  ports?: Array<{ internal: number; external: number }>;
  hostBinding?: string;
  volumeMappings?: DockerVolumeMapping[];
  isSqlServer?: boolean;
  created?: string;
}

export interface DockerVolumeMapping {
  hostPath: string;
  containerPath: string;
  mode?: 'rw' | 'ro';
}

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
  createdAt?: string;
  labels?: Record<string, string>;
}

export interface DockerStatus {
  isAvailable: boolean;
  isRunning?: boolean;
  version?: string;
  containers?: DockerContainer[];
  error?: string;
}

// Legacy alias
export interface DockerDetectionResult {
  dockerRunning: boolean;
  containers: DockerContainer[];
  error?: string;
}

export interface StartContainerResult {
  success: boolean;
  containerId: string;
  error?: string;
}

export interface PathTranslation {
  localPath: string;
  containerPath: string;
  isAccessible: boolean;
  suggestion?: string;
}
