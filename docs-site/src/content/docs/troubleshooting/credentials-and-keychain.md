---
title: Credential and keychain problems
description: Passwords that do not stick, "password not found in Keychain", and what Joinery does when the credential store refuses it.
sidebar:
  order: 2
---

Every secret Joinery holds — database passwords, SSH passwords and key passphrases, AI provider
API keys, and the Microsoft Entra ID token cache — goes to the operating system's credential
store: the macOS Keychain, or the Windows Credential Store. Nothing secret is written to a file.
[Where Joinery stores things](../../reference/storage-locations/) is the full map; this page is
what to do when that machinery misbehaves.

## One entry, read once

Joinery does not keep a keychain item per connection. It keeps **one** item — service
`ca.adam11.joinery`, account `credentials-vault` — holding a JSON object of every secret, read
once at startup and cached in the main process for the session. Saving a profile writes the whole
object back.

That shape explains two things you might otherwise read as faults:

- **The keychain is read once per launch, not once per connection.** Opening a second connection
  costs no keychain access at all; the answer is already in memory.
- **Deleting that one keychain item deletes every saved secret at once** — every database
  password, every SSH credential, every AI key. There is no per-connection item to remove.

If you are coming from an early build that stored one item per credential, the first launch after
upgrading migrates them into the vault and deletes the old items. That runs once, and only when
no vault exists yet.

## "Connection password not found in Keychain"

The profile is saved but its password is not. Joinery raises this when a connect or a query needs
a password for a profile and the vault has no entry under that profile's id. The same message
exists for SSH: _SSH password not found in Keychain_.

Common causes, in the order worth checking:

1. **The profile was saved with the password field empty.** Joinery skips the credential write
   when there is no password to write. Open the connection, type the password, save again.
2. **The vault was never readable this session.** See the next section — the app carries on
   without saved credentials rather than refusing to start.
3. **The keychain item was deleted or the profile id changed.** Re-enter and save.

Re-entering the password and saving is the fix in all three cases. There is no repair command,
and there does not need to be one: the write is the repair.

## When the keychain refuses

If the read at startup fails — access denied, a locked keychain, keychain unavailable — Joinery
**does not stop**. It marks the store unavailable, continues with no saved credentials, and
writes a `CredentialStore` warning to the log reading _Keychain access unavailable - saved
credentials will not be loaded. Grant keychain access to enable credential storage._

After that, passwords you type are kept in memory for the rest of the session and are **not
persisted**. They work for this run and are gone at quit. A failed write behaves the same way and
logs its own line.

> **Careful** — none of this is shown in the user interface. Nothing in the window says the
> keychain is unavailable, so the symptom you see is "my passwords keep disappearing" while the
> real message is sitting in the output panel. Open it with **⌘J** and filter to **Errors**, or
> read the whole timeline: the `CredentialStore` lines are the ones that matter. Surfacing this
> properly is a known gap.

On macOS, the fix is usually in **Keychain Access**: find the `ca.adam11.joinery` entry, and
check that Joinery is allowed to read it. Rebuilding the app from source produces a differently
signed binary, which is the usual reason a previously granted permission stops applying.

## "Login failed" with a password you are sure of

This one is almost never the keychain. Joinery stores what you typed **byte for byte** — it never
trims, and the drivers pass genuine special characters through unharmed. What does break a login
is invisible junk that rides along with a paste: a leading or trailing space, a stray line break,
curly quotes from a document or chat app, a non-breaking space, an en dash where a hyphen was
meant.

Press **Test** in the connection editor. On an authentication failure the panel lists the
guidance the app has, and if any of those artifacts are present it names them — and, in that
case, states the password's character count so you can compare it against what you expected. It
never shows the password itself. A clean password adds no lines, so no news is genuine news: the
credentials really are being rejected as typed.

Retyping the password by hand, rather than pasting it again, is the fastest way to rule this out.

## API keys and Entra ID

An AI provider's key is stored in the same vault under `ai-<vendor-id>`, and removing the key in
the AI settings deletes that entry. If a provider suddenly reports an authentication failure and
the key looks right, it is worth checking the same paste artifacts as above.

The Microsoft Entra ID sign-in keeps its MSAL token cache in the vault too, under
`__entra_msal_cache__`. If Entra sign-in loops or silently re-prompts, the cache is the piece
that failed to persist — and a keychain that is not writable will do exactly that.

## Deleting a connection cleans up after itself

Deleting a connection profile deletes its database password, its SSH password and its key
passphrase along with it. You do not need to visit the keychain afterwards.

<details>
<summary>Where this page's facts come from</summary>

| Claim                                                                                      | Source                                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| One keychain item: service `ca.adam11.joinery`, account `credentials-vault`, holding JSON  | `packages/main/src/services/keychain/credential-store.ts:13-18, 44-56`                            |
| The app id is `ca.adam11.joinery`                                                          | `packages/shared/src/constants/index.ts:5`                                                        |
| It is read once at startup and cached, and concurrent callers share one read               | `packages/main/src/services/keychain/credential-store.ts:28-42, 134-149`                          |
| A save rewrites the whole vault                                                            | `packages/main/src/services/keychain/credential-store.ts:93-98, 103-120`                          |
| Legacy per-credential items are migrated into the vault and deleted, only when none exists | `packages/main/src/services/keychain/credential-store.ts:57-76`                                   |
| A failed read marks the store unavailable, continues, and logs that exact sentence         | `packages/main/src/services/keychain/credential-store.ts:79-88`                                   |
| A failed write keeps the value in memory for the session and logs it                       | `packages/main/src/services/keychain/credential-store.ts:111-128`                                 |
| Nothing surfaces the unavailable state: `isKeychainAvailable()` has no callers             | `packages/main/src/services/keychain/credential-store.ts:179-184` (only occurrence)               |
| "Connection password not found in Keychain"                                                | `packages/main/src/services/sql/connection-pool.ts:633, 735, 809`                                 |
| "SSH password not found in Keychain"                                                       | `packages/main/src/services/ssh/ssh-tunnel-manager.ts:96-100`                                     |
| A profile saved with no password skips the credential write                                | `packages/main/src/services/config/connection-profiles.ts:138-148`                                |
| Passwords are stored verbatim, and the paste artifacts that break a login                  | `packages/shared/src/validators/password-hygiene.ts:1-22, 63-77`                                  |
| The findings, and the length line, are emitted only when an artifact is found              | `packages/shared/src/validators/password-hygiene.ts:149-162`                                      |
| Auth-failure guidance appends those findings, never the value                              | `packages/main/src/services/sql/connection-pool.ts:1166-1180`                                     |
| Test renders the error and every guidance line inline                                      | `packages/renderer/src/features/connections/test-result-panel.tsx:29-60`                          |
| AI provider keys are `ai-<vendor-id>`, set and deleted with the key                        | `packages/main/src/services/ai/ai-service.ts:136-138, 154-156`                                    |
| The Entra MSAL token cache is a vault entry named `__entra_msal_cache__`                   | `packages/main/src/services/azure/entra-auth.ts:12-13, 56-57`                                     |
| Deleting a profile deletes its password and both SSH secrets                               | `packages/main/src/services/config/connection-profiles.ts:191-193`                                |
| ⌘J toggles the output panel, which has an errors-only filter                               | `packages/renderer/src/commands/catalogue.ts:559-566`, `shell/workspace/output-panel.tsx:191-202` |

</details>
