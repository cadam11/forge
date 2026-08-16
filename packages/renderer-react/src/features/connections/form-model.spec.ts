/**
 * The connection form's pure model: the engine × auth-mode matrix, the DSQL sniffing, and the two
 * profile builders.
 *
 * Everything here was unreachable in the Angular original — the same logic lived on a class that
 * needed `MAT_DIALOG_DATA` and a `MatDialogRef` to instantiate, which is why the engine-switch
 * heuristic, the IPv6 guard and the `aws-iam` username default had no tests at all. The matrix at the
 * bottom is the brief's "per engine × auth mode, incl. SSH and DSQL branches" gate, driven through
 * the zod adapter in `form-schema.spec.ts` and through the builders here.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PORTS, type ConnectionProfile } from '@joinery/shared';

import {
  AUTH_MODES,
  DEFAULT_SSH_PORT,
  ENGINES,
  NEW_CONNECTION_VALUES,
  applyAuthModeChange,
  applyEngineChange,
  awsProfileOptions,
  buildProfileDraft,
  buildSshTunnelConfig,
  buildTestProfile,
  formValuesFromProfile,
  isAuthModeValidForEngine,
  needsPassword,
  needsUsername,
  normalizeServer,
  resolvedUsername,
  splitHostPort,
  type ConnectionFormValues,
} from './form-model';

const DSQL_HOST = 'abcdefghijklmnopqrstuvwxyz.dsql.us-east-1.on.aws';

function values(overrides: Partial<ConnectionFormValues> = {}): ConnectionFormValues {
  return { ...NEW_CONNECTION_VALUES, ...overrides };
}

/** A saved profile with every optional member the dialog does NOT edit already populated. */
const DOCKER_ENTRA_PROFILE: ConnectionProfile = {
  id: 'profile-1',
  name: 'Saved',
  engine: 'mssql',
  server: 'localhost',
  port: 1433,
  authenticationType: 'entra-id',
  username: 'someone@example.com',
  database: 'reporting',
  encrypt: true,
  trustServerCertificate: false,
  connectionTimeout: 45,
  requestTimeout: 60_000,
  color: '#1e88e5',
  isDocker: true,
  dockerContainerId: 'container-abc',
  volumeMappings: [{ hostPath: '/tmp/host', containerPath: '/var/opt/mssql' }],
  azureTenantId: 'tenant-1',
  azureClientId: 'client-1',
  azureHomeAccountId: 'home-account-1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('the engine and auth-mode tables', () => {
  it('offers every engine the shared labels declare', () => {
    // Derived from ENGINE_LABELS rather than re-listed, so a fourth engine in packages/shared shows
    // up in the picker without an edit here. That is the property being pinned.
    expect(ENGINES).toEqual(['mssql', 'postgresql', 'mysql']);
    for (const engine of ENGINES) {
      expect(AUTH_MODES[engine].length).toBeGreaterThan(0);
    }
  });

  it('offers each engine only the auth modes it actually supports', () => {
    expect(AUTH_MODES.mssql.map(m => m.value)).toEqual(['sql', 'windows', 'entra-id']);
    expect(AUTH_MODES.postgresql.map(m => m.value)).toEqual(['sql', 'aws-iam']);
    expect(AUTH_MODES.mysql.map(m => m.value)).toEqual(['sql']);

    expect(isAuthModeValidForEngine('postgresql', 'aws-iam')).toBe(true);
    expect(isAuthModeValidForEngine('mssql', 'aws-iam')).toBe(false);
    expect(isAuthModeValidForEngine('mysql', 'windows')).toBe(false);
  });
});

describe('which credentials the form collects', () => {
  // The whole matrix, because the three Angular predicates that expressed it disagreed about
  // aws-iam (`isValid` allowed a blank username, `validationHint` never asked for one on
  // non-mssql engines, and `canTestConnection` had its own copy).
  const cases: readonly [
    ConnectionFormValues['engine'],
    ConnectionFormValues['authenticationType'],
    boolean,
    boolean,
  ][] = [
    ['mssql', 'sql', true, true],
    ['mssql', 'windows', false, false],
    ['mssql', 'entra-id', false, false],
    ['postgresql', 'sql', true, true],
    ['postgresql', 'aws-iam', true, false],
    ['mysql', 'sql', true, true],
  ];

  it.each(cases)('%s / %s → username %s, password %s', (engine, auth, username, password) => {
    const state = values({ engine, authenticationType: auth });
    expect(needsUsername(state)).toBe(username);
    expect(needsPassword(state)).toBe(password);
  });

  it('defaults an aws-iam profile’s blank username to the admin DB role', () => {
    expect(resolvedUsername(values({ authenticationType: 'aws-iam' }))).toBe('admin');
    expect(resolvedUsername(values({ authenticationType: 'aws-iam', username: 'reader' }))).toBe(
      'reader'
    );
  });

  it('collapses a blank username to undefined for every other mode', () => {
    expect(resolvedUsername(values({ username: '' }))).toBeUndefined();
  });
});

