/**
 * The connection form's data model, and every derivation the editor makes from it.
 *
 * Pure: no React, no bridge, no store. That is the point — the Angular original
 * (`shared/components/connection-dialog/connection-dialog.component.ts`, 1,040 LOC) mixed the
 * auth-mode rules, the engine-switch heuristics, the DSQL sniffing, the profile builders and the
 * template into one class, so none of it could be tested without instantiating a Material dialog.
 * Everything here is a function of its arguments, and `form-model.spec.ts` drives the whole
 * engine × auth-mode matrix through it.
 *
 * ── The form model is flat and total ─────────────────────────────────────────────────────────
 *
 * `ConnectionFormValues` has no optional members. A field the user left blank is `''` (or `NaN`
 * for a number input), never `undefined`. Two reasons: `react-hook-form`'s `register` wants a
 * defined default for every field it owns, and the absent/blank distinction is exactly what the
 * Angular `Partial<ConnectionProfile>` form object kept getting wrong — `formData.server!` appears
 * three times in its builders because the type said "maybe missing" while the runtime guaranteed
 * `''`. The `''` → `undefined` collapse happens once, in `buildProfileDraft`.
 *
 * ── Where the constants come from ────────────────────────────────────────────────────────────
 *
 * Ports and engine labels are `DEFAULT_PORTS` / `ENGINE_LABELS` from `@joinery/shared`; the
 * Angular dialog re-typed both (`{ mssql: 1433, postgresql: 5432, mysql: 3306 }` at `:809`, and
 * three `<mat-option>` labels at `:82-84`). The per-engine *auth-mode* lists and the default
 * username/database hints have no shared home, so they are declared here — see their comments.
 */

import {
  DEFAULT_PORTS,
  ENGINE_LABELS,
  isDsqlEndpoint,
  type AuthenticationType,
  type ConnectionProfile,
  type DatabaseEngine,
  type SshAuthType,
  type SshTunnelConfig,
} from '@joinery/shared';

import type { ProfileDraft } from '../../state/connection';

/** Every field the editor owns. Total by construction — see the header. */
export interface ConnectionFormValues {
  readonly name: string;
  readonly engine: DatabaseEngine;
  readonly server: string;
  readonly port: number;
  readonly authenticationType: AuthenticationType;
  readonly username: string;
  /** Never persisted by this renderer: it travels to keytar through the bridge. See `secrets.ts`. */
  readonly password: string;
  readonly awsProfile: string;
  readonly encrypt: boolean;
  readonly trustServerCertificate: boolean;
  readonly connectionTimeout: number;
  readonly database: string;
  /** A preset hex, or `''` for "no colour". */
  readonly color: string;
  /** A collation name, or `''` for "server default". */
  readonly mysqlCollation: string;
  readonly sshEnabled: boolean;
  readonly sshHost: string;
  readonly sshPort: number;
  readonly sshUsername: string;
  readonly sshAuthType: SshAuthType;
  readonly sshPassword: string;
  readonly sshPrivateKeyPath: string;
  readonly sshPassphrase: string;
}

/** The engines, in the order `ENGINE_LABELS` declares them. One cast, so nothing else needs one. */
export const ENGINES = Object.keys(ENGINE_LABELS) as readonly DatabaseEngine[];

/**
 * Which auth modes each engine offers, and what to call them.
 *
 * Joinery UI policy, not a shared constant: `AuthenticationType` is the union of all four modes
 * across all engines, and nothing in `packages/shared` records which engine supports which.
 * (`packages/main`'s providers enforce it at connect time, but the renderer may not import from
 * there.) The labels differ per engine on purpose — `'sql'` is "SQL Server Authentication" on
 * mssql and "Password Authentication" everywhere else, exactly as the Angular dropdown had it.
 */
export const AUTH_MODES: Record<
  DatabaseEngine,
  readonly { value: AuthenticationType; label: string }[]
> = {
  mssql: [
    { value: 'sql', label: 'SQL Server Authentication' },
    { value: 'windows', label: 'Windows Authentication' },
    { value: 'entra-id', label: 'Microsoft Entra ID' },
  ],
  postgresql: [
    { value: 'sql', label: 'Password Authentication' },
    { value: 'aws-iam', label: 'AWS IAM (Aurora DSQL)' },
  ],
  mysql: [{ value: 'sql', label: 'Password Authentication' }],
};

/**
 * The database each engine connects to when the field is left blank. Placeholder text only — it is
 * never submitted, because a blank Default Database means "let the driver decide".
 */
export const DEFAULT_DATABASE_HINTS: Record<DatabaseEngine, string> = {
  mssql: 'master',
  postgresql: 'postgres',
  mysql: 'mysql',
};

