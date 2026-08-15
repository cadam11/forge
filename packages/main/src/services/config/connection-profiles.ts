/**
 * Connection Profiles Storage
 * Stores connection profiles (without passwords) in app data directory
 */

import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import type { ConnectionProfile, SaveConnectionRequest } from '@joinery/shared';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';
import { CredentialStore } from '../keychain/credential-store';

const log = createLogger('ProfileStore');

interface ConnectionProfilesSchema {
  profiles: ConnectionProfile[];
  version: number;
}

export class ConnectionProfilesStore extends BaseSingleton {
  private store: Store<ConnectionProfilesSchema>;
  private credentialStore: CredentialStore;

  constructor() {
    super();
    this.store = new Store<ConnectionProfilesSchema>({
      name: 'connections',
      defaults: {
        profiles: [],
        version: 1,
      },
    });
    this.credentialStore = CredentialStore.getInstance();
  }

  /**
   * Get all connection profiles.
   * Backfills `engine: 'mssql'` for profiles saved before multi-DB support
   * and migrates the legacy `'azure-ad'` auth type to `'entra-id'`.
   * Migrated profiles are written back so the migration runs at most once
   * per profile rather than on every read.
   */
  getAll(): ConnectionProfile[] {
    const profiles = this.store.get('profiles', []);
    let mutated = false;
    for (const p of profiles) {
      if (!p.engine) {
        (p as ConnectionProfile).engine = 'mssql';
        mutated = true;
      }
      if ((p.authenticationType as string) === 'azure-ad') {
        p.authenticationType = 'entra-id';
        mutated = true;
      }
    }
    if (mutated) {
      this.store.set('profiles', profiles);
    }
    return profiles;
  }

  /**
   * Get a single connection profile by ID
   */
  getById(id: string): ConnectionProfile | undefined {
    const profiles = this.getAll();
    return profiles.find(p => p.id === id);
  }

  /**
   * Save a connection profile (create or update)
   */
  async save(request: SaveConnectionRequest): Promise<ConnectionProfile> {
    log.info(`Saving profile: ${request.profile.name} (${request.profile.id || 'NEW'})`);

    const profiles = this.getAll();
    const now = new Date().toISOString();

    // Reject creates / renames that would silently duplicate an existing
    // profile name. Without this guard, a user who hits "New Connection"
    // twice for the same logical server (e.g., after a failed connect with
    // a typo) ends up with two profiles sharing the same display name and
    // different UUIDs — surfaces in the sidebar dropdown as duplicate
    // entries and is hard to untangle. Match is case-insensitive on
    // trimmed names.
    const incomingName = request.profile.name?.trim().toLowerCase();
    if (incomingName) {
      const conflict = profiles.find(
        p => p.id !== request.profile.id && p.name.trim().toLowerCase() === incomingName
      );
      if (conflict) {
        log.warn(
          `Rejecting save: name conflict with existing profile ${conflict.id} (${conflict.name})`
        );
        throw new Error(
          `A connection named "${conflict.name}" already exists. ` +
            `Use Manage Connections → Edit to modify it, or pick a different name.`
        );
      }
    }

    let profile: ConnectionProfile;

    if (request.profile.id) {
      // Update existing
      log.debug(`Updating existing profile: ${request.profile.id}`);
      const index = profiles.findIndex(p => p.id === request.profile.id);
      if (index === -1) {
        log.error(`Profile not found for update: ${request.profile.id}`);
        throw new Error('Connection profile not found');
      }

      profile = {
        ...profiles[index],
        ...request.profile,
        id: request.profile.id,
        updatedAt: now,
      };
      profiles[index] = profile;
      log.debug(`Updated profile at index ${index}`);
    } else {
      // Create new
      const newId = uuidv4();
      log.debug(`Creating new profile with ID: ${newId}`);
      profile = {
        ...request.profile,
        id: newId,
        createdAt: now,
        updatedAt: now,
      } as ConnectionProfile;
      profiles.push(profile);
      log.debug(`Total profiles: ${profiles.length}`);
    }

    this.store.set('profiles', profiles);
    log.debug('Profiles saved to store');

    // Store password if provided
    if (request.password) {
      log.debug(`Storing password for profile: ${profile.id}`);
      await this.credentialStore.set(profile.id, request.password);
    } else {
      log.debug('No password provided, skipping keychain storage');
    }

    // Store SSH credentials if provided
    if (request.sshPassword) {
      await this.credentialStore.set(`${profile.id}:ssh-password`, request.sshPassword);
    }
    if (request.sshPassphrase) {
      await this.credentialStore.set(`${profile.id}:ssh-passphrase`, request.sshPassphrase);
    }

    log.info(`Profile saved: ${profile.id}`);
    return profile;
  }

  /**
   * Persist the MSAL homeAccountId bound to an Entra profile. Narrow update
   * to avoid racing with concurrent saves that might overwrite other fields.
   * Returns true if the profile existed and was updated.
   */
  async setAzureHomeAccountId(id: string, homeAccountId: string): Promise<boolean> {
    const profiles = this.getAll();
    const index = profiles.findIndex(p => p.id === id);
    if (index === -1) return false;
    profiles[index] = {
      ...profiles[index],
      azureHomeAccountId: homeAccountId,
      updatedAt: new Date().toISOString(),
    };
    this.store.set('profiles', profiles);
    log.info(`Bound Entra account ${homeAccountId} to profile ${id}`);
    return true;
  }

  /**
   * Delete a connection profile
   */
  async delete(id: string): Promise<boolean> {
    const profiles = this.getAll();
    const index = profiles.findIndex(p => p.id === id);

    if (index === -1) {
      return false;
    }

    profiles.splice(index, 1);
    this.store.set('profiles', profiles);

    // Also delete credentials (DB password + SSH credentials)
    await this.credentialStore.delete(id);
    await this.credentialStore.delete(`${id}:ssh-password`);
    await this.credentialStore.delete(`${id}:ssh-passphrase`);

    return true;
  }

  /**
   * Get password for a connection
   */
  async getPassword(id: string): Promise<string | null> {
    log.debug(`Getting password for profile: ${id}`);
    const password = await this.credentialStore.get(id);
    return password;
  }
}
