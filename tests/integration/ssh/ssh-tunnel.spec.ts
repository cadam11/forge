/**
 * SSH tunnel happy-path test.
 *
 * Verifies that Forge's `SshTunnelManager` opens a tunnel through the bastion
 * container to `postgres-private` (which is only reachable on the private
 * network) and that PostgreSQL traffic flows through cleanly.
 *
 * Cleanup runs in afterEach via `closeAll()` so an aborted assertion never
 * leaves a dangling tunnel.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client as PgClient } from 'pg';

import { SshTunnelManager } from '@forgedb/main/services/ssh/ssh-tunnel-manager';
import type { SshTunnelConfig } from '@forgedb/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRIVATE_KEY = join(HERE, '..', '..', '.ssh', 'id_test');
const PROFILE_ID = 'test-tunnel-profile';

const SSH_CONFIG: SshTunnelConfig = {
  enabled: true,
  host: '127.0.0.1',
  port: 12222,
  username: 'forge',
  authType: 'privateKey',
  privateKeyPath: PRIVATE_KEY,
};

const PG_TARGET = { host: 'postgres-private', port: 5432 };

const manager = SshTunnelManager.getInstance();

beforeAll(() => {
  if (!existsSync(PRIVATE_KEY)) {
    throw new Error(
      `[ssh-tunnel.spec] expected private key at ${PRIVATE_KEY}. ` +
        `Run \`npm run test:harness:up\` first — it generates the keypair.`
    );
  }
});

afterEach(async () => {
  await manager.closeAll();
});

describe('ssh tunnel — bastion to postgres-private', () => {
  it('opens a tunnel and routes a SELECT through it', async () => {
    const endpoint = await manager.openTunnel(
      PROFILE_ID,
      SSH_CONFIG,
      PG_TARGET.host,
      PG_TARGET.port
    );
    expect(endpoint.localPort).toBeGreaterThan(0);
    expect(endpoint.localHost).toBe('127.0.0.1');
    expect(manager.hasTunnel(PROFILE_ID)).toBe(true);

    const client = new PgClient({
      host: endpoint.localHost,
      port: endpoint.localPort,
      user: 'forge',
      password: 'forge',
      database: 'forge_private',
    });
    await client.connect();
    try {
      const dbRow = (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0];
      expect(dbRow.db).toBe('forge_private');
      const oneRow = (await client.query<{ one: number }>('SELECT 1 AS one')).rows[0];
      expect(oneRow.one).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('reuses the same tunnel for repeated openTunnel calls on the same profile', async () => {
    const first = await manager.openTunnel(PROFILE_ID, SSH_CONFIG, PG_TARGET.host, PG_TARGET.port);
    const second = await manager.openTunnel(PROFILE_ID, SSH_CONFIG, PG_TARGET.host, PG_TARGET.port);
    expect(second.localPort).toBe(first.localPort);
  });

  it('closeTunnel evicts the tunnel from the manager', async () => {
    await manager.openTunnel(PROFILE_ID, SSH_CONFIG, PG_TARGET.host, PG_TARGET.port);
    expect(manager.hasTunnel(PROFILE_ID)).toBe(true);
    await manager.closeTunnel(PROFILE_ID);
    expect(manager.hasTunnel(PROFILE_ID)).toBe(false);
  });
});
