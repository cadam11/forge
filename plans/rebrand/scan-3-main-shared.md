# Rebrand Scan 3 — Main / Preload / Shared / CLI

Scope: `packages/main`, `packages/preload`, `packages/shared`, `packages/cli`, plus the root-level
build/config files that these packages share (`package.json`, `tsconfig.json`, `vitest*.config.ts`,
`electron-builder.yml`, `resources/entitlements.mac.plist`, `scripts/*.js`, `tests/integration/**`).

**This is a read-only inventory. No edits were made.**

Renderer-specific findings, `__mj` schema/database detection AI logic depth, and e2e/visual test
content are a sibling agent's domain — where this scan touches that boundary (e.g. the `MJ.*` IPC
channel group, `MJ*` type names) it is flagged as an **overlap**, not deep-dived.

---

## 0. TL;DR — the four things that actually matter

1. **Keychain service name** (`APP_ID = 'com.memberjunction.forge'`) is used as the keytar service
   string for every stored credential (DB passwords, SSH keys). Change it and every existing user's
   saved credentials become invisible to the app — `keytar.getPassword(newName, ...)` returns nothing
   for entries stored under the old name. **This needs a migration, not a find/replace.**
2. **`productName: MJ Forge` + `appId: com.memberjunction.forge`** in `electron-builder.yml` drive
   Electron's `app.getPath('userData')` and `app.getPath('logs')` on every OS. No code calls
   `app.setName()` to override this. Renaming either value moves the on-disk folder that holds
   connection profiles, query history, app state, and cached query-result snapshots — **existing
   users silently lose all of that** unless a migration copies the old folder to the new one first.
3. **macOS Keychain Access Group entitlement** (`resources/entitlements.mac.plist:19`) hardcodes
   `$(AppIdentifierPrefix)com.memberjunction.forge` — must move in lockstep with `appId` and
   `APP_ID`, or code-signing/entitlement mismatches can break keychain access after an update.
