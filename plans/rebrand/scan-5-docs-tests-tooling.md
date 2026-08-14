# Rebrand Scan 5 — Docs, Tests, Repo Tooling

Scope: README/CONTRIBUTING/LICENSE-family docs, `docs/**`, `plans/**`, `tests/**` (incl. `tests/reporter/**`), `.claude/**`, editor configs, root-level dev tooling config (`package.json`, `electron-builder.yml`, `.changeset`, `.github/workflows`, `.husky`, `scripts/*.js`). Read-only scan — **no edits made**.

Target end state: product name **"Forge"**, zero references to "MemberJunction" / "MJ" as a company or product brand, except where a reference names a genuine external npm dependency that is still in use (those are separate JUDGMENT items, not simple renames).

---

## 0. Executive Summary

| Classification | Count (approx.) |
|---|---|
| MECHANICAL | 46 |
| COORDINATED | 3 groups (11 files) |
| JUDGMENT | 9 items |

- **No LICENSE, CODE_OF_CONDUCT, SECURITY.md, or CHANGELOG file exists in the repo**, despite README.md linking to `LICENSE` and package.json declaring `"license": "MIT"`. This is a pre-existing gap, not something the rebrand created — but it's the natural moment to add one, and the copyright holder name is a JUDGMENT call.
- **No `.vscode` or `.idea` directories exist anywhere in the repo.** Nothing to do there.
- **No `.claude/settings.json` or `.claude/agents/` directory exists.** Only `.claude/commands/*`, `.claude/skills/*`.
- `@memberjunction/ng-markdown` **is a real, currently-installed npm dependency** (`packages/renderer/package.json`), imported at exactly **one** call site. Not a branding string — replacing it is a functional code change (new markdown-rendering library), not a find/replace. Full blast radius below.
- `@memberjunction/ng-shared-generic` and `@memberjunction/sqlglot-ts` are **also real, currently-installed npm dependencies** from the actual MemberJunction npm org, imported at 4 more call sites total. These cannot be "rebranded away" by renaming strings — MJ Forge is a genuine downstream consumer of MemberJunction's open-source packages. Decommissioning them is a product/architecture decision, not a docs fix.
- `README.md`'s "Acknowledgments" section explicitly credits MemberJunction as the team that built Forge, with a link to `github.com/MemberJunction/MJ` — this is an attribution claim, not just a name string, and needs a product decision (see JUDGMENT section).
- Test suite is in good shape for the rebrand: only **one** test assertion touches the word "forge" and it's already lowercase/generic (`toContain('forge')`), so it **will keep passing**. No test currently hardcodes "MJ Forge" or "MemberJunction" as an *expected UI string*. The `tests/reporter/**` HTML dashboard (not a test assertion, but end-user-visible tooling output) does hardcode "MJ Forge" in page titles/headers/console logs — those are MECHANICAL.
- `tests/e2e/mj-schema.spec.ts` and its fixtures (`tests/fixtures/postgres/mj-schema.sql`, `mj-seed.sql`) deliberately test Forge's built-in awareness of MemberJunction's `__mj` schema convention. This is a **product feature**, not incidental branding — renaming the files/tables is mechanical, but deciding whether to keep testing (or keep shipping) MJ-schema-awareness at all is a JUDGMENT call for Craig.
- `plans/**` (9,863 total lines across 11 files) is saturated with "MJ Forge" / "MemberJunction" — these are historical design docs. Recommend leaving as history (see JUDGMENT section) rather than mechanically rewriting.
- `electron-builder.yml` sets `appId: com.memberjunction.forge` and `copyright: Copyright © 2026 MemberJunction`. The `appId` is used by macOS to scope Keychain items and app-specific storage — changing it is a COORDINATED change with real user-data-migration implications, flagged here for the code-domain scan/executor even though the file itself is tooling config in my domain.
- `plans/perf-baselines.md` documents Craig's live Electron `userData` path as `~/Library/Application Support/mj-forge/` — this directory name is derived from the app's product name and will change if `productName`/`app.setName()` changes. Flagging for cross-agent awareness; not something a docs/tests scan can fix, but the executor must not silently orphan that directory.

---

## 1. README.md

25 KB, 482 lines. Every occurrence below.

