/**
 * The editor, mounted for real against the singleton connection store and a partial bridge.
 *
 * What is worth asserting here rather than in `form-model.spec.ts` / `form-schema.spec.ts` — those
 * cover the rules; this covers the wiring, and each of these was a live defect or a live risk:
 *
 *  - **What actually reaches the bridge.** The whole `connection.save` argument list is captured and
 *    asserted, including the three positional passwords, because a transposition there is the
 *    PLAN.md §7.1 wart and nothing else in the suite would see it.
 *  - **A blank password on an edit sends `undefined`, not `''`.** That is what makes the main
 *    process fall back to the keychain instead of overwriting it with an empty credential.
 *  - **`aws-iam` sends no password at all**, and offers no password field to type one into.
 *  - **The Test panel clears on any edit** — including a colour swatch and a checkbox, which the
 *    Angular dialog's three separate clearing mechanisms all missed.
 *  - **Test uses the smaller gate.** A nameless form can be tested and cannot be saved.
 *  - **The engine switch is applied to the live form**, not just computed by a pure function.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConnectionProfile, TestConnectionResult } from '@joinery/shared';

import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import { IpcQueryProvider } from '../../ipc';
import { TooltipProvider } from '../../ui';
import { connectionStore } from '../../state/connection';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { explorerStore } from '../../state/explorer';
import { ConnectionEditor } from './connection-editor';

/**
 * One captured `connection.save` / `connection.test` call: the profile, then the three optional
 * password strings the bridge takes positionally (PLAN.md §7.1). Captured as a whole tuple on purpose
 * — asserting the profile alone would let a transposition of the three secrets through, which is the
 * exact failure mode the wart makes possible and nothing else in the suite would notice.
 */
type BridgeCall = readonly [
  Record<string, unknown>,
  string | undefined,
  string | undefined,
  string | undefined,
];
type SaveCall = BridgeCall;
type TestCall = BridgeCall;

const teardowns: (() => void)[] = [];
let saveCalls: SaveCall[] = [];
let testCalls: TestCall[] = [];
let testResult: TestConnectionResult = { success: true, serverVersion: 'PostgreSQL 16' };
let awsProfiles: string[] | Error = [];
/** Every toast the store raised, `"<level>: <message>"`. */
let notifications: string[] = [];

const SAVED_PROFILE: ConnectionProfile = {
  id: 'saved-1',
  name: 'Reporting',
  engine: 'postgresql',
  server: 'db.example.com',
  port: 5432,
  authenticationType: 'sql',
  username: 'reader',
  database: 'analytics',
  encrypt: false,
  trustServerCertificate: true,
  connectionTimeout: 15,
};

beforeEach(() => {
  saveCalls = [];
  testCalls = [];
  testResult = { success: true, serverVersion: 'PostgreSQL 16' };
  awsProfiles = [];

  teardowns.push(
    installJoineryMock({
      connection: {
        save: (
          incoming: ConnectionProfile,
          password?: string,
          sshPassword?: string,
          sshPassphrase?: string
        ) => {
          saveCalls.push([
            incoming as unknown as Record<string, unknown>,
            password,
            sshPassword,
            sshPassphrase,
          ]);
          return Promise.resolve(SAVED_PROFILE);
        },
        test: (
          incoming: ConnectionProfile,
          password?: string,
          sshPassword?: string,
          sshPassphrase?: string
        ) => {
          testCalls.push([
            incoming as unknown as Record<string, unknown>,
            password,
            sshPassword,
            sshPassphrase,
          ]);
          return Promise.resolve(testResult);
        },
        list: () => Promise.resolve([SAVED_PROFILE]),
        listAwsProfiles: () =>
          awsProfiles instanceof Error ? Promise.reject(awsProfiles) : Promise.resolve(awsProfiles),
        // The Connect path: save → store.connect → explorer.addServerNode/expandNode.
        connect: () =>
          Promise.resolve({ id: SAVED_PROFILE.id, profile: SAVED_PROFILE, status: 'connected' }),
        disconnect: () => Promise.resolve(),
        ping: () => Promise.resolve(true),
      },
      database: { list: () => Promise.resolve([]) },
      // `connectionStore.connect` persists the open-connection list on success.
      app: { setState: () => Promise.resolve() },
    })
  );
  // The store toasts on its own; recording rather than silencing so a test can assert what the user
  // was told, and so the default console sink does not print it as failure noise.
  notifications = [];
  teardowns.push(
    setNotifier({
      success: message => notifications.push(`success: ${message}`),
      error: message => notifications.push(`error: ${message}`),
      info: message => notifications.push(`info: ${message}`),
      warning: message => notifications.push(`warning: ${message}`),
    })
  );
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  // `destroy()` first: a successful connect starts a 30s heartbeat interval, and an interval that
  // outlives its test keeps firing against a torn-down bridge.
  connectionStore.getState().destroy();
  connectionStore.setState({
    profiles: [],
    connectedProfileIds: new Set(),
    databasesByConnection: new Map(),
    healthByConnection: new Map(),
  });
  explorerStore.getState().clear();
  vi.clearAllMocks();
});

