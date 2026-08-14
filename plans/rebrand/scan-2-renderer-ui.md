# Scan 2 — Renderer / Angular UI Rebrand Inventory

Domain: `packages/renderer` (Angular renderer) — everything a user can see, plus any persistence keys/selectors/assets that live there. Read-only scan, no edits made.

Scope note up front: this codebase has **two unrelated uses of "MJ"/"MemberJunction"** that must not be conflated:

1. **App branding** — the product name "MJ Forge" / the phrase "by MemberJunction" (this fork's origin). This is what the rebrand targets.
2. **A real product feature** — Forge can connect to a database that has the separate **MemberJunction application framework** installed in it (a `__mj` schema with entities, applications, audit logs, etc.). Forge detects this and shows badges/menu items for it. This is a genuine third-party concept unrelated to Forge's own name, and renaming it would be **factually wrong**, not just a style choice. Every finding below is tagged `[BRAND]` or `[MJ-FRAMEWORK — DO NOT RENAME]` accordingly.

---

## Summary counts

| Classification | Count |
|---|---|
| MECHANICAL | 9 |
| COORDINATED | 4 groups (settings key, ctrl-e key, placeholder key, `@mj-forge/*` package scope — 65+ import sites) |
| JUDGMENT | 6 |
| OUT OF SCOPE (flagged, do not touch) | 3 groups (MJ-framework feature naming, third-party `mj-*` component selectors, `@memberjunction/*` npm deps) |

No manifest.json/webmanifest exists in the renderer. No meta tags beyond viewport/charset in `index.html`. No copyright/license strings found anywhere in the renderer UI. No `.mj-` CSS custom properties (`--mj-*`) exist. Angular component selector prefix is already `app-` (`angular.json` line with `"prefix": "app"`) — none of Forge's own components use an `mj-` selector.

---

## A. Display copy — "MJ Forge" → "Forge" `[BRAND]` — MECHANICAL

Plain, unambiguous replacements. "MJ Forge" → "Forge" reads correctly as English in every one of these; no awkward phrasing.

| File | Line | Current string | Replacement |
|---|---|---|---|
| `packages/renderer/package.json` | 4 | `"description": "Angular renderer for MJ Forge"` | `"description": "Angular renderer for Forge"` |
| `packages/renderer/src/index.html` | 5 | `<title>MJ Forge</title>` | `<title>Forge</title>` |
| `packages/renderer/src/app/app.component.ts` | 83 | `readonly loadingMessage = signal('Starting MJ Forge...');` | `signal('Starting Forge...')` |
| `packages/renderer/src/app/layout/sidebar/sidebar.component.ts` | 67 | `<img class="app-icon" src="assets/icons/mj-logo.png" alt="MJ Forge" />` | keep `<img>`, change `alt="MJ Forge"` → `alt="Forge"` — but see **Section D**, this `<img>`'s `src` is the higher-risk part |
| `packages/renderer/src/app/layout/status-bar/status-bar.component.ts` | 195 | `<span>MJ Forge {{ appVersion() ? 'v' + appVersion() : '' }}</span>` | `<span>Forge {{ appVersion() ? 'v' + appVersion() : '' }}</span>` |
| `packages/renderer/src/app/features/welcome/welcome.component.ts` | 29 | `<h1>MJ Forge</h1>` | `<h1>Forge</h1>` |
| `packages/renderer/src/app/features/welcome/welcome.component.ts` | 94 | `<p>Learn the basics of MJ Forge</p>` | `<p>Learn the basics of Forge</p>` |
| `packages/renderer/src/app/features/welcome/welcome.component.ts` | 198 | `MJ Forge speaks SQL Server, PostgreSQL, and MySQL. Make sure your server is` | `Forge speaks SQL Server, PostgreSQL, and MySQL. Make sure your server is` |
| `packages/renderer/src/app/features/welcome/welcome.component.ts` | 208 | `Running databases in Docker is the easiest way to develop locally. MJ Forge` (continues `detects SQL Server, PostgreSQL, and MySQL containers automatically.` on line 209) | `... locally. Forge detects SQL Server, PostgreSQL, and MySQL containers automatically.` |
| `packages/renderer/src/app/shared/components/erd-diagram/erd-diagram.component.css` | 3 | `* Uses MJ Forge CSS variables for theming` (comment) | `* Uses Forge CSS variables for theming` |
| `packages/renderer/src/app/shared/components/command-palette/command-palette.component.ts` | 632 | `label: 'About MJ Forge',` | `label: 'About Forge',` |

**Caveat on the "About Forge" command palette entry**: this command dispatches `window.dispatchEvent(new CustomEvent('forge:show-about'))` (line 637) but **there is no listener anywhere in the renderer for `forge:show-about`** — no About dialog component exists in this codebase at all (confirmed: only `forge:show-shortcuts` has a registered listener, in `shortcuts-dialog.component.ts:241`). This command is currently dead — clicking it does nothing. Flag for Craig: either build the About dialog as part of this rebrand (good place to put the new name/logo/version/license) or remove the dead command-palette entry. Not a rename issue, but adjacent and worth deciding now since you're already touching this string.

---

## B. "by MemberJunction" attribution copy `[BRAND]` — JUDGMENT

| File | Line | Current string |
|---|---|---|
| `packages/renderer/src/app/features/welcome/welcome.component.ts` | 227–231 | Welcome-screen footer: `<p>Built with <mat-icon inline>favorite</mat-icon> by MemberJunction</p>` |

**Options:**
1. Remove the attribution line entirely (clean break from MemberJunction branding).
2. Replace with a generic "Built with ❤️" (drop "by MemberJunction").
3. Keep an attribution but change wording to something like "Forked from MemberJunction Forge" if the license/goodwill relationship requires crediting upstream.

**Recommendation**: since the goal is "ALL MemberJunction references removed," go with option 1 or 2 unless there's a license obligation to credit upstream (check the repo's LICENSE file — outside this scan's domain, flag to Craig). This is a judgment call because it may have licensing/attribution implications beyond pure branding.

---

## C. Persistence keys (localStorage) — COORDINATED, migration required

These are **identifiers**, not display copy. Renaming the string value silently orphans existing users' saved state (their settings, confirmed dialogs, placeholder values) because `localStorage.getItem(NEW_KEY)` will return `null` on first launch after the rebrand, even though the old data is still sitting under the old key.

| File | Line | Constant | Current key string | Used for |
|---|---|---|---|---|
| `packages/renderer/src/app/core/services/settings.service.ts` | 5 | `STORAGE_KEY` | `'mj-forge-settings'` | All persisted user app settings (theme, etc.) — read at `settings.service.ts:131`, written at `:151` |
| `packages/renderer/src/app/features/query/query.component.ts` | 1538 | `CTRL_E_CONFIRMED_KEY` | `'mj-forge-ctrl-e-execute-confirmed'` | Whether the user dismissed the Ctrl+E "execute" confirmation warning — read at `:1546`, written at `:1607` |
| `packages/renderer/src/app/features/query/query.component.ts` | 1539 | `PLACEHOLDER_VALUES_KEY` | `'mj-forge-flyway-placeholder-values'` | Remembered Flyway placeholder substitution values per user — read at `:1647`, written at `:1656` |

**Already-clean keys (no `mj` prefix, no change needed)**, listed here only so the executor doesn't accidentally "fix" them and break a different naming scheme:
- `'forge:welcomeDismissed'` — `packages/renderer/src/app/core/state/tab.state.ts:32,117,465`
- `'forge:completed-tours'` — `packages/renderer/src/app/core/services/onboarding.service.ts:28`
- `'forge-snippets'` — `packages/renderer/src/app/shared/components/snippet-library/snippet-library.component.ts:27`

**Recommended migration approach** (do not just swap the string):
1. Pick the new key name, e.g. `'forge-settings'`, `'forge-ctrl-e-execute-confirmed'`, `'forge-flyway-placeholder-values'` (drop `mj-`, keep everything else — matches the existing `forge-snippets`/`forge:*` convention already in the codebase).
2. On first read under the new key, if it's missing, fall back to reading the old `mj-forge-*` key, migrate its value forward under the new key, and (optionally) delete the old key. This is a few extra lines per site — write it once as a tiny shared helper (e.g. `readWithMigration(oldKey, newKey)`) rather than three copy-pasted migration blocks.
3. Without this, every existing installed user silently loses their saved settings/confirmations/placeholder values on upgrade. Low stakes for placeholder values and the Ctrl+E confirmation (mildly annoying, re-prompts once), **higher stakes for `mj-forge-settings`** — that's the user's theme preference and other app settings.

---

## D. Asset: `mj-logo.png` — dual purpose, needs splitting `[BRAND + MJ-FRAMEWORK conflict]` — JUDGMENT (high priority)

`packages/renderer/src/assets/icons/mj-logo.png` is **the single physical asset file used for two semantically different things**:

| File | Line | Usage | Meaning |
|---|---|---|---|
| `packages/renderer/src/app/layout/sidebar/sidebar.component.ts` | 67 | `<img class="app-icon" src="assets/icons/mj-logo.png" alt="MJ Forge" />` | **The app's own logo/icon**, shown in the sidebar header next to the text "Forge" (line 68: `<span class="logo">Forge</span>`) — this is Forge's own branding and should become the new Forge logo. |
| `packages/renderer/src/app/layout/sidebar/sidebar.component.ts` | 284–290 | `@if (node.mjInfo?.isMJEnabled) { <img class="mj-icon" src="assets/icons/mj-logo.png" alt="MemberJunction" matTooltip="MemberJunction ({{ node.mjInfo.entityCount }} entities)" /> }` | A small **badge icon shown next to a database tree node when that database has the MemberJunction framework installed** — this is legitimate, accurate, and must keep referencing MemberJunction (see Section H). |

**Problem**: if you simply drop in a new "Forge" logo at `mj-logo.png`, the MJ-framework badge (which is *supposed* to say "this database has MemberJunction installed") will now incorrectly show Forge's own logo instead of a MemberJunction mark — actively misleading.

**Recommendation**: split into two files before touching either usage:
1. `assets/icons/logo.png` (or `forge-logo.png`) — new Forge app icon, wired into sidebar.component.ts:67.
2. Keep a separate, small `assets/icons/memberjunction-badge.png` (or similar, could reuse the current file under a new name) wired into sidebar.component.ts:287, `alt="MemberJunction"` unchanged.

This is a two-file, two-line-reference COORDINATED change once the split is decided; the design decision itself (what the new logo looks like, whether to keep a MemberJunction badge visual at all vs. switch to a generic "installed framework" icon) is a JUDGMENT call for Craig.

The CSS class `.mj-icon` (`sidebar.component.ts:602`) styles the *badge* usage only (14×14px, opacity 0.9, hover effect) — this class name is tied to "this is the MJ badge," not to Forge branding, so leave it as-is (or rename to `.mj-framework-badge` for clarity, optional/cosmetic).

---

## E. Package scope `@mj-forge/*` — COORDINATED, cross-package (65 import sites in renderer alone)

`packages/renderer/package.json` line 4 declares `"name": "@mj-forge/renderer"`, and depends on `"@mj-forge/shared": "*"` (line ~30). The renderer imports types/values from `@mj-forge/shared` in **65 places across 61 files**. This mirrors the same `@mj-forge/*` scope used by `packages/main`, `packages/preload`, and the root `tsconfig.json` path aliases (`/Users/cadam/code/forge/tsconfig.json:24-31`) — **this is a monorepo-wide package-scope rename, not renderer-specific**, so coordinate with whichever scan covers `packages/main`/`packages/preload`/root config before executing. Renderer's part of the change is mechanical (`@mj-forge/` → `@forge/` or whatever scope is chosen) but must land atomically with:
- `packages/shared/package.json` `"name"` field
- `packages/main/package.json`, `packages/preload/package.json` dependency declarations
- Root `tsconfig.json` paths (`@mj-forge/main`, `@mj-forge/renderer`, `@mj-forge/preload`, `@mj-forge/shared` and their `/*` variants)
- `packages/renderer/tsconfig.json` paths block (`@mj-forge/shared` → `../shared/src/index.ts`, line 26-27)
- Every `npm`/`package-lock.json` reference to the old scope

**Full list of renderer files importing `@mj-forge/shared`** (file : line : import statement):

```
src/app/core/services/erd-adapter.service.ts:2:import type { ForeignKeyInfo } from '@mj-forge/shared';
src/app/core/services/golden-layout-manager.service.ts:3:import type { LayoutConfig, LayoutNode } from '@mj-forge/shared';
src/app/core/services/ipc.service.ts:87:} from '@mj-forge/shared';
src/app/core/services/log.service.ts:3:import type { LogEntry, LogLevel } from '@mj-forge/shared';
src/app/core/services/query-history.service.ts:15:import type { QueryHistoryEntry } from '@mj-forge/shared';
src/app/core/services/settings.service.ts:2:import type { AppSettings, ThemePreference } from '@mj-forge/shared';
src/app/core/services/settings.service.ts:3:import { DEFAULT_SETTINGS } from '@mj-forge/shared';
src/app/core/services/sql-intellisense.service.ts:5:import type { ObjectMetadata, ColumnInfo } from '@mj-forge/shared';
src/app/core/services/table-properties.service.ts:7:import type { TableProperties } from '@mj-forge/shared';
src/app/core/services/theme.service.ts:3:import type { ThemePreference } from '@mj-forge/shared';
src/app/core/state/ai.state.ts:17:} from '@mj-forge/shared';
src/app/core/state/ai.state.ts:18:import { DEFAULT_AI_SETTINGS } from '@mj-forge/shared';
src/app/core/state/capabilities.state.spec.ts:2:import { FULL_CAPABILITIES } from '@mj-forge/shared';
src/app/core/state/capabilities.state.ts:10:import { FULL_CAPABILITIES } from '@mj-forge/shared';
src/app/core/state/capabilities.state.ts:11:import type { EngineCapabilities, EngineVariant } from '@mj-forge/shared';
src/app/core/state/chat-instance.state.ts:9:import type { ChatMessage, ChatStreamChunk, Conversation, ToolCallResult } from '@mj-forge/shared';
src/app/core/state/chat.state.ts:14:} from '@mj-forge/shared';
src/app/core/state/connection.state.spec.ts:41:} from '@mj-forge/shared';
src/app/core/state/connection.state.spec.ts:42:import { FULL_CAPABILITIES } from '@mj-forge/shared';
src/app/core/state/connection.state.ts:3:import { FULL_CAPABILITIES } from '@mj-forge/shared';
src/app/core/state/connection.state.ts:9:} from '@mj-forge/shared';
src/app/core/state/explorer-folders.spec.ts:2:import { FULL_CAPABILITIES } from '@mj-forge/shared';
src/app/core/state/explorer-folders.ts:8:import type { EngineCapabilities } from '@mj-forge/shared';
src/app/core/state/explorer.state.ts:11:} from '@mj-forge/shared';
src/app/core/state/query-history.state.ts:8:import type { QueryHistoryEntry, QueryHistoryFilter } from '@mj-forge/shared';
src/app/core/state/query-results.state.ts:12:} from '@mj-forge/shared';
src/app/core/state/tab.state.ts:5:import type { TabState } from '@mj-forge/shared';
src/app/features/backup/backup.component.ts:18:import type { BackupProgress, BackupType, BackupRequest } from '@mj-forge/shared';
src/app/features/chat/chat-panel.component.ts:32:import type { ToolCallResult } from '@mj-forge/shared';
src/app/features/connections/connections.component.ts:21:import type { ConnectionProfile, AuthenticationType, TestConnectionResult } from '@mj-forge/shared';
src/app/features/erd/erd.component.ts:15:import type { MJEntityInfo } from '@mj-forge/shared';
src/app/features/explorer/explorer.component.ts:13:import type { ColumnInfo, IndexInfo } from '@mj-forge/shared';
src/app/features/query/query.component.ts:1009:  planEngine = signal<import('@mj-forge/shared').DatabaseEngine>('mssql');
src/app/features/query/query.component.ts:56:} from '@mj-forge/shared';
src/app/features/restore/restore.component.ts:19:import type { RestoreProgress, RestoreRequest } from '@mj-forge/shared';
src/app/features/welcome/welcome.component.ts:18:import type { DockerStatus, DockerContainer } from '@mj-forge/shared';
src/app/layout/golden-layout-container/golden-layout-container.component.ts:34:import type { LayoutConfig } from '@mj-forge/shared';
src/app/layout/output-panel/output-panel.component.ts:14:import type { LogEntry } from '@mj-forge/shared';
src/app/layout/sidebar/sidebar.component.ts:45:import type { DatabaseEngine } from '@mj-forge/shared';
src/app/layout/status-bar/status-bar.component.ts:17:import type { DockerStatus, DockerContainer } from '@mj-forge/shared';
src/app/shared/components/ai-analysis-panel/ai-analysis-panel.component.ts:24:import type { ResultSet } from '@mj-forge/shared';
src/app/shared/components/backup-dialog/backup-dialog.component.ts:40:} from '@mj-forge/shared';
src/app/shared/components/connection-context-chip/connection-context-chip.component.ts:16:import type { DatabaseEngine } from '@mj-forge/shared';
src/app/shared/components/connection-dialog/connection-dialog.component.ts:22:import { isDsqlEndpoint } from '@mj-forge/shared';
src/app/shared/components/connection-dialog/connection-dialog.component.ts:31:} from '@mj-forge/shared';
src/app/shared/components/create-database-dialog/create-database-dialog.component.ts:19:import type { RecoveryModel } from '@mj-forge/shared';
src/app/shared/components/docker-panel/docker-panel.component.ts:13:import type { DockerStatus, DockerContainer } from '@mj-forge/shared';
src/app/shared/components/execution-plan/execution-plan.component.ts:14:import type { DatabaseEngine } from '@mj-forge/shared';
src/app/shared/components/fk-link/fk-link.component.ts:19:import type { ColumnMetadata, FkRecordRequest } from '@mj-forge/shared';
src/app/shared/components/missing-cli-tools/missing-cli-tools.component.ts:20:import type { CliInstallInstructions, CliInstallStep, CliToolStatus } from '@mj-forge/shared';
src/app/shared/components/missing-cli-tools/missing-cli-tools.component.ts:7: * steps sourced from `@mj-forge/shared`'s `getCliInstallInstructions`,  (comment, not an import)
src/app/shared/components/object-search/object-search.component.ts:19:import type { ObjectMetadata } from '@mj-forge/shared';
src/app/shared/components/password-hygiene-warning/password-hygiene-warning.component.ts:13:import { describePasswordHygiene } from '@mj-forge/shared';
src/app/shared/components/query-history-dialog/query-history-dialog.component.ts:30:import type { QueryHistoryEntry } from '@mj-forge/shared';
src/app/shared/components/restore-dialog/restore-dialog.component.ts:41:} from '@mj-forge/shared';
src/app/shared/components/result-diff-viewer/result-diff-viewer.component.ts:8:import type { ResultDiff, RowDiff } from '@mj-forge/shared';
src/app/shared/components/result-history-panel/result-history-panel.component.ts:21:import type { QueryResultSnapshot, ResultDiff } from '@mj-forge/shared';
src/app/shared/components/results-grid/results-grid.component.ts:35:import type { ResultSet, ColumnMetadata } from '@mj-forge/shared';
src/app/shared/components/row-detail-panel/row-detail-panel.component.ts:16:import type { ColumnMetadata, FkRecordRequest } from '@mj-forge/shared';
src/app/shared/components/server-file-browser/server-file-browser.component.ts:18:import type { ServerDrive, ServerFileEntry } from '@mj-forge/shared';
src/app/shared/components/settings-panel/settings-panel.component.ts:15:import type { ThemePreference } from '@mj-forge/shared';
src/app/shared/components/table-properties-panel/table-properties-container.component.ts:15:import type { ColumnInfo, ExtendedProperty } from '@mj-forge/shared';
src/app/shared/components/table-properties-panel/table-properties-panel.component.ts:17:import type { TableProperties, ColumnInfo, ExtendedProperty } from '@mj-forge/shared';
src/app/shared/components/test-result-panel/test-result-panel.component.ts:11:import type { TestConnectionResult } from '@mj-forge/shared';
src/app/shared/components/workspace-panel/workspace-panel.component.ts:12:import type { FileTreeNode, WorkspaceInfo } from '@mj-forge/shared';
```

Note: `MJEntityInfo` (imported in `erd.component.ts:15`) is a **type name**, not a package-scope string — see Section H, do not rename it, it names an entity from the MJ framework detection feature.

Once the new scope is chosen, this is a mechanical global find/replace of the literal string `@mj-forge/` across all matched files — but it must be executed in the same commit/PR as the `packages/shared`, `packages/main`, `packages/preload`, and root `tsconfig.json` changes, or the build breaks. `packages/renderer/tsconfig.json` (lines 26-27) also needs its own `@mj-forge/shared` path alias updated.

---

## F. External URLs — JUDGMENT (depends on where the rebranded repo actually lives)

| File | Line | Current URL | Notes |
|---|---|---|---|
| `packages/renderer/src/app/features/welcome/welcome.component.ts` | 687 | `this.ipc.openExternal('https://github.com/MemberJunction/Forge/wiki').subscribe();` | "Documentation" link in welcome-screen footer |
| `packages/renderer/src/app/features/welcome/welcome.component.ts` | 692 | `this.ipc.openExternal('https://github.com/MemberJunction/Forge').subscribe();` | "GitHub" link in welcome-screen footer |

**Decision needed from Craig**: does the rebranded fork live at a new GitHub org/repo (e.g. `github.com/<your-org>/forge`), or does it stay hosted under `MemberJunction/Forge` (this repo's current `origin`, per the git status header) even after the in-app rebrand? If a new repo/org is created, update both URLs and the wiki link target; if not, these URLs are technically still correct even post-rebrand and should be left alone (a "Report an issue" / "Documentation" link pointing at the actual repo isn't a MemberJunction-branding statement, it's just where the code lives). No mechanical fix possible until this is decided.

---

## G. Copyright / license strings

None found. Searched all `.ts`/`.html` in the renderer for `copyright`, `©`, `(c) 20`, "all rights reserved" (case-insensitive) — zero matches. If a license notice is desired in an About dialog (see Section A's dead-command note), that's new content to author, not a rename.

---

## H. `[MJ-FRAMEWORK — DO NOT RENAME]` — MemberJunction-the-framework detection feature

This is the single biggest thing to get right in this rebrand: a large fraction of "MJ" occurrences in the renderer are **not** about Forge's own name. They describe Forge's ability to detect and browse a separate thing — the MemberJunction application framework — when it happens to be installed inside a connected database (a `__mj` schema containing entities, applications, saved queries, audit logs, error logs, change history, user record logs). Forge is a generic SQL IDE; MemberJunction is a metadata-driven app framework that some customers' databases happen to have installed. Renaming any of this would make Forge lie to the user about what it detected.

Representative locations (not exhaustive — this concept threads through `explorer.state.ts`, `ipc.service.ts`, `sidebar.component.ts`, `erd.component.ts`):

| File | Line(s) | Content | Verdict |
|---|---|---|---|
| `src/app/core/state/explorer.state.ts` | 37, 120, 339, 367, 415, 428, 642, 651, 691, 756, 787, 817 | Comments/logic: "MJ-specific node types," "__mj schema," "MJ detection," "MJ Change History, Audit Logs, Error Logs" | Keep — describes real schema/feature detection |
| `src/app/core/services/ipc.service.ts` | 75, 1007-1125 | Section header "MemberJunction Detection Methods"; methods `detectMJDatabase`, `getMJEntities`, `getMJEntityFields`, `getMJApplications`, `getMJEntityRelationships`, `getMJRecordChanges`, `getMJAuditLogs`, `getMJSavedQueries`, `getMJErrorLogs`, `getMJUserRecordLogs` | Keep — these are the actual method names calling into main-process code that queries a customer's `__mj` schema |
| `src/app/layout/sidebar/sidebar.component.ts` | 288-289 | `alt="MemberJunction"`, `matTooltip="MemberJunction ({{ node.mjInfo.entityCount }} entities)"` | Keep |
| `src/app/layout/sidebar/sidebar.component.ts` | 1394, 1423 | Context-menu labels `'View Change History (MJ)'`, `'View Audit Log (MJ)'` | Keep as-is, or optionally expand `(MJ)` → `(MemberJunction)` for clarity — **cosmetic judgment call only**, not a rebrand requirement |
| `src/app/layout/sidebar/sidebar.component.ts` | 1401, 1430 | SQL comment: `-- Note: Requires MemberJunction to be installed in this database` | Keep — literally true, describes a prerequisite unrelated to Forge's name |
| `src/app/features/erd/erd.component.ts` | 88-145, 595-803 | "MJ Entity badge," `MJEntityInfo` type usage, "MJ not installed in this database — that's fine" | Keep |

**Recommendation to Craig**: explicitly carve this feature area out of the rebrand ticket/PR description so a reviewer doesn't flag "why does this PR that removes MemberJunction branding still say MemberJunction everywhere in the explorer/ERD code" — it's intentional and correct.

---

## I. `[MJ-FRAMEWORK — DO NOT RENAME]` — Third-party Angular component selectors

Forge's own components all use the `app-` selector prefix (`angular.json` → `"prefix": "app"`), confirmed empty search for any Forge-owned `mj-*` component/directive/pipe selector. However, the renderer **consumes** two real npm packages published by MemberJunction that export `mj-`-prefixed component selectors — these are external library API surface and cannot be renamed without forking the library:

| File | Line | Usage | Package |
|---|---|---|---|
| `src/app/app.component.ts` | 38 | `<mj-loading [text]="loadingMessage()" size="large" animation="pulse"></mj-loading>` | `@memberjunction/ng-shared-generic` |
| `src/app/shared/components/ai-analysis-panel/ai-analysis-panel.component.ts` | 126 | `<mj-loading ...>` | `@memberjunction/ng-shared-generic` |
| `src/app/shared/components/result-history-panel/result-history-panel.component.ts` | 180 | `<mj-loading ...>` | `@memberjunction/ng-shared-generic` |
| `src/app/features/chat/chat-panel.component.ts` | 241, 253 | `<mj-markdown ...>` (×2) | `@memberjunction/ng-markdown` |

Corresponding real npm dependencies, both legitimate third-party packages (not to be touched):
- `packages/renderer/package.json:28` — `"@memberjunction/ng-markdown": "^3.2.0"`
- `packages/renderer/package.json:29` — `"@memberjunction/ng-shared-generic": "^3.2.0"`

Import sites for these modules: `app.component.ts:6`, `chat-panel.component.ts:23`, `ai-analysis-panel.component.ts:22`, `result-history-panel.component.ts:20` (all `import { ... } from '@memberjunction/ng-...'`).

**Verdict**: out of scope entirely. These stay as-is unless/until Craig decides to replace the dependency itself (e.g. swap `ng-markdown` for `@memberjunction/ng-markdown`'s underlying approach, roll your own markdown renderer via a different library) — that would be a JUDGMENT call about a functional dependency swap, not a rename, and is a much bigger undertaking (CLAUDE.md mandates `@memberjunction/ng-markdown` specifically for AI-generated markdown — removing it would need sign-off since it's an explicit project rule, not incidental branding).

---

## J. Things checked and found clean (no action needed)

| Area | Result |
|---|---|
| `index.html` meta tags / manifest / webmanifest | Only `<title>` (Section A) and standard `viewport`/`charset` meta + `favicon.ico` link — no branding in meta tags, no manifest file exists in renderer |
| `document.title` assignments | None found anywhere in renderer — title is static in `index.html` only |
| CSS custom properties `--mj-*` | None exist anywhere in `src/styles.scss` or any component `styles` block — Forge already uses `--bg-primary`, `--accent-primary`, etc. with no `mj` prefix |
| Angular component selector prefix | `angular.json` prefix is `"app"`; zero Forge-owned components use an `mj-` selector |
| Angular route paths (`app.routes.ts`) | `''`, `connections`, `explorer`, `query`, `backup`, `restore`, `erd`, `**` — none contain `mj` |
| Copyright/license strings in UI | None found |
| `.mj-` CSS classes | Only two, both tied to the MJ-framework badge feature (Section D/H): `.mj-icon` (`sidebar.component.ts:602`), `.mj-entity-badge` (`erd.component.ts:319`) — leave as-is, they style the legitimate MJ-detection UI, not app branding |
| Assets directory (`src/assets/icons/`) | Two files total: `database-cylinder.svg` (generic, no branding) and `mj-logo.png` (Section D) |
| Favicon | `src/favicon.ico`, referenced from `index.html:8` — binary file, visually inspect and replace with new Forge mark; filename itself (`favicon.ico`) contains no branding string so no rename needed, just a new image |

---

## Top-line risks for Craig to decide before an executor touches this

1. **`mj-logo.png` is used for two different things** (Forge's own app icon AND the "this DB has MemberJunction installed" badge) — Section D. Needs two separate asset files and a decision on what the MJ-framework badge should look like once it's no longer sharing Forge's logo.
2. **`mj-forge-settings` localStorage key** holds real user data (theme, settings) — a naive rename orphans every existing user's settings on upgrade. Needs a migration shim, not a straight find/replace — Section C.
3. **`@mj-forge/*` package scope** touches 65 import sites in the renderer alone, plus root `tsconfig.json` and three other packages' `package.json` — this must be a single coordinated cross-package change, not something the renderer can do in isolation — Section E.
4. **Don't let a global "MJ" → "Forge" find/replace run loose** — the majority of "MJ" occurrences in this codebase (explorer state, IPC service, sidebar context menus, ERD badges) refer to the *separate* MemberJunction application framework a customer's database might have installed, and are correct as written — Section H. A careless regex pass here would break real functionality/copy accuracy, not just "over-rebrand."
5. **GitHub URLs and the welcome-screen "Built with... by MemberJunction" attribution** depend on decisions outside this scan's domain (where the repo will actually live; any licensing obligation to credit upstream) — Sections B and F.