describe('applyEngineChange', () => {
  it('moves the port to the new engine’s default', () => {
    for (const engine of ENGINES) {
      expect(applyEngineChange(values(), engine).port).toBe(DEFAULT_PORTS[engine]);
    }
  });

  it('replaces another engine’s conventional username but keeps a chosen one', () => {
    expect(applyEngineChange(values({ username: 'sa' }), 'postgresql').username).toBe('postgres');
    expect(applyEngineChange(values({ username: 'root' }), 'mssql').username).toBe('sa');
    expect(applyEngineChange(values({ username: '' }), 'mysql').username).toBe('root');
    expect(applyEngineChange(values({ username: 'reporting_svc' }), 'mysql').username).toBe(
      'reporting_svc'
    );
  });

  it('resets an auth mode the new engine does not offer', () => {
    const dsql = values({ engine: 'postgresql', authenticationType: 'aws-iam' });
    expect(applyEngineChange(dsql, 'mssql').authenticationType).toBe('sql');
    expect(applyEngineChange(dsql, 'mysql').authenticationType).toBe('sql');
  });

  it('keeps an auth mode the new engine does offer', () => {
    const entra = values({ engine: 'mssql', authenticationType: 'entra-id' });
    expect(applyEngineChange(entra, 'mssql').authenticationType).toBe('entra-id');
  });

  it('sniffs a DSQL endpoint that was pasted before the engine was switched', () => {
    // The Angular ordering bug: `onServerChange` short-circuited on engine, so a host pasted while
    // mssql was selected was never re-examined when the user switched to PostgreSQL.
    const pasted = values({ server: DSQL_HOST });
    const switched = applyEngineChange(pasted, 'postgresql');

    expect(switched.authenticationType).toBe('aws-iam');
    expect(switched.database).toBe('postgres');
    expect(switched.awsProfile).toBe('default');
  });
});

describe('applyAuthModeChange', () => {
  it('defaults the AWS profile when aws-iam is picked', () => {
    expect(applyAuthModeChange(values(), 'aws-iam').awsProfile).toBe('default');
  });

  it('leaves an already-chosen AWS profile alone', () => {
    expect(applyAuthModeChange(values({ awsProfile: 'prod' }), 'aws-iam').awsProfile).toBe('prod');
  });

  it('touches nothing else for the other modes', () => {
    expect(applyAuthModeChange(values(), 'windows')).toEqual(
      values({ authenticationType: 'windows' })
    );
  });
});

describe('splitHostPort', () => {
  it('splits a pasted host:port', () => {
    expect(splitHostPort('db.example.com:5433')).toEqual({ host: 'db.example.com', port: 5433 });
  });

  it('trims', () => {
    expect(splitHostPort('  localhost  ')).toEqual({ host: 'localhost' });
  });

  it('leaves a bare or bracketed IPv6 literal intact', () => {
    // The guard the Angular comment describes: truncating at the LAST colon would turn
    // `2001:db8::1` into `2001:db8:` with port NaN.
    expect(splitHostPort('2001:db8::1')).toEqual({ host: '2001:db8::1' });
    expect(splitHostPort('[::1]')).toEqual({ host: '[::1]' });
  });

  it('leaves an out-of-range or non-numeric suffix intact', () => {
    expect(splitHostPort('host:99999')).toEqual({ host: 'host:99999' });
    expect(splitHostPort('host:abc')).toEqual({ host: 'host:abc' });
    expect(splitHostPort('host:0')).toEqual({ host: 'host:0' });
  });
});