function mount(props: Partial<Parameters<typeof ConnectionEditor>[0]> = {}) {
  const onDismiss = vi.fn();
  const onSaved = vi.fn();
  const { unmount } = render(
    <IpcQueryProvider>
      <TooltipProvider>
        <ConnectionEditor onDismiss={onDismiss} onSaved={onSaved} {...props} />
      </TooltipProvider>
    </IpcQueryProvider>
  );
  teardowns.push(unmount);
  return { onDismiss, onSaved };
}

/** The profile object the Nth `connection.save` call carried. */
function savedProfile(index = 0): Record<string, unknown> {
  const call = saveCalls[index];
  if (call === undefined) throw new Error(`connection.save was not called ${index + 1} time(s)`);
  return call[0];
}

/** Fills a create form with the minimum a save needs. */
async function fillMinimum(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Connection name'), 'Local SQL');
  await user.type(screen.getByLabelText('Server'), 'localhost');
  await user.type(screen.getByLabelText('Username'), 'sa');
}

describe('the form the user sees', () => {
  it('opens on a blank mssql form with TLS on', () => {
    mount();

    expect(screen.getByTestId('connection-editor')).toBeTruthy();
    expect(screen.getByLabelText('Port')).toHaveProperty('value', '1433');
    expect(screen.getByLabelText('Encrypt the connection')).toHaveProperty('checked', true);
    expect(screen.getByLabelText('Trust the server certificate')).toHaveProperty('checked', true);
  });

  it('opens an existing profile with its values and NO password', () => {
    mount({ profile: SAVED_PROFILE });

    expect(screen.getByLabelText('Connection name')).toHaveProperty('value', 'Reporting');
    expect(screen.getByLabelText('Server')).toHaveProperty('value', 'db.example.com');
    expect(screen.getByLabelText('Username')).toHaveProperty('value', 'reader');
    // The keychain is the only place the password lives, so an edit cannot show it.
    expect(screen.getByLabelText('Password')).toHaveProperty('value', '');
  });

  it('renders every password field as a password input', () => {
    // A `type="text"` secret would leak on a screen-share and into a screenshot, which is exactly
    // what the both-theme gate produces.
    mount();
    expect(screen.getByLabelText('Password')).toHaveProperty('type', 'password');
  });

  it('hides the auth-type picker for an engine with only one mode', async () => {
    const user = userEvent.setup();
    mount();

    expect(screen.getByTestId('connection-auth-type')).toBeTruthy();
    await selectOption(user, 'connection-engine', 'MySQL');
    expect(screen.queryByTestId('connection-auth-type')).toBeNull();
  });
});

