import { describe, it, expect } from 'vitest';
import type { ConnectionProfile } from '@forgedb/shared';
import { ConnectionPoolManager } from './connection-pool';

/**
 * Pins the error-categorization contract that feeds the connection dialog's
 * inline test-failure panel (TestConnectionResult.guidance):
 *  - MSSQL login failures from pool.connect() arrive as a tedious
 *    ConnectionError with code 'ELOGIN' and NO `number` property (only
 *    query-time RequestErrors carry `number`) — both shapes must categorize
 *    as AUTH_FAILED, or the hygiene guidance is dead code.
 *  - Password-hygiene lines appear on auth failures for every engine, only
 *    when a password was provided, and never on non-auth errors.
 *  - The raw password never appears in any guidance line.
 */

type Categorized = { code: string; message: string; guidance: string[] };

interface CategorizeSeam {
  categorizeError(
    error: Error & { code?: string; number?: number },
    password?: string
  ): Categorized;
  categorizePgError(
    error: Error & { code?: string },
    profile?: ConnectionProfile,
    password?: string
  ): string[];
  categorizeMySQLError(error: Error & { code?: string }, password?: string): string[];
}

const seam = (): CategorizeSeam => ConnectionPoolManager.getInstance() as unknown as CategorizeSeam;

const mssqlError = (props: { code?: string; number?: number; message?: string }) =>
  Object.assign(new Error(props.message ?? "Login failed for user 'sa'."), props);

describe('categorizeError — MSSQL auth failures', () => {
  it('categorizes a query-time RequestError (number 18456) as AUTH_FAILED', () => {
    const result = seam().categorizeError(mssqlError({ number: 18456 }));
    expect(result.code).toBe('AUTH_FAILED');
    expect(result.message).toBe('Login failed');
  });

  it("categorizes a connect-time ConnectionError (code 'ELOGIN', no number) as AUTH_FAILED", () => {
    // tedious builds ConnectionError(token.message, 'ELOGIN') and never copies
    // token.number onto it; mssql's wrapper preserves only message/code.
    const result = seam().categorizeError(mssqlError({ code: 'ELOGIN' }));
    expect(result.code).toBe('AUTH_FAILED');
    expect(result.message).toBe('Login failed');
  });

  it('appends hygiene findings and the entered-password length for an artifact-bearing password', () => {
    const result = seam().categorizeError(mssqlError({ code: 'ELOGIN' }), 'secret’ ');
    const joined = result.guidance.join(' ');
    expect(joined).toMatch(/ends with a space/);
    expect(joined).toMatch(/curly quotes/);
    expect(joined).toMatch(/being tested is 8 characters/);
    expect(joined).not.toContain('secret');
  });

  it('keeps exactly the three generic lines when no password was provided', () => {
    const result = seam().categorizeError(mssqlError({ number: 18456 }), undefined);
    expect(result.guidance).toHaveLength(3);
  });

  it('keeps exactly the three generic lines for a clean password (no length disclosure)', () => {
    const result = seam().categorizeError(mssqlError({ number: 18456 }), 'CleanP@ss1');
    expect(result.guidance).toHaveLength(3);
    expect(result.guidance.join(' ')).not.toMatch(/characters/);
  });

  it('never adds password-derived lines to non-auth errors', () => {
    const result = seam().categorizeError(
      mssqlError({ code: 'ESOCKET', message: 'socket hang up' }),
      'secret '
    );
    expect(result.code).toBe('CONNECTION_REFUSED');
    expect(result.guidance.join(' ')).not.toMatch(/password|characters/i);
  });
});

describe('categorizePgError — PostgreSQL auth failures', () => {
  it('appends hygiene findings on 28P01 when a password is provided', () => {
    const guidance = seam().categorizePgError(
      Object.assign(new Error('password authentication failed'), { code: '28P01' }),
      undefined,
      'secret\n'
    );
    expect(guidance.join(' ')).toMatch(/ends with a space/);
    expect(guidance.join(' ')).toMatch(/being tested is 7 characters/);
  });

  it('stays generic on 28P01 with a clean password and on non-auth codes', () => {
    const clean = seam().categorizePgError(
      Object.assign(new Error('x'), { code: '28P01' }),
      undefined,
      'CleanP@ss1'
    );
    expect(clean).toHaveLength(3);
    const refused = seam().categorizePgError(
      Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
      undefined,
      'secret '
    );
    expect(refused.join(' ')).not.toMatch(/characters/);
  });

  it('routes aws-iam credential failures to SSO guidance ahead of the generic cases', () => {
    const profile = { authenticationType: 'aws-iam', awsProfile: 'dev' } as ConnectionProfile;
    const guidance = seam().categorizePgError(
      new Error('Could not load credentials from any providers'),
      profile
    );
    expect(guidance.join(' ')).toMatch(/aws sso login --profile dev/);
  });
});

describe('categorizeMySQLError — MySQL auth failures', () => {
  it('appends hygiene findings on ER_ACCESS_DENIED_ERROR when a password is provided', () => {
    const guidance = seam().categorizeMySQLError(
      Object.assign(new Error('Access denied'), { code: 'ER_ACCESS_DENIED_ERROR' }),
      'secret '
    );
    expect(guidance.join(' ')).toMatch(/ends with a space/);
  });

  it('stays generic on non-auth codes even with an artifact-bearing password', () => {
    const guidance = seam().categorizeMySQLError(
      Object.assign(new Error('x'), { code: 'ER_BAD_DB_ERROR' }),
      'secret '
    );
    expect(guidance.join(' ')).not.toMatch(/password|characters/i);
  });
});
