/**
 * The connection form's zod schema — an **adapter** over `packages/shared/src/validators/`, not a
 * second implementation of it.
 *
 * PLAN.md §2 ("Forms") makes the shared validators the single source of truth, and the brief is
 * explicit that a zod adapter is the pattern. So this file contains **no validation rule of its own
 * for any field the shared package already validates**: `validateConnectionName`,
 * `validateServer`, `validatePort` and `validateUsername` are called, and their `errors` arrays are
 * replayed as zod issues on the right field path. Length caps, hostname/IPv4/IPv6 shapes, the
 * 1–65535 port range and the "username is required for SQL auth" rule all live there and are
 * changed there. `adapt` below is the whole bridge.
 *
 * ── Consequences worth stating, because each one is a decision ────────────────────────────────
 *
 * 1. **The username rule needs no branching here.** `validateUsername(name, authType)` requires a
 *    username only when `authType === 'sql'`, which is exactly the form's rule once you follow it
 *    through: mssql `windows`/`entra-id` collect nothing, `aws-iam` defaults a blank name to
 *    `admin` (`form-model.ts:resolvedUsername`), and every other engine/mode combination is `sql`.
 *    The Angular dialog wrote that condition out three times — in `isValid()`, in
 *    `canTestConnection()` and in `validationHint()` — and the three disagreed about `aws-iam`.
 *
 * 2. **The Default Database field is NOT validated.** `validateDatabaseName` exists, but it is the
 *    *create-a-database* validator: it rejects reserved words and system database names, and
 *    `master` / `postgres` / `mysql` are precisely the legitimate defaults here. Applying it would
 *    reject the correct value for every engine. Angular did not validate this field either.
 *
 * 3. **SSH has no shared validator, so two rules are declared here** — username required, and
 *    private-key path required for key auth. `packages/shared` is read-only for this task
 *    (PLAN.md §8), so they cannot be added there; `SSH_MESSAGES` marks them for a later PR to
 *    lift. The SSH *host* and *port* still go through `validateServer` / `validatePort`, because a
 *    bastion hostname is a hostname.
 *
 * 4. **Connection Timeout is unvalidated on purpose.** An emptied number input reads as `NaN` and
 *    `form-model.ts` substitutes 30 seconds, which is the Angular behaviour (`|| 30` at `:1011`).
 *    Reporting it as an error would be a new rule, not a ported one.
 */

import { z } from 'zod';
import type { FieldErrors } from 'react-hook-form';
import {
  ENGINE_LABELS,
  validateConnectionName,
  validatePort,
  validateServer,
  validateUsername,
  type AuthenticationType,
  type DatabaseEngine,
  type SshAuthType,
  type ValidationResult,
} from '@joinery/shared';

import {
  AUTH_MODES,
  ENGINES,
  isAuthModeValidForEngine,
  type ConnectionFormValues,
} from './form-model';

/**
 * The only human-facing rules this file owns. Declared here because `packages/shared` has no SSH
 * validator and is read-only for this task — see note 3 in the header.
 */
const SSH_MESSAGES = {
  username: 'SSH username is required for a tunnelled connection',
  privateKeyPath: 'Private key path is required for key authentication',
} as const;

/**
 * Replays a shared `ValidationResult` as zod issues on one field path.
 *
 * One issue per message, so a value that fails two shared rules surfaces both — `validateServer`
 * can return "Invalid server hostname or IP address" and "octets must be 0-255" together, and
 * collapsing them would drop the specific one.
 */
function adapt(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  result: ValidationResult
): void {
  for (const message of result.errors) {
    ctx.addIssue({ code: 'custom', message, path: [...path] });
  }
}

/**
 * A numeric field. Accepts `NaN`, which is what `react-hook-form`'s `valueAsNumber` produces for an
 * emptied `<input type="number">` — the *shared* validator is what must name that failure ("Port
 * must be a number"), so zod's own "expected number, received NaN" must never be what the user
 * sees.
 */
const numberField = z.custom<number>(value => typeof value === 'number', {
  message: 'Expected a number',
});

