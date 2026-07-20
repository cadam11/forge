Build, tag, and publish a new release of MJ Forge to GitHub with CI-built installers for macOS and Windows.

## Inputs

Ask the user:

1. **Version number** (e.g. `0.4.0`) — or suggest the next patch/minor based on current version in `package.json`
2. **Release notes** — or offer to auto-generate from commits since the last tag

## Steps

### 1. Pre-flight checks

- Ensure working tree is clean (`git status` — no uncommitted changes)
- Ensure you're on the `main` branch
- Confirm all packages build successfully: `npm run build`
- Check the current version in `package.json` and the latest git tag

### 1a. Run the full regression harness — REQUIRED RELEASE GATE

**This is mandatory for every release. No release proceeds on a red or skipped harness.** Invoke the **forge-regression-harness** skill and run the complete 4-tier pipeline:

- The harness needs the Docker daemon running (it brings up the test Docker Compose stack). If Docker is down, start it and wait for the daemon before running.
- Run `npm run test:full` — it brings the harness up, runs unit/integration/e2e/visual, writes structured JSON to `tests/reports/.cache/`, and **exits non-zero on any failure**.
- **Gate:** the run must exit 0 (all tiers green). If anything fails, STOP — do not bump, tag, or push. Surface the failures (read `tests/reports/.cache/{tier}.summary.md`), fix or get the user's call, and re-run until green.
- Only after a green harness do you continue to the version bump.

### 2. Bump version

- Update `version` in root `package.json` to the new version number

### 3. Commit and open a bump PR — do NOT push to `main` directly

The project hard rule is **never push directly to `main`** (see root CLAUDE.md). The release convention is a dedicated bump branch merged via PR (see PRs #26 / #28 / #38) — the tag is then placed on the merge commit. Direct-to-main pushes are blocked by the permission classifier anyway.

- Create branch `chore/bump-v{VERSION}`
- Stage `package.json` **only** (don't sweep in unrelated working-tree changes)
- Commit: `chore: bump version to v{VERSION}`
- Push the branch and open a PR into `main` via `gh pr create` (summarize the release + confirm the harness gate is green in the body)
- Merge with `gh pr merge --merge --delete-branch` (a real merge commit, so the tag can point at it)
- Sync local main: `git checkout main && git pull origin main`

### 4. Tag and push tag

- Create an annotated tag at the merge commit: `git tag -a v{VERSION} -m "Release v{VERSION}"`
- Push tag: `git push origin v{VERSION}`
- This triggers the GitHub Actions CI workflow (`.github/workflows/build-release.yml`) which builds:
  - macOS: DMG + ZIP for both arm64 and x64
  - Windows: NSIS installer + ZIP for both x64 and arm64

### 5. Monitor CI

- Watch the GitHub Actions run: `gh run list --repo MemberJunction/Forge --limit 1`
- Wait for completion: `gh run watch {RUN_ID} --repo MemberJunction/Forge --exit-status`
- Both `macos-latest` and `windows-latest` jobs must pass
- If a job fails, investigate with `gh run view --job={JOB_ID} --log-failed`, fix, and re-tag

### 6. Verify release

- Check the release page: `gh release view v{VERSION} --repo MemberJunction/Forge`
- Confirm all expected assets are present (typically 16 files: DMGs, ZIPs, EXEs, blockmaps)

### 7. Local test install (macOS)

- Download the arm64 DMG: `gh release download v{VERSION} --repo MemberJunction/Forge --pattern "*arm64.dmg" --dir ~/Downloads`
- Inform the user the DMG is ready at `~/Downloads/` for manual testing
- Remind: right-click → Open to bypass Gatekeeper (app is not yet notarized)

### 8. Update the wiki

The user-facing docs at https://github.com/MemberJunction/Forge/wiki must reflect what shipped. Invoke the **wiki-author** skill (`.claude/skills/wiki-author/SKILL.md`) — it handles the clone-write-commit-push workflow, including the wiki's `master` (not `main`) default branch and the team-of-authors + dedicated wiki-editor pattern.

Two things must happen on every release:

**A. Refresh `Release-Notes.md`.** Summarise v{VERSION} highlights — feature additions, behaviour changes, and UX shifts the user will notice. Pull from `git log v{PREVIOUS}..v{VERSION} --no-merges` and merged PR titles. Keep it short; the page points readers at the full GitHub Releases for everything else.

**B. Audit content pages for drift.** Walk the changes since the last tag and update any wiki page whose feature surface moved. Common drift sources:

- New AI tools, providers, or models → `AI-Assistant-Setup.md`, `Using-the-AI-Assistant.md`
- New menu items or keyboard shortcuts (especially anything added to `packages/main/src/menu.ts` or `shortcuts-dialog.component.ts`) → `Keyboard-Shortcuts.md` and the relevant feature page
- New connection options or auth flows → the relevant `Connecting-to-X.md` / `SSH-Tunneling.md` / `Azure-Entra-ID.md`
- Object Explorer, ERD, Execution Plan, Backup/Restore, Snippet Library behaviour → the corresponding feature page
- New settings → `Settings.md` (and potentially the affected feature page)

For a **patch release with no UX changes**, the audit may yield only the `Release-Notes.md` edit — that's fine, push it as a single-page commit. For **minor or major releases**, expect 3–5 content pages to need updates.

**Screenshots:** the wiki pins image URLs to a specific release tag (e.g. `https://raw.githubusercontent.com/MemberJunction/Forge/v{PREVIOUS}/docs/screenshots/<name>.png`) for stability. If the UI shifted in this release, re-capture the affected screenshots (the wiki-author skill describes the playwright-cli flow against a Docker SQL Server) and update the tag in the URL to v{VERSION}. If the UI did not shift, leave the older tag as-is — pinning to v{VERSION} every release just to update the tag is churn.

**Commit message:** `docs(wiki): update for v{VERSION}` (conventional commit). Push directly to wiki `master` after a `git diff --stat` review — wikis don't support PRs, so the push _is_ the publish. The user has standing authorization for wiki pushes during a release run; you don't need to re-confirm each one.

## Troubleshooting

- **`cpu-features` build failure**: The `scripts/before-build.js` hook removes this incompatible optional module before `@electron/rebuild` runs. If it still fails, check that `before-build.js` exists and is referenced in `electron-builder.yml` under `beforeBuild`.
- **Missing dependencies in packaged app**: The `beforeBuild` hook MUST return `true`. Returning `false` tells electron-builder that node_modules are handled externally, which excludes all deps from the asar.
- **Workspace symlink issues**: `scripts/prepare-package.js` replaces the `@mj-forge/shared` symlink with a real copy. This runs automatically as part of `npm run package`.