describe('switching engine', () => {
  it('applies the whole transform to the live form', async () => {
    const user = userEvent.setup();
    mount();

    await selectOption(user, 'connection-engine', 'PostgreSQL');

    expect(screen.getByLabelText('Port')).toHaveProperty('value', '5432');
    expect(screen.getByLabelText('Username')).toHaveProperty('value', 'postgres');
    // MySQL's collation picker must not be showing, and PostgreSQL's IAM mode must be offered.
    expect(screen.queryByTestId('connection-collation')).toBeNull();
    expect(screen.getByTestId('connection-auth-type')).toBeTruthy();
  });

  it('reveals the collation picker for MySQL only', async () => {
    const user = userEvent.setup();
    mount();

    await selectOption(user, 'connection-engine', 'MySQL');
    expect(screen.getByTestId('connection-collation')).toBeTruthy();
    expect(screen.getByLabelText('Port')).toHaveProperty('value', '3306');
  });
});

describe('the aws-iam branch', () => {
  it('collects no password and sends none', async () => {
    const user = userEvent.setup();
    mount();

    await selectOption(user, 'connection-engine', 'PostgreSQL');
    await selectOption(user, 'connection-auth-type', 'AWS IAM (Aurora DSQL)');

    // No password field at all — the pool mints IAM tokens.
    expect(screen.queryByLabelText('Password')).toBeNull();
    // And TLS is stated rather than offered as a checkbox.
    expect(screen.getByTestId('connection-dsql-tls-note')).toBeTruthy();
    expect(screen.queryByLabelText('Encrypt the connection')).toBeNull();
    // SSH is stated as unavailable rather than offered.
    expect(screen.getByTestId('connection-dsql-ssh-note')).toBeTruthy();
    expect(screen.queryByLabelText('Connect through an SSH tunnel')).toBeNull();

    await user.type(screen.getByLabelText('Connection name'), 'DSQL');
    await user.type(screen.getByLabelText('Server'), 'db.example.com');
    await user.click(screen.getByTestId('connection-save'));

    await waitFor(() => expect(saveCalls).toHaveLength(1));
    // Positions 1–3 are password / sshPassword / sshPassphrase.
    expect(saveCalls[0]?.slice(1)).toEqual([undefined, undefined, undefined]);
    // `postgres`, not `admin`: switching to PostgreSQL filled the username with that engine's
    // convention, and the `admin` DB-role default only applies to a username the user left blank
    // (pinned in `form-model.spec.ts`). What matters here is that a real username still travels while
    // no password does.
    expect(savedProfile()).toMatchObject({ authenticationType: 'aws-iam', username: 'postgres' });
  });

  it('defaults a cleared username to the admin DB role', async () => {
    const user = userEvent.setup();
    mount();

    await selectOption(user, 'connection-engine', 'PostgreSQL');
    await selectOption(user, 'connection-auth-type', 'AWS IAM (Aurora DSQL)');
    await user.clear(screen.getByLabelText('Username'));
    await user.type(screen.getByLabelText('Connection name'), 'DSQL');
    await user.type(screen.getByLabelText('Server'), 'db.example.com');
    await user.click(screen.getByTestId('connection-save'));

    await waitFor(() => expect(saveCalls).toHaveLength(1));
    expect(savedProfile()).toMatchObject({ username: 'admin' });
  });

  it('offers the discovered AWS profiles as a picker', async () => {
    awsProfiles = ['default', 'prod'];
    const user = userEvent.setup();
    mount();

    await selectOption(user, 'connection-engine', 'PostgreSQL');
    await selectOption(user, 'connection-auth-type', 'AWS IAM (Aurora DSQL)');

    // The free-text fallback is an `<input>`; the picker is the Radix trigger.
    await waitFor(() =>
      expect(screen.getByTestId('connection-aws-profile').tagName).toBe('BUTTON')
    );
  });

  it('falls back to free-text entry when the profiles cannot be listed', async () => {
    awsProfiles = new Error('no ~/.aws');
    const user = userEvent.setup();
    mount();

    await selectOption(user, 'connection-engine', 'PostgreSQL');
    await selectOption(user, 'connection-auth-type', 'AWS IAM (Aurora DSQL)');

    // Degrades rather than blocking the flow, and the value the auth switch defaulted survives.
    expect(screen.getByTestId('connection-aws-profile').tagName).toBe('INPUT');
    expect(screen.getByLabelText('AWS profile')).toHaveProperty('value', 'default');
  });
});

