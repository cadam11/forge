---
name: wiki-author
description: Author a complete user-facing GitHub Wiki for the current repository. Triggers when the user wants to write, generate, refresh, or expand wiki documentation — phrases like "write the wiki", "build a github wiki", "generate user docs for the wiki", "set up our wiki", "add a wiki page for X", "/wiki". Use this whenever the user mentions GitHub wikis, project user documentation, end-user help pages, or wants to publish how-to / reference docs to github.com/<owner>/<repo>/wiki — even casually. Coordinates a small team of subagents that each own one page, then handles the .wiki.git clone-write-commit-push workflow.
---

# Wiki Author

You are setting up or extending a project's **GitHub Wiki** — the user-facing documentation site at `github.com/<owner>/<repo>/wiki`. This is **not** API reference material and not the in-repo `README.md`. It is task-oriented help for end users (and contributors who need narrative context the README can't carry).

GitHub wikis are their own git repository: `<repo>.wiki.git`. You clone it, write Markdown files, and push. That's it. The challenge is producing a coherent, well-cross-linked information architecture without writing one giant essay — which is why this skill emphasizes **a team of subagents, one per page, in parallel**.

## When to use this skill

Use it when the user wants to:

- Stand up a wiki from scratch.
- Add several new pages at once.
- Refresh / rewrite the wiki to reflect current product state.
- Audit an existing wiki for gaps and fill them.

For a single small edit to one existing page, you don't need this skill — just edit the page directly via a clone or a `gh` API call.

## High-level workflow

