/**
 * Tests for connection types and constants
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_PORTS, ENGINE_LABELS } from './connection.types';
import type { DatabaseEngine, ConnectionProfile } from './connection.types';

describe('DatabaseEngine type', () => {
  it('accepts mssql', () => {
    const engine: DatabaseEngine = 'mssql';
    expect(engine).toBe('mssql');
  });

  it('accepts postgresql', () => {
    const engine: DatabaseEngine = 'postgresql';
    expect(engine).toBe('postgresql');
  });

  it('accepts mysql', () => {
    const engine: DatabaseEngine = 'mysql';
    expect(engine).toBe('mysql');
  });
});

describe('DEFAULT_PORTS', () => {
  it('has correct SQL Server port', () => {
    expect(DEFAULT_PORTS.mssql).toBe(1433);
  });

  it('has correct PostgreSQL port', () => {
    expect(DEFAULT_PORTS.postgresql).toBe(5432);
  });

  it('has correct MySQL port', () => {
    expect(DEFAULT_PORTS.mysql).toBe(3306);
  });

  it('has ports for all engines', () => {
    const engines: DatabaseEngine[] = ['mssql', 'postgresql', 'mysql'];
    for (const engine of engines) {
      expect(DEFAULT_PORTS[engine]).toBeDefined();
      expect(typeof DEFAULT_PORTS[engine]).toBe('number');
    }
  });
});

describe('ENGINE_LABELS', () => {
  it('has correct SQL Server label', () => {
    expect(ENGINE_LABELS.mssql).toBe('SQL Server');
  });

  it('has correct PostgreSQL label', () => {
    expect(ENGINE_LABELS.postgresql).toBe('PostgreSQL');
  });

  it('has correct MySQL label', () => {
    expect(ENGINE_LABELS.mysql).toBe('MySQL');
  });
});

describe('ConnectionProfile', () => {
  it('can be created with all required fields including engine', () => {
    const profile: ConnectionProfile = {
      id: 'test-1',
      name: 'Test Connection',
      engine: 'mssql',
      server: 'localhost',
      port: 1433,
      authenticationType: 'sql',
      encrypt: true,
      trustServerCertificate: true,
      connectionTimeout: 30,
    };

    expect(profile.engine).toBe('mssql');
    expect(profile.port).toBe(1433);
  });

  it('can be created for PostgreSQL', () => {
    const profile: ConnectionProfile = {
      id: 'test-2',
      name: 'PG Test',
      engine: 'postgresql',
      server: 'localhost',
      port: 5432,
      authenticationType: 'sql',
      username: 'postgres',
      encrypt: false,
      trustServerCertificate: true,
      connectionTimeout: 30,
    };

    expect(profile.engine).toBe('postgresql');
    expect(profile.port).toBe(5432);
  });

  it('supports optional fields', () => {
    const profile: ConnectionProfile = {
      id: 'test-3',
      name: 'Full Profile',
      engine: 'mssql',
      server: 'db.example.com',
      port: 1433,
      authenticationType: 'sql',
      username: 'admin',
      database: 'mydb',
      encrypt: true,
      trustServerCertificate: false,
      connectionTimeout: 60,
      requestTimeout: 120,
      color: '#ff0000',
      isDocker: true,
      dockerContainerId: 'abc123',
    };

    expect(profile.database).toBe('mydb');
    expect(profile.requestTimeout).toBe(120);
    expect(profile.isDocker).toBe(true);
  });
});

import { FULL_CAPABILITIES } from './connection.types';
import type { EngineCapabilities, EngineVariant, ActiveConnection } from './connection.types';

describe('EngineCapabilities', () => {
  it('FULL_CAPABILITIES has every capability enabled', () => {
    const values = Object.values(FULL_CAPABILITIES);
    expect(values.length).toBe(5);
    expect(values.every(v => v === true)).toBe(true);
  });

  it('ActiveConnection accepts capabilities and engineVariant', () => {
    const variant: EngineVariant = 'dsql';
    const caps: EngineCapabilities = {
      supportsMultipleDatabases: false,
      supportsDatabaseManagement: false,
      supportsStoredProcedures: false,
      supportsTriggers: false,
      supportsBackupRestore: false,
    };
    const conn: Partial<ActiveConnection> = { capabilities: caps, engineVariant: variant };
    expect(conn.capabilities?.supportsTriggers).toBe(false);
  });
});
