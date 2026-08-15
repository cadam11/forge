# Forge Rebrand — Execution Plan

**Goal:** the product is named **Forge** (never "MJ Forge"), and the repo contains no MemberJunction
branding, no MemberJunction-specific product code, and no `@memberjunction/*` dependencies.

**Audience:** this document is written for *executor agents*. Every task below is scoped so it can be
done without re-running discovery. Line-level inventory lives in the sibling scan files; this file is
the order of operations, the decisions, and the verification gates.

| Scan file | Domain |
|---|---|
| `scan-1-build-packaging.md` | build, packaging, npm scope, electron-builder, scripts |
| `scan-2-renderer-ui.md` | Angular renderer — user-visible copy, storage keys, assets |
| `scan-3-main-shared.md` | main / preload / shared / cli — identity, keychain, menus, IPC |
| `scan-4-mj-database-features.md` | the `__mj` MemberJunction feature slice (deletion targets) |
| `scan-5-docs-tests-tooling.md` | README, docs, plans, tests, `.claude/` |
| `scan-6-dependency-replacement.md` | replacing the three `@memberjunction/*` npm packages |

---

## Decisions (settled — do not re-litigate)

| # | Decision | Value |
|---|---|---|
| D1 | MemberJunction `__mj` database feature | **Delete entirely.** All six sub-features, all 10 IPC channels, all 11 shared types. |
| D2 | App identity / user data | **Clean break, no migration.** Existing saved credentials, connection profiles, and query history are abandoned. |
| D3 | `@memberjunction/*` npm dependencies | **Replace all three in this pass.** See Phase 6. |
| D4 | Upstream attribution | **One README credit only.** Remove the in-app Help-menu item and the welcome-screen footer line. |
| D5 | npm workspace scope | `@mj-forge/*` → **`@forgedb/*`** |
| D6 | Test fixture `__mj` schema | **Rename, don't delete** — it is the only e2e coverage of non-`public` schema queries and a two-table JOIN. |
| D7 | `plans/**` historical docs | **Leave as history.** Add one disclaimer file; do not rewrite dated engineering logs. |

### Naming constants (single source of truth for executors)

| Thing | Old | New |
|---|---|---|
| Product name | `MJ Forge` | `Forge` |
| Root package name | `mj-forge` | `forge` |
| npm scope | `@mj-forge/` | `@forgedb/` |
| Bundle / app id | `com.memberjunction.forge` | `ca.adam11.forge` |
| Copyright line | `Copyright © 2026 MemberJunction` | `Copyright © 2026 Craig Adam` |
| GitHub repo | `github.com/MemberJunction/Forge` | `github.com/cadam11/forge` |
| macOS userData dir | `~/Library/Application Support/MJ Forge` | `~/Library/Application Support/Forge` |

> `ca.adam11.forge` is the reverse-DNS form of Craig's `adam11.ca` domain — confirmed, not assumed.
> The copyright holder is still assumed to be "Craig Adam"; it appears only in `electron-builder.yml:3`
> and the new LICENSE (T7.2) and is trivial to swap before execution starts.

---

## Do NOT touch

Executors must leave these alone. They are correct as-is, or they belong to a different decision.

1. **`plans/**` (except a new `plans/README.md`)** — dated engineering logs. Rewriting them to say
   "Forge" makes them retroactively false. 9,863 lines across 11 files; leave every one.
2. **`plans/rebrand/*.md`** — these scan files and this plan.
3. **Already-correct names** — `window.forge` / `ForgeAPI` in preload, the `forge` CLI binary and
   command name, `forge.log`, `forge-test-*` docker container names, `POSTGRES_USER: forge`,
   `forge:welcomeDismissed` / `forge:completed-tours` / `forge-snippets` localStorage keys,
   `.github/workflows/*` (they use `${{ github.repository }}`, no hardcoded org).
4. **`packages/main/src/services/config/*` electron-store names** (`app-state`, `query-history`,
   `connections`, `query-results`) — already generic.
5. **`resources/icon.png` / `icon.icns` filenames** — generic; the *image* may be replaced but the
   filenames need no rename.

---

## Phase 0 — Prep

**T0.1** Create the working branch off `main`:
```bash
git checkout -b refactor/forge-rebrand
```
**T0.2** Capture a green baseline so later failures are attributable:
```bash
npm run typecheck && npm run test && npm run build
```
Record the result. If anything is already red on `main`, note it — do not try to fix it as part of
this work, and do not let it mask a regression later.