/** The conventional superuser per engine, used only by the engine-switch heuristic below. */
const CONVENTIONAL_USERNAMES: Record<DatabaseEngine, string> = {
  mssql: 'sa',
  postgresql: 'postgres',
  mysql: 'root',
};

/** MySQL collations offered in the picker. `''` is "server default". */
export const MYSQL_COLLATIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Server default' },
  { value: 'utf8mb4_0900_ai_ci', label: 'utf8mb4_0900_ai_ci (MySQL 8.0+)' },
  { value: 'utf8mb4_unicode_ci', label: 'utf8mb4_unicode_ci' },
  { value: 'utf8mb4_general_ci', label: 'utf8mb4_general_ci' },
  { value: 'utf8mb4_bin', label: 'utf8mb4_bin' },
  { value: 'utf8_general_ci', label: 'utf8_general_ci (legacy)' },
];

/** The colour tags, carried over unchanged from `connection-dialog.component.ts:575-584`. */
export const PRESET_COLORS: readonly { value: string; label: string }[] = [
  { value: '#e53935', label: 'Red' },
  { value: '#fb8c00', label: 'Orange' },
  { value: '#fdd835', label: 'Yellow' },
  { value: '#43a047', label: 'Green' },
  { value: '#00897b', label: 'Teal' },
  { value: '#1e88e5', label: 'Blue' },
  { value: '#8e24aa', label: 'Purple' },
  { value: '#d81b60', label: 'Pink' },
];

/** The default SSH port, and the fallback when the field is emptied. */
export const DEFAULT_SSH_PORT = 22;

/** The fallback connection timeout, in seconds. */
export const DEFAULT_CONNECTION_TIMEOUT = 30;

/** A brand-new profile: mssql on 1433 with SQL auth, TLS on, no SSH. */
export const NEW_CONNECTION_VALUES: ConnectionFormValues = {
  name: '',
  engine: 'mssql',
  server: '',
  port: DEFAULT_PORTS.mssql,
  authenticationType: 'sql',
  username: '',
  password: '',
  awsProfile: '',
  encrypt: true,
  trustServerCertificate: true,
  connectionTimeout: DEFAULT_CONNECTION_TIMEOUT,
  database: '',
  color: '',
  mysqlCollation: '',
  sshEnabled: false,
  sshHost: '',
  sshPort: DEFAULT_SSH_PORT,
  sshUsername: '',
  sshAuthType: 'password',
  sshPassword: '',
  sshPrivateKeyPath: '',
  sshPassphrase: '',
};

// ── Auth-mode predicates ─────────────────────────────────────────────────────────────────────

/**
 * True when the form must collect a username from the user.
 *
 * Non-mssql engines always need one. On mssql only `sql` auth uses form credentials: `windows`
 * uses the OS principal and `entra-id` uses MSAL through the system browser. The *password* half
 * is narrowed further by `isAwsIamAuth` — Aurora DSQL mints IAM tokens, so no password is ever
 * collected for it.
 */
export function needsUsername(
  values: Pick<ConnectionFormValues, 'engine' | 'authenticationType'>
): boolean {
  if (values.engine !== 'mssql') return true;
  return values.authenticationType === 'sql';
}

/** True when the form should collect a password. */
export function needsPassword(
  values: Pick<ConnectionFormValues, 'engine' | 'authenticationType'>
): boolean {
  return needsUsername(values) && !isAwsIamAuth(values);
}

/** Aurora DSQL auth: the pool mints IAM tokens, so no password is ever collected or stored. */
export function isAwsIamAuth(values: Pick<ConnectionFormValues, 'authenticationType'>): boolean {
  return values.authenticationType === 'aws-iam';
}

export function isEntraAuth(values: Pick<ConnectionFormValues, 'authenticationType'>): boolean {
  return values.authenticationType === 'entra-id';
}

/** Whether an auth mode is offered for an engine. Derived from `AUTH_MODES`, never re-listed. */
export function isAuthModeValidForEngine(
  engine: DatabaseEngine,
  authenticationType: AuthenticationType
): boolean {
  return AUTH_MODES[engine].some(mode => mode.value === authenticationType);
}

// ── Server normalization and DSQL detection ──────────────────────────────────────────────────

/**
 * Splits a pasted `host:port` into its parts.
 *
 * `isDsqlEndpoint`'s regex only matches bare hostnames, so a pasted
 * `<id>.dsql.<region>.on.aws:5432` must have its port stripped before it can be recognised.
 *
 * IPv6 guard: only splits when the part before the final colon contains no other colon, so a bare
 * (`2001:db8::1`) or bracketed (`[::1]`) literal is left alone rather than truncated.
 */