| Line | Current string | Recommended replacement | Class |
|---|---|---|---|
| 2 | `<img src="resources/logo.png" alt="MJ Forge" width="128" height="128">` | `alt="Forge"`; **note: `resources/logo.png` does not exist in the repo** (only `resources/icon.png` / `icon.icns`) — this `<img>` has been broken independent of rebrand. Flag for whoever owns README, not just a rename. | JUDGMENT (broken asset) |
| 5 | `<h1 align="center">MJ Forge</h1>` | `Forge` | MECHANICAL |
| 8 | (tagline, no MJ) | — | — |
| 17 | `https://github.com/MemberJunction/Forge/releases/latest` | `https://github.com/<new-org>/Forge/releases/latest` | COORDINATED (org URL, repeats 9× in this file — see list below) |
| 25 | `<a href="#why-mj-forge">Why MJ Forge?</a>` | `<a href="#why-forge">Why Forge?</a>` — anchor target must be updated too (see line 241) | MECHANICAL |
| 33 | `img.shields.io/github/v/release/MemberJunction/Forge` | update org segment | COORDINATED |
| 34 | `img.shields.io/github/actions/workflow/status/MemberJunction/Forge/build-release.yml` | update org segment | COORDINATED |
| 39 | `## What is MJ Forge?` | `## What is Forge?` | MECHANICAL |
| 41 | `MJ Forge is a desktop database IDE...` | `Forge is a desktop database IDE...` | MECHANICAL |
| 51 | `MJ Forge speaks three database dialects fluently:` | `Forge speaks...` | MECHANICAL |
| 57 | ``` `@memberjunction/sqlglot-ts` powers cross-dialect conversion``` | Depends on JUDGMENT decision about the dependency — if kept, leave as-is (it's an accurate/necessary reference to a real external package); if replaced, update to new package name | JUDGMENT (see §12) |
| 81 | (no MJ) | — | — |
| 138 | `The AI assistant is the heart of MJ Forge.` | `...heart of Forge.` | MECHANICAL |
| 185 | `https://github.com/MemberJunction/Forge/releases/latest` | org update | COORDINATED |
| 194–195 | `[MJ Forge.dmg](...)` ×2 | `[Forge.dmg]` — also matches actual DMG artifact name once `productName` changes (see electron-builder.yml, §11) | COORDINATED (must match real artifact filename) |
| 199, 201 | `[MJ Forge Setup.exe](...)` ×2 | `[Forge Setup.exe]` — same coordination with `productName`/NSIS artifactName | COORDINATED |
| 204 | `github.com/MemberJunction/Forge/releases/latest` | org update | COORDINATED |
| 241 | `## Why MJ Forge?` | `## Why Forge?` (and update anchor link at line 25 to match, e.g. `#why-forge`) | MECHANICAL |
| 243 | table header `MJ Forge` (comparison table vs. Azure Data Studio/TablePlus/DBeaver/DataGrip) | `Forge` | MECHANICAL |
| 266 | `git clone https://github.com/MemberJunction/Forge.git` | update org | COORDINATED |
| 360 | `mj-forge/` (project-structure tree root label) | `forge/` | MECHANICAL |
| 383 (approx, inside tree) | — | — | — |
| 444–452 | Contributing section (no direct MJ string, but see CONTRIBUTING.md) | — | — |
| 450 | `github.com/MemberJunction/Forge/issues` | org update | COORDINATED |
| 451 | `github.com/MemberJunction/Forge/discussions` | org update | COORDINATED |
| 456–464 | **"Acknowledgments" section — entire block**: `MJ Forge is built by the team behind [MemberJunction](https://github.com/MemberJunction/MJ), the open-source metadata-driven application platform.` plus a shields.io "Built by MemberJunction" badge linking to `github.com/MemberJunction/MJ` | Decide: remove section entirely, or keep an honest "built on top of the MemberJunction ecosystem" acknowledgment with the dependency disclosure from §12. This is an attribution/provenance claim, not just a name. | **JUDGMENT** |
| 479 | `https://github.com/MemberJunction/Forge/stargazers` | org update | COORDINATED |
| 480 | `https://github.com/MemberJunction/Forge/releases/latest` | org update | COORDINATED |

**Coordinated set — all `github.com/MemberJunction/Forge` URLs in README.md** (lines 17, 33, 34, 185, 194, 195, 199, 201, 204, 266, 450, 451, 479, 480 — 14 occurrences): these must all change together to whatever the new org/repo slug is (e.g. `github.com/<new-org>/Forge`), and must match whatever `.github/workflows/build-release.yml` actually publishes to (that workflow itself has **no** hardcoded MemberJunction references — it uses `${{ github.repository }}`-relative context per my grep — so the workflow doesn't need changes, only the README's hardcoded links do).

---

## 2. CONTRIBUTING.md

6.6 KB, 209 lines.

| Line | Current string | Recommended replacement | Class |
|---|---|---|---|
| 1 | `# Contributing to MJ Forge` | `# Contributing to Forge` | MECHANICAL |
| 3 | `Thank you for your interest in contributing to MJ Forge!` | `...to Forge!` | MECHANICAL |
| 19 | `git clone https://github.com/YOUR_USERNAME/Forge.git` | no org hardcoded here — fine as-is | — |
| 20 | `git remote add upstream https://github.com/MemberJunction/Forge.git` | update org | COORDINATED (same URL family as README) |
| 56 | `mj-forge/` (project tree root label) | `forge/` | MECHANICAL |
| 121 | `5. **Use \`@memberjunction/ng-markdown\`** for rendering AI-generated content in the renderer.` | Depends on JUDGMENT decision in §12 — if the dependency stays, this instruction is accurate and should stay; if replaced, update the package name and guidance | JUDGMENT (tied to §12) |
| 205 | `github.com/MemberJunction/Forge/issues` | update org | COORDINATED |
| 206 | `github.com/MemberJunction/Forge/discussions` | update org | COORDINATED |

No other MemberJunction/MJ references in this file (verified full read).

---

## 3. LICENSE / CODE_OF_CONDUCT / SECURITY.md / CHANGELOG

**None of these files exist in the repo root** (confirmed via `find` at repo root and recursively for any casing variant). Findings:

| Item | Status | Class |
|---|---|---|
| `LICENSE` | **Missing.** README.md line 470 says `MIT License — see [LICENSE](LICENSE) for details.` — dead link. `package.json` declares `"license": "MIT"`. Who is the copyright holder once this is created? Options: (a) Craig Adam personally, (b) a new entity/org name for the "Forge" project, (c) omit a named copyright holder and just say "The Forge Contributors". | **JUDGMENT — decision needed from Craig before this file can be authored** |
| `CODE_OF_CONDUCT.md` | Missing. Not referenced anywhere else in the repo either, so this isn't a rebrand regression — just noting the gap in case the rebrand is also a "make repo public-ready" moment. | JUDGMENT (out of scope unless Craig wants it) |
| `SECURITY.md` | Missing. Same as above. | JUDGMENT (out of scope unless Craig wants it) |
| `CHANGELOG.md` / `CHANGELOG` | Missing at repo root. Note: `.changeset/` tooling is configured (`.changeset/config.json`) and would normally generate one — it currently has no MJ/MemberJunction references itself (config is name-agnostic), so no action needed there beyond whatever changeset entries get written going forward. | — (no finding, informational) |

---

## 4. docs/ARCHITECTURE.md

278 lines.

| Line | Current string | Recommended replacement | Class |
|---|---|---|---|
| 1 | `# MJ Forge Architecture Guide` | `# Forge Architecture Guide` | MECHANICAL |
| 5 | `MJ Forge is a native desktop database IDE supporting SQL Server and PostgreSQL.` | `Forge is a native desktop database IDE...` | MECHANICAL |
| 97 | `Forge supports multiple database engines through a dialect + provider abstraction inspired by [MemberJunction](https://github.com/MemberJunction/MJ).` | Same attribution question as README §1 — this is a design-provenance claim ("inspired by"), softer than README's "built by the team behind." Could plausibly stay if MJ inspiration is real and acknowledged generically, or be removed/reworded. | **JUDGMENT** (tied to README Acknowledgments decision — keep them consistent) |
| 245 | `**Framework:** Vitest with @vitest/coverage-v8 (matching MemberJunction/MJ pattern)` | Reword to avoid the MJ reference, e.g. "(standard Vitest + v8 coverage setup)" | MECHANICAL (once JUDGMENT on attribution is resolved, this one has no reason to stay — it's just describing tooling conventions, not a real dependency) |

Note: this doc's Package Structure tree (line 27 `packages/`) doesn't spell out `mj-forge/` as a root label the way README/CONTRIBUTING do, so no finding there.

---

## 5. docs/SQL-CONVERSION-STUDY.md

125 lines. Design-study doc, mostly discusses third-party library candidates.

| Line | Current string | Recommended replacement | Class |
|---|---|---|---|
| 27 | `### 3. \`@memberjunction/sqlglot\` (Internal MJ package — if available)` | This whole subsection (lines 27–29) discusses a *hypothetical* internal MJ package that was never adopted (the actual dependency that shipped is `@memberjunction/sqlglot-ts`, a different, real public package — see §12). Recommend either deleting this speculative subsection or updating it to reflect what was actually built. | JUDGMENT (historical/speculative content, low stakes) |

No other MJ references in this file. It's a design study, arguably belongs with `plans/` rather than `docs/` — flag as a possible file-move, not required.

---

## 6. docs/screenshots/** (image assets)

8 PNG files, all referenced from README.md's Screenshots section:

```
docs/screenshots/ai-assistant-dark.png
docs/screenshots/ai-assistant-light.png
docs/screenshots/connection-dialog-dark.png
docs/screenshots/connection-dialog-light.png
docs/screenshots/home-screen-dark.png
docs/screenshots/home-screen-light.png
docs/screenshots/settings-dark.png
docs/screenshots/settings-light.png
```

**Filenames themselves contain no MJ/MemberJunction branding** — no rename needed on that front. However, these are screenshots of the **live running app**, so if any UI surface (title bar, About dialog, window title, welcome-screen copy) currently reads "MJ Forge" on screen, that text is baked into the pixels and **cannot be fixed by find/replace** — it requires re-capturing the screenshots after the in-app rebrand lands. I did not visually inspect all 8 images pixel-by-pixel (out of scope for a docs/tooling text scan and the other scan agent covers renderer UI text), but flagging this as a required step in the rebrand rollout: **recapture all 8 screenshots post-rebrand**, ideally via the same Playwright/`wiki-author` skill flow already used for the GitHub wiki screenshots (see `.claude/commands/publish-build.md` line 87, which pins wiki screenshots to release tags via `docs/screenshots/<name>.png` — same pinning mechanism/risk applies here).

Class: **JUDGMENT** (requires visual re-capture, not a text edit).

---

## 7. plans/** (historical design/planning documents)

11 files, 9,863 total lines. Counts of MemberJunction/MJ Forge occurrences per file:

| File | Lines | MJ/MemberJunction occurrences |
|---|---|---|
| `plans/system-plan.md` | 4,437 | 36 |
| `plans/UX-IMPROVEMENTS-ROADMAP.md` | 1,631 | 21 |
| `plans/2026-07-20-aurora-dsql-support.md` | 1,383 | 13 |
| `plans/2026-07-21-dsql-iam-auth.md` | 521 | 0 |
| `plans/ai-features-spec.md` | 513 | 8 |
| `plans/2026-01-26-fixes-and-features.md` | 421 | 6 |
| `plans/future-multi-database.md` | 350 | 0 |
| `plans/2026-04-04-ssh-tunneling.md` | 318 | 1 |
| `plans/IMPLEMENTATION-STATUS.md` | 132 | 1 |
| `plans/improvement-loop.md` | 89 | 1 |
| `plans/perf-baselines.md` | 68 | 1 |

Representative findings (full line-by-line for the two largest files would run to 50+ rows each — see "Recommendation" below for why I didn't exhaustively enumerate every line):

- `plans/system-plan.md`: title (`# MJ Forge — System Plan`), a dedicated `## MemberJunction Integration` section (~line 325) describing dependence on `@memberjunction/global` and `@memberjunction/config`, ASCII-art mockups with a repeated `│  MJ Forge` title-bar label (10 occurrences, lines 389/457/498/540/598/768/827/873/926/986), a `"productName": "MJ Forge"` / `"appId": "com.memberjunction.forge"` JSON snippet (lines 3224–3225) mirroring `electron-builder.yml`, and code comments `// Adapted from @memberjunction/global` (×3, lines 3103/3128/3184).
- `plans/UX-IMPROVEMENTS-ROADMAP.md`: title, a `### 2.6 MJ Forge CLI (\`forge\`)` section proposing a `@mj-forge/cli` package (this matches the *actual* `packages/cli/package.json` that exists today — see §11), comparison-table headers (`MJ Forge` vs. SSMS/ADS/TablePlus).
- `plans/2026-07-20-aurora-dsql-support.md` and `plans/2026-01-26-fixes-and-features.md`: these are **implementation plans for features that already shipped** (Aurora DSQL support, MemberJunction database awareness/`__mj` detection) — they reference real current import paths like `@mj-forge/shared` (already correctly namespaced, not `@memberjunction/shared`) and the `__mj` schema feature discussed in §9 below.
- `plans/ai-features-spec.md`: references installing `@memberjunction/sql-parser` for AST-based SQL parsing (lines 154, 167, 169, 239, 322) — **this does not appear to have been installed** (not found in any `package.json` I checked); this looks like a design idea that was superseded by the sqlglot-ts approach that actually shipped. Worth flagging to Craig as possibly-stale-and-safe-to-ignore rather than a live dependency.
- `plans/2026-04-04-ssh-tunneling.md`, `plans/IMPLEMENTATION-STATUS.md`, `plans/improvement-loop.md`, `plans/perf-baselines.md`: single incidental mentions ("MJ Forge connects to...", etc.) — low-effort mechanical fixes if plans are touched at all.
- `plans/future-multi-database.md`, `plans/2026-07-21-dsql-iam-auth.md`: **zero MJ/MemberJunction references** — clean, no action needed.

**Recommendation (JUDGMENT, not decided here):** `plans/` reads as a running engineering log/history, not user-facing documentation. Three options:
1. **Leave as-is** — historical record of decisions made under the old name; add a one-line disclaimer at the top of `plans/` (or a `plans/README.md`) noting the project was renamed and older docs predate it.
2. **Mechanically rename** the branded strings throughout (cheap, but risks producing historically-inaccurate docs — e.g. a doc that claims to be a "plan for MJ Forge" is now retroactively false-labeled as always having been "Forge").
3. **Delete/archive** superseded planning docs (e.g. the never-shipped `@memberjunction/sql-parser` idea in `ai-features-spec.md`) and leave the rest untouched.

I recommend **option 1** for anything already shipped/true, since these are dated engineering artifacts (filenames like `2026-01-26-...`) — rewriting history to match a later rebrand is misleading. Executor should not touch `plans/**` without Craig's explicit call.

---

## 8. tests/** overview

### 8a. tests/README.md (legacy doc — likely stale)

137 lines. Full read above.

| Line | Current string | Recommended replacement | Class |
|---|---|---|---|
| 1 | `# MJ Forge Regression Test Suite` | `# Forge Regression Test Suite` | MECHANICAL |
| 5 | `Automated Playwright tests for MJ Forge Electron app.` | `...for Forge Electron app.` | MECHANICAL |
| 11 | `**MJ_5_14_0 database** with MemberJunction schema (\`__mj\` schema)` | See JUDGMENT §9 | JUDGMENT |
| 18, 21, 24 | References `e2e/full-audit.spec.ts` and a "31 tests" suite | **This file describes a test suite (`full-audit.spec.ts`) that no longer exists in the repo** (confirmed via `find` — not present anywhere under `tests/`). The current `tests/README.md` (the harness-overview one, §8's parent context) calls this "the legacy MSSQL audit" at line 130, and `tests/e2e/mj-schema.spec.ts` / `tests/e2e/welcome-screen.spec.ts` header comments both reference it as "the legacy 31-test audit." Note there are genuinely two separate legacy-flavored files here — `tests/README.md` (this one, quoted throughout 8a) and `tests/regression-suite.md` (8b) — both documenting the same retired suite from slightly different angles, both predating the current Vitest/Playwright harness. **Recommend deleting or clearly marking this file as historical**, since a reader following its instructions (`npx playwright test e2e/full-audit.spec.ts`) will hit a file-not-found error today, unrelated to rebranding. | **JUDGMENT** (stale doc, pre-existing — not rebrand-caused, but worth flagging since exhaustiveness was requested) |
| 70–74 | `### MJ Metadata (Tests 22-23)` — `MJ Entity query`, `MJ Application query` | Ties to JUDGMENT §9 | JUDGMENT |

**Correction/clarification on file identity:** `tests/README.md` is the file with the "Full Audit (31 tests)" legacy content (quoted above). `tests/regression-suite.md` is a *second*, similarly-legacy-flavored file — I read both; see below for `regression-suite.md`'s own findings. Both files describe the same legacy 31-test suite from different angles and both predate the current Vitest/Playwright harness described in the `forge-regression-harness` skill. Recommend Craig decide whether to keep one, merge, or archive both — this is a docs-hygiene question independent of rebranding, but exhaustiveness requires flagging it since both are full of "MJ" references.

### 8b. tests/regression-suite.md

Read in full above (143 lines, essentially a duplicate/near-duplicate of `tests/README.md`'s legacy content). Same MJ Forge / MJ_5_14_0 / `__mj` findings as 8a apply here too — same lines/patterns repeat almost verbatim (title line 1, prerequisites, "MJ Metadata" test section). Recommend deciding 8a and 8b together as one unit.

### 8c. tests/helpers/forge-actions.ts

Line 36 (comment): `` `__mj.*` — minimal MemberJunction shape (user / application / entity). `` — comment-only, describes test fixture design. Tied to JUDGMENT §9.

### 8d. tests/e2e/mj-schema.spec.ts + tests/fixtures/postgres/mj-schema.sql + tests/fixtures/postgres/mj-seed.sql

See dedicated §9 below — this is the most consequential JUDGMENT item in the whole scan.

### 8e. tests/docker-compose.test.yml

| Line | Current string | Recommended replacement | Class |
|---|---|---|---|
| 1 | `# MJ Forge regression test infrastructure.` | `# Forge regression test infrastructure.` | MECHANICAL |

Everything else in this file (`name: forge-test`, container names `forge-test-mssql`/`forge-test-postgres`/`forge-test-mysql`/`forge-test-postgres-private`/`forge-test-bastion`, env vars `POSTGRES_USER: forge`, etc.) is **already** generically "forge"-branded — no MemberJunction/MJ residue in service/container/volume/network names. No further action needed beyond the one comment line.

### 8f. vitest.config.ts / vitest.integration.config.ts

| File | Line | Current string | Recommended replacement | Class |
|---|---|---|---|---|
| `vitest.config.ts` | 2 | `* Vitest Configuration — MJ Forge` | `* Vitest Configuration — Forge` | MECHANICAL |
| `vitest.config.ts` | 4 | `* Follows the MemberJunction monorepo testing pattern:` | Reword, e.g. "Follows a standard Vitest monorepo testing pattern:" | MECHANICAL (attribution, low stakes — just a style-convention credit) |
| `vitest.config.ts` | 60 | `'@mj-forge/shared': new URL(...)` | Path alias — **only touch if the `@mj-forge/*` package scope itself is being renamed** (that's a code-domain/COORDINATED change spanning every package.json + tsconfig + import statement repo-wide, well beyond this scan's docs/tests remit; flagging for the code-domain agent) | COORDINATED (cross-domain, not actionable from docs/tests alone) |
| `vitest.integration.config.ts` | 33, 40, 41 | Comment + two `@mj-forge/shared` / `@mj-forge/main` path aliases | Same as above | COORDINATED (cross-domain) |

### 8g. Other e2e/integration/visual spec files — checked, no branding findings

I grepped every file under `tests/e2e/**`, `tests/integration/**`, `tests/e2e/visual/**` for `MJ Forge`, `MemberJunction`, `mj-forge`, `MJ_5_14`, and `__mj`. Beyond `mj-schema.spec.ts` (§9) and the `@mj-forge/*` import paths already covered in §8f/§11, the only other hits were:
- `tests/e2e/connection.spec.ts` line 5 — a comment: `* Uses the seeded postgres test container instead of MSSQL+MJ_5_14_0` (historical comment referencing the retired MSSQL/MJ_5_14_0 fixture approach — safe mechanical cleanup, low priority).
- Several `tests/integration/**/*.spec.ts` files import from `@mj-forge/main/...` / `@mj-forge/shared` (already forge-namespaced, not MemberJunction-namespaced) — no finding.

No test in the repo asserts an exact string like `"MJ Forge"` or `"MemberJunction"` as expected UI text. **See the dedicated Breaking Assertions section (§10) for the full, deliberately short list.**

### 8h. tests/reporter/** (HTML/dashboard reporter branding)

This is genuinely user-facing tooling output (the live dashboard at `http://127.0.0.1:5188` and the static HTML report), not test code — all MECHANICAL string swaps:

| File | Line | Current string | Recommended replacement |
|---|---|---|---|
| `tests/reporter/build-report.mjs` | 35 | `console.log('▶ MJ Forge regression run starting');` | `'▶ Forge regression run starting'` |
| `tests/reporter/render-html.mjs` | 2073 | `<title>MJ Forge — regression report (...)</title>` | `<title>Forge — regression report (...)</title>` |
| `tests/reporter/render-html.mjs` | 2080 | `<h1><span class="accent">MJ Forge</span> Regression Report</h1>` | `<h1><span class="accent">Forge</span> Regression Report</h1>` |
| `tests/reporter/serve.mjs` | 2 | `// Live dashboard server for the MJ Forge regression harness.` | `// Live dashboard server for the Forge regression harness.` |
| `tests/reporter/serve.mjs` | 185 | `console.log(\`  MJ Forge live dashboard:  ${localUrl}\`);` | `` `  Forge live dashboard:  ${localUrl}` `` |
| `tests/reporter/serve.mjs` | 1511 | `<title>MJ Forge · Regression Harness</title>` | `<title>Forge · Regression Harness</title>` |
| `tests/reporter/serve.mjs` | 1518 | `<h1><span class="accent">MJ Forge</span> Regression Harness</h1>` | `<h1><span class="accent">Forge</span> Regression Harness</h1>` |

`tests/reporter/playwright-live-reporter.mjs` and `tests/reporter/vitest-live-reporter.mjs` — no MJ/MemberJunction references found.

---

## 9. JUDGMENT — the `__mj` / MemberJunction-schema-awareness test feature

This is the single most consequential decision in this scan and deserves its own section.

**What exists today:**
- `tests/e2e/mj-schema.spec.ts` — asserts Forge can query a `__mj` PostgreSQL schema (MemberJunction's internal metadata schema convention) and get correct row counts (11 seeded applications, 24 seeded entities).
- `tests/fixtures/postgres/mj-schema.sql` / `mj-seed.sql` — a minimal synthetic `__mj.user` / `__mj.application` / `__mj.entity` schema + seed data, explicitly modeled on real MemberJunction's schema shape (per its own header comment: *"Minimal MemberJunction (\_\_mj) schema for regression-test purposes... Real MJ has dozens of tables..."*).
- `plans/2026-01-26-fixes-and-features.md` §5 ("MemberJunction Database Awareness", lines 188–337) documents a **shipped renderer feature**: Forge detects when a connected database has a `__mj` schema with an `Entity` table and shows a tooltip `"MemberJunction Database ({{ node.mjInfo.entityCount }} entities)"` in the Object Explorer tree.
- `tests/README.md` (legacy) / `tests/regression-suite.md` both document this as tests 22–23 of the original 31-test audit ("MJ Entity query", "MJ Application query").

**Why this isn't a pure rename:** Forge has a real, working feature that recognizes and labels databases as "MemberJunction databases" by name, in the product UI, based on schema introspection. This is outside my scan domain to fix (it's renderer + main-process code — `packages/renderer/src/app/core/state/explorer.state.ts` and `packages/main/src/services/sql/metadata.ts` both showed up in my initial grep of MemberJunction references across the whole repo, confirming this is live code, not just test/doc scaffolding).

**Options for Craig:**
1. **Keep the feature, rename only the display label** — e.g. still detect `__mj` schema, but the tooltip says something generic like "Framework-managed database (N entities)" instead of naming MemberJunction. Tests/fixtures get renamed (`mj-schema.sql` → e.g. `entity-schema.sql`) but keep testing the same `__mj` detection logic.
2. **Remove the feature entirely** — Forge stops special-casing `__mj` schemas. This is a product-scope change, not a docs fix — someone needs to decide if losing "one-click recognize a MemberJunction-managed DB" is acceptable for the rebrand.
3. **Keep the feature exactly as-is, including the MemberJunction name in the UI label** — arguably legitimate on the theory that recognizing a *specific third-party schema convention* your users may have databases built with is a genuine interop feature (like recognizing a Rails-migrations table), not "branding." This conflicts with the stated goal of "ALL MemberJunction references removed," so flagging rather than assuming.

I'm not deciding this — it changes shipped product behavior, not just strings. Recommend Craig weigh in before an executor touches `tests/e2e/mj-schema.spec.ts`, its fixtures, or the underlying `explorer.state.ts`/`metadata.ts` detection logic (owned by the code-domain scan).

If option 1 or 2 is chosen, the MECHANICAL file/identifier renames would be:

| Current | Suggested |
|---|---|
| `tests/e2e/mj-schema.spec.ts` | `tests/e2e/entity-schema.spec.ts` (or similar) |
| `tests/fixtures/postgres/mj-schema.sql` | `tests/fixtures/postgres/entity-schema.sql` |
| `tests/fixtures/postgres/mj-seed.sql` | `tests/fixtures/postgres/entity-seed.sql` |
| `ensureForgeTestSeeded()` comment references to "MJ schema" (`tests/helpers/forge-actions.ts` lines 36–37, 58) | reword |
| Schema name `__mj` itself, table names `__mj.user`/`__mj.application`/`__mj.entity` | **judgment — this is the actual schema-convention string being tested, changing it changes what the feature detects, see options above** |

---

## 10. Breaking Test Assertions — dedicated section

**Short answer: none.** I searched every `.spec.ts` file under `tests/` for assertions on branded text (`toContain`, `toHaveText`, `getByText`, `getByRole(... name: ...)`, `window.title()`) that reference "MJ Forge," "MemberJunction," or similar, and found exactly one relevant assertion — and it will **keep passing**, not break:

| File:Line | Assertion | Why it does NOT break |
|---|---|---|
| `tests/e2e/welcome-screen.spec.ts:18` | `expect(title.toLowerCase()).toContain('forge');` | Window title is asserted to merely *contain* the lowercase substring "forge" — under a rebrand to plain "Forge," the window title will still contain "forge." This assertion is already forward-compatible and needs no change. |

No test anywhere asserts the literal strings `"MJ Forge"` or `"MemberJunction"` as expected UI text, window title, or dialog content. The `__mj` schema-name assertions in `tests/e2e/mj-schema.spec.ts` (lines 45, 48, 66, 68) assert on **row counts and fixture data values** ("Knowledge Base", "Audit Log", "/11 rows/i", "/24 rows/i") — not on branding strings — so they won't break from a MemberJunction/MJ string rename. They *would* break if the underlying feature/schema-name itself is changed per the §9 JUDGMENT decision, in which case the fixture data and assertions need to move together as one atomic change (COORDINATED, not a simple find/replace, since the SQL files, the spec file, and `forge-actions.ts`'s `ensureForgeTestSeeded()` all reference the same `__mj` name and row-count contract).

**Executor guidance:** it is safe to mechanically rename "MJ Forge" → "Forge" and reword "MemberJunction" mentions across `tests/**` (per the tables above) without needing to touch any test assertion in the same pass — **except** for the `__mj`-schema feature, which depends on Craig's §9 decision first.

---

## 11. package.json files, electron-builder.yml — flagged for cross-reference with code-domain scan

These are not strictly "docs/tests," but the task explicitly asked me to check `package.json` for the `@memberjunction/ng-markdown` dependency, so full findings here (the code-domain scan agent should also see this table, since some of these are source-adjacent):

| File | Line | Current | Note | Class |
|---|---|---|---|---|
| `package.json` (root) | 2 | `"name": "mj-forge"` | Root workspace package name | MECHANICAL (rename to `"forge"`) |
| `package.json` (root) | 58 | `"@memberjunction/sqlglot-ts": "^5.23.0"` | Real dependency — see §12 | JUDGMENT |
| `packages/renderer/package.json` | 2 | `"name": "@mj-forge/renderer"` | Already forge-namespaced, not MJ-namespaced | — (no finding — this is fine to leave, or rename `@mj-forge/*` → `@forge/*` as ONE coordinated cross-repo rename, out of docs/tests scope) |
| `packages/renderer/package.json` | 4 | `"description": "Angular renderer for MJ Forge"` | | MECHANICAL |
| `packages/renderer/package.json` | 28 | `"@memberjunction/ng-markdown": "^3.2.0"` | Real dependency — see §12 | JUDGMENT |
| `packages/renderer/package.json` | 29 | `"@memberjunction/ng-shared-generic": "^3.2.0"` | Real dependency — see §12 | JUDGMENT |
| `packages/shared/package.json` | 4 | `"description": "Shared types and constants for MJ Forge"` | | MECHANICAL |
| `packages/cli/package.json` | 4 | `"description": "Command-line interface for MJ Forge SQL Server management"` | | MECHANICAL |
| `packages/cli/package.json` | 37 | `"author": "MJ Forge"` | | MECHANICAL |
| `packages/main/package.json` | 4 | `"description": "Electron main process for MJ Forge"` | | MECHANICAL |
| `packages/preload/package.json` | 4 | `"description": "Electron preload scripts for MJ Forge"` | | MECHANICAL |
| `electron-builder.yml` | 1 | `appId: com.memberjunction.forge` | **macOS scopes Keychain items and some app-specific storage by bundle/app ID** — changing this is NOT a cosmetic rename; it can orphan existing users' saved connection profiles/credentials on upgrade. Flag prominently for code-domain agent + Craig; needs a migration plan, not just a string swap. | **COORDINATED / HIGH RISK** |
| `electron-builder.yml` | 2 | `productName: MJ Forge` | Drives DMG/EXE artifact filenames (`${productName}-${version}-${arch}.dmg` etc., lines 100, 122) and the Electron `app.getName()` default, which in turn affects the userData directory name (see `plans/perf-baselines.md` finding re: `~/Library/Application Support/mj-forge/`). Renaming this changes where the packaged app stores user data going forward — existing installs' data at the old path won't be found unless something migrates it. | **COORDINATED / HIGH RISK** |
| `electron-builder.yml` | 3 | `copyright: Copyright © 2026 MemberJunction` | Same copyright-holder question as LICENSE (§3) | **JUDGMENT** |
| `scripts/package.js`, `scripts/prepare-package.js`, `scripts/restore-package.js`, `scripts/workspace-links.js` | various (comments + one literal path `node_modules/@mj-forge/`) | Comments referencing `@mj-forge/*` workspace symlink management | Already forge-namespaced (not MJ-namespaced) — only relevant if the `@mj-forge` npm scope itself is renamed later; not a MemberJunction reference per se | — (no finding for this scan's purpose) |

**Note on scope boundary:** `packages/*/package.json` "description"/"author" field edits and the `@mj-forge/*` → possible `@forge/*` npm-scope rename are genuinely shared territory between this docs/tests/tooling scan and whatever scan covers `packages/**` source code — I'm surfacing them here because they're metadata/config, not TypeScript logic, but recommend de-duplicating against that other scan's findings before execution.

---

## 12. `@memberjunction/*` npm dependency blast radius (explicitly requested)

Three distinct `@memberjunction/*` scoped packages are **currently installed, real, external dependencies** — not internal code that happens to be named after MemberJunction. None of these can be fixed by a documentation or string rename; each requires either (a) keeping the dependency and being honest about it in docs, or (b) a real migration to a replacement library, which is a functional code change with real engineering risk (the ticket's framing "Replacing it is a real code change, not a doc change" applies to all three, not just `ng-markdown`).

| Package | Declared in | Version | Import site(s) | What it does |
|---|---|---|---|---|
| `@memberjunction/ng-markdown` | `packages/renderer/package.json:28` | `^3.2.0` | `packages/renderer/src/app/features/chat/chat-panel.component.ts:23` — `import { MarkdownModule } from '@memberjunction/ng-markdown';` | Renders AI-generated markdown in the chat panel. **Exactly 1 import site.** Per root `CLAUDE.md` (line 156 in `AI Integration Rules`), this is the *mandated* library for markdown rendering — removing it means also updating that governance rule. |
| `@memberjunction/ng-shared-generic` | `packages/renderer/package.json:29` | `^3.2.0` | `packages/renderer/src/app/app.component.ts:6`, `packages/renderer/src/app/shared/components/ai-analysis-panel/ai-analysis-panel.component.ts:22`, `packages/renderer/src/app/shared/components/result-history-panel/result-history-panel.component.ts:20` — all `import { SharedGenericModule } from '@memberjunction/ng-shared-generic';` | Shared Angular module used in 3 components (app root, AI analysis panel, result history panel). **3 import sites.** |
| `@memberjunction/sqlglot-ts` | root `package.json:58` | `^5.23.0` | `packages/main/src/services/sql/sql-converter.ts:13-14` — `import { SqlGlotClient } from '@memberjunction/sqlglot-ts'; import type { TranspileResult, SQLDialect as SqlGlotDialect } from '@memberjunction/sqlglot-ts';` | Powers cross-dialect SQL conversion, called out as a headline feature in README.md line 57 and 306, and in the Roadmap (line 421). **1 file, 2 import statements.** This is also the subject of `docs/SQL-CONVERSION-STUDY.md`, which recommends it by name (line 13) as "Library Candidates #1." |

**Additionally**, three source comments reference a *fourth*, unrelated MemberJunction package that was apparently used as design inspiration but is **not an installed dependency** — grep confirms `@memberjunction/global` does not appear in any `package.json`:

- `packages/main/src/utils/singleton.ts:2` — `* Singleton base class adapted from @memberjunction/global`
- `packages/main/src/utils/json-utils.ts:2` — `* JSON utilities adapted from @memberjunction/global`
- `packages/main/src/utils/object-cache.ts:2` — `* Object cache adapted from @memberjunction/global`
- `packages/main/src/services/sql/dialect/sql-dialect.ts:7` — `* see @memberjunction/sql-dialect for the upstream design.` (also not an installed dependency)

These four comments are MECHANICAL from a docs-only view (they're just code comments citing prior art/inspiration, not functional imports) — but they live in `.ts` source files, so touching them is technically the code-domain scan's territory. Flagging here since the ticket specifically asked me to trace the `ng-markdown` blast radius and I found these adjacent ones in the process.

**Recommendation:** Craig needs to decide, for each of the 3 real dependencies, whether to (a) keep using the MemberJunction-published package and disclose it honestly (e.g., "Forge builds on select open-source MemberJunction packages" — a factual dependency notice, distinct from the aspirational README "built by the team behind MemberJunction" framing), or (b) replace each with a different library — which is a real migration project (evaluate alternatives, port usage, test regressions) for each of the 3, not something a rebrand pass can safely do as a side effect.

---

## 13. .claude/ directory

Full file listing (confirmed via `find`):
```
.claude/commands/commit.md
.claude/commands/publish-build.md
.claude/commands/test-ui.md
.claude/skills/electron/SKILL.md
.claude/skills/forge-regression-harness/SKILL.md
.claude/skills/wiki-author/SKILL.md
.claude/skills/wiki-author/references/page-template.md
.claude/skills/wiki-author/references/sidebar-example.md
.claude/skills/wiki-author/references/subagent-brief-template.md
```
**No `.claude/settings.json` and no `.claude/agents/` directory exist.**

| File | Line | Current string | Recommended replacement | Class |
|---|---|---|---|---|
| `.claude/commands/commit.md` | — | No MJ/MemberJunction references found | — | — |
| `.claude/commands/test-ui.md` | 1 | `Run the Playwright UI regression test suite against the MJ Forge Electron app.` | `...against the Forge Electron app.` | MECHANICAL |
| `.claude/commands/publish-build.md` | 1 | `Build, tag, and publish a new release of MJ Forge to GitHub...` | `...of Forge to GitHub...` | MECHANICAL |
| `.claude/commands/publish-build.md` | 53, 54, 60, 65 | `gh run list --repo MemberJunction/Forge`, `gh run watch ... --repo MemberJunction/Forge`, `gh release view v{VERSION} --repo MemberJunction/Forge`, `gh release download v{VERSION} --repo MemberJunction/Forge` | Update `--repo` flag values to the new org/slug once repo is actually moved/renamed on GitHub | **COORDINATED** (must match wherever the GitHub repo actually lives — don't edit this ahead of the actual repo move) |
| `.claude/commands/publish-build.md` | 71 | `The user-facing docs at https://github.com/MemberJunction/Forge/wiki must reflect what shipped.` | Update URL | COORDINATED (same repo-move dependency) |
| `.claude/commands/publish-build.md` | 87 | `` `https://raw.githubusercontent.com/MemberJunction/Forge/v{PREVIOUS}/docs/screenshots/<name>.png` `` | Update URL pattern | COORDINATED (same repo-move dependency; also depends on §6's screenshot re-capture) |
| `.claude/skills/electron/SKILL.md` | 3 | `description: '...building Electron features for MJ Forge — ...'` | `for Forge` | MECHANICAL |
| `.claude/skills/electron/SKILL.md` | 8 | `You are a senior Electron developer working on MJ Forge, a native macOS database management app...` | `working on Forge, ...` | MECHANICAL |
| `.claude/skills/electron/SKILL.md` | 12 | `MJ Forge structure:` | `Forge structure:` | MECHANICAL |
| `.claude/skills/forge-regression-harness/SKILL.md` | 3 (frontmatter description) | `Use the MJ Forge regression test harness to drive quality...` | `Use the Forge regression test harness...` | MECHANICAL |
| `.claude/skills/forge-regression-harness/SKILL.md` | 6 | `# MJ Forge Regression Harness` | `# Forge Regression Harness` | MECHANICAL |
| `.claude/skills/wiki-author/SKILL.md` + `references/*` | — | No MJ/MemberJunction references found in any of the 4 wiki-author files | — | — |

**Note:** the frontmatter `description:` fields (electron SKILL.md line 3, forge-regression-harness SKILL.md line 3) are used by the Claude harness for skill-triggering/matching — editing them is safe (still descriptive, still triggers correctly) but should be done carefully to not accidentally break the trigger-matching phrasing the skill relies on ("building Electron features for Forge" reads fine and preserves all the same trigger keywords).

---

## 14. Editor configs (.vscode, .idea) and other hidden dirs

- **No `.vscode/` directory anywhere in the repo** (checked root and recursively, excluding `node_modules`).
- **No `.idea/` directory anywhere in the repo.**
- `.changeset/config.json` — no branding, name-agnostic, no finding.
- `.github/workflows/build-release.yml` and `.github/workflows/ci.yml` — **no MemberJunction/MJ Forge references found** (checked both files fully); they don't hardcode the GitHub org/repo name (rely on `${{ github.repository }}`-style relative context), so **no changes needed** in the workflow YAML itself for the rebrand — only the `.claude/commands/publish-build.md` instructions that reference `--repo MemberJunction/Forge` explicitly (§13) need updating, and only once the actual repo is renamed/moved.
- `.husky/pre-commit` — single line, `npx lint-staged`, no branding.

---

## 15. Summary tables by classification

### MECHANICAL (safe exact-string find/replace) — representative list, not exhaustive of every line already tabulated above

| # | File | Line(s) | Change |
|---|---|---|---|
| 1 | README.md | 5, 39, 41, 51, 138, 241, 243, 360 | "MJ Forge" → "Forge" |
| 2 | CONTRIBUTING.md | 1, 3, 56 | "MJ Forge" → "Forge" |
| 3 | docs/ARCHITECTURE.md | 1, 5 | "MJ Forge" → "Forge" |
| 4 | docs/ARCHITECTURE.md | 245 | reword MemberJunction-pattern comment |
| 5 | tests/README.md | 1, 5 | "MJ Forge" → "Forge" |
| 6 | tests/docker-compose.test.yml | 1 | "MJ Forge" → "Forge" |
| 7 | vitest.config.ts | 2, 4 | "MJ Forge" → "Forge"; reword pattern-credit line |
| 8 | tests/reporter/build-report.mjs | 35 | "MJ Forge" → "Forge" |
| 9 | tests/reporter/render-html.mjs | 2073, 2080 | "MJ Forge" → "Forge" |
| 10 | tests/reporter/serve.mjs | 2, 185, 1511, 1518 | "MJ Forge" → "Forge" |
| 11 | .claude/commands/test-ui.md | 1 | "MJ Forge" → "Forge" |
| 12 | .claude/commands/publish-build.md | 1 | "MJ Forge" → "Forge" |
| 13 | .claude/skills/electron/SKILL.md | 3, 8, 12 | "MJ Forge" → "Forge" |
| 14 | .claude/skills/forge-regression-harness/SKILL.md | 3, 6 | "MJ Forge" → "Forge" |
| 15 | packages/*/package.json | descriptions/author (6 files) | "MJ Forge" → "Forge" |
| 16 | package.json (root) | 2 | `"mj-forge"` → `"forge"` |
| 17 | tests/e2e/connection.spec.ts | 5 | stale comment cleanup |

(~46 total individual line-level mechanical changes across the above, per full per-file tables in §1–§13.)

### COORDINATED (atomic multi-file changes)

1. **GitHub org/repo URLs** — all `github.com/MemberJunction/Forge` and `raw.githubusercontent.com/MemberJunction/Forge` references across `README.md` (14 occurrences), `CONTRIBUTING.md` (3), `.claude/commands/publish-build.md` (5 `--repo`/URL references). Must land together, and only once the repo is actually renamed/transferred on GitHub — editing these first would point at a URL that 404s.
2. **`productName`/`appId` in `electron-builder.yml`** ↔ DMG/EXE artifact filenames referenced in `README.md` (lines 194, 195, 199, 201) ↔ Electron `userData` directory path (documented in `plans/perf-baselines.md` as `~/Library/Application Support/mj-forge/`) ↔ macOS Keychain scoping. **High risk** — needs a data-migration plan from the code-domain agent before `productName`/`appId` change, not a pure rename.
3. **`__mj` schema-awareness feature** — `tests/e2e/mj-schema.spec.ts` + `tests/fixtures/postgres/mj-schema.sql` + `tests/fixtures/postgres/mj-seed.sql` + `tests/helpers/forge-actions.ts` (`ensureForgeTestSeeded`) + the underlying renderer/main-process detection logic (out of my domain) all move together if Craig chooses to rename-but-keep (§9 option 1) or must be deleted together if removed (§9 option 2).

### JUDGMENT (human decision needed)

1. **LICENSE file** — doesn't exist; need to create one and decide the copyright holder name (§3).
2. **README "Acknowledgments" section** — keep/reword/remove the "built by the team behind MemberJunction" attribution + badge (§1, line 456-464).
3. **docs/ARCHITECTURE.md "inspired by MemberJunction" line** (line 97) — keep consistent with the README decision above.
4. **`__mj` schema-awareness feature** — keep/rename/remove, spans tests + fixtures + shipped renderer/main-process code (§9). Most consequential item in this scan.
5. **Three real `@memberjunction/*` npm dependencies** (`ng-markdown`, `ng-shared-generic`, `sqlglot-ts`) — keep-and-disclose vs. replace-with-migration (§12).
6. **docs/SQL-CONVERSION-STUDY.md speculative `@memberjunction/sqlglot` subsection** (lines 27-29) — delete or correct now that the real shipped dependency is `sqlglot-ts` (§5).
7. **`plans/**` treatment** — leave as history / mechanically rename / archive superseded docs (§7). Recommend leave-as-history.
8. **`tests/README.md` and `tests/regression-suite.md`** — both describe a legacy `full-audit.spec.ts` suite that no longer exists in the repo; recommend deciding whether to delete, merge, or explicitly mark historical (§8a-8b) — pre-existing staleness, not rebrand-caused, but blocks a clean mechanical pass since half their content is about a test file that's gone.
9. **`docs/screenshots/**` (8 PNGs)** — must be recaptured post-rebrand if any baked-in on-screen text currently reads "MJ Forge"; cannot be fixed by find/replace (§6).

---

## Appendix: files scanned with zero MemberJunction/MJ findings (confirmed clean)

- `plans/future-multi-database.md`
- `plans/2026-07-21-dsql-iam-auth.md`
- `.github/workflows/build-release.yml`
- `.github/workflows/ci.yml`
- `.husky/pre-commit`
- `.changeset/config.json`
- `.claude/commands/commit.md`
- `.claude/skills/wiki-author/SKILL.md` and its 3 `references/*.md` files
- `tests/reporter/playwright-live-reporter.mjs`, `tests/reporter/vitest-live-reporter.mjs`
- All of `tests/e2e/*.spec.ts` and `tests/e2e/visual/*.spec.ts` except `mj-schema.spec.ts` and the one stale comment in `connection.spec.ts:5`
- `tests/integration/**/*.spec.ts` (only clean `@mj-forge/*` import-path references, already forge-namespaced)
- No `.vscode/`, `.idea/`, `LICENSE`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, or root `CHANGELOG` exist anywhere in the repo.
