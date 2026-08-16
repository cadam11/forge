/**
 * The zod adapter, and the property that matters most about it: **every message it produces for a
 * shared-validated field is byte-identical to the one `packages/shared` produced.**
 *
 * That is asserted by calling the shared validator in the test and comparing strings, not by
 * hard-coding the expected text. A forked copy of a rule — a re-typed 128-character cap, a re-typed
 * port range, a reworded "is required" — fails these tests even if it happens to agree today, because
 * the expectation moves with `packages/shared` and a fork does not.
 *
 * The matrix at the bottom is the brief's gate: every engine × auth mode, plus both SSH branches and
 * the DSQL branch, driven through the resolver the dialog actually uses.
 */

import { describe, expect, it } from 'vitest';
import {
  validateConnectionName,
  validatePort,
  validateServer,
  validateUsername,
} from '@joinery/shared';

import { NEW_CONNECTION_VALUES, type ConnectionFormValues } from './form-model';
import { TEST_FIELDS, connectionFormSchema, firstErrorMessage } from './form-schema';

function values(overrides: Partial<ConnectionFormValues> = {}): ConnectionFormValues {
  return { ...NEW_CONNECTION_VALUES, ...overrides };
}

/** Field → messages, the way `zodResolver` will hand them to react-hook-form. */
function errorsFor(input: ConnectionFormValues): Record<string, string[]> {
  const result = connectionFormSchema.safeParse(input);
  if (result.success) return {};

  const byField: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join('.');
    byField[field] = [...(byField[field] ?? []), issue.message];
  }
  return byField;
}

/** A form filled in enough to be valid, so a test can break exactly one thing. */
const COMPLETE = values({
  name: 'Reporting',
  server: 'db.example.com',
  port: 1433,
  username: 'sa',
});

describe('the schema as a whole', () => {
  it('accepts a complete form', () => {
    expect(errorsFor(COMPLETE)).toEqual({});
  });

  it('rejects an engine or auth mode the pickers do not offer', () => {
    // The `oneOf` fields. Not reachable from the UI, but the schema is also the contract for a
    // restored draft or a future prefill, and silently accepting `engine: 'oracle'` would send it to
    // the main process.
    expect(
      errorsFor({ ...COMPLETE, engine: 'oracle' as ConnectionFormValues['engine'] })
    ).toHaveProperty('engine');
    expect(
      errorsFor({
        ...COMPLETE,
        authenticationType: 'kerberos' as ConnectionFormValues['authenticationType'],
      })
    ).toHaveProperty('authenticationType');
  });
});

describe('every message comes from packages/shared', () => {
  it('name: required', () => {
    expect(errorsFor({ ...COMPLETE, name: '' }).name).toEqual(validateConnectionName('').errors);
  });

  it('name: too long, and untrimmed', () => {
    const tooLong = 'x'.repeat(129);
    expect(errorsFor({ ...COMPLETE, name: tooLong }).name).toEqual(
      validateConnectionName(tooLong).errors
    );

    const padded = ' Reporting ';
    expect(errorsFor({ ...COMPLETE, name: padded }).name).toEqual(
      validateConnectionName(padded).errors
    );
  });

  it('server: required, and malformed', () => {
    expect(errorsFor({ ...COMPLETE, server: '' }).server).toEqual(validateServer('').errors);

    const bad = 'not a hostname!';
    expect(errorsFor({ ...COMPLETE, server: bad }).server).toEqual(validateServer(bad).errors);
  });

  it('server: an out-of-range IPv4 octet', () => {
    const octets = '999.1.1.1';
    expect(errorsFor({ ...COMPLETE, server: octets }).server).toEqual(
      validateServer(octets).errors
    );
  });

  it('replays EVERY message a shared validator returns, not just the first', () => {
    // A 129-character name with padding fails two of `validateConnectionName`'s rules at once.
    // Collapsing them would hide whichever one the user did not think of.
    const padded = ` ${'x'.repeat(129)} `;
    const shared = validateConnectionName(padded).errors;
    expect(shared.length).toBeGreaterThan(1);
    expect(errorsFor({ ...COMPLETE, name: padded }).name).toEqual(shared);
  });

  it('port: out of range, and emptied', () => {
    expect(errorsFor({ ...COMPLETE, port: 70_000 }).port).toEqual(validatePort(70_000).errors);
    // An emptied `<input type="number">` reads as NaN under `valueAsNumber`. The user must see the
    // shared validator's wording, not zod's "expected number, received NaN".
    expect(errorsFor({ ...COMPLETE, port: Number.NaN }).port).toEqual(
      validatePort(Number.NaN).errors
    );
    expect(errorsFor({ ...COMPLETE, port: Number.NaN }).port).toEqual(['Port must be a number']);
  });

  it('username: required for sql auth only, in the shared validator’s words', () => {
    expect(errorsFor({ ...COMPLETE, username: '' }).username).toEqual(
      validateUsername('', 'sql').errors
    );
  });
});