**Gate:** baseline recorded.

---

## Phase 1 — Delete the MemberJunction database feature

Do this **first**. It removes ~1,150 lines that would otherwise need rebranding, and it deletes the
only place where "MJ" legitimately means MemberJunction-the-framework rather than the old product name.
Once this phase lands, *every* remaining "MJ"/"MemberJunction" string in `packages/` is branding and can
be treated mechanically.

Full line-level detail: `scan-4-mj-database-features.md`. Zero tests break — there is no test coverage
of any of this code.

Execute in this order (1.1–1.3 are independently mergeable; 1.4 and 1.5 must go together):

**T1.1 — Table context-menu items (highest user impact; live defect today).**
Delete `packages/renderer/src/app/layout/sidebar/sidebar.component.ts:1391-1448` — the divider plus
`View Change History (MJ)` and `View Audit Log (MJ)`. These appear on *every* table on *every* engine
with no gate and emit `SELECT TOP` / `[bracket]` T-SQL, which is invalid on PostgreSQL and MySQL.

**T1.2 — ERD enrichment.**
In `packages/renderer/src/app/features/erd/erd.component.ts` remove: the `MJEntityInfo` import (`:15`),
the `mjEntity` field on `NodePanelInfo` (`:19`), the badge template (`:88-94`), the two action buttons
(`:105-116`), the "MJ Entity Details" section (`:142-…`), the `.mj-entity-badge` CSS (`:319-…`), the
cache fields (`:595-596`), the unconditional `loadMJEntities()` call (`:670-671`), `findMJEntity`
(`:684-685`), `viewChangeHistory`/`viewAuditLog` (`:739-790`), and the loader/cache block (`:795-820`).
`onNodeSelected` becomes synchronous again — a small simplification, keep it.

**T1.3 — Sidebar badge.**
Delete `sidebar.component.ts:284-291` (the `<img class="mj-icon">` block) and the `.mj-icon` CSS at
`:602`. **Leave `assets/icons/mj-logo.png` in place** — Phase 5 owns that asset.

**T1.4 — Explorer tree + folder context menus.**
- `packages/renderer/src/app/core/state/explorer.state.ts`: remove the 9 `mj_*` members of the
  `NodeType` union (`:36-46`), `TreeNode.mjInfo` (`:68-69`), the icon entries (`:120-129`), the
  `__mj` branch in the folder dispatcher (`:367-370`), the `loadChildren` cases (`:415-436`), the
  detection block (`:642-668` — collapse to a plain `schemas.map`), and `getMJSchemaFolders` plus the
  three loaders (`:690-843`).
- `packages/renderer/src/app/features/explorer/explorer.component.ts`: remove `mj_entity` / `mj_query` /
  `mj_application` from `:362`, `:374`, `:435-437`.
- `sidebar.component.ts`: remove `:872-890` (node-open handlers), `:1061-1071` (context-menu dispatch
  cases), and `:1771-1985` (five MJ context-menu builders).

After this, the `__mj` schema still appears in the explorer and expands normally through the standard
capability-aware folder system — a strictly better outcome than today's hand-rolled list.

**T1.5 — Main process, IPC, and types.**
- `packages/main/src/services/sql/metadata.ts`: delete `:1209-1827` (all ten `getMJ*`/`detectMJDatabase`
  methods plus the private `queryMJ` helper) and the MJ type imports at `:22-31`.
- `packages/main/src/ipc/database.ipc.ts`: delete `:133-277` and the imports at `:14-23`.
- `packages/shared/src/constants/ipc-channels.ts`: delete the `MJ` channel group at `:201-213`.
- `packages/preload/src/index.ts`: delete the types at `:400-459`, the implementation at `:871-937`,
  and the MJ type import at `:74`.
- `packages/renderer/src/app/core/services/ipc.service.ts`: delete `:1006-1126` and the MJ type
  imports at `~:75`.
- `packages/shared/src/types/database.types.ts`: delete the 11 interfaces at `:227-404`.

**Gate:**
```bash
npm run typecheck && npm run test
git grep -In "__mj\|MJEntity\|MJDatabase\|detectMJ\|getMJ\|mj_entity\|mj_query" -- packages/
```
The grep must return **nothing** in `packages/`. TypeScript will catch any reference missed above,
since every MJ type flows from a single `@mj-forge/shared` export site.

---

## Phase 2 — Delete `mj.config.cjs`

