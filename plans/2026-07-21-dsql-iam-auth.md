# Aurora DSQL IAM Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace paste-a-token auth for Aurora DSQL with automatic IAM token minting from the user's AWS credentials — a new "AWS IAM" authentication type with a profile picker and endpoint auto-detection, no password field.

**Architecture:** Build on AWS's official `@aws/aurora-dsql-node-postgres-connector` (Apache-2.0), whose `AuroraDSQLPool` extends pg's `Pool` and mints a fresh SigV4 token per physical connection (region auto-parsed from the endpoint, `admin` user automatically gets the admin-token variant). `ConnectionPoolManager` constructs that pool for profiles with `authenticationType: 'aws-iam'`; everything downstream (queryAny, metadata, ping, the DSQL dialect from PR #42) is unchanged because the pool type is substitutable. The connection dialog gains the auth type, an AWS-profile dropdown (parsed from `~/.aws/config`/`~/.aws/credentials` via a new IPC), and DSQL-endpoint auto-detection.

**Tech Stack:** Electron main (TypeScript, `pg`, `@aws/aurora-dsql-node-postgres-connector` + peer deps `@aws-sdk/credential-providers`, `@aws-sdk/dsql-signer`), Angular 18 renderer, Vitest.

## Global Constraints

- Strict TypeScript; no `any` without justification. `npm run typecheck` clean; warnings are errors in touched files (direct ESLint per file — the renderer has no `ng lint` target, pre-existing).
- **Branch: `feature/dsql-iam-auth` created off `dsql`** (stacked on PR #42; rebases onto main after #42 merges). Never commit to main. Per-task commits, squash at PR merge (session convention).
- Conventional commits; every commit message ends with the two session trailer lines used on the `dsql` branch.
- Credentials discipline: Forge stores NOTHING for IAM auth — no tokens, no AWS keys, no Keychain entry. Tokens are minted in-memory per connection by the connector from the user's `~/.aws` configuration. Never log tokens or credentials.
- All renderer↔main communication through typed IPC channels in `packages/shared/src/constants/ipc-channels.ts`.
- Unit test command: `npx vitest run <path>`; suites that must stay green: `packages/main` (245+), `packages/renderer` (28+), `packages/shared`.
- Bound every loop; no swallowed errors (config-file parse failures return `[]` but log at debug; connect errors surface with guidance).

---

## Design context

### Why

DSQL auth today in Forge (and in DBeaver/DataGrip per AWS's own docs): generate a token (15-min default expiry) out-of-band, paste it as the password. Expired token → new connections fail; AWS's documented mitigation is 7-day tokens. AWS's own SQLTools VS Code driver instead does automatic IAM auth via the official node-postgres connector — endpoint + optional AWS profile, no password field. This plan brings Forge to parity with that.

### Facts established by research (verify anything load-bearing in Task 1's spike)

- Package `@aws/aurora-dsql-node-postgres-connector` exports `AuroraDSQLClient` and `AuroraDSQLPool` (extending pg `Client`/`Pool`). Options: `host`, `user`, `region` (auto-detected from hostname if omitted), `profile` (AWS profile, defaults to `default`), `customCredentialsProvider`, `tokenDurationSecs`, `database`, `port`. Peer deps: `pg`, `@aws-sdk/credential-providers`, `@aws-sdk/dsql-signer`.
- Users named `admin` automatically get admin auth tokens; other users get regular tokens. Tokens are generated per connection — pool growth after expiry just mints again, so there is no refresh dance.
- DSQL endpoints match `<id>.dsql.<region>.on.aws` (also `dsql-fips` in some regions). SSL is mandatory server-side; database is always `postgres`; port 5432.
- DSQL supports only a small set of session parameters (`application_name`, `timezone`, planner toggles, …). The connector handles connection setup; do not add `SET` statements.
- Existing plumbing from PR #42: `authenticationType: 'sql' | 'windows' | 'entra-id'` union (`connection.types.ts:6`); the dialog forces non-MSSQL engines to `'sql'` (`connection-dialog.component.ts:709-710`); `getPgPool` throws without a Keychain password; `detectDsql` probes `sys.dsql_major_version()`; `PgProvider` (provider/pg-provider.ts) is dead code — the live PG path is `ConnectionPoolManager.getPgPool`/`testPgConnection` only.

### Decisions (locked)

1. Use the official connector; do not hand-roll signing.
2. `aws-iam` is offered only for `engine === 'postgresql'`.
3. IAM profiles skip the Keychain entirely (no password saved or fetched); the SSH-tunnel wrapper still runs (harmless when disabled).
4. `detectDsql` short-circuits to `true` for `aws-iam` profiles (IAM auth ⇒ DSQL) — probe stays for token-as-password DSQL connections.
5. Encrypt is forced on for `aws-iam` in the pool config (DSQL rejects non-SSL).
6. Auto-detection assists but never overrides explicit user choices: it only flips fields when the host matches a DSQL endpoint AND auth is still `'sql'` AND no password has been typed.
7. Out of scope: `customCredentialsProvider` UI (env-var/instance creds flow through the connector's default chain anyway), token-duration setting (per-connection minting makes it irrelevant), MFA prompting.

### File map

| File                                                                                           | Action | Responsibility                                                                        |
| ---------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `packages/main/package.json` / root lockfile                                                   | Modify | Add connector + peer deps                                                             |
| `packages/shared/src/types/connection.types.ts`                                                | Modify | `'aws-iam'` in `AuthenticationType`; `ConnectionProfile.awsProfile?`                  |
| `packages/shared/src/utils/dsql-endpoint.ts`                                                   | Create | `isDsqlEndpoint`, `dsqlRegionFromEndpoint` (pure)                                     |
| `packages/shared/src/utils/dsql-endpoint.spec.ts`                                              | Create | Tests                                                                                 |
| `packages/shared/src/index.ts`                                                                 | Modify | Export the new utils                                                                  |
| `packages/shared/src/constants/ipc-channels.ts`                                                | Modify | `CONNECTION.LIST_AWS_PROFILES`                                                        |
| `packages/main/src/services/config/aws-profiles.ts`                                            | Create | Parse `~/.aws/{config,credentials}` profile names (pure parser + fs wrapper)          |
| `packages/main/src/services/config/aws-profiles.spec.ts`                                       | Create | Parser tests                                                                          |
| `packages/main/src/ipc/connection.ipc.ts`                                                      | Modify | LIST_AWS_PROFILES handler                                                             |
| `packages/main/src/services/sql/connection-pool.ts`                                            | Modify | IAM branches in `getPgPool`/`testPgConnection`; `detectDsql` shortcut; error guidance |
| `packages/preload/src/index.ts`                                                                | Modify | `connection.listAwsProfiles`                                                          |
| `packages/renderer/src/app/core/services/ipc.service.ts`                                       | Modify | Wrapper                                                                               |
| `packages/renderer/src/app/shared/components/connection-dialog/connection-dialog.component.ts` | Modify | Auth option, profile dropdown, auto-detection, save flow                              |

---

### Task 1: Dependencies + connector API spike

**Files:**

- Modify: `package.json` (workspace root — `pg` lives here; match its location), lockfile via `npm install`
- Create: `packages/main/src/services/sql/dsql-connector-smoke.spec.ts` (type-level smoke test)

**Interfaces:**

- Consumes: nothing.
- Produces: installed `@aws/aurora-dsql-node-postgres-connector`, `@aws-sdk/credential-providers`, `@aws-sdk/dsql-signer`; a verified statement in the task report of the connector's ACTUAL exported names and constructor options (README research says `AuroraDSQLPool` with `host/user/profile/region/database/port/tokenDurationSecs`; if reality differs, the report must say so and Tasks 3+ adapt).

- [ ] **Step 1: Install**

Run: `npm install @aws/aurora-dsql-node-postgres-connector @aws-sdk/credential-providers @aws-sdk/dsql-signer`
(Install at the same level `pg` is declared. If the exact package name 404s, STOP and report BLOCKED with the npm search output for `aurora-dsql` — do not substitute a lookalike package.)

- [ ] **Step 2: Write the type-level smoke test**

Create `packages/main/src/services/sql/dsql-connector-smoke.spec.ts`:

```typescript
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
```

If constructing without connecting has side effects (e.g. eager credential resolution that throws without AWS config), adapt: wrap in try/catch asserting the instance type or downgrade to a pure `typeof AuroraDSQLPool` check — and record the finding in the report.

- [ ] **Step 3: Run and verify**

Run: `npx vitest run packages/main/src/services/sql/dsql-connector-smoke.spec.ts` and `npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 4: Commit** (`chore(deps): add official Aurora DSQL node-postgres connector`)

---

### Task 2: Shared types + endpoint detection utils

**Files:**

- Modify: `packages/shared/src/types/connection.types.ts` (line 6 union; `ConnectionProfile`)
- Create: `packages/shared/src/utils/dsql-endpoint.ts`, `packages/shared/src/utils/dsql-endpoint.spec.ts`
- Modify: `packages/shared/src/index.ts` (re-export)
- Modify: `packages/shared/src/constants/ipc-channels.ts` (`CONNECTION` block)

**Interfaces:**

- Produces: `AuthenticationType` gains `'aws-iam'`; `ConnectionProfile.awsProfile?: string`; `isDsqlEndpoint(host: string): boolean`; `dsqlRegionFromEndpoint(host: string): string | undefined`; `IPC_CHANNELS.CONNECTION.LIST_AWS_PROFILES = 'connection:list-aws-profiles'`.

- [ ] **Step 1: Write the failing util tests**

Create `packages/shared/src/utils/dsql-endpoint.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isDsqlEndpoint, dsqlRegionFromEndpoint } from './dsql-endpoint';

describe('isDsqlEndpoint', () => {
  it.each([
    ['abc123def.dsql.us-east-1.on.aws', true],
    ['abc123def.dsql-fips.ca-central-1.on.aws', true],
    ['ABC123.DSQL.US-EAST-1.ON.AWS', true],
    ['mydb.rds.amazonaws.com', false],
    ['localhost', false],
    ['dsql.us-east-1.on.aws', false],
    ['abc.dsql.on.aws', false],
    ['', false],
  ])('%s → %s', (host, expected) => {
    expect(isDsqlEndpoint(host)).toBe(expected);
  });
});

describe('dsqlRegionFromEndpoint', () => {
  it('extracts the region', () => {
    expect(dsqlRegionFromEndpoint('abc123.dsql.eu-west-2.on.aws')).toBe('eu-west-2');
    expect(dsqlRegionFromEndpoint('abc123.dsql-fips.us-east-2.on.aws')).toBe('us-east-2');
  });
  it('returns undefined for non-DSQL hosts', () => {
    expect(dsqlRegionFromEndpoint('mydb.rds.amazonaws.com')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Verify failure** (`npx vitest run packages/shared/src/utils/dsql-endpoint.spec.ts` → module not found)

- [ ] **Step 3: Implement**

Create `packages/shared/src/utils/dsql-endpoint.ts`:

```typescript
/**
 * Aurora DSQL cluster endpoints look like <id>.dsql.<region>.on.aws
 * (or .dsql-fips. in FIPS regions). Used by the connection dialog to
 * auto-suggest IAM auth and by DSQL detection short-circuits.
 */

const DSQL_ENDPOINT_RE = /^[a-z0-9-]+\.dsql(?:-fips)?\.([a-z0-9-]+)\.on\.aws$/i;

export function isDsqlEndpoint(host: string): boolean {
  return DSQL_ENDPOINT_RE.test(host.trim());
}

export function dsqlRegionFromEndpoint(host: string): string | undefined {
  const match = DSQL_ENDPOINT_RE.exec(host.trim());
  return match?.[1]?.toLowerCase();
}
```

In `connection.types.ts`: change line 6 to

```typescript
export type AuthenticationType = 'sql' | 'windows' | 'entra-id' | 'aws-iam';
```

and add to `ConnectionProfile` (near `azureTenantId`):

```typescript
  awsProfile?: string; // AWS credentials profile for aws-iam auth (default: 'default')
```

In `ipc-channels.ts` `CONNECTION` block, after `PING`:

```typescript
    LIST_AWS_PROFILES: 'connection:list-aws-profiles',
```

Re-export the utils from `packages/shared/src/index.ts` following its existing export style.

- [ ] **Step 4: Verify green** (util spec + full `packages/shared` + `npm run typecheck`)
- [ ] **Step 5: Commit** (`feat(shared): aws-iam auth type and DSQL endpoint detection`)

---

### Task 3: AWS profile listing (parser + IPC)

**Files:**

- Create: `packages/main/src/services/config/aws-profiles.ts`, `aws-profiles.spec.ts`
- Modify: `packages/main/src/ipc/connection.ipc.ts`

**Interfaces:**

- Produces: `parseAwsProfileNames(configText: string, credentialsText: string): string[]` (pure); `listAwsProfiles(): Promise<string[]>` (reads `~/.aws/config` + `~/.aws/credentials`, missing files → contribute nothing); IPC handler for `CONNECTION.LIST_AWS_PROFILES` returning `string[]`.

- [ ] **Step 1: Failing parser tests**

Create `packages/main/src/services/config/aws-profiles.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseAwsProfileNames } from './aws-profiles';

const CONFIG = `
[default]
region = us-east-1

[profile dev]
sso_session = my-sso
region = us-west-2

[profile prod-admin]
region = eu-west-1

[sso-session my-sso]
sso_start_url = https://example.awsapps.com/start
`;

const CREDENTIALS = `
[default]
aws_access_key_id = AKIA...

[legacy-keys]
aws_access_key_id = AKIA...
`;

describe('parseAwsProfileNames', () => {
  it('collects config [profile x] and credentials [x] sections, default first, deduped', () => {
    expect(parseAwsProfileNames(CONFIG, CREDENTIALS)).toEqual([
      'default',
      'dev',
      'prod-admin',
      'legacy-keys',
    ]);
  });

  it('ignores sso-session and services sections', () => {
    expect(parseAwsProfileNames(CONFIG, '')).not.toContain('my-sso');
  });

  it('handles empty inputs', () => {
    expect(parseAwsProfileNames('', '')).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify failure**, then **Step 3: Implement**

Create `packages/main/src/services/config/aws-profiles.ts`:

```typescript
/**
 * AWS profile discovery for the connection dialog's aws-iam auth picker.
 * Pure parsing is separated from fs so it's unit-testable. We only need
 * section NAMES — credential resolution itself is the connector's job.
 */
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { createLogger } from '../../utils/logger';

const log = createLogger('AwsProfiles');

// ~/.aws/config uses "[profile name]" (except "[default]");
// ~/.aws/credentials uses bare "[name]". Ignore sso-session/services sections.
const CONFIG_SECTION_RE = /^\[(?:profile\s+)?([^\]\s][^\]]*)\]\s*$/;
const NON_PROFILE_PREFIXES = ['sso-session ', 'services '];

export function parseAwsProfileNames(configText: string, credentialsText: string): string[] {
  const names = new Set<string>();
  for (const text of [configText, credentialsText]) {
    for (const line of text.split('\n')) {
      const match = CONFIG_SECTION_RE.exec(line.trim());
      if (!match) continue;
      const name = match[1].trim();
      if (NON_PROFILE_PREFIXES.some(p => line.trim().slice(1).startsWith(p))) continue;
      names.add(name);
    }
  }
  const sorted = [...names].filter(n => n !== 'default');
  return names.has('default') ? ['default', ...sorted] : sorted;
}

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    log.debug(`No AWS file at ${path}: ${(err as Error).message}`);
    return '';
  }
}

export async function listAwsProfiles(): Promise<string[]> {
  const awsDir = join(homedir(), '.aws');
  const [config, credentials] = await Promise.all([
    readOrEmpty(join(awsDir, 'config')),
    readOrEmpty(join(awsDir, 'credentials')),
  ]);
  return parseAwsProfileNames(config, credentials);
}
```

Note: `parseAwsProfileNames` must preserve first-seen order after `default` (the test asserts config-then-credentials order). If `Set` iteration order needs adjusting to satisfy the test, do it plainly.

In `connection.ipc.ts`, after the PING handler:

```typescript
// AWS profile names for the aws-iam auth picker (names only — no credentials)
safeHandle(IPC_CHANNELS.CONNECTION.LIST_AWS_PROFILES, async (): Promise<string[]> => {
  return listAwsProfiles();
});
```

with `import { listAwsProfiles } from '../services/config/aws-profiles';`.

- [ ] **Step 4: Verify green** (parser spec + `packages/main` suite + typecheck)
- [ ] **Step 5: Commit** (`feat(main): list AWS profiles for aws-iam auth picker`)

---

### Task 4: Pool manager IAM branches

**Files:**

- Modify: `packages/main/src/services/sql/connection-pool.ts` (`getPgPool`, `testPgConnection`, `detectDsql`, PG error guidance)

**Interfaces:**

- Consumes: `AuroraDSQLPool` (Task 1), `'aws-iam'` type (Task 2).
- Produces: `aws-iam` profiles connect without Keychain passwords; `detectDsql` short-circuit.

No new unit test (driver-heavy singleton, consistent with PR #42's Task 3); verification is typecheck + suites + the live checklist.

- [ ] **Step 1: Extract a pool-config builder branch in `getPgPool`**

In `getPgPool`, replace the password fetch + `new PgPool(...)` block so the IAM branch comes FIRST (before any Keychain access):

```typescript
// aws-iam (Aurora DSQL): the official connector mints a fresh IAM token
// per physical connection from the user's ~/.aws credentials — nothing
// is read from or written to the Keychain for these profiles.
const { effectiveProfile } = await this.withTunnel(profile);

let pool: PgPool;
if (profile.authenticationType === 'aws-iam') {
  pool = new AuroraDSQLPool({
    host: effectiveProfile.server,
    port: effectiveProfile.port,
    user: effectiveProfile.username || 'admin',
    database: dbName,
    profile: profile.awsProfile || undefined,
    // DSQL rejects non-SSL connections; encrypt is forced on this path.
    ssl: { rejectUnauthorized: !effectiveProfile.trustServerCertificate },
    connectionTimeoutMillis: effectiveProfile.connectionTimeout * 1000,
    query_timeout: (effectiveProfile.requestTimeout || 30) * 1000,
    max: 10,
    idleTimeoutMillis: 30000,
  });
} else {
  const password = await this.profileStore.getPassword(profileId);
  if (!password) throw new Error('Connection password not found in Keychain');
  pool = new PgPool({
    /* existing options block unchanged */
  });
}
```

Keep the existing verify-connection + `pgPools.set` code after it unchanged. Move the pre-existing `withTunnel` call as shown (it currently sits between the password fetch and pool construction — hoist it above the branch). Import `AuroraDSQLPool` from `@aws/aurora-dsql-node-postgres-connector`. If the connector's option names differ from Task 1's verified report, follow the report.

- [ ] **Step 2: Mirror in `testPgConnection`**

Add the same branch with `max: 1` and no `query_timeout`, keeping the existing `SELECT version() ...` verification query. `testConnection`'s callers pass `password || ''` — the IAM branch ignores it.

- [ ] **Step 3: `detectDsql` shortcut**

At the top of `detectDsql`, after the cache check:

```typescript
const profile = this.profileStore.getById(profileId);
if (profile?.authenticationType === 'aws-iam') {
  // IAM auth is DSQL-only — no need to probe.
  this.dsqlCache.set(profileId, true);
  return true;
}
```

- [ ] **Step 4: Error guidance**

In the PG error-guidance path used by `testPgConnection`'s catch (and any shared `getErrorGuidance`), add cases matching common credential failures (`CredentialsProviderError`, message contains `Could not load credentials`, `Token is expired`, `expired`, `sso`): guidance lines

```typescript
return [
  `AWS credentials for profile '${profile.awsProfile || 'default'}' are missing or expired`,
  `If you use SSO, run: aws sso login --profile ${profile.awsProfile || 'default'}`,
  'Then retry the connection',
];
```

Wire it so it only triggers for `aws-iam` profiles; match the file's existing guidance-structure idiom.

- [ ] **Step 5: Verify** (`npm run typecheck`, `npx vitest run packages/main`), **Step 6: Commit** (`feat(dsql): mint IAM auth tokens via official connector for aws-iam profiles`)

---

### Task 5: Preload + IpcService plumbing

**Files:**

- Modify: `packages/preload/src/index.ts` (type block AND implementation object)
- Modify: `packages/renderer/src/app/core/services/ipc.service.ts` (+ its local `ForgeAPI` shadow interface)

**Interfaces:**

- Produces: `window.forge.connection.listAwsProfiles(): Promise<string[]>`; `IpcService.listAwsProfiles(): Observable<string[]>`.

- [ ] **Step 1: Add in all THREE places** (preload type, preload impl, ipc.service shadow interface + method):

```typescript
listAwsProfiles: () => Promise<string[]>;
```

```typescript
    listAwsProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION.LIST_AWS_PROFILES),
```

```typescript
  listAwsProfiles(): Observable<string[]> {
    return from(this.api.connection.listAwsProfiles());
  }
```

- [ ] **Step 2: Verify** (`npm run typecheck`), **Step 3: Commit** (`feat(ipc): expose AWS profile listing to renderer`)

---

### Task 6: Connection dialog UX

**Files:**

- Modify: `packages/renderer/src/app/shared/components/connection-dialog/connection-dialog.component.ts`

**Interfaces:**

- Consumes: `isDsqlEndpoint` (Task 2), `IpcService.listAwsProfiles` (Task 5), `'aws-iam'` type.

Requirements (locate anchors by name — line refs are from before this branch):

1. **Engine/auth guard** (`onEngineChange`-ish logic at :709-710): postgresql keeps `'sql' | 'aws-iam'`; switching engine away from postgresql while `aws-iam` is selected resets to `'sql'`; mssql behavior unchanged.
2. **Auth dropdown** (template `mat-select` at :116): add `@if (formData.engine === 'postgresql') { <mat-option value="aws-iam">AWS IAM (Aurora DSQL)</mat-option> }`.
3. **Conditional section** (pattern: the entra-id `@if` at :137): when `aws-iam` selected — hide the password field, show:
   - AWS profile `mat-select` populated from `ipc.listAwsProfiles()` (loaded lazily the first time `aws-iam` is selected; falls back to a plain text input when the list is empty), bound to `formData.awsProfile`, default `'default'`.
   - A hint line: `Tokens are minted automatically from your AWS credentials — nothing is stored.`
   - Username field stays visible (DB role), defaulting to `admin` when empty at save time for aws-iam.
4. **Endpoint auto-detection**: on server/host input change, if `isDsqlEndpoint(host)` AND `formData.authenticationType === 'sql'` AND the password field is empty: set `authenticationType = 'aws-iam'`, `database = 'postgres'`, `encrypt = true`. Never do the reverse (user can still switch back manually).
5. **Save flow** (mappings at :744/:765): include `awsProfile` in the saved profile; skip password handling for aws-iam (pass `undefined`).
6. **Test Connection**: no change needed beyond the above — the handler resolves the password to `undefined` and the main-side branch ignores it. Verify this path compiles and behaves (the dialog currently requires a password for `'sql'`-auth test; ensure the requirement is bypassed for `aws-iam`).

Match the component's existing template idioms (`@if`, `mat-form-field` structure) exactly. No new component files.

- [ ] **Step 1: Implement**, **Step 2: Verify** (`npm run typecheck`, `npx vitest run packages/renderer`, direct ESLint on the file), **Step 3: Commit** (`feat(renderer): AWS IAM auth UX in connection dialog`)

---

### Task 7: Verification, stacked PR

- [ ] **Step 1:** `npm run typecheck && npm test` — all green.
- [ ] **Step 2:** `npm run test:harness:up && npm run test:full` — **run `npm run build` first** (issue #43: Playwright tiers silently skip without dist). All four tiers green; report any failure verbatim to Craig.
- [ ] **Step 3:** Manual live-cluster checklist (needs Craig's AWS setup):
  1. New connection → paste DSQL endpoint → dialog auto-selects AWS IAM, database `postgres`, SSL on.
  2. Pick an SSO profile → Test Connection succeeds without any password.
  3. Connect; explorer browses; leave idle past 1 hour → next query transparently reconnects with a fresh token (no toast storm).
  4. `aws sso logout` → new connection attempt shows the `aws sso login --profile <x>` guidance.
  5. Non-admin DB role: username other than `admin` connects with a regular token (if a custom role exists on the cluster).
- [ ] **Step 4:** Single squash-target PR: `gh pr create --base dsql` (stacked on #42; retarget to main after #42 merges). PR body calls out: new dependencies (official AWS connector + 2 SDK peer deps), no credential storage, the auto-detection behavior, and anything the live checklist surfaced.

---

## Self-review notes

- Coverage: every design decision maps to a task (connector install/spike T1, types+detection T2, profile listing T3, pool branches T4, IPC T5, dialog T6, verification T7).
- Risk deliberately front-loaded: T1's spike pins the connector API before anything depends on it; BLOCKED-on-404 instruction prevents a lookalike-package supply-chain mistake.
- Type consistency: `awsProfile` spelled identically in profile type, pool branch, dialog binding, guidance strings; `LIST_AWS_PROFILES`/`listAwsProfiles` naming consistent across channel/preload/service.