describe('the SSH branch', () => {
  it('reveals the tunnel fields and sends the config', async () => {
    const user = userEvent.setup();
    mount();

    expect(screen.queryByLabelText('SSH host')).toBeNull();
    await user.click(screen.getByLabelText('Connect through an SSH tunnel'));

    await fillMinimum(user);
    await user.type(screen.getByLabelText('SSH host'), 'bastion.example.com');
    await user.type(screen.getByLabelText('SSH username'), 'ec2-user');
    await user.type(screen.getByLabelText('SSH password'), 'bastion-secret');

    await user.click(screen.getByTestId('connection-save'));
    await waitFor(() => expect(saveCalls).toHaveLength(1));

    expect(savedProfile().sshTunnel).toEqual({
      enabled: true,
      host: 'bastion.example.com',
      port: 22,
      username: 'ec2-user',
      authType: 'password',
    });
    // password, sshPassword, sshPassphrase — in that order, and the SSH secret must be in slot 2.
    expect(saveCalls[0]?.slice(1)).toEqual([undefined, 'bastion-secret', undefined]);
  });

  it('swaps the password field for a key path and a passphrase', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByLabelText('Connect through an SSH tunnel'));
    await selectOption(user, 'connection-ssh-auth-type', 'Private key');

    expect(screen.queryByLabelText('SSH password')).toBeNull();
    expect(screen.getByLabelText('Private key path')).toBeTruthy();
    expect(screen.getByLabelText('Passphrase (optional)')).toHaveProperty('type', 'password');

    await fillMinimum(user);
    await user.type(screen.getByLabelText('SSH host'), 'bastion.example.com');
    await user.type(screen.getByLabelText('SSH username'), 'ec2-user');
    await user.type(screen.getByLabelText('Private key path'), '~/.ssh/id_ed25519');
    await user.type(screen.getByLabelText('Passphrase (optional)'), 'key-phrase');

    await user.click(screen.getByTestId('connection-save'));
    await waitFor(() => expect(saveCalls).toHaveLength(1));

    expect(savedProfile().sshTunnel).toMatchObject({
      authType: 'privateKey',
      privateKeyPath: '~/.ssh/id_ed25519',
    });
    // The passphrase is the THIRD optional string, not the second.
    expect(saveCalls[0]?.slice(1)).toEqual([undefined, undefined, 'key-phrase']);
  });

  it('blocks a save on an incomplete tunnel and says why', async () => {
    const user = userEvent.setup();
    const { onSaved } = mount();

    await fillMinimum(user);
    await user.click(screen.getByLabelText('Connect through an SSH tunnel'));
    await user.click(screen.getByTestId('connection-save'));

    await waitFor(() =>
      expect(screen.getByTestId('connection-validation-hint').textContent).toContain(
        'Server is required'
      )
    );
    expect(saveCalls).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('secrets', () => {
  it('sends a typed password in the first positional slot', async () => {
    const user = userEvent.setup();
    mount();

    await fillMinimum(user);
    await user.type(screen.getByLabelText('Password'), 'hunter2');
    await user.click(screen.getByTestId('connection-save'));

    await waitFor(() => expect(saveCalls).toHaveLength(1));
    expect(saveCalls[0]?.slice(1)).toEqual(['hunter2', undefined, undefined]);
    // And it is nowhere in the profile object — the keychain is the only store.
    expect(JSON.stringify(savedProfile())).not.toContain('hunter2');
  });

  it('sends undefined when an edit leaves the password blank', async () => {
    const user = userEvent.setup();
    mount({ profile: SAVED_PROFILE });

    await user.click(screen.getByTestId('connection-save'));
    await waitFor(() => expect(saveCalls).toHaveLength(1));

    // `undefined`, not `''`: `connection-profiles.ts` only overwrites the stored credential for a
    // truthy password, so this is what "keep what is in the keychain" looks like on the wire.
    expect(saveCalls[0]?.slice(1)).toEqual([undefined, undefined, undefined]);
  });

  it('does not re-send an SSH secret once the tunnel is switched off', async () => {
    const user = userEvent.setup();
    mount();

    await fillMinimum(user);
    await user.click(screen.getByLabelText('Connect through an SSH tunnel'));
    await user.type(screen.getByLabelText('SSH password'), 'bastion-secret');
    await user.click(screen.getByLabelText('Connect through an SSH tunnel'));

    await user.click(screen.getByTestId('connection-save'));
    await waitFor(() => expect(saveCalls).toHaveLength(1));

    expect(saveCalls[0]?.slice(1)).toEqual([undefined, undefined, undefined]);
    expect(savedProfile().sshTunnel).toBeUndefined();
  });
});

describe('the password hygiene banner', () => {
  it('appears for a paste artifact and not for a clean password', async () => {
    const user = userEvent.setup();
    mount();

    await user.type(screen.getByLabelText('Password'), 'clean-P@ssw0rd!');
    expect(screen.queryByTestId('password-hygiene-warning')).toBeNull();

    await user.type(screen.getByLabelText('Password'), ' ');
    const banner = screen.getByTestId('password-hygiene-warning');
    expect(banner.textContent).toContain('copy/paste artifacts');
    expect(banner.textContent).toContain('ends with a space');
    // Never the password itself.
    expect(banner.textContent).not.toContain('clean-P@ssw0rd!');
  });

  it('does not brand a typed international password an artifact', async () => {
    const user = userEvent.setup();
    mount();

    await user.type(screen.getByLabelText('Password'), 'passwörd');
    expect(screen.queryByTestId('password-hygiene-warning')).toBeNull();
  });

  it('watches the SSH password too, in its own banner', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByLabelText('Connect through an SSH tunnel'));
    await user.type(screen.getByLabelText('SSH password'), 'trailing ');

    expect(screen.getByTestId('ssh-password-hygiene-warning')).toBeTruthy();
    expect(screen.queryByTestId('password-hygiene-warning')).toBeNull();
  });
});