**T2.1** `git rm mj.config.cjs`. Nothing in the repo reads it — it is MemberJunction CodeGen residue.

> 🔴 **Security, separate from the rebrand:** this tracked file contains a plaintext SQL Server `sa`
> password and points at an `MJ_5_14_0` database. Deleting the file does **not** remove it from git
> history. Treat the credential as leaked and rotate it independently of this work. Do not attempt a
> history rewrite as part of the rebrand.

---

## Phase 3 — npm scope rename `@mj-forge/*` → `@forgedb/*`

Purely mechanical, but **atomic** — a partial rename breaks the build. ~196 occurrences across 129
files before Phase 1; fewer after.

**T3.1** Replace the scope everywhere except the lockfile:
```bash
grep -rl '@mj-forge' --include='*.ts' --include='*.js' --include='*.mjs' \
     --include='*.json' --include='*.yml' --include='*.md' . \
  | grep -v node_modules | grep -v '/dist/' | grep -v package-lock.json \
  | xargs sed -i '' 's|@mj-forge|@forgedb|g'
```

**T3.2** Confirm these specific files were caught — they are the ones a naive `src/`-only sweep misses:
- `tsconfig.json:24-31` (8 path aliases)
- `packages/renderer/tsconfig.json:26-27`
- `vitest.config.ts:60`, `vitest.integration.config.ts:33,40,41`
- `electron-builder.yml:26` (`to: node_modules/@mj-forge/shared` — the asar mapping; if this is
  missed, packaged builds fail to resolve the shared package at runtime)
- `scripts/workspace-links.js:19` (`DEFAULT_SCOPE_DIR` — **live code**, not a comment) and `:61`
- `package.json:19,20` (`--workspace=` flags)
- 5 × `packages/*/package.json` `name` fields, 2 × `"@mj-forge/shared": "*"` dependency declarations
- 8 root-level integration specs under `tests/integration/**`

**T3.3** Rename the root package: `package.json:2` → `"name": "forge"`.

**T3.4** Regenerate the lockfile — never hand-edit it:
```bash
rm -rf node_modules packages/*/node_modules && npm install
```

**Gate:**
```bash
git grep -In "@mj-forge" ; npm run typecheck && npm run build && npm run test
```
The grep must return nothing.

---

## Phase 4 — App identity (clean break)

These four values must change **in one commit**. Per D2 there is no migration: existing installs lose
saved credentials and app state. That is accepted.

**T4.1** `electron-builder.yml`:
- `:1` `appId: com.memberjunction.forge` → `appId: ca.adam11.forge`
- `:2` `productName: MJ Forge` → `productName: Forge`
- `:3` `copyright: Copyright © 2026 MemberJunction` → `copyright: Copyright © 2026 Craig Adam`

**T4.2** `resources/entitlements.mac.plist:19` — keychain-access-group must match the new appId byte
for byte: `$(AppIdentifierPrefix)ca.adam11.forge`.

**T4.3** `packages/shared/src/constants/index.ts:5` — `APP_ID = 'ca.adam11.forge'`. This constant is the
keytar service name (`credential-store.ts:13`), so it is what actually abandons the old credentials.

**Consequences to expect and not treat as bugs:** the DMG/EXE artifact names change automatically
(`${productName}` interpolation, no manual edit needed); `app.getPath('userData')` and
`app.getPath('logs')` move to `Forge`; the Windows AUMID follows `appId`. There is no auto-updater
(`publish: null`), no protocol scheme, and no telemetry, so nothing else keys off these values.

**Gate:** `npm run build`, then confirm `git grep -In "com.memberjunction"` returns nothing.

---

## Phase 5 — User-facing strings and assets

All mechanical unless noted. Detail in `scan-2-renderer-ui.md` §A and `scan-3-main-shared.md` §8/§13/§14.

**T5.1 — Renderer copy.** `"MJ Forge"` → `"Forge"` in: `index.html:5` (`<title>`),
`app.component.ts:83` (loading message), `status-bar.component.ts:195`, `welcome.component.ts:29,94,198,208`,
`command-palette.component.ts:632`, `sidebar.component.ts:67` (`alt=`),
`erd-diagram.component.css:3` (comment), `packages/renderer/package.json:4`.