1. **Read the project context.** `README.md`, `CLAUDE.md`, `docs/`, `package.json`, `CHANGELOG.md` if present. You need a real picture of what the product does before you can write user docs about it.
2. **Detect screenshots and existing assets.** Look in `docs/screenshots/`, `assets/`, `resources/`. If you find them, plan to reference them by raw GitHub URL (the wiki repo can't import in-repo paths — see [Linking to images](#linking-to-images-from-the-main-repo)).
3. **Propose an information architecture.** Adapt — don't copy — the [standard IA](#standard-information-architecture). Show it to the user and confirm before writing.
4. **Clone the wiki.** `git clone https://github.com/<owner>/<repo>.wiki.git` into a temp dir or sibling dir. If it 404s, the wiki doesn't have its first page yet — see [Bootstrapping an empty wiki](#bootstrapping-an-empty-wiki).
5. **Dispatch subagents.** One per page, in parallel. Brief each one with: project context, page scope, target filename, screenshots available, links to peer pages.
6. **Write `_Sidebar.md` and `_Footer.md` yourself** (you're the only agent that knows the full page list).
7. **Review every page.** Read what each subagent produced. Do not blindly trust summaries. Fix cross-links, harmonize tone, kill any hallucinations about features that don't exist.
8. **Commit and push.** Conventional commit. **Confirm with the user before pushing** — the wiki is public-visible the moment you push.

## GitHub wiki mechanics (must-know)

These are easy to get wrong. Get them right the first time.

- **Pages are Markdown files** in the `<repo>.wiki.git` repository. Default extension `.md`.
- **The filename becomes the page title and URL.** Spaces in the title become hyphens in the URL: `Getting Started.md` → `https://github.com/<owner>/<repo>/wiki/Getting-Started`. Prefer filenames that already contain hyphens (`Getting-Started.md`) so the on-disk name matches the URL.
- **Forbidden filename characters:** `\ / : * ? " < > |`. Avoid them in page titles too.
- **Special pages:**
  - `Home.md` — the landing page. Always required.
  - `_Sidebar.md` — appears on the right side of every page. Use it for navigation.
  - `_Footer.md` — appears at the bottom of every page. Use it for version / "edit this page" / license links.
- **Internal links** between wiki pages: `[[Page Name]]` or `[[Display text|Page-Name]]`. Prefer `[[Page Name]]` for readability when the link text is the title.
- **External links and inline anchors** use normal Markdown: `[text](url)` and `[#section](#section-anchor)`.
- **Linking to images from the main repo** — the wiki cannot do `![](docs/screenshots/foo.png)` because the wiki and the main repo are separate git repos. Use the raw GitHub URL pattern:
  `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/docs/screenshots/foo.png`
  Pin to a tag (e.g. `v0.4.1`) instead of `main` if you want the screenshot to stay stable across product changes.
- **Code blocks** with language hints (` ```sql `, ` ```typescript `) render with syntax highlighting.
- **Mermaid diagrams** render natively in fenced ` ```mermaid ` blocks. Use them sparingly for architecture or flow.
- **Tables of contents** are not auto-generated. Either write them manually at the top of long pages or rely on the sidebar.

## Capturing fresh screenshots

Reusing whatever already lives in `docs/screenshots/` is the quick path. Capturing fresh, page-specific screenshots is the better path when the existing set is stale or doesn't cover the feature you're documenting.

Use the **`playwright-cli`** skill (or a small Playwright script written inline) to drive the app. For an Electron app, launch via `_electron.launch({ args: [appPath] })` rather than `chromium.launch()` — Electron has a main process you need to spawn, not just a browser context. Set a fixed viewport (e.g. 1440×900) so screenshots stay consistent across runs and across pages.

Typical capture loop:

1. Build the app (`pnpm run build`) so the renderer is up to date.
2. Launch the app under Playwright.
3. Wait for the main window to settle (`waitForSelector` on a known element, not `waitForTimeout`).
4. Drive the UI to the state you want to document — open the dialog, run the query, switch the theme.
5. `await page.screenshot({ path: '<wiki>/images/<name>.png', fullPage: false })`.
6. Close the app cleanly.

Keep capture scripts tiny and per-page; resist the urge to build a generic framework. A 30-line script per screenshot beats a 300-line abstraction every time.

**Where to put the captured images.** You have two reasonable choices:

- **In the wiki repo itself** (recommended). Create an `images/` directory inside the cloned wiki and commit `.png` files alongside the pages. Reference them as `![caption](images/filename.png)`. Pro: screenshots travel with the pages and never break. Con: can't be reused from the main README.
- **In the main repo's `docs/screenshots/`**, then reference via raw GitHub URLs. Pro: shared with the README. Con: requires a separate commit + push to the main repo, and the URL pins to a branch or tag — pin to a tag for stability.

**For seeded/realistic data.** If the app needs a database to look meaningful in screenshots, use the user's local Docker SQL Server (or whatever test database they offer) rather than a freshly empty install. A query editor screenshot with five tables in the explorer and real rows in the result grid is dramatically more useful than a "Welcome" screen.

**Light vs. dark.** If the app supports themes, capture both — and name files consistently: `query-editor-light.png`, `query-editor-dark.png`. Embed the version that matches the wiki's overall vibe; one theme is fine on a single page. Don't double up everywhere.

**Cropping and annotation.** Native screenshots are usually too big and too cluttered. Crop to the feature in question. Add red-box callouts only when the screenshot alone isn't self-explanatory (which usually means the screenshot is poorly framed — recapture before you reach for arrows).

## Standard information architecture

This is a **starting template**, not a prescription. Drop pages that don't apply, add pages the project actually needs, and adjust naming to match the product's vocabulary. Confirm the final list with the user before dispatching subagents.

For a desktop / developer-tool project:

| Page                   | Filename                | Purpose                                                                                 |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| Home                   | `Home.md`               | What the product is, who it's for, where to download, top-level navigation.             |
| Installation           | `Installation.md`       | OS-by-OS install steps, system requirements, first-launch checks.                       |
| Getting Started        | `Getting-Started.md`    | "Five-minute tour" — connect, run a query, see results.                                 |
| Connecting (per topic) | `Connecting-to-<X>.md`  | One page per connection type if non-trivial (e.g. SSH tunnel, cloud auth, Docker).      |
| Core feature pages     | `<Feature>.md`          | One per major feature area (query editor, explorer, ERD, AI assistant, backup/restore). |
| Keyboard Shortcuts     | `Keyboard-Shortcuts.md` | Reference table grouped by context.                                                     |
| Settings & Preferences | `Settings.md`           | Walkthrough of each settings panel.                                                     |
| AI Assistant Setup     | `AI-Assistant-Setup.md` | API keys, providers, models, safety/confirmation behaviour.                             |
| Troubleshooting / FAQ  | `Troubleshooting.md`    | Symptom → cause → fix. Real failures users hit.                                         |
| Release Notes          | `Release-Notes.md`      | Or link to GitHub Releases.                                                             |
| Contributing           | `Contributing.md`       | Short page that points to `CONTRIBUTING.md` in the main repo.                           |
| \_Sidebar              | `_Sidebar.md`           | Navigation, grouped.                                                                    |
| \_Footer               | `_Footer.md`            | Version, edit-on-github link, license.                                                  |

For a library / SDK, swap "Connecting" / "Settings" / "AI Assistant" for things like "Quickstart", "Configuration", "Recipes", "Migration Guide", "Concepts".

## Style guide

The wiki is **for end users**, not maintainers. Write accordingly.

- **Task-oriented headings.** `Connecting to a SQL Server database` beats `The connection dialog`. Users arrive with a goal — name the goal.
- **Imperative voice in steps.** "Open the connection dialog" not "The user can open the connection dialog."
- **Concrete over abstract.** Show the actual menu name, the actual button label, the actual keyboard shortcut.
- **Screenshots near the action.** If a `docs/screenshots/<name>.png` exists for a feature, embed it — it's worth more than a paragraph.
- **No marketing language.** Cut "powerful", "seamless", "blazing fast", "world-class". The README does that job. The wiki teaches.
- **Cross-link generously.** Every page should link to at least one neighbour via `[[Page Name]]`. Dead-end pages are a smell.
- **Short paragraphs.** Three to four sentences max. People scan wikis; they don't read them.
- **Code blocks with language hints.** Triple-backtick + `sql`, `bash`, `typescript`, etc.
- **Don't document features that don't exist.** If you're not sure a feature exists, grep the codebase or ask. Hallucinated UI in a wiki is worse than no wiki.
- **Comments and footnotes.** Skip them. The page IS the comment.

## Dispatching subagents

For a fresh wiki of 8–15 pages, the fastest path is one subagent per page, all spawned in parallel. Subagents are stateless — assume each one knows nothing about the project and brief it like a smart colleague who just walked in.

A good page-author brief contains, in order:

1. **Project one-liner** — the same one you'd give a stranger.
2. **Tech stack** — one sentence so the agent knows what vocabulary to use.
3. **Authoritative sources** — paths to `README.md`, `CLAUDE.md`, the relevant `docs/*.md`, the relevant `packages/<x>/src/...` directories. Tell it to read these before writing.
4. **Page scope** — exactly what this page covers and, equally important, what it does NOT cover (point at peer pages instead).
5. **Target filename** — exact name, on disk, in the wiki clone directory.
6. **Style guide pointer** — "Follow the style guide in `.claude/skills/wiki-author/SKILL.md` § Style guide" or paste the relevant bullets inline.
7. **Cross-link list** — the list of peer pages it should link to via `[[Page Name]]`, so the page is wired into the wiki on arrival.
8. **Screenshots available** — list the raw GitHub URLs the agent can embed and what each one shows.
9. **Length target** — typical wiki page is 150–500 lines of Markdown. Set a soft cap.
10. **Output expectation** — "Write the file directly to `<wiki-clone-path>/<filename>`. Report back in one sentence what you wrote and any uncertainties or gaps."

Use `general-purpose` subagents for page authoring. Run them in parallel by sending a single message with multiple `Agent` tool calls.

After all subagents return, **read each file you produced**. Subagents over-promise in their summaries. Verify by reading the actual Markdown.

## Clone, write, commit, push

```bash
# 1. Clone the wiki repo. Owner/repo come from the user or `gh repo view --json owner,name`.
WIKI_DIR=$(mktemp -d)
git clone "https://github.com/<owner>/<repo>.wiki.git" "$WIKI_DIR"

# 2. Subagents and you write files into $WIKI_DIR.
# 3. Stage, commit, push.
cd "$WIKI_DIR"
git add .
git status   # show the user what you're about to commit
git commit -m "docs(wiki): add initial user documentation"
# 4. Confirm with the user before pushing.
git push origin master   # GitHub wikis use 'master', not 'main', as the default branch.
```

**Important caveats:**

- **Wikis use `master` as the default branch**, not `main`. Don't try to rename it.
- **The wiki repo only exists once at least one page has been created.** If `git clone` returns a 404, the user must visit `github.com/<owner>/<repo>/wiki` and click "Create the first page" once. After that, clone works. See [Bootstrapping an empty wiki](#bootstrapping-an-empty-wiki).
- **Wiki pages are world-readable on push if the main repo is public.** Treat `git push` as a publish action — confirm with the user before running it. Don't push secrets, internal URLs, customer names, or anything else that wouldn't belong in a public README.
- **No PRs against wikis.** Pushes go straight to master. There is no review gate. Be deliberate.

## Bootstrapping an empty wiki

If the wiki has never been used, the `.wiki.git` repo doesn't exist yet and `git clone` returns 404. The fix:

1. Tell the user: "The wiki hasn't been initialised. Visit `https://github.com/<owner>/<repo>/wiki` in your browser and click 'Create the first page'. Save anything — even just the word 'placeholder'. Then come back."
2. Once they confirm, clone again and overwrite `Home.md` with the real content.

## Common pitfalls (read this before you start)

- **Writing a 2000-line `Home.md`.** Keep Home short and link out. Long-form belongs on dedicated pages.
- **Using `[[ ]]` link syntax for external URLs.** That syntax is wiki-internal only. External links are normal Markdown.
- **Forgetting the sidebar.** Without `_Sidebar.md`, navigation collapses to GitHub's default page list, which is alphabetised and ugly. Always ship a sidebar.
- **Embedding repo-relative image paths.** Wikis can't see them. Use raw GitHub URLs.
- **Pushing without confirmation.** Wikis publish on push. Always show `git status` and `git diff --stat` and ask before `git push`.
- **Hallucinating UI.** If you didn't see it in the code or in a screenshot, don't describe it. Ask the user or grep first.
- **Letting subagents drift.** Each subagent has only the brief you gave it. If you don't list cross-links explicitly, you'll get pages that exist in isolation. If you don't list the screenshots, you'll get walls of text.

## Reference files

- `references/page-template.md` — A starting skeleton for a typical feature page. Copy-paste, fill in.
- `references/sidebar-example.md` — Worked example of `_Sidebar.md` for a multi-section wiki.
- `references/subagent-brief-template.md` — Fill-in-the-blanks brief you can hand to a page-author subagent.

Read these only when you actually need them. SKILL.md alone is enough for the common path.