describe('the engine × auth-mode matrix', () => {
  const base = { name: 'Matrix', server: 'db.example.com' } as const;

  it.each([
    ['mssql', 'sql', true],
    ['mssql', 'windows', false],
    ['mssql', 'entra-id', false],
    ['postgresql', 'sql', true],
    ['postgresql', 'aws-iam', false],
    ['mysql', 'sql', true],
  ] as const)('%s / %s → username required: %s', (engine, authenticationType, required) => {
    const blank = errorsFor(values({ ...base, engine, authenticationType, username: '' }));
    expect('username' in blank).toBe(required);

    // Supplying one is always legal, including for the modes that do not need it.
    expect(errorsFor(values({ ...base, engine, authenticationType, username: 'someone' }))).toEqual(
      {}
    );
  });

  it('accepts a DSQL profile with no username at all', () => {
    // `resolvedUsername` defaults it to `admin` at save time (`form-model.spec.ts` pins that), so the
    // form must not block on it — which is exactly what the Angular `isValid()` special-cased and
    // `validationHint()` forgot.
    expect(
      errorsFor(
        values({
          name: 'DSQL',
          engine: 'postgresql',
          authenticationType: 'aws-iam',
          server: 'abcdefghijklmnopqrstuvwxyz.dsql.us-east-1.on.aws',
          port: 5432,
          username: '',
          awsProfile: 'default',
        })
      )
    ).toEqual({});
  });
});

describe('the SSH branch', () => {
  const tunnelled = (overrides: Partial<ConnectionFormValues>): ConnectionFormValues =>
    values({ ...COMPLETE, sshEnabled: true, ...overrides });

  it('validates nothing SSH-related while the tunnel is off', () => {
    // Every SSH field left blank, and the form is still valid — a disabled tunnel's fields are not
    // half-filled input, they are unused.
    expect(errorsFor({ ...COMPLETE, sshHost: '', sshUsername: '', sshPrivateKeyPath: '' })).toEqual(
      {}
    );
  });

  it('requires host and username once it is on', () => {
    const errors = errorsFor(tunnelled({ sshHost: '', sshUsername: '' }));
    expect(errors.sshHost).toEqual(validateServer('').errors);
    expect(errors.sshUsername).toEqual(['SSH username is required for a tunnelled connection']);
  });

  it('validates the SSH host as a hostname, through the shared validator', () => {
    const bad = 'bastion!!';
    expect(errorsFor(tunnelled({ sshHost: bad, sshUsername: 'ec2-user' })).sshHost).toEqual(
      validateServer(bad).errors
    );
  });

  it('validates the SSH port through the shared validator', () => {
    expect(
      errorsFor(tunnelled({ sshHost: 'bastion', sshUsername: 'u', sshPort: 0 })).sshPort
    ).toEqual(validatePort(0).errors);
  });

  it('accepts password auth with no key path', () => {
    expect(
      errorsFor(tunnelled({ sshHost: 'bastion', sshUsername: 'u', sshAuthType: 'password' }))
    ).toEqual({});
  });

  it('requires a key path for key auth', () => {
    expect(
      errorsFor(
        tunnelled({
          sshHost: 'bastion',
          sshUsername: 'u',
          sshAuthType: 'privateKey',
          sshPrivateKeyPath: '   ',
        })
      ).sshPrivateKeyPath
    ).toEqual(['Private key path is required for key authentication']);
  });

  it('accepts key auth with a path', () => {
    expect(
      errorsFor(
        tunnelled({
          sshHost: 'bastion',
          sshUsername: 'u',
          sshAuthType: 'privateKey',
          sshPrivateKeyPath: '~/.ssh/id_ed25519',
        })
      )
    ).toEqual({});
  });
});

describe('fields the schema deliberately leaves alone', () => {
  it('does not apply the create-a-database validator to the Default Database field', () => {
    // `validateDatabaseName` rejects system database names, and `master` / `postgres` / `mysql` are
    // exactly the legitimate defaults. Applying it would make the correct value an error on every
    // engine.
    for (const database of ['master', 'postgres', 'mysql', 'select']) {
      expect(errorsFor({ ...COMPLETE, database })).toEqual({});
    }
  });

  it('does not reject an emptied Connection Timeout', () => {
    // `form-model.ts` substitutes 30 seconds, which is the ported behaviour.
    expect(errorsFor({ ...COMPLETE, connectionTimeout: Number.NaN })).toEqual({});
  });

  it('never validates a password', () => {
    // A password can legitimately contain anything, so hygiene is advisory and lives in the banner.
    expect(errorsFor({ ...COMPLETE, password: '  spaces  ' })).toEqual({});
  });
});

describe('TEST_FIELDS', () => {
  it('omits the name, so Test is available before a form can be saved', () => {
    expect(TEST_FIELDS).not.toContain('name');
    // And the name really is the only thing standing between the two gates for a plain profile: a
    // form that fails Save purely on its name passes every field Test looks at.
    const nameless = { ...COMPLETE, name: '' };
    expect(Object.keys(errorsFor(nameless))).toEqual(['name']);
  });

  it('covers every field the schema can complain about besides name and timeout', () => {
    // The drift guard: a rule added to the schema on a new field, without adding that field here,
    // would leave Test able to fire on input it knows is invalid.
    const broken = errorsFor(
      values({
        name: '',
        server: '',
        port: Number.NaN,
        username: '',
        sshEnabled: true,
        sshHost: '',
        sshPort: Number.NaN,
        sshUsername: '',
        sshAuthType: 'privateKey',
        sshPrivateKeyPath: '',
      })
    );
    expect(Object.keys(broken).sort()).toEqual([...TEST_FIELDS, 'name'].sort());
  });
});

describe('firstErrorMessage', () => {
  it('names the topmost problem in the form’s reading order', () => {
    expect(
      firstErrorMessage({
        name: { message: 'Connection name is required', type: 'custom' },
        server: { message: 'Server is required', type: 'custom' },
      })
    ).toBe('Server is required');
  });

  it('falls through to the name when nothing above it is wrong', () => {
    expect(
      firstErrorMessage({ name: { message: 'Connection name is required', type: 'custom' } })
    ).toBe('Connection name is required');
  });

  it('is undefined for a clean form', () => {
    expect(firstErrorMessage({})).toBeUndefined();
  });
});