**T5.2 — Main / CLI copy.** `menu.ts:394` (`'MJ Forge Documentation'` → `'Forge Documentation'`),
`chat-service.ts:791` (**live LLM system prompt** — change only the `MJ Forge` substring; the string
already correctly says "Forge AI"), `entra-auth.ts:342` (OAuth success page),
`logger.ts:2`, `cli/src/index.ts:15`, and the four remaining `packages/*/package.json` descriptions
plus `cli/package.json:37` (`"author": "Forge"`).

**T5.3 — CLI ASCII banner.** `packages/cli/src/index.ts:30` — the box-drawing border padding is
hand-counted. `MJ Forge CLI` (13 chars) → `Forge CLI` (9 chars) needs **4 extra spaces added** to keep
`║…║` aligned. Verify visually by running the CLI; do not blind-replace.

**T5.4 — Remove upstream attribution from the app (D4).**
- `packages/main/src/menu.ts:430-434` — delete the entire `'About MemberJunction'` menu item.
- `packages/renderer/src/app/features/welcome/welcome.component.ts:227-231` — delete the
  `Built with ❤️ by MemberJunction` footer line.

**T5.5 — GitHub URLs → `github.com/cadam11/forge`.**
`menu.ts:396` (wiki), `menu.ts:409-411` (issues), `welcome.component.ts:687,692`.

**T5.6 — localStorage keys (clean break, consistent with D2).**
`settings.service.ts:5` `'mj-forge-settings'` → `'forge-settings'`;
`query.component.ts:1538` `'mj-forge-ctrl-e-execute-confirmed'` → `'forge-ctrl-e-execute-confirmed'`;
`query.component.ts:1539` `'mj-forge-flyway-placeholder-values'` → `'forge-flyway-placeholder-values'`.
No migration shim — matches the Phase 4 decision. Users re-pick their theme once.

**T5.7 — Logo asset.** Rename `packages/renderer/src/assets/icons/mj-logo.png` → `logo.png` and update
the single remaining reference at `sidebar.component.ts:67`. (The second consumer, the MemberJunction
detection badge, was deleted in T1.3 — so this asset no longer has a dual purpose.)

**T5.8 — Dead command-palette entry.** `command-palette.component.ts:632` dispatches
`forge:show-about`, for which **no listener exists** — no About dialog is implemented anywhere.
Remove the dead entry. (Building a real About dialog is a reasonable follow-up, not rebrand scope.)

**Gate:** `npm run typecheck && npm run test && npm run build`.

---

## Phase 6 — Replace the `@memberjunction/*` dependencies

Per D3 all three go. **Only T6.1 is cheap-executor work.** T6.2 and T6.3 change shipped behaviour
(sanitization of LLM output; SQL dialect conversion) and need a careful implementer writing tests
first. Full design, verbatim API surface, and test cases: `scan-6-dependency-replacement.md`.

### Additional decisions (settled)

| # | Decision | Value |
|---|---|---|
| D8 | Mermaid diagrams | **Keep, with security tightened** — `securityLevel: 'loose'` → `'strict'`, and its SVG output must pass through DOMPurify's SVG profile before insertion. |
| D9 | Syntax highlighting | **Restore properly** — add `highlight.js@^11.12.0` *and* the theme CSS to `angular.json` `styles[]`. Highlighting has never actually rendered; this is a small visible improvement, not parity. |
| D10 | sqlglot | **Vendor into the repo.** No functional replacement exists. |

> These supersede the "do not change / out of scope" guidance in `scan-1` (§29-30, 36, 368),
> `scan-2` (§I), and `scan-5` (§12), which were written before D3 was made.

### T6.1 — `ng-shared-generic` → app-owned loading component (S, delegatable)

Highest branding value per unit of risk in the entire rebrand: this module's *only* export in use is
`<mj-loading>`, **which paints an animated MemberJunction logo in MJ blue (`#264FAF`) on Forge's own
startup screen.**

Create `packages/renderer/src/app/shared/components/loading/loading.component.ts` — standalone,
`OnPush`, selector `app-loading`. **Keep the input names and value vocabulary identical**
(`text`, `size: 'small'|'medium'|'large'`, `animation: 'pulse'`) so the three call sites are a pure tag
rename. Preserve: centred mark with caption below, size presets (40×22 / 80×45 / 120×67 px), 1.5s pulse
(opacity 1→0.4→1, scale 1→0.96→1). Use `var(--accent)` / `var(--text-secondary)` so it themes.
The component has no lifecycle hooks, no I/O, no outputs — nothing can regress functionally.

