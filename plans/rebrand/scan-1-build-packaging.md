# Rebrand Scan 1 — Build, Packaging, Tooling, Package Identity

Scope: root and per-package `package.json` identity, the `@mj-forge/*` npm scope and every import site, `electron-builder.yml`, `resources/` bundle identifiers, `scripts/*`, `.github/workflows/*`, `mj.config.cjs`, `.npmrc`/`.nvmrc`, Docker/compose files, CSS `--mj-*` custom properties, `.gitignore`/`.gitattributes`.

This file is written to be worked from directly — every row has an exact file path, line number, current string, and recommended replacement. No edits were made; this is read-only inventory.

**Assumed target naming** (confirm with Craig before executing — see Judgment Calls at the bottom): npm scope `@mj-forge/*` → `@forge/*`, package name `mj-forge` → `forge`, `productName`/`appId` per Judgment Call #1.

---

## 1. Root and per-package `package.json` identity

| File | Line | Current | Recommended | Class |
|---|---|---|---|---|
| `package.json` | 2 | `"name": "mj-forge"` | `"name": "forge"` | MECHANICAL (but see §2 ripple — changes `app.getName()` at runtime, see Risk #1) |
| `package.json` | 20 | `"dev:renderer": "npm run start --workspace=@mj-forge/renderer"` | `--workspace=@forge/renderer` | COORDINATED (part of scope rename, §2) |
| `package.json` | 21 | `"dev:main": "... --workspace=@mj-forge/main"` | `--workspace=@forge/main` | COORDINATED (part of scope rename, §2) |
| `packages/cli/package.json` | 2 | `"name": "@mj-forge/cli"` | `"name": "@forge/cli"` | COORDINATED (§2) |
| `packages/cli/package.json` | 3 | `"description": "Command-line interface for MJ Forge SQL Server management"` | `"description": "Command-line interface for Forge SQL Server management"` | MECHANICAL |
| `packages/cli/package.json` | 37 | `"author": "MJ Forge"` | `"author": "Forge"` (or Craig's preferred author string) | MECHANICAL — flag for Craig, it's the only `author` field in the whole repo |
| `packages/main/package.json` | 2 | `"name": "@mj-forge/main"` | `"name": "@forge/main"` | COORDINATED (§2) |
| `packages/main/package.json` | 4 | `"description": "Electron main process for MJ Forge"` | `"description": "Electron main process for Forge"` | MECHANICAL |
| `packages/main/package.json` | 12 | `"@mj-forge/shared": "*"` (dependency) | `"@forge/shared": "*"` | COORDINATED (§2) |
| `packages/preload/package.json` | 2 | `"name": "@mj-forge/preload"` | `"name": "@forge/preload"` | COORDINATED (§2) |
| `packages/preload/package.json` | 4 | `"description": "Electron preload scripts for MJ Forge"` | `"description": "Electron preload scripts for Forge"` | MECHANICAL |
| `packages/preload/package.json` | ~9 | `"@mj-forge/shared": "*"` (dependency) | `"@forge/shared": "*"` | COORDINATED (§2) |
| `packages/renderer/package.json` | 2 | `"name": "@mj-forge/renderer"` | `"name": "@forge/renderer"` | COORDINATED (§2) |
| `packages/renderer/package.json` | 4 | `"description": "Angular renderer for MJ Forge"` | `"description": "Angular renderer for Forge"` | MECHANICAL |
| `packages/renderer/package.json` | 28 | `"@memberjunction/ng-markdown": "^3.2.0"` | **do not change** — real third-party npm dependency | JUDGMENT — see Judgment Call #3 |
| `packages/renderer/package.json` | 29 | `"@memberjunction/ng-shared-generic": "^3.2.0"` | **do not change** — real third-party npm dependency | JUDGMENT — see Judgment Call #3 |
| `packages/renderer/package.json` | 30 | `"@mj-forge/shared": "*"` (dependency) | `"@forge/shared": "*"` | COORDINATED (§2) |
| `packages/shared/package.json` | 2 | `"name": "@mj-forge/shared"` | `"name": "@forge/shared"` | COORDINATED (§2) |
| `packages/shared/package.json` | 4 | `"description": "Shared types and constants for MJ Forge"` | `"description": "Shared types and constants for Forge"` | MECHANICAL |
| `package.json` (root) | — | no `author`, `repository`, `homepage`, or `bugs` fields present anywhere in the repo | consider adding them if Craig wants a real npm-identity story | JUDGMENT — nothing to fix, just noting absence |

Root `package.json` dependency `"@memberjunction/sqlglot-ts": "^5.23.0"` (line 58) — same as above, real third-party dependency, **do not change**. See Judgment Call #3.

---

## 2. The `@mj-forge/*` npm scope — every import/reference site

**This is the single biggest ripple in the whole build/packaging domain.** The scope string `@mj-forge` appears in **129 files, 196 occurrences** (excluding `node_modules` and `dist`). Because the string `@mj-forge` is unique and consistent everywhere (no case variants, no partial collisions with unrelated text), this is safe to execute as **one atomic global find/replace**, not a file-by-file manual edit. Recommend classifying the *execution* as COORDINATED (must be done in one pass, then verified with a full build) even though each individual substitution is MECHANICAL.

### Recommended execution recipe for the cheap agent

```bash
# 1. Replace the scope everywhere except package-lock.json (regenerate that instead)
grep -rl '@mj-forge' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.json' . \
  | grep -v node_modules | grep -v '/dist/' | grep -v package-lock.json \
  | xargs sed -i '' 's/@mj-forge/@forge/g'

# 2. Regenerate the lockfile (do NOT hand-edit package-lock.json)
rm -rf node_modules packages/*/node_modules
npm install

# 3. Verify
npm run typecheck && npm run build && npm run test
```

### Full file list (129 files) touched by the scope rename

Config / build files:
- `tsconfig.json` (lines 21–28, the `paths` map — all 8 entries: `@mj-forge/main`, `@mj-forge/main/*`, `@mj-forge/renderer`, `@mj-forge/renderer/*`, `@mj-forge/preload`, `@mj-forge/preload/*`, `@mj-forge/shared`, `@mj-forge/shared/*`)
- `packages/renderer/tsconfig.json` (lines ~19–20, `@mj-forge/shared` and `@mj-forge/shared/*` paths)
- `vitest.config.ts` (line ~57, alias `'@mj-forge/shared'`)
- `vitest.integration.config.ts` (lines ~30–31, aliases `'@mj-forge/shared'` and `'@mj-forge/main'`)
- `electron-builder.yml` (lines ~28–30: `to: node_modules/@mj-forge/shared` mapping — **must be updated in lockstep with the scope rename or packaging silently ships a broken/missing shared package**)
- `scripts/workspace-links.js` (lines 3, 6, 19, 61 — `DEFAULT_SCOPE_DIR`, comments, log message)
- `scripts/package.js` (line 6, comment)
- `scripts/prepare-package.js` (line 4, comment)
- `scripts/restore-package.js` (line 3, comment)
- `package-lock.json` (15 occurrences — regenerate via `npm install`, do not hand-edit)

Source files (all under `packages/main/src`, `packages/preload/src`, `packages/renderer/src`, `packages/shared/src`, plus `tests/integration/**`) — full list:

```
packages/main/src/__tests__/setup.ts
packages/main/src/ipc/ai.ipc.ts
packages/main/src/ipc/app.ipc.ts
packages/main/src/ipc/backup.ipc.ts
packages/main/src/ipc/chat.ipc.ts
packages/main/src/ipc/connection.ipc.ts
packages/main/src/ipc/database.ipc.ts
packages/main/src/ipc/docker.ipc.ts
packages/main/src/ipc/explorer.ipc.ts
packages/main/src/ipc/log.ipc.ts
packages/main/src/ipc/query-results.ipc.ts
packages/main/src/ipc/query.ipc.ts
packages/main/src/ipc/server-fs.ipc.ts
packages/main/src/ipc/settings.ipc.ts
packages/main/src/ipc/theme.ipc.ts
packages/main/src/ipc/workspace.ipc.ts
packages/main/src/services/ai/ai-service.ts
packages/main/src/services/ai/chat-service.ts
packages/main/src/services/ai/stream-coalescer.spec.ts
packages/main/src/services/ai/stream-coalescer.ts
packages/main/src/services/ai/tool-registry.ts
packages/main/src/services/config/app-state.ts
packages/main/src/services/config/connection-profiles.ts
packages/main/src/services/config/query-history.ts
packages/main/src/services/config/query-results-store.spec.ts
packages/main/src/services/config/query-results-store.ts
packages/main/src/services/config/snapshot-file-store.spec.ts
packages/main/src/services/config/snapshot-file-store.ts
packages/main/src/services/docker/detector.ts
packages/main/src/services/docker/volume-mapper.ts
packages/main/src/services/keychain/credential-store.ts
packages/main/src/services/sql/aurora-dsql-pool-options.spec.ts
packages/main/src/services/sql/aurora-dsql-pool-options.ts
packages/main/src/services/sql/backup-args.spec.ts
packages/main/src/services/sql/backup-args.ts
packages/main/src/services/sql/backup-restore.ts
packages/main/src/services/sql/cli-deps.ts
packages/main/src/services/sql/connection-pool-categorize.spec.ts
packages/main/src/services/sql/connection-pool.ts
packages/main/src/services/sql/dialect/index.ts
packages/main/src/services/sql/dialect/mssql-dialect.ts
packages/main/src/services/sql/dialect/mysql-dialect.ts
packages/main/src/services/sql/dialect/pg-dialect.ts
packages/main/src/services/sql/dialect/pg-dsql-dialect.ts
packages/main/src/services/sql/dialect/sql-dialect.ts
packages/main/src/services/sql/metadata.ts
packages/main/src/services/sql/mysql-backup.ts
packages/main/src/services/sql/pg-backup.ts
packages/main/src/services/sql/provider/database-provider.ts
packages/main/src/services/sql/provider/mysql-provider.ts
packages/main/src/services/sql/provider/pg-provider.ts
packages/main/src/services/sql/query-executor.ts
packages/main/src/services/sql/row-cap.spec.ts
packages/main/src/services/sql/row-cap.ts
packages/main/src/services/sql/server-filesystem.ts
packages/main/src/services/ssh/ssh-tunnel-manager.spec.ts
packages/main/src/services/ssh/ssh-tunnel-manager.ts
packages/main/src/utils/logger.ts
packages/main/src/utils/tsql-builder.ts
packages/preload/src/index.ts
packages/renderer/src/app/core/services/erd-adapter.service.ts
packages/renderer/src/app/core/services/golden-layout-manager.service.ts
packages/renderer/src/app/core/services/ipc.service.ts
packages/renderer/src/app/core/services/log.service.ts
packages/renderer/src/app/core/services/query-history.service.ts
packages/renderer/src/app/core/services/settings.service.ts
packages/renderer/src/app/core/services/sql-intellisense.service.ts
packages/renderer/src/app/core/services/table-properties.service.ts
packages/renderer/src/app/core/services/theme.service.ts
packages/renderer/src/app/core/state/ai.state.ts
packages/renderer/src/app/core/state/capabilities.state.spec.ts
packages/renderer/src/app/core/state/capabilities.state.ts
packages/renderer/src/app/core/state/chat-instance.state.ts
packages/renderer/src/app/core/state/chat.state.ts
packages/renderer/src/app/core/state/connection.state.spec.ts
packages/renderer/src/app/core/state/connection.state.ts
packages/renderer/src/app/core/state/explorer-folders.spec.ts
packages/renderer/src/app/core/state/explorer-folders.ts
packages/renderer/src/app/core/state/explorer.state.ts
packages/renderer/src/app/core/state/query-history.state.ts
packages/renderer/src/app/core/state/query-results.state.ts
packages/renderer/src/app/core/state/tab.state.ts
packages/renderer/src/app/features/backup/backup.component.ts
packages/renderer/src/app/features/chat/chat-panel.component.ts
packages/renderer/src/app/features/connections/connections.component.ts
packages/renderer/src/app/features/erd/erd.component.ts
packages/renderer/src/app/features/explorer/explorer.component.ts
packages/renderer/src/app/features/query/query.component.ts
packages/renderer/src/app/features/restore/restore.component.ts
packages/renderer/src/app/features/welcome/welcome.component.ts
packages/renderer/src/app/layout/golden-layout-container/golden-layout-container.component.ts
packages/renderer/src/app/layout/output-panel/output-panel.component.ts
packages/renderer/src/app/layout/sidebar/sidebar.component.ts
packages/renderer/src/app/layout/status-bar/status-bar.component.ts
packages/renderer/src/app/shared/components/ai-analysis-panel/ai-analysis-panel.component.ts
packages/renderer/src/app/shared/components/backup-dialog/backup-dialog.component.ts
packages/renderer/src/app/shared/components/connection-context-chip/connection-context-chip.component.ts
packages/renderer/src/app/shared/components/connection-dialog/connection-dialog.component.ts
packages/renderer/src/app/shared/components/create-database-dialog/create-database-dialog.component.ts
packages/renderer/src/app/shared/components/docker-panel/docker-panel.component.ts
packages/renderer/src/app/shared/components/execution-plan/execution-plan.component.ts
packages/renderer/src/app/shared/components/fk-link/fk-link.component.ts
packages/renderer/src/app/shared/components/missing-cli-tools/missing-cli-tools.component.ts
packages/renderer/src/app/shared/components/object-search/object-search.component.ts
packages/renderer/src/app/shared/components/password-hygiene-warning/password-hygiene-warning.component.ts
packages/renderer/src/app/shared/components/query-history-dialog/query-history-dialog.component.ts
packages/renderer/src/app/shared/components/restore-dialog/restore-dialog.component.ts
packages/renderer/src/app/shared/components/result-diff-viewer/result-diff-viewer.component.ts
packages/renderer/src/app/shared/components/result-history-panel/result-history-panel.component.ts
packages/renderer/src/app/shared/components/results-grid/results-grid.component.ts
packages/renderer/src/app/shared/components/row-detail-panel/row-detail-panel.component.ts
packages/renderer/src/app/shared/components/server-file-browser/server-file-browser.component.ts
packages/renderer/src/app/shared/components/settings-panel/settings-panel.component.ts
packages/renderer/src/app/shared/components/table-properties-panel/table-properties-container.component.ts
packages/renderer/src/app/shared/components/table-properties-panel/table-properties-panel.component.ts
packages/renderer/src/app/shared/components/test-result-panel/test-result-panel.component.ts
packages/renderer/src/app/shared/components/workspace-panel/workspace-panel.component.ts
packages/shared/src/__tests__/setup.ts
tests/integration/backup/mssql-backup-restore.spec.ts
tests/integration/backup/mysql-backup-restore.spec.ts
tests/integration/backup/pg-backup-restore.spec.ts
tests/integration/database-lifecycle/create-drop-database.spec.ts
tests/integration/dialect/dialect-roundtrip.spec.ts
tests/integration/ssh/ssh-tunnel.spec.ts
```

**Note on `packages/cli`**: `packages/cli/package.json` name is `@mj-forge/cli` but nothing in `packages/cli/src` imports `@mj-forge/*` (it's a standalone package with its own `mssql` dependency, not wired into the turbo/workspace dependency graph the same way). Confirm during execution that `packages/cli` is even still active — it duplicates functionality now in `packages/main`/`packages/renderer` and may be dead code from an earlier prototype (worth asking Craig, but that's a product decision, not a rebrand one).

---

## 3. `electron-builder.yml` — packaging identity

| Line | Current | Recommended | Class |
|---|---|---|---|
| 1 | `appId: com.memberjunction.forge` | e.g. `com.forge.app` or Craig's chosen reverse-DNS id | JUDGMENT — see Judgment Call #1, HIGH RISK |
| 2 | `productName: MJ Forge` | `Forge` | MECHANICAL, but ripples into `dmg.artifactName`, `nsis.artifactName` templates (both use `${productName}`, no literal string to fix — they update automatically) and README download-link text |
| 3 | `copyright: Copyright © 2026 MemberJunction` | `Copyright © 2026 <Craig's name or new entity>` | JUDGMENT — needs Craig's actual copyright holder name |
| 30 (`from`/`to` mapping) | `to: node_modules/@mj-forge/shared` | `to: node_modules/@forge/shared` | COORDINATED — part of §2 scope rename, must match `scripts/workspace-links.js` |

`dmg.artifactName: "${productName}-${version}-${arch}.dmg"` (line ~81) and `nsis.artifactName: "${productName}-${version}-${arch}-setup.exe"` (line ~101) both interpolate `productName` — no manual edit needed here, they'll automatically read "Forge" once line 2 changes. Flag for verification only.

---

## 4. `resources/` — bundle identifiers and assets

| File | Finding | Recommended | Class |
|---|---|---|---|
| `resources/entitlements.mac.plist` line 19 | `<string>$(AppIdentifierPrefix)com.memberjunction.forge</string>` (keychain-access-groups) | Must match new `appId` exactly | COORDINATED — tied to `electron-builder.yml` appId (§3) and `APP_ID` constant (§5). **All three must change together or the packaged app cannot access its own keychain entitlement group.** |
| `resources/icon.png`, `resources/icon.icns` | Filenames are generic (`icon.*`), no MemberJunction/mj branding in the filenames or found in binary strings via a text grep | No action needed on filenames | — |
| No `Info.plist` found in the repo | electron-builder generates `Info.plist` at package time from `electron-builder.yml` fields (`appId`, `productName`, `copyright`, `extendInfo`) — there is no static Info.plist template to edit | N/A | — |

---

## 5. `APP_ID` constant — cross-cutting keychain identity

This is the most consequential single string in the whole domain.

| File | Line | Current | Notes |
|---|---|---|---|
| `packages/shared/src/constants/index.ts` | 5 | `export const APP_ID = 'com.memberjunction.forge';` | Source of truth |
| `packages/main/src/services/keychain/credential-store.ts` | 7, 13 | `import { APP_ID } from '@mj-forge/shared'; ... const SERVICE_NAME = APP_ID;` | `SERVICE_NAME` is passed to every `keytar.getPassword`/`setPassword`/`findCredentials`/`deletePassword` call (lines 48, 60, 72, 96) |

**Class: JUDGMENT — RISK #1 (highest risk finding in this scan).**

`APP_ID` is used as the macOS Keychain **service name** under which every user's stored database credentials live (`keytar.setPassword(SERVICE_NAME, ...)`). It must stay byte-identical to the `keychain-access-groups` entry in `resources/entitlements.mac.plist` and to `electron-builder.yml`'s `appId`, because macOS ties keychain-access-group entitlements to the code-signed appId.

If Craig changes `com.memberjunction.forge` → a new appId anywhere in this triangle without changing it everywhere:
- The packaged app will fail code-signing verification against its own entitlements (mismatched keychain-access-group), **or**
- Even if it packages fine, `keytar.getPassword(newServiceName, ...)` will silently return nothing for existing installs — every user with saved connection credentials loses them and must re-enter passwords. There's no automatic migration in `credential-store.ts` today (it does have "legacy" credential lookup/cleanup logic at line 60, but that's for a different legacy format, not a service-name migration).

**Recommendation**: If Craig wants to change the appId as part of the rebrand, `credential-store.ts` needs an explicit one-time migration step (read old `com.memberjunction.forge` service name, copy to new service name, delete old) rather than a silent cutover. This is implementation work, not a find/replace — flagging for Craig's decision on whether it's in scope for this rebrand pass or deferred.

---

## 6. `mj.config.cjs` — vestigial MemberJunction CodeGen config

**Class: JUDGMENT.**

```
module.exports = {
  codeGenLogin: 'sa',
  codeGenPassword: '<REDACTED — plaintext sa password, see security note below>',
  codeGenHost: 'localhost',
  codeGenPort: 1433,
  codeGenDatabase: 'MJ_5_14_0',
  trustServerCertificate: true,
  encrypt: false,
};
```

- **Nothing in the repo reads this file.** Grepped for `mj.config`, `codeGenLogin`, `codeGenPassword`, `codeGenHost`, `codeGenDatabase` across `.ts`/`.js`/`.json`/`.md` — zero hits outside the file itself.
- It matches the config shape used by MemberJunction's own `CodeGen` CLI tool (a separate MJ ecosystem tool Forge doesn't appear to invoke anywhere in `package.json` scripts or CI).
- It is **checked into git** (not in `.gitignore`) and **contains a plaintext SQL Server `sa` password** — this looks like leftover scaffolding from when this repo was generated from/alongside a MemberJunction codegen workflow.
- **Recommendation**: delete the file as part of the rebrand (it's pure MemberJunction-tooling residue with no wiring into Forge). Separately — **and out of scope for a pure rebrand** — Craig may want to consider whether that password was ever a real credential and, if so, whether git history needs scrubbing. Flagging this as a security aside, not asking you to act on it here.

---

## 7. Scripts (`scripts/*.js`) — comments and log strings

All four files reference the `@mj-forge` scope only in **comments and console.log strings**, not logic. Once §2's find/replace runs, these are covered automatically since they contain the literal string `@mj-forge`. No separate action needed beyond §2. Confirmed clean of any other MemberJunction-specific logic (they operate on `WORKSPACE_PACKAGES = ['shared']`, a directory name, unaffected by the scope rename).

---

## 8. `.github/workflows/*` — CI/release pipelines

**Clean.** Reviewed `ci.yml` and `build-release.yml` in full — neither references `mj-forge`, `mj_forge`, `memberjunction`, or `MJ` anywhere. Artifact glob patterns (`release/*.dmg`, `release/*.zip`, `release/*.exe`, `release/*.blockmap`) are extension-based, not name-based, so they need no changes regardless of `productName`. No action needed in this domain.

---

## 9. `tests/docker-compose.test.yml` — container/network/volume names

**Clean.** Already uses `forge-test-*` container names (`forge-test-mssql`, `forge-test-postgres`, `forge-test-mysql`, `forge-test-postgres-private`, `forge-test-bastion`), `name: forge-test` compose project name, and generic `testnet`/`bastionnet` networks. Header comment says "MJ Forge regression test infrastructure" (line 1) — cosmetic only.

| File | Line | Current | Recommended | Class |
|---|---|---|---|---|
| `tests/docker-compose.test.yml` | 1 | `# MJ Forge regression test infrastructure.` | `# Forge regression test infrastructure.` | MECHANICAL |

---

## 10. CSS/SCSS `--mj-*` custom properties or `.mj-` class names

**Clean — zero hits.** Searched all `.scss`/`.css` files for `--mj-` and `.mj-` patterns; none found. Forge's stylesheets do not use an `mj` prefix anywhere. No action needed.

---

## 11. `.gitignore` / `.gitattributes`

**Clean.** `.gitignore` has no `mj`-specific entries (all patterns are generic: `node_modules/`, `dist/`, `release/`, `*.dmg`, etc.). `.gitattributes` doesn't exist in the repo. No action needed.

---

## 12. `tsconfig.json` / `turbo.json` / `angular.json` / vitest / playwright configs — non-scope findings

- `turbo.json` — clean, no naming references at all.
- `packages/renderer/angular.json` — project key is `"renderer"`, not `"mj-forge"` or similar; already clean.
- `vitest.config.ts` line 4 comment: `* Vitest Configuration — MJ Forge` and line 6 `* Follows the MemberJunction monorepo testing pattern:` — cosmetic comments.
- `playwright.config.ts` — clean, references only "Forge regression harness" already.
- Per-package `tsconfig.json` files (`packages/cli`, `packages/main`, `packages/preload`, `packages/renderer`, `packages/shared`) — no mj/MemberJunction strings besides the `paths` entries already covered in §2.

| File | Line | Current | Recommended | Class |
|---|---|---|---|---|
| `vitest.config.ts` | 4 | `* Vitest Configuration — MJ Forge` | `* Vitest Configuration — Forge` | MECHANICAL |
| `vitest.config.ts` | 6 | `* Follows the MemberJunction monorepo testing pattern:` | Keep or reword — this is an attribution comment about *pattern inspiration*, not a Forge identity string | JUDGMENT (trivial) — recommend keeping as historical attribution, or delete if "ALL MemberJunction references removed" is meant literally |

---

## 13. `.npmrc` / `.nvmrc` / `.changeset/config.json` / `.syncpackrc.json` / `.eslintrc.json` / `.prettierrc.json` / `.husky/pre-commit`

**All clean.** No `mj`/MemberJunction references found in any of these. `.nvmrc` just contains `20`. `.changeset/config.json` has no `name`/scope fields. No action needed.

---

## 14. `.claude/` tooling — skill and command descriptions (cosmetic, not shipped to end users)

These affect Craig's own Claude Code tooling for this repo, not the shipped app, but they do say "MJ Forge" / "MemberJunction" and would be inconsistent post-rebrand.

| File | Line | Current | Recommended | Class |
|---|---|---|---|---|
| `.claude/commands/test-ui.md` | 1 | `Run the Playwright UI regression test suite against the MJ Forge Electron app.` | `...against the Forge Electron app.` | MECHANICAL |
| `.claude/commands/publish-build.md` | 1 | `Build, tag, and publish a new release of MJ Forge to GitHub...` | `...of Forge to GitHub...` | MECHANICAL |
| `.claude/commands/publish-build.md` | 53, 54, 60, 65, 71, 87 | Multiple `gh run list --repo MemberJunction/Forge`, `gh release view ... --repo MemberJunction/Forge`, wiki URL `github.com/MemberJunction/Forge/wiki`, screenshot URL pattern `raw.githubusercontent.com/MemberJunction/Forge/v{PREVIOUS}/...` | Update `--repo` flags and URLs to Craig's actual GitHub org/repo once the repo itself is moved/renamed | JUDGMENT — **this depends entirely on whether the actual GitHub repository is being renamed/transferred out of the `MemberJunction` org.** If the repo stays at `github.com/MemberJunction/Forge` (Craig's fork lives there), these are *correct* and should not change. If Craig transfers/forks to a new org, every `--repo` reference and raw-content URL here needs updating. Flag for Craig. |
| `.claude/commands/publish-build.md` | 95 | ``scripts/prepare-package.js` replaces the `@mj-forge/shared` symlink...` | `@forge/shared` | COORDINATED (part of §2) |
| `.claude/skills/forge-regression-harness/SKILL.md` | 3, 6 | `Use the MJ Forge regression test harness...` / `# MJ Forge Regression Harness` | `Forge regression test harness` / `# Forge Regression Harness` | MECHANICAL |
| `.claude/skills/electron/SKILL.md` | 3, 8, 12 | `...for MJ Forge — IPC handlers...` / `working on MJ Forge, a native macOS...` / `MJ Forge structure:` | `Forge` throughout | MECHANICAL |

