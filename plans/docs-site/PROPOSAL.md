# Joinery documentation site — proposal

**Ticket:** [J-99](https://linear.app/adam11/issue/J-99) — "Build out a comprehensive user documentation site with Astro and deploy it to GitHub Pages for hosting."

**Status:** specification. Nothing is scaffolded, no dependency is added, no workflow file exists yet.
This document is the decision-ready plan; the build is Phases 1–3 below.

**Grounding:** every claim about the app in this document was read out of the tree at `1f1b723`
(main, merge of PR #42). File paths are given so the next reader can re-check rather than trust.

---

## 0. Decisions first — answer these nine and the rest is mechanical

| #   | Decision                                                                           | Recommendation                                                                                    | Cost of deferring                                                                        |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| D1  | **Custom domain**, or ship on `cadam11.github.io/joinery`?                         | ~~Ship on the Pages subpath. Revisit at v1.~~ **Revisited 2026-08-20 (J-108): `usejoinery.com`.** | Done. `docs-site/public/CNAME` + `site`/`base` change; the `/joinery` base path is gone. |
| D2  | **Docs versioning** — one "current" set, or per-release versions?                  | One set. Revisit after v1 ships.                                                                  | Zero today: there are no releases to version against.                                    |
| D3  | **In-app Help → the site?**                                                        | **Yes, and it fixes a live defect** (see §3.4). Separate one-line ticket, after Phase 1.          | The Help menu keeps pointing at an empty wiki.                                           |
| D4  | **Analytics?**                                                                     | None. Revisit if the site ever needs to justify itself.                                           | Zero.                                                                                    |
| D5  | **Placement**: `docs-site/` outside the pnpm workspace, or inside it?              | Outside (§2.3). Fallback documented.                                                              | Cheap to move later; expensive to discover the CI blast radius after the fact.           |
| D6  | **Starlight**, or plain Astro?                                                     | Starlight for docs routes; one plain Astro route for the landing page (§2.1).                     | Rewriting nav/search/theming by hand is the whole cost of getting this wrong.            |
| D7  | **Landing page** — brand-expressive marketing route at `/`, or a Starlight splash? | Splash in Phase 1, real landing route in Phase 3.                                                 | Zero.                                                                                    |
| D8  | **Does the site replace the README's feature prose, or supplement it?**            | README keeps a short list and links out; the site owns the detail.                                | They drift. The docs inventory already found four stale README claims.                   |
| D9  | **Ship the site before v1, or with it?**                                           | Before. Writing the install page under release pressure is how install pages get written wrong.   | —                                                                                        |

D1, D2, D3 and D4 are the four the brief names. D5–D9 came out of the grounding work and are the same
kind of question, so they are here rather than discovered mid-build.

**One thing only Craig can do:** GitHub Pages is not enabled on the repo today
(`gh api repos/cadam11/joinery` → `"has_pages": false`). Someone with admin has to set
**Settings ▸ Pages ▸ Source = GitHub Actions** once. No workflow can do it for itself, and Phase 1
cannot go green until it is done.

---

## 1. What this site is for, and what already exists

### 1.1 The gap, restated from evidence

`.superpowers/sdd/PLAN/followup-docs-report.md` §3 searched the whole repo for a user guide, a
getting-started doc, a feature walkthrough, or a written keyboard-shortcut reference and matched
**nothing**. Developer docs (README, CONTRIBUTING, ARCHITECTURE) exist and got a pass in Task 24.
End-user docs do not exist at all.

The only end-user help that exists lives inside the running app: the shortcuts cheat-sheet
(`packages/renderer/src/features/shortcuts-dialog/`, ⇧⌘/) and the "setup instructions" views the
backup/restore and SQL-conversion features render when a host binary is missing. Neither is reachable
before you launch the app, which means neither helps the two people who matter most — someone
evaluating Joinery on GitHub, and someone who just built it from source for the first time.

### 1.2 The content backlog this site is expected to absorb

Straight from the docs report, in the order a first-time user hits them:

1. Install / build-from-source — there are no tagged releases and no packaged installers
   (`gh api …/releases` → `[]`). README already says so honestly; the site must too.
2. First connection, per engine — plus SSH tunnelling and Entra ID auth, all three shipped, none documented.
3. AI setup — where keys are stored (Keychain / Windows Credential Store via `keytar`), and how to get one per vendor.
4. Backup/restore host-CLI prerequisites — `pg_dump`, `pg_restore`, `mysqldump`, `mysql`
   (`packages/main/src/services/sql/cli-deps.ts`). Documented today only in this repo's `CLAUDE.md`.
5. SQL dialect conversion's Python prerequisite — `resources/python/sqlglot-server.py`, spawned as
   `python3` (`packages/main/src/services/sql/sqlglot/sqlglot-client.ts:56`), needing
   `pip install sqlglot fastapi uvicorn pydantic`. Undocumented anywhere end-user-facing; [J-29]
   calls it a v1 release blocker.
6. Keyboard shortcuts — 58 commands across 8 groups, written down nowhere outside the app.

Items 4 and 5 are the same shape of problem and get **one** home (§5.5), not two.

### 1.3 What the site is _not_

Not a replacement for `CONTRIBUTING.md` or `docs/ARCHITECTURE.md`. Those stay in the repo and stay
developer-facing; the site links to them from an About section and does not re-tell them. The
ARCHITECTURE.md staleness the report found (MySQL missing from its thesis sentence, `backup.ipc.ts`
mis-annotated MSSQL-only) is a separate fix and does not belong to J-99.

---

## 2. Stack and placement

### 2.1 Astro + Starlight — recommended, with the tradeoff stated

Craig picked Astro. The real question is Starlight (Astro's official docs preset) versus building the
docs chrome on plain Astro.

**Starlight gives, for free, four things this site would otherwise have to build:**

- Sidebar navigation with a typed content-collection schema, so a page that lies about its frontmatter fails the build.
- Full-text search (Pagefind, generated at build time, runs client-side — no service, no key, works on Pages).
- Light/dark theming through documented CSS custom properties, plus a table-of-contents, prev/next, and edit-links.
- MD **and** MDX authoring, which the generated reference pages in §5.3 need.

**The tradeoff, honestly:** you inherit Starlight's layout and DOM. Brand expression is then limited
to CSS custom-property overrides plus Starlight's `components:` override map. `docs/brand/README.md`
explicitly asks marketing surfaces for "editorial, asymmetric layouts… larger compressed typography
and more negative space" — which is hard to do _inside_ a Starlight docs shell and easy to do beside
it.

**So: both.** Starlight owns `/getting-started/**`, `/features/**`, `/reference/**`,
`/troubleshooting/**`. A plain Astro route owns `/` (D7, Phase 3). Astro supports non-Starlight routes
in the same project, so this costs one extra page component, not a second site.

**Rejected: plain Astro alone.** It buys full layout control and costs a hand-rolled sidebar, a
hand-rolled search, and a hand-rolled theme toggle — three things that are pure maintenance and zero
product.

### 2.2 Brand binding

`docs/brand/tokens.css` is already a portable set of CSS custom properties. The site imports it and
maps it onto Starlight's variables:

| Starlight variable                | Joinery token                                   |
| --------------------------------- | ----------------------------------------------- |
| `--sl-color-accent` (+ low/high)  | Oxide `#D6492F`                                 |
| `--sl-color-black` / dark canvas  | Joinery ink `#171817`, charcoal plane `#272A27` |
| `--sl-color-white` / light canvas | Drafting ivory `#F2EFE7`, paper white `#FBFAF5` |
| gray ramp / rules                 | Rule gray `#B9B8AE`                             |
| `--sl-font`                       | Instrument Sans                                 |
| `--sl-font-mono`                  | IBM Plex Mono                                   |
| display / headings                | Archivo Narrow ExtraBold                        |

Signal chartreuse `#C8F04A` stays scarce per the brand kit — callout accents and the "verified"
badge on generated reference pages, nothing else.

Three concrete notes:

- **Self-host the fonts** as woff2 with `@font-face`, do not use a Google Fonts CDN. Reasons: the
  brand kit says "bundle the preferred typefaces before relying on them", CDN fonts are a
  third-party request on a docs site that has no other ones, and offline builds should not vary.
- **Ink-first default (the D2 ruling from `plans/ui-overhaul/PROPOSAL.md`).** Starlight's theme
  default is `auto`. Making ink the default requires overriding Starlight's `ThemeProvider` via its
  documented `components` override map — roughly twenty lines, and it is the **one Starlight internal
  this site takes a dependency on**. Flagged as a small upgrade risk; if a Starlight major breaks it,
  the fallback is to accept `auto` rather than fight it.
- **Contrast is not assumed.** Oxide on ink and oxide on ivory both need measuring for body-text and
  link use before Phase 1 merges. `plans/ui-overhaul/PROPOSAL.md` §2.3 already did this exercise for
  the app; reuse its derived values rather than re-deriving.

### 2.3 Placement: top-level `docs-site/`, **outside** the pnpm workspace

This is the recommendation, and the reasoning is about blast radius, not taste.

**Why not `packages/docs-site`:**

- `pnpm-workspace.yaml` globs `packages/*`. A docs site there joins the workspace, which means
  `turbo run build`, `turbo run lint` and `turbo run typecheck` all pick it up — so
  `pnpm run build` (which `pretest:e2e:react` and `pretest:visual:react` both call) starts building a
  static site before every e2e run.
- `.github/workflows/ci.yml`'s PR path filter includes `packages/**`. A typo fix in one docs sentence
  would run the full type-check-and-test job — a 30-minute timeout budget for a prose change.
- `pnpm-workspace.yaml` sets `nodeLinker: hoisted`, and its own comment explains why: electron-builder
  collects the app's production dependency tree **from disk**, and the isolated layout silently
  omitted transitive packages, producing an `app.asar` that signed cleanly and crashed on first
  connect. Astro and its ~200 transitive packages hoisting into the same flat `node_modules` is not a
  risk to take casually for zero gain. (Astro would be a devDependency, so it should not enter the
  production tree — "should not" is exactly the kind of claim that produced the original bug.)

**Why top-level `docs-site/` works:** its own `package.json`, its own `pnpm install` in the docs
workflow, its own `dist/`. Zero interaction with turbo, with `pnpm run package`, with
`verify:package`, or with CI's existing path filter. The cost is a second install in one workflow and
no turbo cache — for a static site that builds in tens of seconds, that is not a cost.

**Fallback if Craig wants one lockfile:** add `- 'docs-site'` to `pnpm-workspace.yaml` explicitly
(_not_ under `packages/*`) and narrow nothing in CI, since `packages/**` still would not match. This
keeps one lockfile and one install and reintroduces only the hoisting question. If this path is taken,
`pnpm run verify:package` must be run and shown green as part of the phase's acceptance — the
packaging risk is the whole reason the primary recommendation exists.

**Naming:** `docs-site/`, not `docs/`. `docs/` is taken (ARCHITECTURE.md, brand kit, design house
rules) and GitHub Pages' "deploy from a branch, `/docs` folder" mode is deliberately **not** used —
Actions deploy is (§3).

**Two small housekeeping consequences:**

- The root `format`/`format:check` scripts glob `**/*.{ts,tsx,jsx,json,md,scss,css,html}`, so
  `docs-site/**/*.md` gets swept into Prettier automatically (good), but `.mdx` is not in the glob.
  Add `mdx` to it, or the generated pages go unformatted and `format:check` never notices.
- `.gitignore` already ignores `dist/` globally, which covers `docs-site/dist/`. Add `.astro/` and
  the generated-MDX output directory (§5.3).

---

## 3. Deployment

### 3.1 The workflow

`.github/workflows/docs.yml`, using Astro's official Pages recipe: `withastro/action` to build, then
`actions/upload-pages-artifact` → `actions/deploy-pages`. `permissions: { contents: read, pages:
write, id-token: write }`, `concurrency: { group: "pages", cancel-in-progress: false }`.

### 3.2 Base path — the trap worth naming

Project Pages serve from `https://cadam11.github.io/joinery/`, so:

```
site: 'https://cadam11.github.io'
base: '/joinery'
```

Consequence: **root-absolute links break.** A hand-written `[Install](/getting-started/install/)`
resolves to `cadam11.github.io/getting-started/install/` and 404s. Starlight's own sidebar and
prev/next handle the base themselves; author-written links in Markdown do not. The rule for authors
is: relative links between docs pages, and `import.meta.env.BASE_URL` for anything constructed in a
component. This is the single most likely way this site ships broken, so the link checker in §3.5 is
not optional polish — it is the guard for this.

If D1 later picks a custom domain, `base` drops to `/` and every relative link keeps working, which
is the second reason to ban root-absolute links.

### 3.3 When it runs

```yaml
on:
  push:
    branches: [main]
    paths: ['docs-site/**', '.github/workflows/docs.yml']
  workflow_dispatch:
```

Path-filtered, not every main push: a Pages deploy on a renderer-only commit is minutes spent
republishing identical bytes. `workflow_dispatch` covers the manual redeploy (and the first one, right
after Pages is enabled).

**One caveat this filter creates:** the generated reference pages (§5.3) read from
`packages/renderer/src/commands/catalogue.ts` and `packages/shared/src/config/ai-vendors.json`. A
change to _those_ files changes the site's output without touching `docs-site/**`, so the deploy would
not fire. Fix: add those two paths to the filter. It is a two-line addition and forgetting it is how
the generated pages silently go stale — the exact failure the generators exist to prevent.

### 3.4 In-app Help currently points at an empty wiki (D3, and it is a real defect)

`packages/main/src/menu.ts:414` — **Help ▸ Joinery Documentation** calls
`shell.openExternal('https://github.com/cadam11/joinery/wiki')`. The repo has the wiki tab enabled
(`has_wiki: true`) but **no wiki content exists**: `git ls-remote …/joinery.wiki.git` → _Repository not
found_. So the app's one documentation menu item lands users on an empty page today.

Once Phase 1 is live, that URL becomes the docs site. One line, and it turns an existing dead end into
the front door. Recommend it as its own tiny ticket rather than folding it into J-99, so J-99's
"only artifact is the site" boundary stays clean.

### 3.5 PR previews and link checking

**Previews:** GitHub Pages has exactly one environment per repository, so there is no native per-PR
preview. Two options:

- _Cheap and recommended:_ a `docs-build` job on PRs touching `docs-site/**` that runs the build and
  uploads `dist/` as a workflow artifact. It catches broken builds and broken links before merge;
  it does not give a clickable URL.
- _Real previews:_ Cloudflare Pages or Netlify, both of which do per-PR deploys for free on a public
  repo. That is a second hosting provider to own, and it makes GitHub Pages the odd one out. Defer.

**Link checking is mandatory in Phase 1**, for the §3.2 reason. Preferred: the
`starlight-links-validator` community plugin, _if_ it is maintained against the Starlight version we
pin — check before adopting, do not assume. Otherwise a `lychee` or `linkinator` step over the built
`dist/` in the same job. Either way it must fail the build, not warn.

---

## 4. Information architecture

Full tree, one line of content per page. Derived from what ships: the twenty directories in
`packages/renderer/src/features/` and the 58 commands in `packages/renderer/src/commands/catalogue.ts`.

### Home — 1 page

| Page | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`  | Positioning line ("Your database, fitted to the way you work."), the three engines, three hero CTAs. **Shipped:** Starlight splash in Phase 1, replaced in Phase 3 (D7) by the brand-expressive **non-Starlight** route `docs-site/src/pages/index.astro` — the site's one `src/pages/` entry and the sole claimant of `/`. The hero CTA trio is **Install / Prerequisites / Workspace tour** (the "reality wins" ruling: shipped pages only); Features and Reference moved to the masthead nav. |

### Getting Started — 8 pages

| Page                       | Content                                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install                    | Build from source today (`git clone` → `pnpm install` → `pnpm run dev`); packaged DMG/installer section stubbed with an explicit "arrives with v1" and no fake download button.                                                              |
| Prerequisites              | macOS 13+ / Windows 10-11; engine versions (MSSQL 2017+, PG 12+, MySQL 5.7/8.0+); Docker optional; **the host-CLI tools for PG/MySQL backup/restore**; **Python + sqlglot for dialect conversion**. The single home for both prereqs (§5.5). |
| First run                  | The welcome tab, "Detect Docker Containers" vs "Add Connection", and the guided tour (`features/onboarding/tours.ts`, palette: "Start the guided tour").                                                                                     |
| Connect to SQL Server      | The connection editor, SQL auth, Azure SQL, and Entra ID auth (`@azure/msal-node`).                                                                                                                                                          |
| Connect to PostgreSQL      | Connection editor fields, per-database pooling, SSL.                                                                                                                                                                                         |
| Connect to MySQL           | Connection editor fields, per-database pooling.                                                                                                                                                                                              |
| Connect over an SSH tunnel | The tunnel fields, key vs password, idle-reconnect behaviour (`ssh2`).                                                                                                                                                                       |
| A tour of the workspace    | Sidebar, Dockview tabs and splits, results panel, output panel, the assistant — the vocabulary every later page uses.                                                                                                                        |

### Features — 17 pages (one per shipped surface)

| Page                              | Content                                                                                                                                                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Query editor                      | Monaco, tabs, execute (⌃E) and execute-selection, statement scope, cancel, format, toggle comment, placeholders, open/save/save-as query files.                                                                                                                                    |
| Results grid                      | AG Grid, virtualization, the row cap, copy formats (TSV/CSV/JSON), export, the row inspector, FK lookup, result diff, result history.                                                                                                                                              |
| Execution plans                   | The plan view, on all three engines.                                                                                                                                                                                                                                               |
| Object explorer                   | Lazy-loaded tree, refresh, object properties, reveal-in-explorer, server and database properties.                                                                                                                                                                                  |
| Find a database object            | ⌘P fuzzy search over tables, views, procedures, functions (`features/object-search/`).                                                                                                                                                                                             |
| Command palette                   | ⌘K (and ⇧⌘P — `command-palette.tsx:85`), the 58 commands, the eight groups, and how the palette relates to the menus.                                                                                                                                                              |
| Keyboard shortcuts (feature page) | The ⇧⌘/ cheat-sheet, and a pointer at the generated full table in Reference.                                                                                                                                                                                                       |
| Snippets                          | The snippet library, insert-snippet, ⌥⌘S (**not** ⇧⌘S — the catalogue comment at `catalogue.ts:637` records that mistake).                                                                                                                                                         |
| Query history                     | ⇧⌘H, what is retained, how to re-run.                                                                                                                                                                                                                                              |
| ERD                               | The canvas, layout, viewport, caching, the details panel.                                                                                                                                                                                                                          |
| Schema diff                       | Comparing two databases, and the generated diff query.                                                                                                                                                                                                                             |
| Backup & restore                  | Per engine: MSSQL T-SQL `BACKUP`/`RESTORE`, PG `pg_dump`/`pg_restore`, MySQL `mysqldump`/`mysql`. Links to Prerequisites. Notes that server-filesystem browsing is MSSQL-only.                                                                                                     |
| Databases                         | Create, rename, delete — and the confirmations that guard them.                                                                                                                                                                                                                    |
| Docker containers                 | Detection, the pip, connect-to-this-container.                                                                                                                                                                                                                                     |
| SQL dialect conversion            | Convert to SQL Server / PostgreSQL / MySQL; the Python prerequisite and what failure looks like.                                                                                                                                                                                   |
| AI assistant                      | Chat, streaming, tool calling and tool-call cards, conversations, chat-as-a-tab, and what the assistant can see (the active editor).                                                                                                                                               |
| AI setup                          | Vendors, **where keys are stored** (Keychain / Windows Credential Store via `keytar`), per-vendor key links from `ai-vendors.json`'s own `docsUrl` fields, the model picker, and the OpenRouter auto-router with its cost-tier band (J-92, `features/chat/chat-composer.tsx:131`). |

("Keyboard shortcuts" here is a thin cross-link page and may fold into "Command palette" during
Phase 2 if it earns nothing on its own — that would make it 16.)

### Reference — 6 pages

| Page                           | Content                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keyboard shortcuts             | **Generated** from `commands/catalogue.ts` (§5.3).                                                                                                           |
| Command reference              | **Generated** — all 58 commands by group, with labels, descriptions and accelerators.                                                                        |
| Settings                       | Appearance / Editor / Query / Grid / AI, from `features/settings/settings-groups.tsx` — which also names the one control that ships disabled and why (J-54). |
| Supported engines and versions | MSSQL 2017+, PG 12+, MySQL 5.7/8.0+, Azure SQL; what is tested (the compose harness pins `mssql/server:2022-latest`, `postgres:16-alpine`, `mysql:8`).       |
| AI providers and models        | **Generated** from `packages/shared/src/config/ai-vendors.json`, including its `version` and `lastUpdated`.                                                  |
| Where Joinery stores things    | Main-process `AppState`, the Keychain, and the fact that the renderer does not use `localStorage` (enforced by `no-local-storage-writes.spec.ts`).           |

### Troubleshooting — 5 pages

| Page                                        | Content                                                                                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker isn't detected                       | What detection does, and what to check.                                                                                                                                |
| Credential and keychain problems            | Symptoms, and where credentials actually live.                                                                                                                         |
| "A required command-line tool is missing"   | The backup/restore setup-instructions view, and the per-platform install commands.                                                                                     |
| SQL conversion fails / Python not found     | The sqlglot prerequisite; **and the honest note that this currently fails cryptically on Windows** ([J-29]). Documenting the sharp edge beats pretending it is smooth. |
| Connection failures and dropped SSH tunnels | Timeouts, pool behaviour, idle-reconnect.                                                                                                                              |

### About — 3 pages

| Page                | Content                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Release notes       | Stub until v1; then the changelog.                                                              |
| Brand and press kit | Links `docs/brand/` — mark, lockups, palette, and the usage rules.                              |
| Contributing        | Points at `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, and the test tiers. Does not re-tell them. |

**Totals:** 1 + 8 + 17 + 6 + 5 + 3 = **40 pages**, of which 3 are generated.

---

## 5. Content sourcing rules

These are the standard the pages are held to in review. They exist because the docs inventory found
four separate README claims that were true once.

### 5.1 Every factual claim is traceable to code

A claim in a docs page must be checkable against a file in this repo. During authoring, the source is
recorded (a path, and a symbol or line where it helps). Reviewers spot-check. This is the same
accuracy standard the docs inventory used on the README, applied prospectively.

### 5.2 Nothing unshipped gets documented

The page set is _derived from_ `packages/renderer/src/features/` and `commands/catalogue.ts`. If a
surface is not in one of those, it does not get a page. Specifically: the README's "Coming Soon" and
"Future" sections do **not** become docs pages — and note the inventory already found that "Coming
Soon" lists two features that shipped (`command-palette`, `object-search`), which is the same failure
mode running in the other direction.

### 5.3 Generate, don't transcribe, the two lists that are already data

This is the highest-leverage rule here, and it exists because of something the codebase already did
right.

`packages/renderer/src/commands/catalogue.ts` holds every command's label, description, group and
accelerator **as data**, and `catalogue.spec.ts` parses `packages/main/src/menu.ts` and
`packages/preload/src/index.ts` as text and asserts every menu accelerator in the catalogue equals
what the main process actually registers. Its own header says why: a comment nobody can execute had
three wrong values in it.

So the keyboard-shortcut and command-reference pages must be **generated from that file at build
time**, not typed out. A generated page inherits an existing test that fails when the docs would have
gone stale. The same applies to the AI providers/models table and
`packages/shared/src/config/ai-vendors.json` (which carries its own `version` and `lastUpdated`, and
has its own spec).

Mechanism: `docs-site/scripts/generate-reference.mjs`, run as a `prebuild`, emitting MDX into a
gitignored `docs-site/src/content/docs/reference/_generated/`.

Two hard requirements on the generator:

- **It asserts its inputs exist and fails loudly.** If `catalogue.ts` moves, the build must break, not
  emit an empty shortcuts page. An empty reference page is worse than no reference page.
- **It parses, it does not import.** `catalogue.ts` is a renderer TSX-adjacent module that pulls in
  `lucide-react` icons; importing it into a Node build script drags the renderer's dependency tree
  into the docs build. Read and parse the data, the way `catalogue.spec.ts` reads `menu.ts`.

Cost, stated plainly: this couples the docs build to the repo's file layout. That is a real coupling,
and it is worth it — the alternative is 58 hand-typed commands that go wrong the first time
someone changes a menu.

### 5.4 AI-generated prose is allowed; unverified prose is not

Pages may be drafted by a model. Before merge, each page is checked against a **running build** —
click the thing, confirm the copy. The PR records which build and which engine were used. Draft speed
is the point; unverified draft speed is how you get a docs site that is confidently wrong.

### 5.5 A prerequisite has exactly one home

`pg_dump`/`pg_restore`/`mysqldump`/`mysql` and Python+sqlglot are the same shape of problem (docs
report §4). Both live on **Getting Started ▸ Prerequisites**. Feature pages and troubleshooting pages
link there; they do not restate the install commands. Two copies of an install command is one copy
that will be wrong.

### 5.6 Brand voice governs

`docs/brand/README.md`'s Voice section: exact, calm, competent; concrete verbs; **no anthropomorphic
AI claims**. Note that the README currently violates this ("The database tool that thinks alongside
you", "it doesn't just answer questions — it acts"). Do not copy that copy onto the site.

---

## 6. Screenshots

The app is an Electron desktop app, so screenshots cannot be captured by a headless browser hitting a
URL. But the regression harness already launches the real app with the two host variables that make
captures reproducible pinned — so this is reuse, not new machinery.

### 6.1 The proposal

A new Playwright project, `docs-shots`, `testDir: './tests/docs-shots'`, alongside the existing
`e2e-react`, `perf-react` and `visual-react` projects in `playwright.config.ts`.

What it reuses:

- `tests/helpers/electron-app.ts` — launches the built app, and gives every launch its own `mkdtemp`
  userData directory, so nothing from the host's real Joinery state can appear in a shot.
- `tests/e2e-react-visual/fixtures.ts`'s pinning approach — device pixel ratio via Chromium's
  `--force-device-scale-factor`, macOS scroller style via the `AppleShowScrollBars` NSArgumentDomain
  pair, and an explicit theme. All three are _asserted_ per launch in that tier, not merely requested,
  and the docs project should keep that property.
- `tests/helpers/react/*` — the action helpers that drive the app to each surface (connections, query,
  explorer, erd, chat, dialogs, overlays).
- `tests/helpers/db-fixtures.ts` — the synthetic schema against the compose containers.

**Why a separate project rather than more specs in `visual-react`:** the two want opposite DPRs. The
visual tier pins DPR **1** deliberately (its whole ledger entry is about a tier whose baselines were
shot at 2 and compared at 1). Docs want DPR **2** so the images are crisp on retina. Same helpers,
different `metadata`, so it must be its own project.

### 6.2 Data safety — this is the reason the old screenshots died

FOLLOW-UPS item 3 / [J-23]: the eight original `docs/screenshots/` PNGs were **deleted rather than
rebranded because they leaked an internal Azure SQL hostname**. Capturing from
`tests/helpers/db-fixtures.ts` fixes that structurally: connection names, hostnames, database names
and row data all come from the fixture, never from Craig's real profiles. That is a stronger guarantee
than "remember to blur it".

This also folds J-23 in: the same generated set restores the README's `## Screenshots` section.
Recommend J-23 be closed as covered by J-99 Phase 3, or re-scoped to "point the README at the docs
shots" — it should not stay open as independent work.

### 6.3 Output, cost, and what we are accepting

- Output goes to `docs-site/src/assets/screenshots/`, **committed**, and consumed through Astro's
  asset pipeline (which optimizes and content-hashes them).
- **Capture is local-only, not CI.** GitHub's macOS runners have no Docker daemon, so the fixture
  databases cannot come up there; and the capture needs a built Electron app plus the macOS scroller
  pin. So: `pnpm run docs:shots` on a developer machine with the harness up, then commit the PNGs.
  Craig starts Docker Desktop manually anyway (per `CLAUDE.md`), so this fits the existing rhythm.
- **Cost:** binary churn in git, and a manual step whenever the UI moves. Both accepted.
- **Both themes for hero shots only.** Ink and ivory for the handful of hero images (swapped via
  `[data-theme]`), ink alone for the rest. Capturing 40 pages twice doubles the churn for very little.
- **Staleness:** shots rot silently. Cheap guard — the capture writes a
  `screenshots.manifest.json` sidecar recording the app version and git SHA of the capture run, and a
  test asserts every screenshot a docs page references actually exists. Detecting "this shot no longer
  matches the UI" automatically is not worth building; that risk is accepted and named.

---

## 7. Phasing

Each phase is independently shippable: Phase 1 is a live site, Phase 2 adds pages to a live site,
Phase 3 adds images to a live site.

### Phase 1 — Skeleton, Getting Started, and a live pipeline

Scaffold `docs-site/`; Starlight config; brand tokens and self-hosted fonts; the ink-first
`ThemeProvider` override; `site`/`base`; the deploy workflow; the PR build-check job; the link
validator; the eight Getting Started pages; every other section stubbed with a real title and a
"coming in Phase 2" note (not an empty page).

**Acceptance:**

- `https://cadam11.github.io/joinery/` serves the site. (Requires the Pages setting from §0.)
- A docs-only commit to main deploys; a renderer-only commit does not.
- Link validation passes and is wired to fail the build.
- All eight Getting Started pages carry a source citation per claim (§5.1), and the Prerequisites page
  covers both the host-CLI and the Python prerequisites.
- Light and dark both render with brand tokens; ink is the default; contrast is measured, not assumed.
- `pnpm run format:check`, `pnpm run build`, `pnpm run typecheck` and CI are all unaffected by the new
  directory (that is the §2.3 claim, and it should be demonstrated rather than asserted).

### Phase 2 — Features, Reference, Troubleshooting

The generators first (they define the Reference section's shape), then the 17 feature pages, then
Reference and Troubleshooting.

**Acceptance:**

- One page per shipped feature directory; no page documents anything unshipped (§5.2).
- The generated shortcut/command pages match `catalogue.ts`, under a test that fails if the generator
  drifts; the generator fails loudly if its input files move.
- `.github/workflows/docs.yml`'s path filter includes the generator's input files (§3.3).
- Every page verified against a running build, with the build and engine recorded in the PR (§5.4).
- No prerequisite install command appears on more than one page (§5.5).

### Phase 3 — Screenshots and polish

The `docs-shots` Playwright project, the shots, the hero images in both themes, the brand-expressive
landing route, the README `## Screenshots` restoration, and a search/a11y pass.

**Acceptance:**

- `pnpm run docs:shots` reproduces the committed PNGs on a clean machine with the harness up.
- No screenshot contains a real hostname, credential, or non-fixture data.
- The manifest sidecar exists and the "referenced shot exists" test passes.
- README's Screenshots section is restored; J-23 is closed or re-scoped.
- The landing route renders in both themes and passes contrast.

---

## 8. Estimates

In SDD-task units — one focused Opus subagent brief plus its review round.

| Phase                                              | Tasks  | Breakdown                                                                                                            |
| -------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| **Phase 1** — skeleton + Getting Started + deploy  | **3**  | 1 scaffold and brand binding; 1 deploy workflow, base path and link validation; 1 Getting Started content (8 pages). |
| **Phase 2** — features, reference, troubleshooting | **5**  | 1 generators; 3 feature pages (~6 pages each); 1 Reference + Troubleshooting.                                        |
| **Phase 3** — screenshots + polish                 | **3**  | 1 `docs-shots` harness; 1 shot authoring and page integration; 1 landing route, README/J-23, a11y and search pass.   |
| **Total**                                          | **11** |                                                                                                                      |

Phase 1 is the only one with an external dependency (the Pages repo setting) and the only one that can
be blocked by something a subagent cannot do.

---

## 9. Out of scope for J-99

- Fixing `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`, or the README's stale claims. Separate tickets;
  the docs inventory has the list.
- The in-app Help menu URL change (D3) — its own one-line ticket once Phase 1 is live.
- Docs versioning (D2) and a custom domain (D1) until they are decided.
- Any change to the app itself. This ticket adds a site; it does not touch `packages/`.

---

## References

- `.superpowers/sdd/PLAN/followup-docs-report.md` — the docs inventory this proposal answers.
- `plans/rebrand/FOLLOW-UPS.md` items 3 ([J-23], screenshots) and 9 ([J-29], the Python prerequisite).
- `plans/ui-overhaul/PROPOSAL.md` — the D2 ink-first ruling and the measured contrast work.
- `docs/brand/README.md`, `docs/brand/tokens.css` — the brand the site must wear.
- `packages/renderer/src/commands/catalogue.ts` and its spec — the definitive verb list, and the
  reason the reference pages are generated.

[J-23]: https://linear.app/adam11/issue/J-23
[J-29]: https://linear.app/adam11/issue/J-29