Swap 3 import sites + 3 imports-array entries + 3 tags: `app.component.ts:6,25,38`;
`ai-analysis-panel.component.ts:22,43,126-130`; `result-history-panel.component.ts:20,41,180-184`.
Then remove `packages/renderer/package.json:29`.

Afterwards, grep those two panel templates for `mat-spinner` — if unreferenced, drop the now-unused
`MatProgressSpinnerModule` import too (TypeScript won't catch template-only usage).

Test: `loading.component.spec.ts`, a plain class-level unit test asserting the `size`/`animation` →
CSS-class mapping including the unknown-value fallback.

### T6.2 — `ng-markdown` → `marked` + DOMPurify (M, careful implementer, TDD)

**Write `markdown-renderer.ts` and its XSS spec FIRST**, before touching any call site.

Create `packages/renderer/src/app/shared/markdown/markdown-renderer.ts` exporting one pure function
`renderMarkdown(md: string): string` — `marked` → DOMPurify → clean HTML. Construct the `Marked`
instance **once at module scope**; the current package rebuilds it on every call, and chat re-parses
the whole message on every streamed chunk.

Pin `marked@^14.1.4` (the exact version in the current lockfile) so the diff is provably
behaviour-preserving; upgrade in a separate commit. Config must be `{ gfm: true, breaks: true }` —
`breaks: true` makes a single newline a `<br>` and materially changes how LLM output reads.

Sanitize exactly as specified in `scan-6` §2.C: `USE_PROFILES: {html: true}`, `ADD_ATTR: ['class']`
(required — dropping `class` kills `language-*` styling), `FORBID_TAGS` and `FORBID_ATTR` including
`srcdoc`, `ALLOW_DATA_ATTR: false`. Bind via `[innerHTML]` with `bypassSecurityTrustHtml` applied
**after** DOMPurify, never instead of it.

> **This is a security upgrade, not a risk.** Today `enableSvgRenderer` defaults to `true` and chat
> never overrides it, so `bypassAngularSanitizer` is true: Angular's sanitizer is **never invoked** on
> LLM output, and the only defence is five hand-written regexes that miss `<iframe srcdoc>` entirely
> and miss entity-encoded `javascript:`. DOMPurify uses the browser's real HTML parser and normalizes
> entities before checking URL schemes.

Then create `markdown-viewer.component.ts` — standalone, `OnPush`, selector `app-markdown`, inputs
mirroring the current call sites. **It must call `markForCheck()` (or use signals) after each render
or streaming output freezes under `OnPush`** — this is the most likely defect and only the e2e test
catches it. Implement copy-to-clipboard with event delegation on the container, not post-render DOM
injection; catch and surface `navigator.clipboard` failures rather than swallowing them.

Per D8, keep mermaid at `securityLevel: 'strict'`. Per D9, add `highlight.js` **and** a theme
stylesheet to `packages/renderer/angular.json` `styles[]` — the missing theme is why highlighting has
been invisible.

Swap `chat-panel.component.ts:23,37,241-247,253-259`. While in that file, fix two dead CSS rules:
`:1091` targets `.mermaid` but the renderer emits `.mermaid-diagram`; `:1094` puts `:host` in
non-initial position so it never matches.

**Fold in this fix — same PR:** `ai-analysis-panel.component.ts:473-488` hand-rolls markdown with
regex and binds it to `[innerHTML]` at `:148`. That is a live unsanitized-`innerHTML` path for LLM
output and already violates the rule being rewritten. Replace it with `<app-markdown>`; this deletes
code and closes a hole.

Rewrite `CLAUDE.md:156` (AI Integration Rule #2) and `CONTRIBUTING.md:121` **in this same commit** —
the current rule mandates `@memberjunction/ng-markdown`, so leaving it would make the code violate the
repo's own instructions. Keep the no-unsafe-`innerHTML` half intact.

Tests (all required): `markdown-renderer.spec.ts` with `// @vitest-environment jsdom` — add `jsdom` as
a root devDependency, it is **not** in the lockfile today. XSS cases: `<script>`, `<img onerror>`,
`javascript:` href, **entity-encoded** `&#x6a;avascript:`, `<iframe srcdoc>`, `<svg><animate onbegin>`,
`<object data="data:text/html">`, `formaction`, `style="background:url(javascript:)"`, and markdown
`[x](javascript:alert(1))`. Fidelity cases: GFM table, task list, fenced code → `language-sql`, single
newline → `<br>`. Partial-input cases: unterminated fence, half-written table row, empty string, 100KB
input (bounded). Plus `markdown-viewer.component.spec.ts` and a new `tests/e2e/chat-markdown.spec.ts`
— the e2e is the only thing that proves the `OnPush` + streaming wiring.

### T6.3 — `sqlglot-ts` → vendored (S–M, its own PR)

Per D10. `@memberjunction/sqlglot-ts` is ISC-licensed, so copying is legally clean — **retain the ISC
notice** and credit `sqlglot` (Toby Mao, MIT), matching the existing precedent in `utils/singleton.ts`.

Create:
- `packages/main/src/services/sql/sqlglot/sqlglot-client.ts` — ~200-line port trimmed to the 5 members
  actually used (`start`, `stop`, `transpile`, `IsRunning`, `Port`). Compiling it as CommonJS with the
  rest of `packages/main` also fixes a latent fragility: the package is ESM-only and currently works
  only because Electron 41's Node 22 supports `require(esm)`.
- `packages/main/src/services/sql/sqlglot/types.ts` — `SQLDialect`, `TranspileOptions`, `TranspileResult`.
- `resources/python/sqlglot-server.py` — the 188-line FastAPI server, copied verbatim.

**Two CLAUDE.md rules the upstream client violates — fix them in the port, don't copy them:**
1. Its readiness poll is `while (Date.now() < deadline)` with no iteration cap. Add an explicit bounded
   maximum ("bound every loop").
2. It registers process-level `SIGINT`/`SIGTERM` handlers that call `process.exit(0)` — meaning the
   library can terminate the Electron main process. Do **not** copy these; use the existing shutdown
   hook in `index.ts:145-151`, and fix that hook's swallowed `.catch(() => {})` while you're there.

Edit `sql-converter.ts`: imports at `:13-14` → the local paths; `:4` comment; and pass an explicit
`serverPath` resolved from `process.resourcesPath` when packaged and from the repo in dev. Remove
`package.json:58`.

> **Why the path matters:** `server.py` currently lives inside `app.asar`, and `asarUnpack` covers only
> `.node` and keytar. Electron's asar shim virtualizes paths for Node's `fs` — so the client's
> `existsSync()` check *passes* — but not for a spawned external process. `python3` cannot open a file
> inside an asar archive, so this feature is almost certainly dead in every packaged build, failing as
> "Python 3 is required…" whether or not Python is installed. Putting the server under `resources/`
> means the existing `extraResources` block copies it outside the asar. **Verify this against a real
> `npm run package` build, not `npm run dev`** — getting it wrong reproduces the same bug silently,
> because the error path already blames Python.

**Capture the equivalence fixtures BEFORE swapping the client.** Run ~20 dialect pairs through the
current dependency and record the output (`SELECT TOP 10` → `LIMIT 10`, `ISNULL`→`COALESCE`,
`GETDATE()`→`CURRENT_TIMESTAMP`, `[bracket]`→`"quoted"`→`` `backtick` ``, round-trip stability). Those
recordings are the proof the vendored client behaves identically. Put them in
`tests/integration/sqlglot/transpile.spec.ts`, gated on Python being present and skipped otherwise —
the same pattern the backup CLI integration tests already use.

Also add `sql-converter.spec.ts` (unit, no Python needed — inject a fake client; assert the dialect
map, the `TranspileResult`→`ConversionResult` mapping, that spawn failure returns `success: false`
with the original SQL preserved and never throws, and that concurrent `convert()` calls trigger exactly
one `start()`).

**Explicitly out of scope for the rebrand** — file as separate tickets, do not let them creep in:
Windows interpreter probing (`spawn('python3')` fails on Windows, where it's `python` or `py`);
a `cli-deps.ts`-style setup-instructions UI for missing Python/pip packages; documenting the Python
prerequisite (which appears nowhere in the repo today) and deciding whether README should keep
advertising dialect conversion as a headline feature while it needs an undocumented `pip install`.

**Gate:** XSS suite green; equivalence fixtures match; `npm run test:full`; renderer bundle still within
the budgets at `angular.json:46-57` (dropping `prismjs` and the `@memberjunction/*` transitive tail —
`@memberjunction/core`, `core-entities`, `global`, `ai`, and their `zod`/`lodash`/`debug` tails —
should shrink it).

---

## Phase 7 — Docs, README, LICENSE, tooling

**T7.1 — README.md.** `"MJ Forge"` → `"Forge"` at lines 5, 39, 41, 51, 138, 241, 243, 360; fix the
`#why-mj-forge` anchor pair (lines 25 and 241); update all 14 `github.com/MemberJunction/Forge` URLs to
`github.com/cadam11/forge`; update the DMG/EXE download link text to match the new artifact names
(`Forge-<version>-<arch>.dmg`).
- Line 2 references `resources/logo.png`, **which does not exist** — the header image has been broken
  independently of this rebrand. Either add the asset or drop the `<img>`.
- Lines 456-464 — replace the "Acknowledgments" block (currently claims Forge "is built by the team
  behind MemberJunction", with a badge) with **one honest line** per D4: Forge is an MIT-licensed fork
  of `MemberJunction/Forge`.

**T7.2 — LICENSE.** No LICENSE file exists, despite README linking to it and `package.json` declaring
MIT. Create it. **MIT requires the original copyright notice be preserved in a fork** — the file must
carry the upstream MemberJunction copyright line alongside `Copyright © 2026 Craig Adam`. This is the
legal basis for D4's single-credit approach; do not omit it.

**T7.3 — CONTRIBUTING.md.** Lines 1, 3, 56; upstream remote URL at line 20; issue/discussion URLs at
205-206. Line 121's `@memberjunction/ng-markdown` instruction is superseded by Phase 6.

**T7.4 — docs/.** `ARCHITECTURE.md:1,5` (name), `:97` (drop the "inspired by MemberJunction" link),
`:245` (reword the "matching MemberJunction/MJ pattern" note).
`SQL-CONVERSION-STUDY.md:27-29` — delete the speculative `@memberjunction/sqlglot` subsection; it
describes a package that was never adopted, and Phase 6 supersedes the one that was.

**T7.5 — Root `CLAUDE.md`.** Retitle to `# Forge`; rewrite AI Integration Rule #2 per Phase 6; update
the project-structure tree root label.

**T7.6 — Tests + tooling strings.** `tests/reporter/serve.mjs:2,185,1511,1518`,
`render-html.mjs:2073,2080`, `build-report.mjs:35`, `tests/docker-compose.test.yml:1`,
`vitest.config.ts:2,4`, `tests/e2e/connection.spec.ts:5` (stale comment),
`.claude/commands/test-ui.md:1`, `.claude/commands/publish-build.md` (title + all `--repo` flags and
raw-content URLs → `cadam11/forge`), `.claude/skills/electron/SKILL.md:3,8,12`,
`.claude/skills/forge-regression-harness/SKILL.md:3,6`.

**T7.7 — Attribution comments in source.** Per D4, remove the MemberJunction citations at
`utils/singleton.ts:2`, `utils/json-utils.ts:2`, `utils/object-cache.ts:2`,
`sql/provider/database-provider.ts:5`, `sql/dialect/sql-dialect.ts:6-7`. These cite an MIT package;
with the LICENSE file (T7.2) carrying the upstream notice, the inline citations are not required.

**T7.8 — `plans/README.md`.** Add one short file noting the project was renamed from "MJ Forge" to
"Forge", and that dated documents in this directory predate the rename and are kept as history. Do not
edit any other file in `plans/`.

**T7.9 — Stale test docs.** `tests/README.md` and `tests/regression-suite.md` both document a
`full-audit.spec.ts` suite that **no longer exists**; following their instructions produces a
file-not-found error today. This is pre-existing rot, not rebrand-caused. Mark both as historical or
delete them — Craig's call, flagged not decided.

---

## Phase 8 — Test fixture rename (D6)

Rename the `__mj` fixture schema to a neutral name. **Keep the seeded row counts identical (11
applications, 24 entities)** so the existing assertions do not move.

- `tests/fixtures/postgres/mj-schema.sql` → `app-meta-schema.sql`, schema `__mj` → `app_meta`
- `tests/fixtures/postgres/mj-seed.sql` → `app-meta-seed.sql`
- `tests/e2e/mj-schema.spec.ts` → `cross-schema-query.spec.ts`, retitle the describe block
- `tests/helpers/forge-actions.ts:33-41` (doc comment) and `:58-65` (the idempotent seed guard, which
  keys on `table_schema='__mj' AND table_name='entity'`)

This spec never exercised MemberJunction detection — the fixture uses lowercase `__mj.entity` while
`detectMJDatabase` probed for `'Entity'`, so in case-sensitive PostgreSQL the probe never matched. Its
real value is coverage of non-`public` schema queries and a two-table JOIN, which the rename preserves.

**Gate:** `npm run test:e2e`.

---

## Phase 9 — Verification (QA gate)

**T9.1 — Full suite:**
```bash
npm run typecheck && npm run lint && npm run test:full && npm run build
```

**T9.2 — Residue sweep.** Each of these must return **nothing** outside `plans/` (excluding
`plans/rebrand/`), `package-lock.json`, and `node_modules`:
```bash
git grep -In "MJ Forge"
git grep -In "mj-forge"
git grep -Iin "memberjunction"
git grep -In "__mj"
git grep -In "com\.memberjunction"
```

**T9.3 — Packaged-app check.** `npm run package` and confirm: the app bundle is named `Forge.app`, the
macOS app menu reads "Forge", the About panel shows the new copyright, and the DMG artifact is
`Forge-<version>-<arch>.dmg`.

**T9.4 — Runtime smoke.** Launch the app and confirm: window title is "Forge"; the welcome screen shows
"Forge" with no MemberJunction footer; the Help menu has no "About MemberJunction" item; connecting to
a database and expanding a schema works (this exercises the Phase 1 deletion path); the chat panel
renders markdown (Phase 6); opening an ERD produces no failing `__mj.Entity` query in the logs.

**T9.5 — Screenshots.** All 8 PNGs in `docs/screenshots/` show the running app and have "MJ Forge"
baked into the pixels. They **cannot** be fixed by find/replace — recapture them after T9.4 passes.

**T9.6 — Second-pass QA.** Craig has asked for an independent review pass after execution. Treat T9.2's
sweep as necessary but not sufficient: the reviewer should also check for awkward English left behind
by mechanical replacement (e.g. "the MJ Forge app" → "the Forge app", not "the  app"), and confirm no
executor "helpfully" renamed something on the Do-NOT-touch list.

---

## Suggested PR / commit sequence

**PR 1 — the rebrand** (branch `refactor/forge-rebrand`):

1. `refactor: remove MemberJunction database integration` (Phase 1)
2. `chore: delete vestigial mj.config.cjs` (Phase 2)
3. `refactor: rename npm scope to @forgedb` (Phase 3)
4. `feat!: rebrand app identity to Forge` (Phase 4 — breaking: resets local app data)
5. `refactor: rebrand user-facing strings and assets` (Phase 5)
6. `refactor: replace MemberJunction loading component` (T6.1)
7. `docs: rebrand documentation and add LICENSE` (Phase 7)
8. `test: rename __mj fixture to app_meta` (Phase 8)

**PR 2 — markdown renderer** (T6.2). Separate because it changes sanitization of LLM output and
carries its own XSS test suite. Renderer-only.

**PR 3 — vendored sqlglot** (T6.3). Separate because it touches `packages/main`, packaging, and
`resources/`, and needs verification against a real packaged build.

Commits 1–3 are each independently revertible. Commit 4 is the one that changes user-visible behaviour
beyond naming; call it out in the PR description.

### Dependency delta (net, across all three PRs)

```diff
 packages/renderer/package.json
-  "@memberjunction/ng-markdown": "^3.2.0"
-  "@memberjunction/ng-shared-generic": "^3.2.0"
+  "marked": "^14.1.4"
+  "dompurify": "^3.4.13"
+  "highlight.js": "^11.12.0"
 package.json (root)
-  "@memberjunction/sqlglot-ts": "^5.23.0"
+  "jsdom": "^25.0.0"        // devDependency — required for the DOMPurify unit tests
```

`mermaid` is retained per D8. `dompurify` is already in the tree transitively via mermaid, so
promoting it to a direct dependency costs nothing.

---

## Open items Craig has not yet ruled on

Not blocking execution — each has a stated default in the plan above, but flag rather than assume:

1. **"Craig Adam"** as the copyright holder (`electron-builder.yml:3` and the new LICENSE, T7.2).
   The bundle id is settled: `ca.adam11.forge`.
2. **A new brand mark** for the loading component and the app icon — T6.1 and T5.7 proceed with a
   neutral placeholder otherwise.
3. **`tests/README.md` / `tests/regression-suite.md`** both document a `full-audit.spec.ts` that no
   longer exists. Pre-existing rot; delete or mark historical (T7.9).
4. **Whether README should keep advertising SQL dialect conversion** as a headline feature given it
   requires an undocumented `pip install` and appears broken in packaged builds (T6.3).