---

## 15. Out-of-domain findings worth flagging to the other scan(s)

Not in my domain (build/packaging) but discovered incidentally and worth handing to whichever scan owns docs/UI/product content:

- `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/SQL-CONVERSION-STUDY.md`, `plans/*.md`, `tests/regression-suite.md` — extensive "MJ Forge" / "MemberJunction" branding, GitHub badge URLs pointing at `github.com/MemberJunction/Forge`, and a "Built by MemberJunction" credit block in README. README also references `resources/logo.png` for the header image — **that file does not exist in `resources/`** (only `icon.png`/`icon.icns` do), so the README image link is already broken independent of the rebrand.
- Product-facing "MemberJunction database awareness" feature (detects `__mj` schema, shows "MemberJunction (N entities)" tooltips, an "About MemberJunction" menu item in `packages/main/src/menu.ts` line 431, welcome-screen "by MemberJunction" credit in `packages/renderer/src/app/features/welcome/welcome.component.ts` line 231, sidebar icons/tooltips in `sidebar.component.ts` lines 288-289) — this is a real *feature* (detecting when a connected database has the MemberJunction framework installed), not incidental branding. Removing all "MemberJunction" strings here is a product decision (does Forge keep MJ-database-detection as a feature under a generic name, or drop it?), not a mechanical rename. Flagging for Craig / the content-domain scan.
- `packages/main/src/menu.ts` lines 396, 411 and `welcome.component.ts` line 687, 692 — `shell.openExternal('https://github.com/MemberJunction/Forge/wiki')` etc. — same GitHub-org dependency as item §14's publish-build.md judgment call.

