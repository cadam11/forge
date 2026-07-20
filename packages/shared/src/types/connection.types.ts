/**
 * Connection-related type definitions
 */

export type DatabaseEngine = 'mssql' | 'postgresql' | 'mysql';
export type AuthenticationType = 'sql' | 'windows' | 'entra-id';
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Default ports for each database engine */
export const DEFAULT_PORTS: Record<DatabaseEngine, number> = {
  mssql: 1433,
  postgresql: 5432,
  mysql: 3306,
};

/** Human-readable labels for each database engine */
export const ENGINE_LABELS: Record<DatabaseEngine, string> = {
  mssql: 'SQL Server',
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
};

/** Engine sub-variant detected at connect time (e.g. Aurora DSQL for postgresql) */
export type EngineVariant = 'dsql';

/**
 * App-level feature support for a live connection. Computed main-side from
 * the resolved dialect and shipped to the renderer on ActiveConnection.
 * Absence of capabilities means "assume everything is supported".
 */
export interface EngineCapabilities {
  /** Server hosts multiple user databases that can be enumerated/switched */
  supportsMultipleDatabases: boolean;
  /** CREATE/RENAME/DROP DATABASE are meaningful on this server */
  supportsDatabaseManagement: boolean;
  supportsStoredProcedures: boolean;
  supportsTriggers: boolean;
  /** Backup/restore is available via SQL or CLI tooling */
  supportsBackupRestore: boolean;
}

export const FULL_CAPABILITIES: EngineCapabilities = {
  supportsMultipleDatabases: true,
  supportsDatabaseManagement: true,
  supportsStoredProcedures: true,
  supportsTriggers: true,
  supportsBackupRestore: true,
};

export interface VolumeMapping {
  hostPath: string;
  containerPath: string;
}

export type SshAuthType = 'password' | 'privateKey';

export interface SshTunnelConfig {
  enabled: boolean;
  host: string;
  port: number; // default 22
  username: string;
  authType: SshAuthType;
  privateKeyPath?: string; // only for authType === 'privateKey'
}

export interface ConnectionProfile {
  id: string;
  name: string;
  engine: DatabaseEngine;
  server: string; // hostname or IP
  port: number;
  authenticationType: AuthenticationType;
  username?: string;
  // Note: password is stored in Keychain, never in profile
  database?: string; // default database
  encrypt: boolean;
  trustServerCertificate: boolean;
  connectionTimeout: number;
  requestTimeout?: number;
  color?: string; // optional accent color for visual identification
  isDocker?: boolean;
  dockerContainerId?: string;
  volumeMappings?: VolumeMapping[];
  sshTunnel?: SshTunnelConfig;
  azureTenantId?: string; // Entra ID tenant (directory) ID — pins login to a specific tenant
  azureClientId?: string; // Entra ID application (client) ID — override the default well-known client
  azureHomeAccountId?: string; // MSAL homeAccountId — binds silent refresh to the specific account this profile signs in as
  mysqlCollation?: string; // e.g. 'utf8mb4_0900_ai_ci'
  createdAt?: string;
  updatedAt?: string;
}

export interface TestConnectionResult {
  success: boolean;
  serverVersion?: string;
  serverName?: string;
  error?: string;
  errorCode?: string;
  guidance?: string[];
}

export interface SaveConnectionRequest {
  profile: Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
  password?: string;
  sshPassword?: string;
  sshPassphrase?: string;
}

export interface ActiveConnection {
  id: string;
  profile: ConnectionProfile;
  status: ConnectionStatus;
  connectedAt?: string;
  currentDatabase?: string;
  /** Present when the engine has a detected sub-variant (e.g. Aurora DSQL) */
  engineVariant?: EngineVariant;
  /** App-level feature support; absent means all features supported */
  capabilities?: EngineCapabilities;
}

// Legacy aliases for backward compatibility
export type AuthType = AuthenticationType;
export type ConnectionTestRequest = Omit<
  ConnectionProfile,
  'id' | 'name' | 'createdAt' | 'updatedAt'
> & { password?: string };
export type ConnectionTestResult = TestConnectionResult;
export interface ConnectionError {
  code: string;
  message: string;
  guidance: string[];
}
