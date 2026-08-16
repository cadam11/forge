/**
 * The one place in this feature that spells the three-positional-passwords wart, and the rules for
 * which secrets a given form state is allowed to send.
 *
 * ── The wart, and why it is adapted rather than fixed ────────────────────────────────────────
 *
 * `connection.test` and `connection.save` both take `(profile, password?, sshPassword?,
 * sshPassphrase?)` — three consecutive optional strings (`packages/preload/src/index.ts:83-94`).
 * PLAN.md §7.1 item 1 logs it: any two of them transpose silently, and no compiler, test or review
 * step would notice. `packages/preload` is out of scope for the rewrite tasks (PLAN.md §8), so the
 * contract is consumed as written — but exactly once, here, behind a named object. Every call site
 * in the editor passes `{ password, sshPassword, sshPassphrase }` by name, so a transposition is a
 * property-name typo the compiler rejects instead of a silent swap.
 *
 * `connectionStore.saveProfile` / `testConnection` repeat the same positional shape, so these two
 * functions wrap the store rather than the bridge. That is also why they are the only members: the
 * feature must not reach `ipc().connection.*` directly and skip the store's list refresh, its
 * toasts and its `connecting` flag.
 *
 * ── Keychain discipline ─────────────────────────────────────────────────────────────────────
 *
 * A secret's whole journey is: a `react-hook-form` field, into a `ConnectionSecrets` literal, into
 * one of the two functions below, into the store, into the bridge, into keytar. It is never
 * written to `localStorage` or `AppState` (the renderer has no such write — `persistence/`'s
 * `no-local-storage-writes.spec.ts` permits exactly one `setItem`, the theme mirror), never logged
 * (`diagnostics.*` is called with errors, never with form values), and never part of a TanStack
 * Query key (`ipc/use-ipc-call.ts` requires `keyArgs` separately for precisely this reason, and the
 * write path here is not a query at all).
 */

import type { ConnectionProfile, TestConnectionResult } from '@joinery/shared';

import { connectionStore, type ProfileDraft } from '../../state/connection';
import { isAwsIamAuth, type ConnectionFormValues } from './form-model';

/**
 * The three secrets, by name. `undefined` means "do not send one", which the main process reads as
 * "fall back to what is already in the keychain" for the password and "there is none" for the two
 * SSH members.
 */
export interface ConnectionSecrets {
  readonly password?: string;
  readonly sshPassword?: string;
  readonly sshPassphrase?: string;
}

/**
 * The secrets a given form state may send. One function for both save and test, because the two
 * rules turn out to be the same rule stated twice:
 *
 * - **`aws-iam` never sends a form password.** The pool mints IAM tokens, and sending `''` would
 *   write an empty credential into the keychain.
 * - **A blank password box means `undefined`, not `''`.** On a save that is the difference between
 *   leaving the stored credential alone and overwriting it
 *   (`connection-profiles.ts:138` only stores a truthy password). On a test it is what makes
 *   `connection.ipc.ts:31` resolve the keychain-stored password for the profile id that
 *   `buildTestProfile` deliberately passes through — so Test exercises exactly what Connect will
 *   use. Angular reached the same place with two methods and a `isEditing()` check
 *   (`connection-dialog.component.ts:667-671,964-966`); the `??` in the handler makes the check
 *   redundant.
 * - **SSH secrets follow the selected auth type**, so turning a tunnel off, or switching it to a
 *   key, never re-sends the other mode's secret.
 */
export function secretsFrom(values: ConnectionFormValues): ConnectionSecrets {
  return {
    password: isAwsIamAuth(values) ? undefined : nonEmpty(values.password),
    ...sshSecrets(values),
  };
}

/** SSH secrets, only for the auth type actually selected. */
function sshSecrets(values: ConnectionFormValues): ConnectionSecrets {
  if (!values.sshEnabled) return {};
  if (values.sshAuthType === 'password') return { sshPassword: nonEmpty(values.sshPassword) };
  return { sshPassphrase: nonEmpty(values.sshPassphrase) };
}

/**
 * `''` → `undefined`. The distinction matters at the bridge: an empty string is a credential the
 * main process will store, `undefined` is a fall-back-to-the-keychain instruction.
 */
function nonEmpty(value: string): string | undefined {
  return value === '' ? undefined : value;
}

/** `connectionStore.saveProfile`, with the three passwords named. */
export function saveProfileWithSecrets(
  draft: ProfileDraft,
  secrets: ConnectionSecrets
): Promise<ConnectionProfile | null> {
  return connectionStore
    .getState()
    .saveProfile(draft, secrets.password, secrets.sshPassword, secrets.sshPassphrase);
}

/**
 * `connectionStore.testConnection`, with the three passwords named.
 *
 * `notifyErrors: false` is fixed here rather than being a parameter: the editor renders failures in
 * its own inline panel, and a toast on top would announce the same error twice. A success still
 * toasts, which is the store's behaviour and the reason the panel only ever shows failures.
 */
export function testProfileWithSecrets(
  profile: ConnectionProfile,
  secrets: ConnectionSecrets
): Promise<TestConnectionResult> {
  return connectionStore
    .getState()
    .testConnection(profile, secrets.password, secrets.sshPassword, secrets.sshPassphrase, {
      notifyErrors: false,
    });
}