---

## Summary tables

### By classification

| Classification | Count of distinct findings (rows above) |
|---|---|
| MECHANICAL | 16 |
| COORDINATED | 9 (mostly the single §2 scope rename, which spans 129 files) |
| JUDGMENT | 8 |

### Judgment calls needing Craig's decision

1. **New `appId`/`productName`/`copyright` for `electron-builder.yml`** — what should replace `com.memberjunction.forge` / `MJ Forge` / `Copyright © 2026 MemberJunction`? This cascades into `resources/entitlements.mac.plist` and `packages/shared/src/constants/index.ts`'s `APP_ID` and must be decided before any of those three files are touched.
2. **Keychain migration** — if `APP_ID` changes, does Craig want a one-time migration in `credential-store.ts` to carry forward existing users' saved credentials, or is silent credential loss acceptable (e.g. because there are no real installs yet)?
3. **`@memberjunction/*` npm dependencies** (`sqlglot-ts`, `ng-markdown`, `ng-shared-generic`) — these are real, functional third-party packages Forge depends on for SQL dialect conversion and Angular UI components (CLAUDE.md itself mandates using `ng-markdown`). "All MemberJunction references removed" can't mechanically apply here without replacing their functionality. Recommend treating these as out of scope for a rebrand (they're supply-chain deps, not Craig's branding) unless Craig wants to fork/replace them.
4. **GitHub org/repo location** — do `--repo MemberJunction/Forge` references in `.claude/commands/publish-build.md` and `shell.openExternal` calls in `menu.ts`/`welcome.component.ts` change? Only if the actual git repository moves out of the `MemberJunction` GitHub org.
5. **`mj.config.cjs` deletion** — confirm it's safe to delete (nothing references it) and whether the embedded plaintext `sa` password warrants a separate git-history conversation.
