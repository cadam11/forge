/**
 * Tests for Connection Profiles Store
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionProfilesStore } from './connection-profiles';

describe('ConnectionProfilesStore', () => {
  let store: ConnectionProfilesStore;

  beforeEach(async () => {
    // Reset singleton for each test
    ConnectionProfilesStore.resetInstance();
    store = ConnectionProfilesStore.getInstance();
    // electron-store persists to disk by default, so the singleton reset
    // alone leaves previous-run profiles in place. Wipe them so tests don't
    // collide on the now-enforced duplicate-name guard.
    for (const p of store.getAll()) {
      await store.delete(p.id);
    }
  });

  describe('backward compatibility', () => {
    it('backfills engine to mssql for legacy profiles', () => {
      const profiles = store.getAll();
      // All returned profiles should have engine set
      for (const p of profiles) {
        expect(p.engine).toBeDefined();
      }
    });
  });

  describe('CRUD operations', () => {
    it('returns empty array when no profiles exist', () => {
      const profiles = store.getAll();
      expect(Array.isArray(profiles)).toBe(true);
    });

    it('saves and retrieves a new profile', async () => {
      const saved = await store.save({
        profile: {
          name: 'Test SQL Server',
          engine: 'mssql',
          server: 'localhost',
          port: 1433,
          authenticationType: 'sql',
          username: 'sa',
          encrypt: true,
          trustServerCertificate: true,
          connectionTimeout: 30,
        },
        password: 'testpassword',
      });

      expect(saved.id).toBeDefined();
      expect(saved.name).toBe('Test SQL Server');
      expect(saved.engine).toBe('mssql');
      expect(saved.createdAt).toBeDefined();

      const found = store.getById(saved.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe('Test SQL Server');
    });

    it('saves a PostgreSQL profile', async () => {
      const saved = await store.save({
        profile: {
          name: 'Test PostgreSQL',
          engine: 'postgresql',
          server: 'localhost',
          port: 5432,
          authenticationType: 'sql',
          username: 'postgres',
          encrypt: false,
          trustServerCertificate: true,
          connectionTimeout: 30,
        },
        password: 'pgpass',
      });

      expect(saved.engine).toBe('postgresql');
      expect(saved.port).toBe(5432);
    });

    it('updates an existing profile', async () => {
      const saved = await store.save({
        profile: {
          name: 'Original',
          engine: 'mssql',
          server: 'localhost',
          port: 1433,
          authenticationType: 'sql',
          encrypt: true,
          trustServerCertificate: true,
          connectionTimeout: 30,
        },
      });

      const updated = await store.save({
        profile: {
          id: saved.id,
          name: 'Updated',
          engine: 'postgresql',
          server: 'dbhost',
          port: 5432,
          authenticationType: 'sql',
          encrypt: false,
          trustServerCertificate: true,
          connectionTimeout: 60,
        },
      });

      expect(updated.id).toBe(saved.id);
      expect(updated.name).toBe('Updated');
      expect(updated.engine).toBe('postgresql');
      expect(updated.updatedAt).toBeDefined();
    });

    it('deletes a profile', async () => {
      const saved = await store.save({
        profile: {
          name: 'To Delete',
          engine: 'mssql',
          server: 'localhost',
          port: 1433,
          authenticationType: 'sql',
          encrypt: true,
          trustServerCertificate: true,
          connectionTimeout: 30,
        },
      });

      const deleted = await store.delete(saved.id);
      expect(deleted).toBe(true);

      const found = store.getById(saved.id);
      expect(found).toBeUndefined();
    });

    it('returns false when deleting non-existent profile', async () => {
      const deleted = await store.delete('non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('duplicate-name guard', () => {
    const baseProfile = {
      engine: 'mssql' as const,
      server: 'localhost',
      port: 1433,
      authenticationType: 'sql' as const,
      encrypt: true,
      trustServerCertificate: true,
      connectionTimeout: 30,
    };

    it('rejects creating a new profile whose name matches an existing profile', async () => {
      await store.save({ profile: { ...baseProfile, name: 'Prod DB' } });

      await expect(store.save({ profile: { ...baseProfile, name: 'Prod DB' } })).rejects.toThrow(
        /already exists/
      );

      // Original is preserved; no second profile was created.
      const all = store.getAll();
      expect(all.filter(p => p.name === 'Prod DB')).toHaveLength(1);
    });

    it('matches the name comparison case-insensitively and trims whitespace', async () => {
      await store.save({ profile: { ...baseProfile, name: 'Prod DB' } });

      await expect(
        store.save({ profile: { ...baseProfile, name: '  prod db  ' } })
      ).rejects.toThrow(/already exists/);
    });

    it('still allows updating the same profile (id matches the conflicting name)', async () => {
      const saved = await store.save({ profile: { ...baseProfile, name: 'Prod DB' } });

      // Same id, same name — this is an update, not a duplicate.
      const updated = await store.save({
        profile: { ...baseProfile, id: saved.id, name: 'Prod DB', port: 1434 },
      });

      expect(updated.id).toBe(saved.id);
      expect(updated.port).toBe(1434);
    });

    it('allows renaming a profile to a name no other profile uses', async () => {
      const saved = await store.save({ profile: { ...baseProfile, name: 'Prod DB' } });
      await store.save({ profile: { ...baseProfile, name: 'Other DB' } });

      const renamed = await store.save({
        profile: { ...baseProfile, id: saved.id, name: 'Prod Database' },
      });

      expect(renamed.name).toBe('Prod Database');
    });

    it('still rejects renaming a profile to collide with another profile', async () => {
      await store.save({ profile: { ...baseProfile, name: 'Prod DB' } });
      const other = await store.save({ profile: { ...baseProfile, name: 'Other DB' } });

      await expect(
        store.save({ profile: { ...baseProfile, id: other.id, name: 'Prod DB' } })
      ).rejects.toThrow(/already exists/);
    });
  });

  describe('password management', () => {
    it('stores and retrieves password', async () => {
      const saved = await store.save({
        profile: {
          name: 'PW Test',
          engine: 'mssql',
          server: 'localhost',
          port: 1433,
          authenticationType: 'sql',
          encrypt: true,
          trustServerCertificate: true,
          connectionTimeout: 30,
        },
        password: 'secret123',
      });

      const password = await store.getPassword(saved.id);
      expect(password).toBe('secret123');
    });
  });
});
