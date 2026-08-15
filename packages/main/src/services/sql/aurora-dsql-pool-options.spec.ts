/**
 * Pins the security-critical invariants of the AuroraDSQLPool options
 * builder used on the aws-iam (Aurora DSQL) connection path. A SigV4 auth
 * token travels as the "password" for these connections, so TLS validation
 * must never be toggleable — and the options must never be derived from a
 * tunnel-rewritten profile (SSH tunneling isn't supported for aws-iam; see
 * connection-pool.ts's getPgPool guard).
 */
import { describe, expect, it } from 'vitest';
import type { ConnectionProfile } from '@joinery/shared';
import { auroraDsqlPoolOptions } from './aurora-dsql-pool-options';

const baseProfile = (over: Partial<ConnectionProfile> = {}): ConnectionProfile => ({
  id: 'profile-1',
  name: 'DSQL IAM Profile',
  engine: 'postgresql',
  server: 'abc123.dsql.us-east-1.on.aws',
  port: 5432,
  authenticationType: 'aws-iam',
  encrypt: true,
  trustServerCertificate: false,
  connectionTimeout: 15,
  ...over,
});

describe('auroraDsqlPoolOptions', () => {
  it('always enables TLS validation, even when trustServerCertificate is true', () => {
    const opts = auroraDsqlPoolOptions(baseProfile({ trustServerCertificate: true }), 'postgres', {
      max: 1,
    });
    expect(opts.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('always enables TLS validation, even when encrypt is false', () => {
    const opts = auroraDsqlPoolOptions(baseProfile({ encrypt: false }), 'postgres', { max: 1 });
    expect(opts.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('always enables TLS validation when both toggles try to weaken it at once', () => {
    const opts = auroraDsqlPoolOptions(
      baseProfile({ encrypt: false, trustServerCertificate: true }),
      'postgres',
      { max: 1 }
    );
    expect(opts.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("defaults user to 'admin' when username is unset", () => {
    const opts = auroraDsqlPoolOptions(baseProfile({ username: undefined }), 'postgres', {
      max: 1,
    });
    expect(opts.user).toBe('admin');
  });

  it("defaults user to 'admin' when username is empty", () => {
    const opts = auroraDsqlPoolOptions(baseProfile({ username: '' }), 'postgres', { max: 1 });
    expect(opts.user).toBe('admin');
  });

  it('uses the profile username when set', () => {
    const opts = auroraDsqlPoolOptions(baseProfile({ username: 'iam-user' }), 'postgres', {
      max: 1,
    });
    expect(opts.user).toBe('iam-user');
  });

  it('maps profile option from awsProfile', () => {
    const opts = auroraDsqlPoolOptions(baseProfile({ awsProfile: 'dev' }), 'postgres', { max: 1 });
    expect(opts.profile).toBe('dev');
  });

  it('leaves profile option undefined when awsProfile is unset', () => {
    const opts = auroraDsqlPoolOptions(baseProfile({ awsProfile: undefined }), 'postgres', {
      max: 1,
    });
    expect(opts.profile).toBeUndefined();
  });

  it('maps host/port/database from the profile and dbName, never a tunnel-rewritten host', () => {
    const profile = baseProfile({
      server: 'abc123.dsql.us-east-1.on.aws',
      port: 5432,
      sshTunnel: {
        enabled: true,
        host: 'bastion.example.com',
        port: 22,
        username: 'tunnel-user',
        authType: 'password',
      },
    });
    const opts = auroraDsqlPoolOptions(profile, 'my_db', { max: 1 });
    expect(opts.host).toBe('abc123.dsql.us-east-1.on.aws');
    expect(opts.port).toBe(5432);
    expect(opts.database).toBe('my_db');
  });

  it('maps connectionTimeoutMillis from connectionTimeout seconds', () => {
    const opts = auroraDsqlPoolOptions(baseProfile({ connectionTimeout: 20 }), 'postgres', {
      max: 1,
    });
    expect(opts.connectionTimeoutMillis).toBe(20000);
  });

  it('passes poolOptions through unchanged (max, idleTimeoutMillis, query_timeout)', () => {
    const opts = auroraDsqlPoolOptions(baseProfile(), 'postgres', {
      max: 10,
      idleTimeoutMillis: 30000,
      query_timeout: 45000,
    });
    expect(opts.max).toBe(10);
    expect(opts.idleTimeoutMillis).toBe(30000);
    expect(opts.query_timeout).toBe(45000);
  });
});