/**
 * A field whose value must be a member of `allowed`.
 *
 * `z.custom<T>` rather than `z.enum(...)` so the schema's output type is the real union
 * (`DatabaseEngine`, `AuthenticationType`) while the accepted values still come from a table
 * derived at runtime. `z.enum` needs a literal tuple, which would mean re-listing the engines here
 * — the thing this whole file exists not to do.
 */
function oneOf<T extends string>(allowed: readonly T[], noun: string) {
  return z.custom<T>(value => typeof value === 'string' && allowed.includes(value as T), {
    message: `Not a supported ${noun}`,
  });
}

/** Every auth mode any engine offers, de-duplicated. Derived from `AUTH_MODES`, never re-listed. */
const AUTH_MODE_VALUES: readonly AuthenticationType[] = [
  ...new Set(Object.values(AUTH_MODES).flatMap(modes => modes.map(mode => mode.value))),
];

const SSH_AUTH_TYPES: readonly SshAuthType[] = ['password', 'privateKey'];

/**
 * The field types. Shapes only — every human-facing rule is in the `superRefine` below.
 *
 * The two derived unions are the point of `oneOf`: `ENGINES` is `ENGINE_LABELS`' keys and
 * `AUTH_MODE_VALUES` is `AUTH_MODES`' values, so the set the UI offers and the set validation
 * accepts are one set. The `z.ZodType<ConnectionFormValues>` annotation on the export below is what
 * checks that they still add up to the form's own types, with **no cast** — if `AUTH_MODES` stopped
 * offering a member of `AuthenticationType`, or offered something outside it, this file stops
 * compiling.
 */
const shape = z.object({
  name: z.string(),
  engine: oneOf<DatabaseEngine>(ENGINES, 'database engine'),
  server: z.string(),
  port: numberField,
  authenticationType: oneOf<AuthenticationType>(AUTH_MODE_VALUES, 'authentication type'),
  username: z.string(),
  password: z.string(),
  awsProfile: z.string(),
  encrypt: z.boolean(),
  trustServerCertificate: z.boolean(),
  connectionTimeout: numberField,
  database: z.string(),
  color: z.string(),
  mysqlCollation: z.string(),
  sshEnabled: z.boolean(),
  sshHost: z.string(),
  sshPort: numberField,
  sshUsername: z.string(),
  sshAuthType: oneOf<SshAuthType>(SSH_AUTH_TYPES, 'SSH authentication type'),
  sshPassword: z.string(),
  sshPrivateKeyPath: z.string(),
  sshPassphrase: z.string(),
});

/**
 * The schema `zodResolver` runs.
 *
 * Both type parameters are pinned. The **output** annotation is the drift guard described above —
 * `AUTH_MODES` and `ENGINES` must still add up to the form's own unions. The **input** annotation is
 * a `@hookform/resolvers` requirement: its `Resolver` needs the schema's input to be a `FieldValues`,
 * and an unannotated `superRefine` chain widens it to `unknown`.
 */
export const connectionFormSchema: z.ZodType<ConnectionFormValues, ConnectionFormValues> =
  shape.superRefine((values, ctx) => {
    adapt(ctx, ['name'], validateConnectionName(values.name));
    adapt(ctx, ['server'], validateServer(values.server));
    adapt(ctx, ['port'], validatePort(values.port));
    // Unconditional: the shared validator's own `authType === 'sql'` gate IS the form's rule. See
    // note 1 in the header.
    adapt(ctx, ['username'], validateUsername(values.username, values.authenticationType));

    // A profile whose stored auth mode the engine does not offer. Unreachable by picking things in
    // this dialog, but reachable from history: PLAN.md predates the per-engine gating, and the
    // Angular dropdown simply hid the option rather than resetting the value, so a profile saved as
    // mysql + `aws-iam` still exists. Left unchecked the editor would render a picker with no matching
    // item and re-save the mismatch, which the pool then fails on at connect time with a message about
    // credentials rather than about configuration.
    if (!isAuthModeValidForEngine(values.engine, values.authenticationType)) {
      ctx.addIssue({
        code: 'custom',
        message: `${ENGINE_LABELS[values.engine]} does not offer this authentication type`,
        path: ['authenticationType'],
      });
    }

    if (!values.sshEnabled) return;

    adapt(ctx, ['sshHost'], validateServer(values.sshHost));
    adapt(ctx, ['sshPort'], validatePort(values.sshPort));
    if (values.sshUsername.trim() === '') {
      ctx.addIssue({ code: 'custom', message: SSH_MESSAGES.username, path: ['sshUsername'] });
    }
    if (values.sshAuthType === 'privateKey' && values.sshPrivateKeyPath.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        message: SSH_MESSAGES.privateKeyPath,
        path: ['sshPrivateKeyPath'],
      });
    }
  });

