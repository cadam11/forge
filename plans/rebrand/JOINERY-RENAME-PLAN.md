# Joinery Rename — Execution Plan

**Goal:** the product is named **Joinery** (never "Forge", never "MJ Forge", never "MemberJunction"),
across code, build, docs, tests, and tooling. This is the second rename pass; the first
(MJ Forge → Forge) merged as PRs #1–#3 and its inventory lives in the sibling `scan-*.md` files.

**Context:** a prior session already applied part of the Joinery brand (staged, uncommitted, on
`main`): new icons, `docs/brand/` kit, welcome/sidebar/status-bar/chat-panel/menu copy, README,
`electron-builder.yml`. That work must be committed first on a feature branch, then the scrub
completes everything it missed.

## Decisions (settled — do not re-litigate)

| #   | Decision                            | Value                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| J1  | Product name                        | `Joinery`                                                                                                                                                                                                                                                                      |
| J2  | Root package name                   | `joinery`                                                                                                                                                                                                                                                                      |
| J3  | npm workspace scope                 | `@forgedb/*` → `@joinery/*`                                                                                                                                                                                                                                                    |
| J4  | Bundle / app id                     | `ca.adam11.forge` → `ca.adam11.joinery`                                                                                                                                                                                                                                        |
| J5  | macOS app / executable              | `Forge.app` → `Joinery.app`                                                                                                                                                                                                                                                    |
| J6  | userData dir                        | `~/Library/Application Support/Forge` → `.../Joinery` — clean break, no migration (same as prior rename's D2). Saved profiles/history under the old dir are abandoned.                                                                                                         |
| J7  | Keychain service name               | rename to `Joinery` (or `ca.adam11.joinery`) — clean break, no credential migration                                                                                                                                                                                            |
| J8  | Preload bridge                      | `window.forge` → `window.joinery` (and any `forge` IPC namespace strings)                                                                                                                                                                                                      |
| J9  | GitHub repo                         | already `github.com/cadam11/joinery` — fix any stale `cadam11/forge` or `MemberJunction/*` URLs                                                                                                                                                                                |
| J10 | Copyright                           | `Copyright © 2026 Craig Adam` (unchanged)                                                                                                                                                                                                                                      |
| J11 | Completed-rebrand planning docs     | **Delete** `REBRAND-PLAN.md` and `scan-1..6*.md` (they exist only to inventory old names; work is done). **Keep** `FOLLOW-UPS.md` (live backlog) and this file — rename Forge → Joinery inside them.                                                                           |
| J12 | Other `plans/*.md` historical docs  | Keep, but replace product-name references (Forge → Joinery); do not rewrite their substance.                                                                                                                                                                                   |
| J13 | Repo `.claude/` skills & scripts    | Rename and rewrite: `forge-regression-harness` → `joinery-regression-harness`, `publish-build`, `test-ui`, `commit`, etc. — all Forge references become Joinery. Untracked dirs (`.agents/`, new `.claude/skills/*`) are out of scope: do not commit them, do not modify them. |
| J14 | Test fixture `__mj` schema handling | Already resolved in prior rename (D6) — do not revisit; just ensure no stray `mj`/`forge` naming remains in test code and snapshots that isn't the intentional fixture schema name.                                                                                            |

## Tasks

### Task 1: Branch, commit prior work, complete the Joinery scrub

1. From `main`, create branch `feature/joinery-rename`.
2. Commit the existing modified files (staged AND unstaged — they are one body of prior-session
   work) as `feat: apply Joinery brand kit and initial rename (prior session work)`. Do NOT add
   untracked directories (`.agents/`, `.claude/skills/add-dark-mode` etc.) — leave them untracked.
3. Inventory every remaining occurrence: `git grep -inE 'forge|memberjunction|mj-forge|mjforge|forgedb'`
   plus case variants, filenames (`git ls-files | grep -i forge`), and package names. Check
   `packages/*/package.json`, `electron-builder.yml`, `packages/main` (app name, userData,
   keychain, menu, window title, logger), `packages/preload` (bridge key), `packages/renderer`
   (copy, storage keys, titles), `packages/shared`, CLAUDE.md, README.md, `docs/`, `plans/`,
   `tests/`, `scripts/`, tracked `.claude/` files, CI workflows (`.github/`).
4. Apply the naming table above everywhere. Conventional commits, logically grouped (e.g.
   `refactor: rename npm scope to @joinery`, `docs: ...`). Preserve the
   "Session model" section at the top of CLAUDE.md verbatim.
5. Storage/localStorage keys, config filenames, and log file paths that embed the old name:
   rename them (clean break; no migration shims).
6. Update `plans/rebrand/FOLLOW-UPS.md` wording to Joinery; delete the files per J11.

**Verification gates (all must pass; paste outputs in your report):**

- `git grep -iE 'memberjunction|mj-forge|mjforge|forgedb'` → zero hits.
- `git grep -iE '\bforge\b'` → zero hits, except (a) this plan file and FOLLOW-UPS where they
  refer to the _old_ name historically, (b) the intentional `__mj` test fixture schema if any.
  List every surviving hit in the report with justification.
- `pnpm install` (lockfile updates from package renames), `pnpm run typecheck`, `pnpm run lint`,
  and the non-Docker test tier (`pnpm run test:unit`) all pass.
- Do NOT run Docker-dependent tiers (integration/e2e/visual) — Docker is not running.
- App boots in dev is NOT required for this task (verified later in priority 3).

**Out of scope:** UI redesign (priority 2), visual-baseline regeneration, git-history rewrite,
the FOLLOW-UPS backlog items themselves.