describe('Test', () => {
  it('works on a form with no name, which Save refuses', async () => {
    const user = userEvent.setup();
    mount();

    await user.type(screen.getByLabelText('Server'), 'localhost');
    await user.type(screen.getByLabelText('Username'), 'sa');

    await user.click(screen.getByTestId('connection-test'));
    await waitFor(() => expect(testCalls).toHaveLength(1));
    // The sentinel id, so the handler does not go looking in the keychain for a profile that has none.
    expect(testCalls[0]?.[0]).toMatchObject({ id: 'test-connection', name: 'Test Connection' });

    await user.click(screen.getByTestId('connection-save'));
    await waitFor(() =>
      expect(screen.getByTestId('connection-validation-hint').textContent).toContain(
        'Connection name is required'
      )
    );
    expect(saveCalls).toHaveLength(0);
  });

  it('refuses to fire on input it already knows is invalid', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByTestId('connection-test'));
    expect(testCalls).toHaveLength(0);
    expect(screen.getByTestId('connection-validation-hint').textContent).toContain(
      'Server is required'
    );
  });

  it('renders a failure inline with all of the main process’s guidance', async () => {
    testResult = {
      success: false,
      error: 'Login failed for user "sa"',
      errorCode: 'AUTH_FAILED',
      guidance: ['Check that the password is correct', 'The password ends with a space'],
    };
    const user = userEvent.setup();
    mount();

    await user.type(screen.getByLabelText('Server'), 'localhost');
    await user.type(screen.getByLabelText('Username'), 'sa');
    await user.click(screen.getByTestId('connection-test'));

    const panel = await screen.findByTestId('connection-test-result');
    expect(panel.textContent).toContain('Login failed for user "sa"');
    expect(screen.getByTestId('connection-test-guidance').textContent).toContain(
      'Check that the password is correct'
    );
    expect(screen.getByTestId('connection-test-guidance').textContent).toContain(
      'ends with a space'
    );
  });

  it('renders nothing for a success — the store toasts it instead', async () => {
    const user = userEvent.setup();
    mount();

    await user.type(screen.getByLabelText('Server'), 'localhost');
    await user.type(screen.getByLabelText('Username'), 'sa');
    await user.click(screen.getByTestId('connection-test'));

    await waitFor(() => expect(testCalls).toHaveLength(1));
    expect(screen.queryByTestId('connection-test-result')).toBeNull();
  });

  it.each([
    [
      'a text field',
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.type(screen.getByLabelText('Connection name'), 'x');
      },
    ],
    [
      'a checkbox',
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(screen.getByLabelText('Encrypt the connection'));
      },
    ],
    [
      'a colour swatch',
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(screen.getByTestId('connection-color-teal'));
      },
    ],
    [
      'the engine picker',
      async (user: ReturnType<typeof userEvent.setup>) => {
        await selectOption(user, 'connection-engine', 'MySQL');
      },
    ],
  ])('clears a stale failure when the user edits %s', async (_label, edit) => {
    testResult = { success: false, error: 'Login failed' };
    const user = userEvent.setup();
    mount();

    await user.type(screen.getByLabelText('Server'), 'localhost');
    await user.type(screen.getByLabelText('Username'), 'sa');
    await user.click(screen.getByTestId('connection-test'));
    await screen.findByTestId('connection-test-result');

    await edit(user);

    // The Angular dialog needed three separate clearing mechanisms for this and the swatches were
    // covered by none of them.
    await waitFor(() => expect(screen.queryByTestId('connection-test-result')).toBeNull());
  });
});