4. **npm workspace scope `@mj-forge/*`** is used in ~85 import/config locations across every package
   in scope. This is a mechanical, monorepo-wide rename (workspace name in 5 `package.json` files +
   every `import ... from '@mj-forge/...'` + `tsconfig.json` paths + 2 vitest configs + 4 root-level
   integration spec files + 4 packaging scripts + `electron-builder.yml`'s asar file-mapping). One
   missed spot breaks the build, so this must be done as a single atomic commit, not file-by-file.

---

## 1. Backward-compatibility / data-loss risks (JUDGMENT — read this before touching anything)

| # | Item | Current value | File:Line | Risk if changed naively | Recommendation |
|---|------|----------------|-----------|-------------------------|-----------------|
| 1 | Keychain service name | `APP_ID = 'com.memberjunction.forge'` | `packages/shared/src/constants/index.ts:5` | Every stored DB/SSH credential becomes unreadable — app will prompt users to re-enter every saved password | On first launch after rebrand, attempt `keytar.findCredentials(OLD_SERVICE_NAME)` once; if found, copy the single `credentials-vault` blob to the new service name, then leave the old entry (don't delete, in case rollback is needed). Ship this as its own migration step, tested explicitly, **before** flipping the constant. |
| 2 | electron-builder `appId` | `com.memberjunction.forge` | `electron-builder.yml:1` | Changes macOS `CFBundleIdentifier` and Windows registry app identity. On macOS this can also affect TCC (privacy permission) grants tied to bundle ID, and interacts with #1's entitlement. On an unsigned/non-notarized dev build this is low-risk; for a real signed release, changing appId marks it as a "different app" to the OS. | Decide the new appId now (e.g. `com.forge.app` or Craig's chosen domain) and change appId + entitlements + APP_ID together in one PR, with the keychain migration from #1 included. |
| 3 | electron-builder `productName` | `MJ Forge` | `electron-builder.yml:2` | Determines `app.getPath('userData')` and `app.getPath('logs')` directory name (e.g. `~/Library/Application Support/MJ Forge` on macOS, `%APPDATA%\MJ Forge` on Windows) since no `app.setName()` call overrides it anywhere in `packages/main/src/index.ts`. Renaming silently orphans: `app-state.json`, `query-history.json`, `connections.json`, `query-results.json` / snapshot files (see `packages/main/src/services/config/*.ts`), and the `chat-history` folder used by `chat-service.ts:47`. | Either (a) keep userData pointed at the old directory by explicitly calling `app.setPath('userData', <old-path>)` early in `index.ts` regardless of new productName, or (b) do a one-time startup migration that copies the old userData dir to the new one if the new one doesn't exist yet and the old one does. (a) is simpler and zero-data-loss; (b) is cleaner long-term but needs careful path resolution per-OS. **Decide before renaming productName.** |
| 4 | Keychain Access Group entitlement | `$(AppIdentifierPrefix)com.memberjunction.forge` | `resources/entitlements.mac.plist:19` | Must match the new appId exactly, or a signed/notarized build's keychain-access-groups entitlement won't match what old builds registered, which can break keychain reads specifically for hardened-runtime builds. | Change in the same commit as #2 (appId). |
| 5 | `deleteAppDataOnUninstall` | `false` | `electron-builder.yml:108` | Not a rename risk per se, but confirms Windows uninstall already preserves user data today — worth knowing when reasoning about #3's migration (Windows users' data persists across reinstalls already). | No action; informational. |

---

## 2. Keychain service (packages/main/src/services/keychain)

| File:Line | Current string | Used as | Classification | Notes |
|---|---|---|---|---|
| `packages/main/src/services/keychain/credential-store.ts:13` | `const SERVICE_NAME = APP_ID;` | keytar service name for every `getPassword`/`setPassword`/`findCredentials`/`deletePassword` call (lines 48, 60, 61, 72, 96) | COORDINATED (see risk #1 above) | Not a plain string here — it's imported from `APP_ID`. The actual string lives in shared constants (below). |
| `packages/shared/src/constants/index.ts:5` | `export const APP_ID = 'com.memberjunction.forge';` | Source of truth for the keychain service name (also doubles as the macOS entitlement value, see §1) | COORDINATED — requires migration, not just rename | Recommended replacement: a new reverse-DNS-style id, e.g. `com.forge.app` or `com.craigadam.forge` (Craig's call). |
| `packages/main/src/services/keychain/credential-store.ts:14` | `const CREDENTIALS_KEY = 'credentials-vault';` | Account key inside the keychain entry | No change needed — not branded | — |

**Every** stored credential (DB connection passwords, SSH tunnel private key passphrases, etc.) lives
under one keytar entry: service=`com.memberjunction.forge`, account=`credentials-vault`, storing a
single JSON blob (see `loadAllIntoCache`/`persist` in the same file). This means there is exactly
**one** migration to write, not per-credential logic — copy that one blob to the new service name on
first run.

---

## 3. Config / state persistence (packages/main/src/services/config)

| File | Store `name:` option | Branded? | Classification |
|---|---|---|---|
| `packages/main/src/services/config/app-state.ts:39` | `'app-state'` | No | none |
| `packages/main/src/services/config/query-history.ts:33` | `'query-history'` | No | none |
| `packages/main/src/services/config/connection-profiles.ts:27` | `'connections'` | No | none |
| `packages/main/src/services/config/query-results-store.ts:75` | `'query-results'` (legacy store, being migrated away from — see file comment at line 53, 69) | No | none |
| `packages/main/src/services/config/snapshot-file-store.ts` | file-per-snapshot store, no electron-store `name:` (see comment at line 8) | No | none |
| `packages/main/src/services/ai/chat-service.ts:47` | `path.join(app.getPath('userData'), 'chat-history')` | No (dir name itself is generic) | none, but see risk #3 — lives inside the userData dir that risk #3 covers |

None of these `electron-store` file names contain MJ/MemberJunction branding — they're already
generic. **The only branding risk in this area is indirect**: all of these files live inside
`app.getPath('userData')`, whose *directory name* is derived from `productName` (see §1, risk #3).
No action needed on the store names themselves.

---

## 4. Logger (packages/main/src/utils/logger.ts, packages/main/src/ipc/log.ipc.ts)

| File:Line | Finding | Classification |
|---|---|---|
| `packages/main/src/utils/logger.ts:2` | Doc comment: `"Production-grade logging service for MJ Forge main process."` | MECHANICAL — comment only, no functional impact |
| `packages/main/src/ipc/log.ipc.ts:52` | `const dir = app.getPath('logs');` — OS logs dir, name derived from productName (e.g. `~/Library/Logs/MJ Forge`) | Indirect — covered by risk #3, no code string to change |
| `packages/main/src/ipc/log.ipc.ts:54` | `logFilePath = join(dir, 'forge.log');` | Already generic (`forge.log`) — no change needed |

Logger itself has no hardcoded MJ-branded file names, directory names, or tag prefixes. `createLogger(tag)`
callers pass their own short tags (`'App'`, `'PoolManager'`, `'CredentialStore'`, etc.) — none contain
"MJ".

---

## 5. IPC channel names (packages/shared/src/constants/ipc-channels.ts)

All channel strings use lowercase namespaces (`connection:`, `docker:`, `database:`, `query:`, etc.)
except one group:

| Channel group | Values | File:Line | Classification |
|---|---|---|---|
| `IPC_CHANNELS.MJ` | `mj:detect`, `mj:get-entities`, `mj:get-entity-fields`, `mj:get-applications`, `mj:get-entity-relationships`, `mj:get-record-changes`, `mj:get-audit-logs`, `mj:get-saved-queries`, `mj:get-error-logs`, `mj:get-user-record-logs` | `packages/shared/src/constants/ipc-channels.ts:202-213` | **JUDGMENT — likely NOT a branding target** |

**Why this is a judgment call, not a mechanical rename:** these channels aren't naming *this app* —
they're the bridge for Forge's feature that *detects a connected database built on the third-party
MemberJunction framework* (checks for a `__mj` schema, reads MJ's `Entity`/`EntityField`/`AuditLog`
tables, etc.). "MJ" here means "the actual MemberJunction product the user's database might be
running," which is a real integration, not self-branding. Renaming these channels to remove "MJ"
would make the feature's own IPC surface describe something else (e.g. `entity-framework:` or
`schema-detect:`) and is a product-naming decision, not a mechanical string swap.

**Recommendation:** leave `IPC_CHANNELS.MJ.*` as-is unless Craig wants to rename the *feature*
(distinct from the app rebrand) — flag to the sibling agent covering AI/database MJ-specific logic
for a final call, since this channel group is consumed on both sides of that boundary.

**Full trio for each channel** (handler → preload bridge → the shared constant; there is no separate
renderer caller list in this scan's domain, that's the sibling agent's territory) if a rename is
ever wanted:

| Channel constant | Main handler | Preload bridge |
|---|---|---|
| `MJ.DETECT` | `packages/main/src/ipc/database.ipc.ts:138` | `packages/preload/src/index.ts:874` |
| `MJ.GET_ENTITIES` | `packages/main/src/ipc/database.ipc.ts:151` | `packages/preload/src/index.ts:876` |
| `MJ.GET_ENTITY_FIELDS` | `packages/main/src/ipc/database.ipc.ts:164` | `packages/preload/src/index.ts:879` |
| `MJ.GET_APPLICATIONS` | `packages/main/src/ipc/database.ipc.ts:178` | `packages/preload/src/index.ts:886` |
| `MJ.GET_ENTITY_RELATIONSHIPS` | `packages/main/src/ipc/database.ipc.ts:191` | `packages/preload/src/index.ts:889` |
| `MJ.GET_RECORD_CHANGES` | `packages/main/src/ipc/database.ipc.ts:210` | `packages/preload/src/index.ts:897` |
| `MJ.GET_AUDIT_LOGS` | `packages/main/src/ipc/database.ipc.ts:224` | `packages/preload/src/index.ts:905` |
| `MJ.GET_SAVED_QUERIES` | `packages/main/src/ipc/database.ipc.ts:238` | `packages/preload/src/index.ts:913` |
| `MJ.GET_ERROR_LOGS` | `packages/main/src/ipc/database.ipc.ts:252` | `packages/preload/src/index.ts:921` |
| `MJ.GET_USER_RECORD_LOGS` | `packages/main/src/ipc/database.ipc.ts:266` | `packages/preload/src/index.ts:929` |

No other IPC channel constants (`CONNECTION`, `DOCKER`, `DATABASE`, `EXPLORER`, `QUERY`,
`QUERY_RESULTS`, `AI`, `SERVER_FS`, `BACKUP`, `RESTORE`, `LOG`, `SETTINGS`, `THEME`, `APP`,
`WORKSPACE`, `CHAT_IPC_CHANNELS` in `packages/shared/src/types/chat.types.ts:143-154`) contain "mj" —
verified by full read of `ipc-channels.ts`.

---

## 6. Preload contextBridge global (packages/preload/src/index.ts)

**Already clean — no rebrand work needed here.**

| File:Line | Finding |
|---|---|
| `packages/preload/src/index.ts:92` | `export interface ForgeAPI {` |
| `packages/preload/src/index.ts:574` | `const forgeAPI: ForgeAPI = {` |
| `packages/preload/src/index.ts:994` | `contextBridge.exposeInMainWorld('forge', forgeAPI);` |
| `packages/preload/src/index.ts:997-999` | `declare global { interface Window { forge: ForgeAPI; ... } }` |

The exposed global is `window.forge`, typed as `ForgeAPI` — someone already did this part of the
rebrand. Comments at lines 74, 400, 871 say `// MemberJunction types` / `// MemberJunction
Integration` — these label the section that bridges to the `IPC_CHANNELS.MJ.*` group (§5) and refer
to the real third-party framework, not app branding; no change recommended (same judgment call as §5).

---

## 7. Custom protocol / single-instance lock / AppUserModelId

| Item | Finding | Classification |
|---|---|---|
| Custom protocol / deep-link scheme | **None found.** No `setAsDefaultProtocolClient`, no `protocol.handle`/`protocol.register*`, no `mjforge://` or `forge://` scheme anywhere in `packages/main/src`. | N/A |
| Single-instance lock | `packages/main/src/index.ts:38` — `app.requestSingleInstanceLock()`. Electron scopes this lock by the app's user data path (i.e. by `productName`/`appId`), not by an explicit string. No hardcoded lock name to change. | Indirect — covered by risk #3 |
| Windows App User Model ID | **No explicit `app.setAppUserModelId()` call and no `nsis`/`win` AUMID override in `electron-builder.yml`.** electron-builder defaults the Windows AUMID to `appId` (`com.memberjunction.forge`) when not explicitly set. | COORDINATED with risk #2 (appId) |
| Auto-updater | `electron-builder.yml:111` — `publish: null`. No `electron-updater`, no feed URL, no `autoUpdater` import anywhere in `packages/main/src`. **Nothing to fix here** — there is no auto-updater wired up at all currently. | N/A |
| Crash reporter / telemetry / analytics | **None found.** No `crashReporter`, `sentry`, `amplitude`, `mixpanel`, or telemetry identifiers in `packages/main`, `packages/preload`, `packages/shared`, or `packages/cli`. | N/A |
| User-Agent / HTTP headers | **None found.** No hardcoded `User-Agent` string anywhere in scope (LLM provider calls in `llm-providers.ts` don't set one explicitly — they rely on the HTTP client/fetch defaults). | N/A |

---

## 8. Menu labels, dialogs, About panel (packages/main/src/menu.ts, packages/main/src/window.ts)

| File:Line | Current string | Classification | Recommended replacement |
|---|---|---|---|
| `packages/main/src/menu.ts:15` | `label: app.name` (macOS app menu — shows whatever `app.name` resolves to) | Indirect | No code change; resolves via productName (risk #3) |
| `packages/main/src/menu.ts:394` | `label: 'MJ Forge Documentation'` | MECHANICAL | `'Forge Documentation'` |
| `packages/main/src/menu.ts:396` | `await shell.openExternal('https://github.com/MemberJunction/Forge/wiki');` | JUDGMENT | Depends on whether the GitHub org/repo itself is being renamed/moved. If the repo stays at `github.com/MemberJunction/Forge`, leave the URL as-is (it's accurate) and only change the menu **label** above. If the repo moves, update this URL too. |
| `packages/main/src/menu.ts:409-411` | `label: 'Report Issue...'` → `shell.openExternal('https://github.com/MemberJunction/Forge/issues')` | JUDGMENT | Same call as above — depends on actual repo location post-rebrand. |
| `packages/main/src/menu.ts:430-434` | `label: 'About MemberJunction'` → `shell.openExternal('https://github.com/MemberJunction/MJ')` | JUDGMENT | This is a distinct menu item crediting the upstream MemberJunction *framework* (unrelated to Forge's own identity) — decide whether to keep it (attribution to the framework Forge integrates with), rename it to something like `'About MemberJunction (integration)'` for clarity, or remove it entirely if the rebrand wants zero MJ surface area in the UI. **This is the single most visible "MemberJunction" mention in the entire app UI** — Craig should decide explicitly. |
| `packages/main/src/window.ts:57` | `titleBarStyle: 'hiddenInset'` | Not branding | — |

No `app.setAboutPanelOptions()` call exists anywhere — the macOS About panel uses Electron defaults,
which pull `productName`, `version`, and `copyright` straight from `electron-builder.yml` (already
covered in §1 risks #2/#3, plus `copyright: Copyright © 2026 MemberJunction` at
`electron-builder.yml:3`, MECHANICAL → `Copyright © 2026 <new owner>`).

No dialog titles (`showOpenDialog`/`showSaveDialog`) contain branding — checked
`packages/main/src/ipc/app.ipc.ts`, `query.ipc.ts:127` (`'Export Results'`), `workspace.ipc.ts:55`
(`'Open Folder'`) — all generic.

---

## 9. AI system prompts (packages/main/src/services/ai)

| File:Line | Current string | Classification |
|---|---|---|
| `packages/main/src/services/ai/chat-service.ts:791` | `` `You are Forge AI, a helpful database assistant built into MJ Forge — a multi-database management tool.` `` | MECHANICAL — this is a **live system prompt sent to the LLM** on every chat turn (`buildSystemPrompt`, called at lines 318 and 500). Replace `MJ Forge` → `Forge`. Careful: the string already says "Forge AI" correctly — only the `MJ Forge` substring needs to change, not the whole line. |

Other system prompts in this directory (`ai-service.ts:156` naming assistant, `:193` data analyst,
`:220` SQL-generation prompt) contain **no MJ/MemberJunction branding at all** — verified by direct
read, only the one line above needs a change.

Per the task note: `packages/main/src/services/sql/metadata.ts` (functions `detectMJDatabase`,
`getMJEntities`, `getMJEntityFields`, `getMJApplications`, `getMJEntityRelationships`,
`getMJRecordChanges`, `getMJAuditLogs`, `getMJSavedQueries`, `getMJErrorLogs`,
`getMJUserRecordLogs` — lines 1217-1824) and the corresponding types in
`packages/shared/src/types/database.types.ts` (`MJDatabaseInfo`, `MJEntityInfo`,
`MJEntityFieldInfo`, `MJApplicationInfo`, `MJRecordChange`, `MJAuditLog`, `MJQuery`, `MJErrorLog`,
`MJUserRecordLog`, `MJEntityRelationship` — lines 232-392) are **the actual MemberJunction-database
detection logic** — noted here only as an overlap with the sibling agent's domain, not itemized
further. Same judgment as §5/§6: "MJ" in these names describes the third-party framework being
detected in the user's database, not Forge's own branding.

---

## 10. Type/interface/class names containing "MJ"

| Name | File:Line | Classification |
|---|---|---|
| `MJDatabaseInfo`, `MJEntityInfo`, `MJEntityFieldInfo`, `MJApplicationInfo`, `MJRecordChange`, `MJAuditLog`, `MJQuery`, `MJErrorLog`, `MJUserRecordLog`, `MJEntityRelationship` | `packages/shared/src/types/database.types.ts:232,252,273,296,307,327,344,362,377,392` | JUDGMENT / overlap — see §9 |
| `IPC_CHANNELS.MJ` (namespace, not a type, but same shape) | `packages/shared/src/constants/ipc-channels.ts:202` | JUDGMENT / overlap — see §5 |

No other MJ-prefixed types, interfaces, classes, or enums were found anywhere in
`packages/main`, `packages/preload`, `packages/shared`, `packages/cli` — confirmed via full-repo
grep for `\bMJ[A-Za-z]*\b` restricted to this scan's directories.

---

## 11. Third-party dependency — DO NOT RENAME

| Reference | Where | Why it's not a rebrand target |
|---|---|---|
| `@memberjunction/sqlglot-ts` | `package.json:41` (root dependency), imported in `packages/main/src/services/sql/sql-converter.ts:13-14` | This is a **real, separately-published npm package** under the MemberJunction org, used to spawn a Python FastAPI microservice for SQL dialect transpilation (see comment at `sql-converter.ts:4`). It is not part of this app's branding — renaming/removing this string would break the import and the dialect-conversion feature entirely. Leave untouched. |
| `@memberjunction/global` | Referenced only in attribution comments (not an actual import) — see §12 | Same reasoning; these comments credit code adapted from a real upstream OSS package. |

---

## 12. Attribution comments (low priority, JUDGMENT)

These are comments crediting code that was adapted from real MemberJunction OSS packages. Not
branding of *this* app — a licensing/attribution question, not a mechanical rename.

| File:Line | Comment |
|---|---|
| `packages/main/src/utils/singleton.ts:2` | `Singleton base class adapted from @memberjunction/global` |
| `packages/main/src/utils/json-utils.ts:2` | `JSON utilities adapted from @memberjunction/global` |
| `packages/main/src/utils/object-cache.ts:2` | `Object cache adapted from @memberjunction/global` |
| `packages/main/src/services/sql/provider/database-provider.ts:5` | `Follows the MemberJunction provider pattern:` |
| `packages/main/src/services/sql/dialect/sql-dialect.ts:6` | `a concrete implementation. Follows the MemberJunction pattern:` |

**Recommendation:** keep these as-is. If the code was genuinely adapted from `@memberjunction/global`
(MIT-licensed per that package), removing the attribution comment could be a license-compliance
question worth a quick check, not a branding one — flagging for Craig's awareness rather than
recommending deletion.

---

## 13. Azure Entra ID auth callback page (packages/main/src/services/azure/entra-auth.ts)

| File:Line | Current string | Classification | Replacement |
|---|---|---|---|
| `packages/main/src/services/azure/entra-auth.ts:342` | `<p>You can close this window and return to MJ Forge.</p>` | MECHANICAL | `<p>You can close this window and return to Forge.</p>` |

This is a plain HTML string served by a local HTTP listener during the Entra ID OAuth redirect flow
(`successPage()` at line 334) — visible to the user in their system browser after signing in. Only
this one line contains branding; the page `<title>` (`"Signed in"`) and the failure page
(`failurePage()`, line 340) are already unbranded.

---

## 14. CLI (packages/cli)

| File:Line | Current string | Classification | Replacement |
|---|---|---|---|
| `packages/cli/src/index.ts:15` | `.description('MJ Forge CLI - SQL Server management from the command line')` | MECHANICAL | `.description('Forge CLI - SQL Server management from the command line')` |
| `packages/cli/src/index.ts:30` | ASCII banner: `` ║           ${chalk.bold('MJ Forge CLI')}                    ║ `` | MECHANICAL, but **the box-drawing padding is hand-counted to align the border** — shortening `MJ Forge CLI` (13 chars) to `Forge CLI` (9 chars) will misalign the `║...║` box unless the padding spaces are adjusted too. Needs a manual re-count, not a blind string replace. | `Forge CLI` + recount padding |
| `packages/cli/package.json:2` | `"name": "@mj-forge/cli"` | COORDINATED (part of the `@mj-forge/*` scope rename, §15) | `"@forge/cli"` (or whatever scope is chosen) |
| `packages/cli/package.json:4` | `"description": "Command-line interface for MJ Forge SQL Server management"` | MECHANICAL | `"Command-line interface for Forge SQL Server management"` |
| `packages/cli/package.json:37` | `"author": "MJ Forge"` | JUDGMENT | Decide what "author" should read post-rebrand — Craig's name, a new org name, or just `"Forge"`. Not purely mechanical since it's a policy choice, not just a string swap. |

**Already correctly branded — no change needed:**
- `packages/cli/package.json:6-8` — `"bin": { "forge": "./dist/index.js" }` — binary name is already `forge`.
- `packages/cli/src/index.ts:14` — `program.name('forge')` — command name is already `forge`.

---

## 15. `@mj-forge/*` npm workspace scope — full COORDINATED file list

Every package in the monorepo is scoped `@mj-forge/*`. This is referenced in 122 places across the
files in this scan's domain (main, preload, shared, cli, plus the root build/test config that ties
them together). It is a single atomic rename — **every one of these must change together**, or the
build breaks (TypeScript path resolution, Vitest aliasing, and the asar packaging step in
`electron-builder.yml` all depend on the same string).

### 15a. Package names (5 files)

| File:Line | Current |
|---|---|
| `packages/main/package.json:2` | `"name": "@mj-forge/main"` |
| `packages/preload/package.json:2` | `"name": "@mj-forge/preload"` |
| `packages/shared/package.json:2` | `"name": "@mj-forge/shared"` |
| `packages/cli/package.json:2` | `"name": "@mj-forge/cli"` |
| `packages/renderer/package.json:2` | `"name": "@mj-forge/renderer"` — **out of this scan's domain**, but must move in the same commit since root `package.json` and `tsconfig.json` reference it (see below). Flag to sibling agent. |

### 15b. Cross-package dependency declarations

| File:Line | Current |
|---|---|
| `packages/main/package.json:18` | `"@mj-forge/shared": "*"` |
| `packages/preload/package.json:14` | `"@mj-forge/shared": "*"` |

### 15c. Root `package.json` workspace references

| File:Line | Current |
|---|---|
| `package.json:2` | `"name": "mj-forge"` (root/monorepo name — unscoped, separate decision from the `@mj-forge/*` package scope) |
| `package.json:19` | `"dev:renderer": "npm run start --workspace=@mj-forge/renderer"` |
| `package.json:20` | `"dev:main": "... npm run start --workspace=@mj-forge/main"` |

### 15d. `tsconfig.json` path aliases (root)

| File:Line | Current |
|---|---|
| `tsconfig.json:24` | `"@mj-forge/main": ["packages/main/src/index.ts"]` |
| `tsconfig.json:25` | `"@mj-forge/main/*": ["packages/main/src/*"]` |
| `tsconfig.json:26` | `"@mj-forge/renderer": ["packages/renderer/src/index.ts"]` |
| `tsconfig.json:27` | `"@mj-forge/renderer/*": ["packages/renderer/src/*"]` |
| `tsconfig.json:28` | `"@mj-forge/preload": ["packages/preload/src/index.ts"]` |
| `tsconfig.json:29` | `"@mj-forge/preload/*": ["packages/preload/src/*"]` |
| `tsconfig.json:30` | `"@mj-forge/shared": ["packages/shared/src/index.ts"]` |
| `tsconfig.json:31` | `"@mj-forge/shared/*": ["packages/shared/src/*"]` |

### 15e. Vitest config aliases (root)

| File:Line | Current |
|---|---|
| `vitest.config.ts:60` | `'@mj-forge/shared': new URL('./packages/shared/src', import.meta.url).pathname` |
| `vitest.integration.config.ts:33` | comment: `` `@mj-forge/shared` and `@mj-forge/main` resolve to source so tests `` |
| `vitest.integration.config.ts:40` | `'@mj-forge/shared': new URL(...)` |
| `vitest.integration.config.ts:41` | `'@mj-forge/main': new URL(...)` |

### 15f. `electron-builder.yml` asar package mapping

| File:Line | Current |
|---|---|
| `electron-builder.yml:26` | `to: node_modules/@mj-forge/shared` — this is the packaging step that maps the workspace-linked `packages/shared` into the asar's `node_modules` so the packaged app can resolve `require('@mj-forge/shared')` at runtime. **If the scope changes, this line and every runtime `import from '@mj-forge/shared'` must change together, or packaged (non-dev) builds will fail to resolve the shared package.** |

### 15g. Packaging scripts (comments + one hardcoded path)

| File:Line | Current |
|---|---|
| `scripts/package.js:6` | comment: `... leaving a stale @mj-forge/* copy behind ...` |
| `scripts/prepare-package.js:4` | comment: `... the @mj-forge/* workspace symlinks with real copies ...` |
| `scripts/workspace-links.js:3` | comment: `Workspace-symlink management for @mj-forge/* packages.` |
| `scripts/workspace-links.js:6` | comment: `... replace the node_modules/@mj-forge/<pkg> workspace symlinks ...` |
| `scripts/workspace-links.js:19` | `const DEFAULT_SCOPE_DIR = path.join(ROOT_DIR, 'node_modules', '@mj-forge');` — **live code, not a comment** — this constant drives which `node_modules` subfolder gets swapped from symlink to real copy during packaging. |
| `scripts/workspace-links.js:61` | `` console.log(`Copying ${pkg} to node_modules/@mj-forge/${pkg}`); `` — log message referencing the same path. |
| `scripts/restore-package.js:3` | comment: `Restores the @mj-forge/* workspace symlinks after packaging ...` |

### 15h. Root-level integration test imports (out of package scope but in this scan's domain since they test `packages/main` services directly)

| File:Line | Current |
|---|---|
| `tests/integration/ssh/ssh-tunnel.spec.ts:18` | `import { SshTunnelManager } from '@mj-forge/main/services/ssh/ssh-tunnel-manager';` |
| `tests/integration/ssh/ssh-tunnel.spec.ts:19` | `import type { SshTunnelConfig } from '@mj-forge/shared';` |
| `tests/integration/dialect/dialect-roundtrip.spec.ts:18` | `import { getDialect } from '@mj-forge/main/services/sql/dialect';` |
| `tests/integration/dialect/dialect-roundtrip.spec.ts:19` | `import type { DatabaseEngine } from '@mj-forge/shared';` |
| `tests/integration/database-lifecycle/create-drop-database.spec.ts:32,41-44` | `vi.mock('@mj-forge/main/services/config/connection-profiles', ...)` + 3 more imports |
| `tests/integration/backup/pg-backup-restore.spec.ts:43,53` | `vi.mock('@mj-forge/main/...')` + import |
| `tests/integration/backup/mssql-backup-restore.spec.ts:36,45,46` | `vi.mock(...)` + 2 imports |
| `tests/integration/backup/mysql-backup-restore.spec.ts:40,49` | `vi.mock(...)` + import |

### 15i. Every in-package `import ... from '@mj-forge/shared'` (packages/main, packages/preload)

85 occurrences across 61 files inside `packages/main/src` and `packages/preload/src` (test specs
included). These are 100% mechanical — a single find/replace of `@mj-forge/` → `@<new-scope>/`
across `packages/main/src/**`, `packages/preload/src/**`, `packages/shared/src/**`,
`packages/cli/src/**` handles all of them at once; I'm not enumerating all 85 line numbers
individually here since every one is the identical pattern `from '@mj-forge/shared'` or `from
'@mj-forge/shared';` — the important thing (already captured above) is the *config/build* files that
need matching updates, since those are the ones a naive `sed` across `src/` won't touch.

**Files containing at least one `@mj-forge/` import (for the mechanical sed's `--include` glob or to
verify post-rename with a re-grep):**

`packages/main/src/utils/logger.ts`, `packages/main/src/utils/tsql-builder.ts`,
`packages/main/src/__tests__/setup.ts`, `packages/main/src/ipc/{server-fs,explorer,query-results,chat,theme,app,query,log,docker,connection,settings,workspace,ai,backup,database}.ipc.ts`,
`packages/main/src/services/config/{query-results-store,query-results-store.spec,snapshot-file-store,snapshot-file-store.spec,connection-profiles,query-history,app-state}.ts`,
`packages/main/src/services/docker/{volume-mapper,detector}.ts`,
`packages/main/src/services/ssh/ssh-tunnel-manager.ts`, `.../ssh-tunnel-manager.spec.ts`,
`packages/main/src/services/keychain/credential-store.ts`,
`packages/main/src/services/ai/{tool-registry,ai-service,chat-service,stream-coalescer,stream-coalescer.spec}.ts`,
`packages/main/src/services/sql/{row-cap,row-cap.spec,backup-args,backup-args.spec,backup-restore,server-filesystem,cli-deps,aurora-dsql-pool-options,aurora-dsql-pool-options.spec,connection-pool-categorize.spec,connection-pool,pg-backup,mysql-backup,query-executor,metadata}.ts`,
`packages/main/src/services/sql/provider/{database-provider,pg-provider,mysql-provider}.ts`,
`packages/main/src/services/sql/dialect/{sql-dialect,mssql-dialect,pg-dialect,pg-dsql-dialect,mysql-dialect,index}.ts`,
`packages/preload/src/index.ts`, `packages/shared/src/__tests__/setup.ts`.

---

## 16. Summary count table

| Classification | Count (distinct findings/rows in this report) |
|---|---|
| MECHANICAL | 10 |
| COORDINATED | 6 (keychain migration, appId+entitlements+APP_ID trio, `@mj-forge/*` scope rename [122 locations across 15a-15i], IPC MJ.* trio list [informational, pending §5 judgment], CLI package rename, root workspace rename) |
| JUDGMENT | 8 (userData/productName migration strategy, appId choice, IPC_CHANNELS.MJ rename-or-keep, "About MemberJunction" menu item, GitHub URLs, CLI author field, attribution comments, MJ*-prefixed types) |
| DO NOT TOUCH | 2 (`@memberjunction/sqlglot-ts` dependency, `@memberjunction/global` attribution references) |
| Confirmed already clean / no action | 6 (preload `window.forge` global, CLI binary/command name, log file name, dialog titles, no protocol scheme, no telemetry/auto-updater) |
