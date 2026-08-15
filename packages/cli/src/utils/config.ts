import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ConnectionConfig {
  name: string;
  server: string;
  port: number;
  database?: string;
  user?: string;
  password?: string;
  trustServerCertificate?: boolean;
  encrypt?: boolean;
}

export interface JoineryConfig {
  connections: Record<string, ConnectionConfig>;
  defaultConnection?: string;
  outputFormat: 'table' | 'json' | 'csv';
  maxRows: number;
}

const CONFIG_DIR = path.join(os.homedir(), '.joinery');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: JoineryConfig = {
  connections: {},
  outputFormat: 'table',
  maxRows: 1000,
};

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): JoineryConfig {
  ensureConfigDir();

  if (!fs.existsSync(CONFIG_FILE)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: JoineryConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getConnection(name?: string): ConnectionConfig | undefined {
  const config = loadConfig();
  const connName = name || config.defaultConnection;

  if (!connName) {
    return undefined;
  }

  return config.connections[connName];
}

export function saveConnection(name: string, connection: ConnectionConfig): void {
  const config = loadConfig();
  config.connections[name] = connection;
  saveConfig(config);
}

export function removeConnection(name: string): boolean {
  const config = loadConfig();
  if (config.connections[name]) {
    delete config.connections[name];
    if (config.defaultConnection === name) {
      config.defaultConnection = undefined;
    }
    saveConfig(config);
    return true;
  }
  return false;
}

export function setDefaultConnection(name: string): boolean {
  const config = loadConfig();
  if (config.connections[name]) {
    config.defaultConnection = name;
    saveConfig(config);
    return true;
  }
  return false;
}

export function listConnections(): ConnectionConfig[] {
  const config = loadConfig();
  return Object.values(config.connections);
}
