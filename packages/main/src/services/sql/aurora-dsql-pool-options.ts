/**
 * Pure options builder for AuroraDSQLPool — kept separate from
 * connection-pool.ts so the security-critical invariants (TLS validation
 * always on, no trust-toggle influence, no SSH-tunnel rewriting) are pinned
 * by unit tests without mocking the pool manager singleton or the driver.
 */
import type { AuroraDSQLPoolConfig } from '@aws/aurora-dsql-node-postgres-connector';
import type { ConnectionProfile } from '@joinery/shared';

export function auroraDsqlPoolOptions(
  profile: ConnectionProfile,
  dbName: string,
  poolOptions: { max: number; idleTimeoutMillis?: number; query_timeout?: number }
): AuroraDSQLPoolConfig {
  return {
    host: profile.server,
    port: profile.port,
    user: profile.username || 'admin',
    database: dbName,
    profile: profile.awsProfile || undefined,
    // DSQL always presents a publicly-trusted certificate and the password
    // IS a live credential (SigV4 token) — certificate validation is never
    // optional on this path, regardless of the profile's trust toggle.
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: profile.connectionTimeout * 1000,
    ...poolOptions,
  };
}
