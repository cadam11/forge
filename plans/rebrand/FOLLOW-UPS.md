# Forge — follow-up work

Deferred items from the rebrand (PR #1), the markdown renderer swap (PR #2), and
the pnpm migration (PR #3). GitHub issues are disabled on this repo, so this file
is the backlog. Delete an entry when it lands; delete the file when it is empty.

Ordered by priority.

---

## 1. Visual regression baselines are stale — `test:visual` is RED on `main`

PR #1 merged with the baselines in `tests/__snapshots__/visual/` still showing
"MJ Forge", the old MemberJunction bowtie mark, and the old status bar. Docker was
unavailable while the rebrand was executed, so they could not be regenerated then.

```bash
pnpm run test:harness:up
pnpm run build
pnpm run test:visual:update
```

Check the regenerated PNGs before committing. Do not run `:update` reflexively — it
regenerates from current behaviour whether or not that behaviour is correct.

`pnpm run test:e2e` was also never run against the rebrand for the same reason.

---

## 2. No `will-navigate` guard in the main process

`packages/main/src/window.ts` installs neither `setWindowOpenHandler` nor a
`will-navigate` handler, and `packages/renderer/src/index.html` has no CSP. The
preload calls `contextBridge.exposeInMainWorld('forge', …)` unconditionally and
re-runs on every document load, so **any** in-app navigation hands the full IPC
surface — SQL execution, keychain, `openExternal` — to the destination page.

PR #2 closed the markdown link path specifically (`markdown-viewer.component.ts`
intercepts `a[href]` and routes to `shell.openExternal`), but the sink itself is
still open to any other route in.

Also worth doing: `packages/main/src/ipc/app.ipc.ts:21` calls
`shell.openExternal(url)` with no scheme validation.

---

## 3. Recapture the README screenshots

The eight PNGs in `docs/screenshots/` were **deleted** in PR #1 rather than
rebranded — they had "MJ Forge" baked into the pixels, and `home-screen-*.png`
additionally published an internal MemberJunction Azure SQL hostname
(`mjc-sql-dev.database.windows.net`, database `mjc-db-dev`, connection `MJC-DEV`)
on the repo's front page.

Recapture against a local Docker database, then restore the README's `## Screenshots`
section and its entry in the nav list at the top. The old images remain in git
history — the hostname is not scrubbed, only unpublished.

---

## 4. GitHub `[!NOTE]` callouts render as literal text

`marked-alert` came transitively with `@memberjunction/ng-markdown`. Without it:

```
> [!NOTE]
> Be careful here.
```

renders as `<blockquote><p>[!NOTE]<br>Be careful here.</p></blockquote>` — the
`[!NOTE]` marker is visible cruft. Models emit these fairly often.

Fix: add `marked-alert` to the renderer's extension chain in
`packages/renderer/src/app/shared/markdown/markdown-renderer.ts` and add callout CSS
(the old package shipped none either, so alerts were unstyled divs before).

Also dropped in the same swap, lower priority: `marked-smartypants` (curly quotes,
en/em dashes) — cosmetic only. Heading IDs are gone too, but nothing linked to them.

---

## 5. Mermaid diagram CSS can escape the diagram

`sanitizeDiagramSvg` in `markdown-renderer.ts` allows `<style>`, and a `<style>`
inside an inline SVG joins the **document** stylesheet set — so CSS that escapes the
diagram can restyle the whole app. Verified reachable in real Chromium through the
component's own insertion path.

It cannot simply be forbidden: every colour mermaid emits lives in that block.

Not exploitable today. Mermaid at `securityLevel: 'strict'` id-prefixes its selectors
and rejected all three injection attempts tried against it — the `%%{init: themeCSS}%%`
directive, a `classDef` brace escape, and a `url()` payload. This is defence-in-depth
only, pinned by a test named `DOCUMENTS A KNOWN LIMITATION` in `markdown-renderer.spec.ts`.

Two defensible fixes: assert the emitted CSS is `#<diagram-id>`-prefixed before
inserting, or strip `<style>` and re-provide the theme from app CSS.

Minor, same area: mermaid emits two unprefixed global rules per diagram
(`@keyframes edge-animation-frame`, `@keyframes dash`).

---

## 6. Pre-existing rot, not caused by the rebrand

- **`pnpm run lint` has never worked.** `packages/renderer/package.json` declares
  `"lint": "ng lint"` but `angular.json` has no lint target. True before the rebrand
  too. The husky/lint-staged pre-commit hook is what actually enforces lint.
- **The renderer has no `typecheck` script**, so `pnpm run typecheck` covers only
  main/preload/shared. `ng build` is the only thing that type-checks the renderer.
- **`tests/regression-suite.md`** documents a `full-audit.spec.ts` that no longer
  exists. Marked historical in PR #1 rather than deleted — Craig's call whether it goes.
- **`README.md`** download badge says `v0.4.0` while `package.json` is `0.5.0`.
- Two `console.warn`/`console.error` calls in `ipc.service.ts` and `explorer.state.ts`
  violate CLAUDE.md's no-console rule. Fixing them properly needs a renderer logging
  service.

---

## 7. Workspace packages import dependencies they do not declare

`packages/main` imports `electron`, `@azure/msal-node`, `pg`, `mysql2`, and the
AWS SDKs without listing any of them in its own `package.json`. They resolve only
because they are declared in the ROOT manifest and Node walks up the directory
tree. Same story for `devicon` in the renderer.

That layout is not accidental: the root package.json _is_ the Electron app
manifest (`main` points at `packages/main/dist/index.js`), and electron-builder
collects the app's production dependencies from it. Moving the deps down into
`packages/main` would drop them out of the asar.

Consequence: the workspace must stay on `nodeLinker: hoisted` (see
`pnpm-workspace.yaml`). pnpm's default isolated linker would be the stricter,
better setup — it makes undeclared imports fail loudly — but it cannot be adopted
until the root-manifest coupling is untangled.

Fix, when someone has the appetite: declare each dependency in the package that
imports it _while keeping it in the root manifest_, verify the asar is unchanged
with `pnpm run verify:package`, then flip the linker.

---

## 8. Dependency versions moved during the pnpm migration

pnpm could not reproduce npm's exact tree (`pnpm import` re-resolves rather than
preserving), so regenerating the lockfile advanced 29 direct dependencies to the
newest version their existing semver range allows. Nothing was widened; the
ranges in `package.json` are untouched. Notables: `@memberjunction/sqlglot-ts`
5.23→5.51, `pg` 8.20→8.23, `mysql2` 3.20→3.23, `electron` 41.0.3→41.10.5,
`prettier` 3.8.1→3.9.6, `@playwright/test` 1.58.2→1.62.1.

Two knock-ons worth knowing:

- `prettier` 3.9.6 reformats 6 files that 3.8.1 accepted (4 source, 2 plans).
  They were left alone; the pre-commit hook will rewrite them when next staged.
- `@playwright/test` 1.62 and `electron` 41.10 both feed the visual tier, whose
  baselines are already stale (item 1). Regenerate them on a machine with Docker
  before reading any visual diff as a real regression.

If the drift is ever suspected in a bug, `git show <pre-migration-sha>:package-lock.json`
still has the old resolution.

---

## 9. Rotate the leaked SQL Server `sa` password

`mj.config.cjs` was deleted in PR #1, but it contained a plaintext `sa` password
pointing at an `MJ_5_14_0` database and **remains in git history**. Treat the
credential as leaked and rotate it independently. No history rewrite was attempted.