describe('Save and Connect', () => {
  it('reports the saved profile and does not connect', async () => {
    const user = userEvent.setup();
    const { onSaved } = mount();

    await fillMinimum(user);
    await user.click(screen.getByTestId('connection-save'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED_PROFILE, false));
    expect(connectionStore.getState().connectedProfileIds.size).toBe(0);
  });

  it('connects and opens the server node when Connect succeeds', async () => {
    const user = userEvent.setup();
    const { onSaved } = mount();

    await fillMinimum(user);
    await user.click(screen.getByTestId('connection-connect'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED_PROFILE, true));
    expect(connectionStore.getState().connectedProfileIds.has('saved-1')).toBe(true);
    expect(explorerStore.getState().rootNodes.map(node => node.connectionId)).toContain('saved-1');
  });

  it('stays open when the save is rejected', async () => {
    teardowns.push(
      installJoineryMock({
        connection: {
          save: () => Promise.reject(new Error('A connection named "Local SQL" already exists.')),
          list: () => Promise.resolve([]),
        },
      })
    );
    const user = userEvent.setup();
    const { onSaved, onDismiss } = mount();

    await fillMinimum(user);
    await user.click(screen.getByTestId('connection-save'));

    // The store toasts the main-process message; the dialog must not close on it, or the user loses
    // everything they typed.
    await waitFor(() =>
      expect(notifications).toContain('error: A connection named "Local SQL" already exists.')
    );
    expect(screen.getByTestId('connection-editor')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses on Cancel without writing anything', async () => {
    const user = userEvent.setup();
    const { onDismiss } = mount();

    await user.click(screen.getByTestId('connection-cancel'));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(saveCalls).toHaveLength(0);
  });
});

/** Opens a Radix `Select` by testid and picks the option with the given visible text. */
async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  triggerTestId: string,
  optionLabel: string
): Promise<void> {
  await user.click(screen.getByTestId(triggerTestId));
  const option = await screen.findByRole('option', { name: optionLabel });
  await user.click(option);
  await waitFor(() => expect(screen.queryByRole('option', { name: optionLabel })).toBeNull());
}