describe('normalizeServer', () => {
  it('normalizes for every engine but only auto-selects IAM for postgresql', () => {
    for (const engine of ENGINES) {
      const result = normalizeServer(values({ engine, server: `  ${DSQL_HOST}:5432  ` }));
      expect(result.server).toBe(DSQL_HOST);
      expect(result.port).toBe(5432);
      expect(result.authenticationType).toBe(engine === 'postgresql' ? 'aws-iam' : 'sql');
    }
  });

  it('does not clobber a deliberate non-sql auth choice', () => {
    const manual = values({
      engine: 'postgresql',
      server: DSQL_HOST,
      authenticationType: 'aws-iam',
      awsProfile: 'prod',
      database: 'mydb',
    });
    expect(normalizeServer(manual).database).toBe('mydb');
    expect(normalizeServer(manual).awsProfile).toBe('prod');
  });

  it('does not auto-select IAM once a password has been typed', () => {
    // A typed password means the user intends password auth against a DSQL-shaped host.
    const withPassword = values({
      engine: 'postgresql',
      server: DSQL_HOST,
      password: 'secret',
    });
    expect(normalizeServer(withPassword).authenticationType).toBe('sql');
  });

  it('leaves a non-DSQL postgresql host on password auth', () => {
    const plain = values({ engine: 'postgresql', server: '127.0.0.1' });
    expect(normalizeServer(plain).authenticationType).toBe('sql');
  });
});

describe('buildSshTunnelConfig', () => {
  it('is undefined when the tunnel is off, whatever the fields hold', () => {
    expect(
      buildSshTunnelConfig(values({ sshHost: 'bastion', sshUsername: 'ec2-user' }))
    ).toBeUndefined();
  });

  it('carries no privateKeyPath for password auth', () => {
    const config = buildSshTunnelConfig(
      values({
        sshEnabled: true,
        sshHost: 'bastion',
        sshUsername: 'ec2-user',
        sshAuthType: 'password',
        sshPrivateKeyPath: '~/.ssh/id_rsa',
      })
    );
    expect(config).toEqual({
      enabled: true,
      host: 'bastion',
      port: DEFAULT_SSH_PORT,
      username: 'ec2-user',
      authType: 'password',
    });
  });

  it('carries the privateKeyPath for key auth', () => {
    const config = buildSshTunnelConfig(
      values({
        sshEnabled: true,
        sshHost: 'bastion',
        sshPort: 2222,
        sshUsername: 'ec2-user',
        sshAuthType: 'privateKey',
        sshPrivateKeyPath: '~/.ssh/id_ed25519',
      })
    );
    expect(config).toMatchObject({ port: 2222, privateKeyPath: '~/.ssh/id_ed25519' });
  });

  it('falls back to port 22 when the field is emptied', () => {
    const config = buildSshTunnelConfig(
      values({ sshEnabled: true, sshHost: 'bastion', sshUsername: 'u', sshPort: Number.NaN })
    );
    expect(config?.port).toBe(DEFAULT_SSH_PORT);
  });
});

describe('buildProfileDraft', () => {
  it('produces every required member of a ConnectionProfile for a create', () => {
    // The Task 4 tightening: `saveProfile` takes a ProfileDraft, which is the whole profile minus a
    // possibly-absent id. A partial object would not compile, and this asserts the runtime shape too.
    const draft = buildProfileDraft(
      values({ name: 'New', server: 'localhost', username: 'sa', port: 1433 })
    );

    expect(draft.id).toBeUndefined();
    for (const key of [
      'name',
      'engine',
      'server',
      'port',
      'authenticationType',
      'encrypt',
      'trustServerCertificate',
      'connectionTimeout',
    ] as const) {
      expect(draft[key]).not.toBeUndefined();
    }
  });

  it('preserves the members the dialog does not edit', () => {
    // The real bug in the Angular builder: it returned only the edited fields and survived purely
    // because `connection-profiles.ts:113` merges an update over the stored profile. Dropping
    // `azureHomeAccountId` would break Entra silent refresh; dropping `volumeMappings` would break a
    // Docker profile's backup paths.
    const draft = buildProfileDraft(
      formValuesFromProfile(DOCKER_ENTRA_PROFILE),
      DOCKER_ENTRA_PROFILE
    );

    expect(draft).toMatchObject({
      id: 'profile-1',
      isDocker: true,
      dockerContainerId: 'container-abc',
      volumeMappings: DOCKER_ENTRA_PROFILE.volumeMappings,
      azureTenantId: 'tenant-1',
      azureClientId: 'client-1',
      azureHomeAccountId: 'home-account-1',
      requestTimeout: 60_000,
    });
  });

  it('round-trips an existing profile’s edited fields unchanged', () => {
    const draft = buildProfileDraft(
      formValuesFromProfile(DOCKER_ENTRA_PROFILE),
      DOCKER_ENTRA_PROFILE
    );

    expect(draft).toMatchObject({
      name: 'Saved',
      engine: 'mssql',
      server: 'localhost',
      port: 1433,
      authenticationType: 'entra-id',
      username: 'someone@example.com',
      database: 'reporting',
      trustServerCertificate: false,
      connectionTimeout: 45,
      color: '#1e88e5',
    });
  });

  it('collapses cleared optional fields to undefined so the main-process merge unsets them', () => {
    const cleared = buildProfileDraft(
      {
        ...formValuesFromProfile(DOCKER_ENTRA_PROFILE),
        color: '',
        database: '',
        mysqlCollation: '',
      },
      DOCKER_ENTRA_PROFILE
    );

    expect(cleared.color).toBeUndefined();
    expect(cleared.database).toBeUndefined();
    expect(cleared.mysqlCollation).toBeUndefined();
  });

  it('drops the SSH tunnel when the checkbox is cleared', () => {
    const tunnelled: ConnectionProfile = {
      ...DOCKER_ENTRA_PROFILE,
      sshTunnel: {
        enabled: true,
        host: 'bastion',
        port: 22,
        username: 'ec2-user',
        authType: 'password',
      },
    };
    const draft = buildProfileDraft(
      { ...formValuesFromProfile(tunnelled), sshEnabled: false },
      tunnelled
    );

    // Present-but-undefined, not absent: the merge in `connection-profiles.ts` only unsets a member
    // the incoming object actually names.
    expect('sshTunnel' in draft).toBe(true);
    expect(draft.sshTunnel).toBeUndefined();
  });

  it('substitutes the default timeout when the field was emptied', () => {
    expect(buildProfileDraft(values({ connectionTimeout: Number.NaN })).connectionTimeout).toBe(30);
  });
});