export function splitHostPort(value: string): { host: string; port?: number } {
  const trimmed = value.trim();
  const separatorIndex = trimmed.lastIndexOf(':');
  if (separatorIndex <= 0) return { host: trimmed };

  const hostPart = trimmed.slice(0, separatorIndex);
  if (hostPart.includes(':')) return { host: trimmed };

  const port = Number(trimmed.slice(separatorIndex + 1));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return { host: trimmed };

  return { host: hostPart, port };
}

/**
 * Normalize the Server field and, when it is an Aurora DSQL endpoint on an otherwise untouched
 * PostgreSQL/password profile, switch the form to AWS IAM.
 *
 * Normalization (trim, split a `:port` suffix) always runs, for every engine — a trimmed bare host
 * is correct regardless. Only the auto-select is gated to postgresql + `sql` auth + no typed
 * password, so it never clobbers a deliberate choice and never fires for mssql/mysql.
 *
 * **Deviation from Angular, deliberate.** `onServerChange` ran this on every keystroke
 * (`connection-dialog.component.ts:874-877`), which means typing `localhost:5` immediately became
 * host `localhost` port `5`, and a trailing space could not be typed at all. The editor calls this
 * on **blur** and on engine change instead, which produces the same outcome for the case it exists
 * for (paste, then move on) without fighting the keyboard.
 */
export function normalizeServer(values: ConnectionFormValues): ConnectionFormValues {
  const { host, port } = splitHostPort(values.server);
  const normalized: ConnectionFormValues = {
    ...values,
    server: host,
    port: port ?? values.port,
  };

  // Aurora DSQL is a PostgreSQL-compatible service only, so gating on engine keeps this a no-op
  // for mssql/mysql even if a non-DSQL host somehow matched the endpoint pattern.
  if (
    normalized.engine !== 'postgresql' ||
    normalized.authenticationType !== 'sql' ||
    normalized.password !== '' ||
    !isDsqlEndpoint(host)
  ) {
    return normalized;
  }

  return {
    ...normalized,
    authenticationType: 'aws-iam',
    database: 'postgres',
    encrypt: true,
    awsProfile: normalized.awsProfile === '' ? 'default' : normalized.awsProfile,
  };
}

/**
 * Everything that follows from picking a different engine: the default port, the conventional
 * username, an auth mode the new engine actually offers, and a re-run of DSQL detection.
 *
 * The username heuristic is Angular's (`:811-833`): replace a blank username, or one that is
 * another engine's convention, and leave anything the user actually chose alone. Expressed over
 * `CONVENTIONAL_USERNAMES` rather than as three hand-written `if` chains, which is what let the
 * original grow to twenty lines.
 *
 * Re-running detection here is what makes paste-then-switch-engine and switch-then-paste behave
 * identically: a DSQL host pasted while mssql was selected was never sniffed.
 */
export function applyEngineChange(
  values: ConnectionFormValues,
  engine: DatabaseEngine
): ConnectionFormValues {
  const conventional = Object.values(CONVENTIONAL_USERNAMES);
  const username =
    values.username === '' || conventional.includes(values.username)
      ? CONVENTIONAL_USERNAMES[engine]
      : values.username;

  const next: ConnectionFormValues = {
    ...values,
    engine,
    port: DEFAULT_PORTS[engine],
    username,
    authenticationType: isAuthModeValidForEngine(engine, values.authenticationType)
      ? values.authenticationType
      : 'sql',
  };

  return engine === 'postgresql' ? normalizeServer(next) : next;
}

/**
 * The AWS profile picker's options: the names discovered on disk, plus the current value when the
 * list does not contain it.
 *
 * Without the union a saved profile naming an AWS credentials profile that no longer exists (or a
 * `default` that `~/.aws/config` never declared) would render as an empty picker while the form
 * still held the value — a Radix `Select` shows its placeholder for a value with no matching item.
 * Angular had exactly that hole.
 */
export function awsProfileOptions(
  discovered: readonly string[],
  current: string
): readonly string[] {
  if (current === '' || discovered.includes(current)) return discovered;
  return [current, ...discovered];
}

/** Selecting `aws-iam` defaults the AWS profile field, which is the only follow-up any mode has. */
export function applyAuthModeChange(
  values: ConnectionFormValues,
  authenticationType: AuthenticationType
): ConnectionFormValues {
  const next: ConnectionFormValues = { ...values, authenticationType };
  if (!isAwsIamAuth(next)) return next;
  return { ...next, awsProfile: next.awsProfile === '' ? 'default' : next.awsProfile };
}

// ── Building what the bridge takes ───────────────────────────────────────────────────────────

/** `aws-iam` defaults a blank username (the DB role) to `admin` at save and test time. */
export function resolvedUsername(values: ConnectionFormValues): string | undefined {
  if (isAwsIamAuth(values) && values.username === '') return 'admin';
  return values.username === '' ? undefined : values.username;
}