/**
 * The fields **Test** validates, which is a strict subset of the fields **Save** does.
 *
 * Test needs a reachable server and enough credentials to authenticate; it does not need a name,
 * because nothing is being persisted. This reproduces `canTestConnection()` versus `isValid()`
 * (`connection-dialog.component.ts:784,974`) as a field list handed to `form.trigger` rather than
 * as a second hand-written predicate — so the two gates cannot drift apart, and Test stays
 * available on a half-filled form the way it was before.
 *
 * `username` is in the list unconditionally; whether it is *required* is the shared validator's
 * call, made from `authenticationType`.
 */
export const TEST_FIELDS: readonly (keyof ConnectionFormValues)[] = [
  'server',
  'port',
  'authenticationType',
  'username',
  'sshHost',
  'sshPort',
  'sshUsername',
  'sshPrivateKeyPath',
];

/**
 * Every field the summary hint can name, in the form's reading order, **with its visible label**.
 *
 * The order is the reading order so the hint names the topmost problem; `name` and
 * `connectionTimeout` come last because they are the two things only Save needs.
 *
 * The labels exist because three of the shared validators are **field-agnostic**: `validateServer`
 * says "Server is required" whoever calls it, and the SSH host is a hostname so it goes through the
 * same validator. Without attribution the summary line read literally "Server is required" while the
 * Server field was filled in and the SSH host was not — the message was true of a field it did not
 * name. The labels are the ones the controls actually render, so the hint points at something the user
 * can see.
 */
const HINT_FIELDS = [
  ['server', 'Server'],
  ['port', 'Port'],
  ['authenticationType', 'Authentication type'],
  ['username', 'Username'],
  ['sshHost', 'SSH host'],
  ['sshPort', 'SSH port'],
  ['sshUsername', 'SSH username'],
  ['sshPrivateKeyPath', 'Private key path'],
  ['name', 'Connection name'],
  ['connectionTimeout', 'Timeout (seconds)'],
] as const satisfies readonly (readonly [keyof ConnectionFormValues, string])[];

/**
 * A one-line summary of what is still missing, for the hint above the action row.
 *
 * Ported in intent from `validationHint()` (`:767-782`), which existed because Material's outlined
 * fields showed no error text — but read off the resolver's own errors instead of from a
 * re-implementation of the rules, which is what made the Angular hint drift out of step with
 * `isValid()` (it asked for a Username on mssql/`sql` only, so a blank PostgreSQL username produced
 * a disabled Save button and no explanation at all).
 *
 * The label is prefixed **unless the message already opens with it**, which is the difference between
 * "SSH host: Server is required" (needed — the message names the wrong field) and "Server is
 * required" (already unambiguous, and "Server: Server is required" would be noise). One rule, and its
 * meaning is simply "never say the field's name twice". A shared message reworded to stop opening with
 * its field name gains the prefix, which is the correct outcome rather than a regression.
 *
 * Only the *summary* is attributed. The inline error under a control needs no prefix — its label is
 * the line directly above it — which is why this is not done inside `adapt`.
 */
export function firstErrorMessage(errors: FieldErrors<ConnectionFormValues>): string | undefined {
  for (const [field, label] of HINT_FIELDS) {
    const message = errors[field]?.message;
    if (typeof message !== 'string' || message === '') continue;
    return message.startsWith(label) ? message : `${label}: ${message}`;
  }
  return undefined;
}

/** The fields the hint can name. Exported so the spec can hold it against `TEST_FIELDS`. */
export const HINT_ORDER: readonly (keyof ConnectionFormValues)[] = HINT_FIELDS.map(
  ([field]) => field
);