describe('buildTestProfile', () => {
  it('uses the real id when editing, so the handler can resolve the stored password', () => {
    expect(
      buildTestProfile(formValuesFromProfile(DOCKER_ENTRA_PROFILE), DOCKER_ENTRA_PROFILE).id
    ).toBe('profile-1');
  });

  it('uses the sentinel id and a stand-in name for an unsaved profile', () => {
    const profile = buildTestProfile(values({ server: 'localhost', username: 'sa' }));
    expect(profile.id).toBe('test-connection');
    expect(profile.name).toBe('Test Connection');
  });

  it('keeps a typed name', () => {
    expect(buildTestProfile(values({ name: 'Staging' })).name).toBe('Staging');
  });
});

describe('formValuesFromProfile', () => {
  it('never carries a secret out of a saved profile', () => {
    const opened = formValuesFromProfile(DOCKER_ENTRA_PROFILE);
    expect(opened.password).toBe('');
    expect(opened.sshPassword).toBe('');
    expect(opened.sshPassphrase).toBe('');
  });

  it('defaults the AWS profile name for an aws-iam profile that has none', () => {
    const iam: ConnectionProfile = {
      ...DOCKER_ENTRA_PROFILE,
      engine: 'postgresql',
      authenticationType: 'aws-iam',
      awsProfile: undefined,
    };
    expect(formValuesFromProfile(iam).awsProfile).toBe('default');
  });

  it('leaves the AWS profile blank for every other mode', () => {
    expect(formValuesFromProfile(DOCKER_ENTRA_PROFILE).awsProfile).toBe('');
  });

  it('unpacks an SSH tunnel', () => {
    const tunnelled: ConnectionProfile = {
      ...DOCKER_ENTRA_PROFILE,
      sshTunnel: {
        enabled: true,
        host: 'bastion',
        port: 2222,
        username: 'ec2-user',
        authType: 'privateKey',
        privateKeyPath: '~/.ssh/id_ed25519',
      },
    };
    expect(formValuesFromProfile(tunnelled)).toMatchObject({
      sshEnabled: true,
      sshHost: 'bastion',
      sshPort: 2222,
      sshUsername: 'ec2-user',
      sshAuthType: 'privateKey',
      sshPrivateKeyPath: '~/.ssh/id_ed25519',
    });
  });
});

describe('awsProfileOptions', () => {
  it('returns the discovered list when it already contains the current value', () => {
    expect(awsProfileOptions(['default', 'prod'], 'prod')).toEqual(['default', 'prod']);
  });

  it('prepends a current value the list does not have, so the picker is never blank', () => {
    expect(awsProfileOptions(['dev'], 'default')).toEqual(['default', 'dev']);
  });

  it('adds nothing for a blank current value', () => {
    expect(awsProfileOptions(['dev'], '')).toEqual(['dev']);
  });
});