export function buildSshTunnelConfig(values: ConnectionFormValues): SshTunnelConfig | undefined {
  if (!values.sshEnabled) return undefined;
  return {
    enabled: true,
    host: values.sshHost,
    port: Number.isInteger(values.sshPort) ? values.sshPort : DEFAULT_SSH_PORT,
    username: values.sshUsername,
    authType: values.sshAuthType,
    ...(values.sshAuthType === 'privateKey' && values.sshPrivateKeyPath !== ''
      ? { privateKeyPath: values.sshPrivateKeyPath }
      : {}),
  };
}

/** The fields the form owns, shared by both builders so they cannot disagree. */
function editedFields(values: ConnectionFormValues) {
  return {
    name: values.name,
    engine: values.engine,
    server: values.server,
    port: values.port,
    authenticationType: values.authenticationType,
    username: resolvedUsername(values),
    database: values.database === '' ? undefined : values.database,
    encrypt: values.encrypt,
    trustServerCertificate: values.trustServerCertificate,
    connectionTimeout: Number.isInteger(values.connectionTimeout)
      ? values.connectionTimeout
      : DEFAULT_CONNECTION_TIMEOUT,
    color: values.color === '' ? undefined : values.color,
    mysqlCollation: values.mysqlCollation === '' ? undefined : values.mysqlCollation,
    awsProfile: values.awsProfile === '' ? undefined : values.awsProfile,
    sshTunnel: buildSshTunnelConfig(values),
  } as const;
}

/**
 * The complete profile to save.
 *
 * `ProfileDraft` is `Omit<ConnectionProfile, 'id'> & { id?: string }` — every non-optional member
 * of the profile is required, which is the Task 4 tightening the brief carries forward, and it is
 * why this returns a whole object rather than a patch.
 *
 * **`existing` is spread first, and that fixes a real data-loss bug.** The Angular builder
 * (`:1019-1038`) returned only the fields the dialog edits, and got away with it because
 * `connection-profiles.ts:113-118` happens to merge an update over the stored profile. So the
 * renderer was shipping an incomplete profile and relying on the main process to fill it back in —
 * `isDocker`, `dockerContainerId`, `volumeMappings`, `azureTenantId`, `azureClientId`,
 * `azureHomeAccountId` and `requestTimeout` all survived by accident. Spreading here makes the
 * draft true on its own, so the renderer's contract no longer depends on the merge.
 *
 * The blank-to-`undefined` collapses are load-bearing in the other direction: `color: undefined` is
 * how "No colour" clears a previously-set tag through that same merge.
 */
export function buildProfileDraft(
  values: ConnectionFormValues,
  existing?: ConnectionProfile
): ProfileDraft {
  return {
    ...existing,
    ...editedFields(values),
    ...(existing === undefined ? {} : { id: existing.id }),
  };
}

/**
 * The profile to hand to `connection.test`.
 *
 * The real id when editing is what lets the main-process handler resolve the keychain-stored
 * password for a blank password field (see `testSecrets`), so Test exercises exactly what Connect
 * will use. A create has no id yet, and `'test-connection'` is the sentinel the Angular dialog
 * used for it (`:1001`).
 */
export function buildTestProfile(
  values: ConnectionFormValues,
  existing?: ConnectionProfile
): ConnectionProfile {
  return {
    ...existing,
    ...editedFields(values),
    id: existing?.id ?? 'test-connection',
    name: values.name === '' ? 'Test Connection' : values.name,
  };
}

/** An existing profile as form values. The password fields are always blank — see `secrets.ts`. */
export function formValuesFromProfile(profile: ConnectionProfile): ConnectionFormValues {
  const ssh = profile.sshTunnel;
  return {
    name: profile.name,
    engine: profile.engine,
    server: profile.server,
    port: profile.port,
    authenticationType: profile.authenticationType,
    username: profile.username ?? '',
    password: '',
    // An `aws-iam` profile always has a profile name in play; `default` is what the CLI itself
    // falls back to, and Angular defaulted the field the same way when opening one (`:638-641`).
    awsProfile: profile.awsProfile ?? (profile.authenticationType === 'aws-iam' ? 'default' : ''),
    encrypt: profile.encrypt,
    trustServerCertificate: profile.trustServerCertificate,
    connectionTimeout: profile.connectionTimeout,
    database: profile.database ?? '',
    color: profile.color ?? '',
    mysqlCollation: profile.mysqlCollation ?? '',
    sshEnabled: ssh?.enabled ?? false,
    sshHost: ssh?.host ?? '',
    sshPort: ssh?.port ?? DEFAULT_SSH_PORT,
    sshUsername: ssh?.username ?? '',
    sshAuthType: ssh?.authType ?? 'password',
    sshPassword: '',
    sshPrivateKeyPath: ssh?.privateKeyPath ?? '',
    sshPassphrase: '',
  };
}
