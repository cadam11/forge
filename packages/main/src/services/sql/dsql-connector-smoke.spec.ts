/**
 * Type-level smoke test for the official Aurora DSQL connector.
 * Constructs (but never connects) an AuroraDSQLPool to pin the constructor
 * option names our pool manager relies on. If the connector's API drifts on
 * upgrade, this fails at typecheck/test time instead of at runtime.
 */
import { describe, it, expect } from 'vitest';
import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import { Pool } from 'pg';

describe('aurora-dsql connector API surface', () => {
  it('AuroraDSQLPool extends pg.Pool and accepts our option set', () => {
    const pool = new AuroraDSQLPool({
      host: 'abc123.dsql.us-east-1.on.aws',
      user: 'admin',
      database: 'postgres',
      port: 5432,
      profile: 'dev',
      max: 1,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 1000,
    });
    expect(pool).toBeInstanceOf(Pool);
  });
});
