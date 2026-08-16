# Joinery renderer rewrite — Angular → React + Tailwind

Architecture plan, 2026-08-15. **No code changes were made producing this document.**

Settled by Craig (not re-litigated here): React; Tailwind CSS; brand-kit theming, ink-first
with ivory at parity; main process + preload + typed IPC survive **unchanged**; the vitest
integration tier survives unchanged; Playwright e2e + visual are rewritten `data-testid`-first.

Inputs: `plans/ui-overhaul/PROPOSAL.md` (§1 current-state audit and §2 brand mapping are
carried forward; its Angular-retheme phases are dead), `docs/brand/`, the licensed
`design` / `add-dark-mode` / `componentize` / `canonicalize-tailwind` skills, and a full walk
of `packages/renderer/src/app/`, `packages/preload/src/index.ts`, `packages/shared/src/`.

---

## 0. Findings that change the scope before anything is written

**0.1 The router is dead, and that resolves Craig's pages-vs-dialogs question.**
`main.ts:12` calls `provideRouter(routes, …)`, `app.routes.ts` declares 7 lazy routes, and
~30 `router.navigate()` calls exist across `menu.service.ts`, `sidebar.component.ts` and
`tab-bar.component.ts` — but **`router-outlet` appears zero times in the entire renderer**.
`app.component.ts:38` renders `<app-shell />` directly. Every navigation is a silent no-op.

Real rendering path: `AppComponent` → `ShellComponent` → `GoldenLayoutContainerComponent`,
which imperatively mounts one of five components per tab
(`golden-layout-container.component.ts:544-549`: `welcome`/`query`/`object`/`erd`/`chat`).

Consequences:

- **Verdict on the duplicated Backup/Restore/Connections surfaces: keep the dialogs, drop
  the pages.** This is not a taste call. `features/backup` (495), `features/restore` (677),
  `features/connections` (635) — **1,807 LOC** — are structurally unreachable. The dialogs
  are the only shipped visual language and carry all the live call sites
  (`sidebar.component.ts:815,823,963,1000,1139`). One visual language: **modal dialog over
  the workbench**, per §2.9.
- **Tabs are the navigation model.** The React app ships no router at all.
- **Two native menu items are broken today.** `menu.service.ts:211,217` implement
  Database ▸ Backup and Database ▸ Restore purely as `router.navigate()`; ditto
  File ▸ New Connection at `:75`. They must be wired to the dialogs in the rewrite (Task 12/13).

**0.2 ~5,800 LOC (13%) of the 44,922 non-spec LOC is confirmed dead. Do not port it.**
`table-properties-panel` 1,373 (unreferenced near-clone of the wired `…-container`),
`result-diff-viewer` 624, `fk-link` 496, `tree-view` 403, `workspace-panel` 395,
`tab-bar` 344, `sql-error.service` 331, `theme.service` 31, plus the 1,807 routed pages.
`workspace-panel` is the notable one: a complete, unreachable file-explorer feature with a
full main-process IPC surface behind it (`preload/src/index.ts:378-387`).

**0.3 The 1,023-LOC `ipc.service.ts` collapses to near-zero.** It is a 1:1 re-declaration of
the preload API wrapped in RxJS + `NgZone`. React calls `window.joinery.*` directly through
TanStack Query. That plus 0.2 means **~6,800 LOC deletes itself** before a single component
is rewritten.

**0.4 Nine `window.dispatchEvent('joinery:*')` DOM channels are the real inter-feature bus,
and 8 of the command palette's emitted events have no listener** (`command-palette.component.ts:331-599`;
audit §1.8 counted 10 dead dispatches). Replace with one typed command bus (Task 4).

**0.5 Six localStorage keys are the only home for real user data and will be silently lost
if not migrated.** `joinery-settings` (every app setting — `settings.service.ts:129,149`),
`joinery:completed-tours` (`onboarding.service.ts:195,204`), `joinery:welcomeDismissed`
(`tab.state.ts:32`), the **entire snippet library** (`snippet-library.component.ts:686,697`),
and two query-editor keys (`query.component.ts:1546,1647`). Task 5 owns migration.

**0.6 `pnpm-workspace.yaml` pins `typescript: ~5.4.5` "to the version the Angular 18
toolchain supports."** During coexistence the React renderer is stuck on TS 5.4. That is
workable (React 19 types and `moduleResolution: "bundler"` both work on 5.4) but the pin —
and the Angular build accelerators in `allowBuilds` (`lmdb`, `msgpackr-extract`, `nice-napi`,
`protobufjs`) — are removed in the cutover task, not before.

**0.7 The design skill is written for marketing web pages and will fight a desktop workbench
if handed over raw.** `responsive-design.md` mandates mobile-first breakpoints and a 16px body
floor; `dark-mode.md` prefers `prefers-color-scheme` with no manual toggle; `tables.md` assumes
real `<table>` markup. Joinery is a fixed 800×600-minimum window (`window.ts:53-54`) with a
3-state theme control and a virtualized grid. Task 2 therefore produces a short **house-rules
overlay** loaded _alongside_ `design/design-guidelines.md`; its content is fixed here:
viewport breakpoints (`sm:`/`md:`/`lg:`) are **banned** in favour of `@container` (panels resize
independently of the window — which is the case `responsive-design.md` itself reserves container
queries for); the body floor is 12px per PROPOSAL §2.4; dark is a `@custom-variant` on
`[data-theme]` **plus** `prefers-color-scheme` for `system` (the toggle is required —
`settings.types.ts:5`); `tables.md`'s hairline-rows/no-container _look_ applies to the grid but
not its markup rules. Everything else in `design/` applies as written — especially `general.md`
(Tailwind authoring), `surfaces.md`, `buttons.md`, `form-controls.md`, `icons.md`,
`interactivity.md`, `shadows.md`.

---

## 1. Feature inventory — the scope contract

MUST = required for v1 parity. SHOULD = ship if the phase lands cleanly, else defer.
DROP = do not port. LOC are non-spec TS in the Angular source.

### 1.1 Shell & chrome

| Surface                                                                                       | LOC           | Verdict    | Notes                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell frame: resizable+persisted sidebar, window drag region, ⌘J output panel                 | 453           | **MUST**   | Rebuild, don't port. Audit §1.9: broken border ownership, 4px non-keyboard resize handle, four magic `38px`.                                                                                                                                 |
| Sidebar: connection tree, database picker, explorer nav, context menus, 7 dialog entry points | 1,926         | **MUST**   | Largest single surface. Split into ≤6 components (Task 8). Brand mark = inline `docs/brand/assets/mark-on-{dark,light}.svg`, not the 3 skewed `<span>`s at `sidebar.component.ts:397-428`.                                                   |
| Status bar: connection/rows/cursor, Docker pip, running-query indicator, theme toggle         | 608           | **MUST**   | Restructure: audit §1.9 proves the 24px bar cannot fit its own 24px controls.                                                                                                                                                                |
| Golden-Layout tab workspace: dock/split, lazy mount, layout persistence, tab context menu     | 827 + 713 mgr | **MUST**   | Replaced by Dockview (§2). `LayoutConfig` in `app-state.types.ts` must keep serializing — see Decision C.                                                                                                                                    |
| Output/console panel: log timeline, level filters, reveal log file                            | 321           | **MUST**   | Hardcoded non-resizable 220px today; make it a real Dockview panel.                                                                                                                                                                          |
| Custom tab strip                                                                              | 344           | **DROP**   | Dead; Dockview owns tab headers.                                                                                                                                                                                                             |
| Native-menu bridge (**31** channels, `preload/src/index.ts:394-441`)                          | 391           | **MUST**   | All 31 `menu.on*` subscriptions must land somewhere real, including the 3 currently broken ones (0.1). (Counted in Task 7: 31 in preload and 31 `menu.on*` calls in `menu.service.ts`. The "≈20" and "34" this row carried were both wrong.) |
| Global context menu renderer                                                                  | 144 + 67 svc  | **MUST**   |                                                                                                                                                                                                                                              |
| Toasts (`MatSnackBar`, 1 file)                                                                | 88            | **MUST**   | → `sonner`.                                                                                                                                                                                                                                  |
| Startup loading screen                                                                        | 129           | **MUST**   |                                                                                                                                                                                                                                              |
| Onboarding tour overlay + tour definitions                                                    | 312 + 209     | **SHOULD** | Only Welcome-tab entry points; low risk to defer one phase.                                                                                                                                                                                  |

### 1.2 Tab surfaces (the five things Dockview mounts)

| Surface                                                                                                             | LOC                     | Verdict  | Notes                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Query tab** — Monaco SQL editor, execute/cancel, format, ⌃E confirm gate, placeholder prompts, hosts 6 sub-panels | 2,689                   | **MUST** | Decompose hard; ~800 LOC of real logic. The two `document.createElement`+`innerHTML` modals (`:1557-1622`, `:1667-1717`) die with it. |
| **Results grid** — sort/filter/copy/export, row selection, menu-copy handler                                        | 2,055                   | **MUST** | AG Grid surface is shallow (§2.6).                                                                                                    |
| **Explorer object tab** — object detail view                                                                        | 447                     | **MUST** |                                                                                                                                       |
| **ERD tab** + pan/zoom diagram canvas, auto-layout                                                                  | 654 + 1,786 + 363 types | **MUST** | d3 + dagre are framework-agnostic; 26 hardcoded hexes must become tokens (audit §1.6).                                                |
| **Chat panel/tab** — streaming, tool confirmation, conversation list, per-tab instance state, markdown+mermaid      | 1,567                   | **MUST** | Both a side panel (`shell.component.ts:48`) and a tab type.                                                                           |
| **Welcome tab** — new-connection CTA, AI setup, tour launch                                                         | 953                     | **MUST** | The only brand-correct surface today (audit D4); keep it editorial, make it theme-aware.                                              |

### 1.3 Query-pane sub-panels

| Surface                                         | LOC   | Verdict                                                        |
| ----------------------------------------------- | ----- | -------------------------------------------------------------- |
| Row detail inspector + FK preview               | 1,315 | **MUST**                                                       |
| Result snapshot history (pin/label/inline diff) | 1,059 | **MUST**                                                       |
| Execution plan tree (MSSQL/PG/MySQL)            | 791   | **SHOULD**                                                     |
| AI analysis panel (markdown result explanation) | 540   | **SHOULD**                                                     |
| Connection context chip                         | 264   | **MUST**                                                       |
| Standalone result diff viewer                   | 624   | **DROP** — dead; superseded by the history panel's inline diff |
| `fk-link` component                             | 496   | **DROP** — dead; row-detail rolled its own                     |

### 1.4 Dialogs — one visual language, per 0.1

| Dialog                                                           | LOC       | Verdict                               |
| ---------------------------------------------------------------- | --------- | ------------------------------------- |
| Connection editor (create/edit/test, auth modes, SSH, DSQL/IAM)  | 1,040     | **MUST**                              |
| Restore wizard                                                   | 971       | **MUST**                              |
| Backup wizard                                                    | 674       | **MUST**                              |
| Query history (search, load-or-execute)                          | 608       | **MUST**                              |
| Server file browser (server-side drives/dirs)                    | 505       | **MUST**                              |
| Connection manager (list/organize)                               | 348       | **MUST**                              |
| AI setup (vendor + API key)                                      | 305       | **MUST**                              |
| Confirm dialog / input dialog                                    | 294 + 258 | **MUST** — become primitives          |
| Create / rename database (capability-gated)                      | 193 + 208 | **MUST**                              |
| Schema diff (picks 2 DBs, _generates a comparison query_)        | 391       | **SHOULD** — palette-only entry point |
| Missing-CLI-tools remediation (owns 3 of the 7 existing testids) | 352       | **MUST**                              |
| Test-result panel, password-hygiene warning                      | 90 + 95   | **MUST**                              |
| Full-page backup / restore / connections                         | 1,807     | **DROP** (0.1)                        |

### 1.5 Global overlays

| Surface                                                              | LOC   | Verdict                                                 |
| -------------------------------------------------------------------- | ----- | ------------------------------------------------------- |
| Settings panel (theme/editor/query/grid)                             | 965   | **MUST**                                                |
| Table properties slide-over (the _container_, which owns its own UI) | 1,236 | **MUST**                                                |
| Command palette (⌘K/⌘⇧P, fuse.js)                                    | 703   | **MUST** — and wire the 8 dead commands (0.4)           |
| Snippet library (CRUD, localStorage-only)                            | 710   | **MUST** — plus data migration (0.5)                    |
| Object search (fuzzy DB objects, fuse.js)                            | 488   | **MUST**                                                |
| Docker panel (container start/stop/create, volumes)                  | 497   | **SHOULD**                                              |
| Shortcuts cheatsheet                                                 | 264   | **MUST**                                                |
| Table properties panel (clone)                                       | 1,373 | **DROP** — dead                                         |
| Workspace / folder panel                                             | 395   | **DROP** — dead, plus its whole IPC surface goes unused |

### 1.6 Services & state (must survive semantically, not structurally)

**MUST port as pure TS, essentially unchanged** (no Angular in them): `markdown-renderer.ts`
(150 — the DOMPurify seam CLAUDE.md mandates), `explorer-folders.ts` (44), `utils/platform.ts`,
`sql-intellisense.service.ts` (768 — Monaco providers), `erd-adapter.service.ts` (259).

**MUST rewrite as stores/hooks:** `tab.state` (707), `explorer.state` (690), `connection.state`
(666), `chat.state` (384), `ai.state` (374), `query-results.state` (369), `chat-instance.state`
(354), `query-history.state` (150), `capabilities.state` (45), `settings.service` (232),
`onboarding.service` (209), `menu.service` (391), `log.service` (117),
`notification.service` (88), `table-properties.service` (64), `context-menu.service` (67),
`query-execution.service` (27), `global-error-handler` (20).

**DROP:** `ipc.service` (1,023 — 0.3), `golden-layout-manager.service` (713 — Dockview replaces
it), `sql-error.service` (331 — zero external refs), `theme.service` (31 — zero external refs;
consumers use `SettingsService` directly).

### 1.7 Persistent state that must round-trip identically

Main process, already typed: `AppState` (`sidebarWidth`, `sidebarCollapsed`, `chatPanelWidth`,
`lastConnectedProfileIds`, `lastDatabase`, `editorHeightPercent`, `showQueryHistory`,
`goldenLayoutConfig`, `aiSettings`), `saveTabs`/`getTabs`, `saveLayout`/`getLayout`, query
history, result snapshots, connection profiles + keytar secrets, AI settings/keys, chat
conversations, backup history. Renderer localStorage: the six keys in 0.5.

---

## 2. Stack

| Concern                                                    | Pick                                                                                                                                                                           | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **React**                                                  | 19.2                                                                                                                                                                           | Current stable; the concurrent/transition primitives are what keep chat streaming from thrashing (Risk R3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Build**                                                  | Vite 8.2 + `@vitejs/plugin-react` 6                                                                                                                                            | `base: './'` and `build.outDir: 'dist/browser'` reproduce Angular's exact artifact contract — see §3.1. Vite 8 bundles with Rolldown; verify install under `nodeLinker: hoisted` in Task 1 rather than assuming.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Tailwind**                                               | v4.3 via `@tailwindcss/vite`                                                                                                                                                   | v4 is what the design skills target: they reference `@theme`, `@utility`, `@custom-variant`, `--spacing()`, `inset-ring`, `scheme-only-dark`, and `npx @tailwindcss/cli canonicalize`. A v3 config would make `canonicalize-tailwind` and half of `general.md` inapplicable. CSS-first `@theme` also means the brand tokens are the Tailwind theme, not a parallel system.                                                                                                                                                                                                                                                                                                                                                                                      |
| **TypeScript**                                             | ~5.4.5 during coexistence, bump at cutover                                                                                                                                     | Forced by the workspace override (0.6). `strict`, `moduleResolution: "bundler"`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Local/UI state**                                         | Zustand 5 + `useShallow`                                                                                                                                                       | Closest sane idiom to Angular signals: one store per current `core/state/*` file, selector-subscribed so a chat token doesn't re-render the grid. Redux is ceremony this project doesn't need; Context re-renders the tree; signal libraries add a second reactivity model next to React's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Server/IPC state**                                       | TanStack Query 5                                                                                                                                                               | Every `window.joinery.*` call is an async request with cache/invalidate/retry semantics — exactly what the 1,023-LOC `ipc.service` hand-rolled badly. Event channels (`onProgress`, `onStreamChunk`, `onEntry`, `onFileChanged`, `onChanged`) stay imperative subscriptions that push into Zustand.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Router**                                                 | **None**                                                                                                                                                                       | 0.1: there is no outlet today and tabs are the navigation model. Adding a router would import a dead concept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Docking layout**                                         | **Dockview 8.1** (`dockview-react`)                                                                                                                                            | React-first, actively released, does dock/split/float/tab-groups, serializes to/from JSON, and supports custom tab renderers (needed for dirty/pinned markers and the rename affordance). Alternatives rejected: **golden-layout 2.6** is frozen at the same version the repo already pins, has no React binding, and its 1,540 LOC of manager+container coupling is a top-3 source of the audit's `!important` debt — keeping it means keeping the worst chrome in the app. **rc-dock** is lighter but its floating/serialization story is weaker. **flexlayout-react** can't do the tab-header customization. `react-resizable-panels` is the fallback if Dockview fights Electron (§6 R5) — sidebar/editor/results/output as fixed splits, tabs hand-rolled. |
| **Monaco**                                                 | `monaco-editor` 0.56 as ESM + `?worker` imports, wrapped in one owned `<SqlEditor>`                                                                                            | Drops the AMD `assets/monaco/vs/loader.js` script-tag hack at `query.component.ts:1221-1241` and the `declare const monaco` global at `:110`. `@monaco-editor/react` is **not** used: it defaults to a CDN loader, which is wrong under `file://` and wrong under a CSP. Register `joinery-ink`/`joinery-ivory` themes from the `--syntax-*` tokens (today it's stock `vs`/`vs-dark`, `:1062`).                                                                                                                                                                                                                                                                                                                                                                 |
| **Results grid**                                           | `ag-grid-react` 36 + `ag-grid-community` 36                                                                                                                                    | The old app's choice matters and the API surface is shallow — `ColDef`, `GridApi`, `defaultColDef`, `ModuleRegistry`, `onGridReady`, cell renderers (`results-grid.component.ts:23-53,1192-1429`). AG Grid ships a first-class React build, so this is a port not a rewrite, and it already satisfies CLAUDE.md's >1000-row virtualization rule. TanStack Table+Virtual would mean re-implementing column sizing, sort, range selection and clipboard from scratch — weeks of work to reach parity, for a lighter bundle nobody is paying for in a desktop app. Theme: bind the theme class to the effective theme (today hardcoded `ag-theme-quartz-dark`, `:213`) and derive all 26 `--ag-*` from tokens.                                                     |
| **Trees** (sidebar, explorer, object search, snippet list) | Hand-rolled + `@tanstack/react-virtual`                                                                                                                                        | Both current trees are bespoke and the shared `tree-view` is dead (1.5). `react-arborist` imposes its own row model and drag semantics on a tree that is context-menu-heavy and capability-gated. Virtualize from day one — the audit lists 6 unvirtualized long lists as deferred perf debt; don't re-inherit it.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Markdown + mermaid**                                     | Port `markdown-renderer.ts` verbatim: `marked` + `marked-highlight` + `highlight.js` + **DOMPurify**                                                                           | CLAUDE.md requires the single sanitize seam and forbids unsanitized `[innerHTML]`. In React that means one `<Markdown>` component that is the _only_ place `dangerouslySetInnerHTML` appears, fed exclusively by `renderMarkdown()`. Add an ESLint rule banning `dangerouslySetInnerHTML` everywhere else (Task 3). `mermaid` stays dynamically imported (`markdown-viewer.component.ts:42`); its `<style>`-escape issue is a known FOLLOW-UP, not this plan's.                                                                                                                                                                                                                                                                                                 |
| **Primitives**                                             | **Radix UI** (`dialog`, `dropdown-menu`, `select`, `tooltip`, `tabs`, `popover`, `scroll-area`) styled with the design skills, + `sonner` for toasts, + `cmdk` for the palette | This is the Material replacement and it is unavoidable: 16 `MatDialog` files, 129 `matTooltip`, 127 `mat-form-field`, 76 `mat-tab`, 70 `mat-menu`, 44 `mat-select`. Hand-rolling means hand-rolling focus traps, `aria-*` wiring and portal/collision logic six times — the audit already found 24 overlays across 3 mechanisms and zero `:focus-visible` on the status bar. Radix is unstyled, so `design/` guidelines apply directly with no fight. **Base UI rejected: 1.0.0-rc.0.** Inputs/textareas/checkboxes are plain elements styled by owned components per `componentize`'s one-component-per-HTML-element rule.                                                                                                                                     |
| **Icons**                                                  | `lucide-react`, tree-shaken                                                                                                                                                    | Replaces 1,148 `mat-icon` ligature uses. The two e2e assertions that match on ligature _text_ die with the old suite, which is being rewritten anyway.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Fonts**                                                  | `@fontsource-variable/archivo`, `@fontsource-variable/instrument-sans`, `@fontsource/ibm-plex-mono`, registered as `--font-*` in `@theme`                                      | Audit §1.5: two of the three brand faces are already requested in CSS and silently falling back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Forms**                                                  | `react-hook-form` + `zod` 4, reusing `packages/shared/src/validators/`                                                                                                         | The connection dialog is 1,040 LOC of conditional auth-mode validation; the shared validators already exist and must stay the single source of truth.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Unit tests**                                             | vitest 4 (existing runner) + `@testing-library/react` + jsdom project                                                                                                          | Root `vitest.config.ts` is `environment: 'node'` with `include: packages/*/src/**/*.{test,spec}.ts`. Task 1 adds a **second vitest project** for the React package with `environment: 'jsdom'`, leaving the node project and `vitest.integration.config.ts` byte-identical.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Lint/format**                                            | Existing prettier + `prettier-plugin-tailwindcss`; ESLint flat config with `react-hooks`, `jsx-a11y`                                                                           | `pnpm run lint` has reportedly never worked for the renderer (audit §1.10). The new package ships a working `lint` **and** `typecheck` task on day one — Angular's absent `typecheck` script is why `build` is the only current type gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### 2.9 One visual language for the duplicated surfaces — rationale

The dialogs win, and the reasoning is stronger than "they're the wired ones":
**modal-over-workbench is the correct pattern here.** Backup, restore and connection editing are
short, transactional, blocking flows — start one, watch a progress stream
(`backup.onProgress` / `restore.onProgress`), finish. A full page competes with the tab
workspace for the same real estate and implies the task is a _place_ you can navigate away from
and return to, which is false: the progress stream is per-invocation and unpersisted. The pages
also introduced the app's only `<mat-card>` and `mat-stepper` uses (audit §2.1, §2.6) — two
patterns the brand direction explicitly rejects ("avoid soft, bubbly cards",
`docs/brand/README.md:85`). So: **`<Dialog>` for all three**, sized `md`/`lg`, hairline-ruled
header + scrollable body + right-aligned action row, one filled oxide affordance per dialog
(audit §2.5), progress inline in the body. Connection _management_ stays a dialog too — its only
job is to launch the editor.

---

## 3. Coexistence & cutover

**Recommendation: (a) a new `packages/renderer-react` package, built feature-by-feature behind
a dev flag, cut over at parity.** Not a long-lived branch.

Why: this is a 45k-LOC replacement executed by agents one PR at a time. On a big-bang branch
nothing is runnable until the shell, docking, Monaco, the grid _and_ enough of the query tab all
exist — 6+ tasks with no verification gate between them, in a repo whose only renderer type gate
is `pnpm run build`. Agent work needs a green run per task or errors compound invisibly. A
divergent branch also blocks the other two v1 priorities (the MJ/Forge scrub, end-to-end query
verification) for its whole life. Dual maintenance is the cost and it is cheap here: the Angular
renderer is **frozen** for the duration (bug fixes only), and main/preload/shared are shared
unchanged, so there is no contract drift to reconcile.

### 3.1 The switch is one environment variable, because the artifact contract is reproducible

The pipeline's entire coupling to the renderer is **six** hard-coded strings in four files:

| #   | Site                                  | Value                                                |
| --- | ------------------------------------- | ---------------------------------------------------- |
| 1   | `electron-builder.yml:19`             | `packages/renderer/dist/browser/**/*`                |
| 2   | `packages/main/src/window.ts:114`     | `loadFile('../../renderer/dist/browser/index.html')` |
| 3   | `tests/helpers/electron-app.ts:22`    | `RENDERER_INDEX` — asserted before launch            |
| 4   | `tests/reporter/build-report.mjs:218` | the same path, as a tier gate                        |
| 5   | `packages/main/src/window.ts:111`     | `loadURL('http://localhost:4200')`                   |
| 6   | root `package.json:17`                | `wait-on http://localhost:4200`                      |

`scripts/package.js`, `prepare-package.js`, `restore-package.js`, `before-build.js`,
`verify-package.js` and `workspace-links.js` contain **zero** renderer references
(`workspace-links.js:21` only links `@joinery/shared`). `turbo.json`, `playwright.config.ts`
and both vitest configs are already renderer-agnostic. `angular.json:46` already sets
`baseHref: "./"`, which is what makes `file://` loading work.

So `packages/renderer-react` is configured to be indistinguishable and **all six sites need
zero changes**:

```ts
// vite.config.ts
base: './',                                  // matches angular.json:46 — required under file://
build: { outDir: 'dist/browser', emptyOutDir: true },
server: { port: 4200, strictPort: true },    // matches window.ts:111 and the root dev:main wait-on
```

Non-negotiables the bundle must satisfy regardless:

- **`sandbox: true`** (`window.ts:59-64`, with `contextIsolation: true`, `nodeIntegration: false`).
  No `process`, `require` or Node builtins may survive into the bundle; Vite's `define` /
  `import.meta.env` covers app code, but any dep touching `process.env` at runtime needs a shim.
- **Relative asset URLs** — absolute `/assets/...` breaks under `file://`.
- **Monaco's workers must land inside the asar** (`asar: true`, `electron-builder.yml:119`).
  Angular copied `monaco-editor/min` → `assets/monaco` (`angular.json:27-29`); Vite `?worker`
  imports achieve the same, verified by R4's packaging runs.
- **CJS interop** for the mermaid/dagre chain: `angular.json:21` needs
  `allowedCommonJsDependencies: ["@dagrejs/graphlib", "@dagrejs/dagre", "nearley"]`; the Vite
  equivalent is `optimizeDeps.include`, set in Task 1, confirmed in Tasks 17-18.
- **The inset titlebar drag region** — `titleBarStyle: 'hiddenInset'`,
  `trafficLightPosition: {x:15,y:15}` (`window.ts:57`). Task 7 owns it.

**How the switch happens.** `dev:renderer` becomes `pnpm --filter $JOINERY_RENDERER run start`,
defaulting to `@joinery/renderer`; `JOINERY_RENDERER=@joinery/renderer-react pnpm run dev` runs
the new UI. Both bind :4200 so only one runs at a time and `dev:main`'s `wait-on` is unchanged.
Both emit `dist/browser/`, so cutover is a directory rename in one PR after which all six sites
above stay untouched and `pnpm run dev` needs no env var.

**Turbo / vitest / CI.** `turbo.json` is task-name-based and needs no edit (its
`outputs: [".angular/**"]` just goes stale). The new package adds a real `typecheck` task —
Angular has none, which is why `.github/workflows/ci.yml:45-46` carries a hand-written
`tsc --noEmit -p packages/renderer/tsconfig.json`; Task 1 adds the equivalent. Root
`vitest.config.ts` gains a `projects` array so a jsdom React project (`include` widened to
`.{ts,tsx}`, own setup file) sits beside the existing node project — whose
`setupFiles: ['./packages/main/src/__tests__/setup.ts']` currently runs for renderer specs too.
`vitest.integration.config.ts` is **not touched**, per the constraint.

**The cutover PR also (persistence, from Task 5):** deletes the six localStorage keys 0.5
inventories — `joinery-settings`, `joinery:completed-tours`, `joinery:welcomeDismissed`,
`joinery-snippets`, `joinery-ctrl-e-execute-confirmed`, `joinery-flyway-placeholder-values` — which
Task 5 deliberately left in place because the Angular renderer still reads them, and which
`src/persistence/legacy-local-storage.ts` (plus its one-shot migration and the
`migratedFromLocalStorageAt` marker) exists only to read. Deleting them retires that whole module.
It also settles the **`joinery:theme-preference` mirror**: with Angular gone the mirror can drop its
`joinery-settings` fallback, and `no-local-storage-writes.spec.ts` — which today permits exactly one
`setItem` in the package — becomes the place to state whether the mirror stays at all (it must, or
the pre-mount FOUC script in `index.html` has no synchronous source; see `persistence/theme-mirror.ts`
for the rejected alternatives). Finally it drops **`optimizeDeps.include: ['@joinery/shared']`** from
`packages/renderer-react/vite.config.ts`: that entry exists because `packages/shared` emits tsc
CommonJS whose `__exportStar` chain the dev server's ESM interop cannot see through (Task 5 hit it on
the first import of a runtime value), so the real fix — **emitting ESM from `packages/shared`** — lands
here, and the workaround goes with it.

**The cutover PR also:** deletes `packages/renderer`; drops the `typescript: ~5.4.5` override and
the four Angular-CLI accelerators (`lmdb`, `msgpackr-extract`, `nice-napi`, `protobufjs`) from
`pnpm-workspace.yaml` `allowBuilds` (0.6); fixes the `strictPeerDependencies` comment, which
cites Angular; deletes the dead `@angular/*` group in `.syncpackrc.json:18`; swaps the four
Angular asar exclusions (`electron-builder.yml:41,42,44,45`) for
`vite`/`@vitejs`/`rolldown`/`tailwindcss` analogues; drops `.angular` from `.prettierignore` and
`turbo.json` outputs; removes the `JOINERY_RENDERER` indirection. It also closes a pre-existing
gap: `scripts/verify-package.js` probes main-process deps and the out-of-asar sqlglot server but
**never checks that the renderer landed in the asar at all** — without that assertion the
cutover's only proof is a manual launch.

**The cutover PR also (primitives, from Task 6):** deletes
`packages/renderer-react/src/markdown/sanitize-parity.spec.ts`. It is the drift guard that holds
`src/markdown/render-markdown.ts` byte-identical to the Angular
`packages/renderer/src/app/shared/markdown/markdown-renderer.ts`, and it does that by importing
the Angular file as `?raw` — a **static** import, so deleting `packages/renderer` without
deleting this spec fails the vitest run at collection, before a single test executes. That is the
right way round (a drift guard that can silently stop guarding is worse than none), which is why
it is a checklist item rather than a lazy import. It is also the only _import_ of the Angular
package anywhere in `renderer-react` — every other mention is a `Ported from …` docblock
reference, which survives the deletion harmlessly.

---

## 4. Phased SDD task plan

One task = one PR = one branch (`feature/rr-NN-slug`). Never commit to `main`.

**Standard gate, every task:** `pnpm run typecheck && pnpm run lint && pnpm test && pnpm run format:check`,
plus `pnpm --filter @joinery/renderer-react run build`. The Angular package must still build and
its e2e suite must still pass until Task 24 — that is the coexistence invariant.

**Docker gate:** any task whose gate names an e2e spec needs `pnpm run test:harness:up`.
**Ping Craig before running the Docker tiers** (CLAUDE.md).

**Test-hook rule, all tasks:** every interactive element ships `data-testid` at creation time,
named `<surface>-<element>[-<qualifier>]` (`sidebar-connection-button`,
`backup-dialog-start`, `results-grid-cell`). The 7-testid mistake is not repeated. Vendor
internals (`.monaco-editor`, `.ag-*`, Dockview's classes) may be located structurally.

### Phase A — Foundations (Tasks 1-7)

**1. Scaffold `packages/renderer-react`.**
Produces: package with Vite 8 + React 19 + TS + the §3.1 config; `index.html`; a "Joinery
renderer-react" placeholder root; `build`/`start`/`typecheck`/`lint`/`clean` scripts (Angular
has neither `typecheck` nor `clean`); ESLint flat config with `react-hooks` + `jsx-a11y`; the
second vitest jsdom project in root `vitest.config.ts`; a CI type-check step mirroring
`ci.yml:45-46`; `jsx`/`tsx` added to the root `format` globs; `JOINERY_RENDERER` indirection
in root `dev:renderer`.
Consumes: nothing.
Gate: standard. `dist/browser/index.html` exists and Electron loads it via
`JOINERY_RENDERER=… pnpm run dev`. Angular build and e2e untouched. Confirm the install
succeeds under `nodeLinker: hoisted` (Rolldown / Lightning CSS / Tailwind Oxide prebuilt
binaries). **Also run `pnpm run package:dir` + `verify:package` against the placeholder and
launch the packaged `.app`** — this is the R4 baseline and it is cheapest to establish now.

**2. Tailwind v4 theme from the brand tokens + the house-rules overlay.**
Produces: `src/styles/theme.css` with `@import "tailwindcss"`, `@theme` registering the 8
brand colors from `docs/brand/tokens.css` plus the derived contrast-safe values from
PROPOSAL §2.2-2.3 (`--j-oxide-deep/-lift`, `--j-amber-deep`, `--j-verify-deep`), the
type/spacing/radius/icon scales from PROPOSAL §2.4, and `--font-{display,interface,technical}`;
the three fontsource deps; `@custom-variant dark` on `[data-theme="dark"]` **and** `prefers-color-scheme` for
`system`; `color-scheme` per theme; a `theme-color` meta pair; `data-theme` written before
React mounts (kills the audit's 3-stage FOUC); `antialiased` on root and `isolate` on the app
container per `general.md`. Plus `docs/design/HOUSE-RULES.md` — the 0.7 overlay.
Consumes: Task 1.
Gate: standard + a static swatch/type-scale page screenshotted in both themes; every pair in
PROPOSAL §2.3 re-measured and recorded.

**3. IPC client layer.**
Produces: `src/ipc/` — a typed accessor over `window.joinery` (no re-declaration; import
`JoineryAPI` from the preload package), TanStack Query provider + one query-key factory per
preload namespace, a `useIpcEvent` hook wrapping the 6 `on*` unsubscribe-returning
subscriptions, and an availability guard for the `window.joinery === undefined` case that
`ipc.service.ts` handles today. Plus the ESLint rule banning `dangerouslySetInnerHTML` outside
`src/markdown/`.
Consumes: `packages/preload/src/index.ts`, `packages/shared/src/`. **Changes neither.**
Gate: standard + unit tests against a mocked `window.joinery`.

**4. Stores + typed command bus.**
Produces: Zustand stores ported from `core/state/*` (tab, connection, explorer, capabilities,
query-results, query-history, ai, chat, chat-instance) with the pure helpers
(`explorer-folders.ts`, `platform.ts`) moved over as-is; a typed command bus replacing the 9
`joinery:*` DOM events (0.4); the `settings` store owning theme resolution + `nativeTheme` IPC.
Consumes: Task 3.
Gate: standard + ported unit tests for `connection.state.spec`, `capabilities.state.spec`,
`explorer-folders.spec` (3 of the 7 renderer specs; they are logic tests and should port
nearly verbatim).

**5. Persistence + localStorage migration.**
Produces: `AppState`/`saveTabs`/`saveLayout` read-write wiring; a one-shot migration that
lifts the six localStorage keys (0.5) — settings, completed tours, welcome-dismissed, the
snippet library, and the two query-editor keys — into main-process `AppState`, idempotent and
reading the same key names the Angular app writes, so a user who has been running Angular
keeps their snippets.
Consumes: Task 4.
Gate: standard + a unit test proving migration is idempotent and a second proving a
pre-populated localStorage set round-trips into `AppState`.

**6. Primitives.**
Produces: `src/ui/` — `Dialog` (Radix, header/body/actions slots, `sm|md|lg`), `Button`
(`primary|outline|ghost|danger` × `sm|md`, exactly two heights ≥6px apart per `buttons.md`),
`Input`/`Textarea`/`Select`/`Checkbox`/`Switch` (one per HTML element, per `componentize`),
`Tooltip`, `DropdownMenu`, `Tabs`, `Popover`, `EmptyState` (retires 19 divergent
implementations), `Toolbar`, `Spinner`, `Toaster` (sonner), `Icon`, `Markdown` (the sole
`dangerouslySetInnerHTML` site, fed by the ported `renderMarkdown`), `Tree` (virtualized),
`ContextMenu`. Every one takes and merges `className`; no baked margins.
Consumes: Tasks 2, 3. Uses `design` + `componentize` + the house rules.
Gate: standard + a primitives gallery route screenshotted both themes + the ported
`markdown-renderer.spec` / `markdown-viewer.spec` / `loading.component.spec` (the other 4
renderer specs) + an XSS test asserting the sanitize seam.

**7. Shell + docking.**
Produces: app frame; Dockview workspace mounting placeholder panels for the five tab types;
sidebar/output-panel/chat splits; status bar; global context menu; toaster; the full
`menu.on*` bridge (all **31** channels — not 34; counted in Task 7 — including the 3 broken ones from 0.1, routed through the
Task 4 command bus); layout serialize/restore against the existing `LayoutConfig` shape
(Decision C); `--titlebar-height`/`--gl-header-height` as real tokens; keyboard-operable
resize handles with `role="separator"`.
Consumes: Tasks 4, 5, 6.
Gate: standard + both themes: empty shell, sidebar collapsed/expanded, 3 tabs incl. a dirty
one, output panel open, status bar in connected/disconnected/executing states.

### Phase B — Feature surfaces (Tasks 8-19)

Each consumes Phase A and is independently runnable. 8 and 9 go first — nothing else is
reachable without a connection. All gates are _standard plus_ what is listed.

| #   | Task — produces                                                                                                                                                                                                                                                       | Extra gate                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 8   | **Sidebar + explorer tree** — connection list, database picker, lazy virtualized object tree, capability-gated folders, the full context-menu action surface, and the inline brand mark from `docs/brand/assets/mark-on-{dark,light}.svg`. Split into ≤6 components.  | `explorer.spec.ts`, `multi-connection-disconnect.spec.ts` rewritten |
| 9   | **Connection dialogs** — editor (all auth modes incl. SSH and DSQL/IAM), manager, test-result panel, password-hygiene warning; `react-hook-form` + the shared validators                                                                                              | `connection.spec.ts`, `test-connection-feedback.spec.ts`            |
| 10  | **Query tab shell + Monaco** — `<SqlEditor>` with ESM workers, the two brand editor themes, `sql-formatter`, execute/cancel, the ⌃E confirm gate, cursor reporting to the status bar. **Opens with the R1 spike.**                                                    | `query-editor.spec.ts`, `query-toolbar.spec.ts`                     |
| 11  | **Results grid** — `ag-grid-react`, all 26 `--ag-*` from tokens, theme-bound class, sort/filter, all three `CopyFormat`s, export, row selection                                                                                                                       | `cross-schema-query.spec.ts` + a 100k-row perf assertion (R2)       |
| 12  | **Backup dialog** + missing-CLI-tools view + server file browser + the broken Database ▸ Backup menu wire                                                                                                                                                             | `backup-cli-deps.spec.ts` + backup half of `backup-restore.spec.ts` |
| 13  | **Restore dialog** + the broken Database ▸ Restore menu wire                                                                                                                                                                                                          | restore half of `backup-restore.spec.ts`                            |
| 14  | **Query sub-panels** — row detail + FK preview, result history with inline diff, connection chip                                                                                                                                                                      | `row-detail.spec.ts`                                                |
| 15  | **Settings panel + theme control** — all four settings groups, 3-state toggle                                                                                                                                                                                         | `settings.spec.ts`, `theme.spec.ts`                                 |
| 16  | **Palette + object search + snippet library + shortcuts dialog** — cmdk; **all** commands wired (0.4); snippets read from the Task 5 migration                                                                                                                        | a spec asserting zero palette commands are no-ops                   |
| 17  | **Chat panel + tab** — streaming, tool confirmation, conversation list, per-tab instance isolation, markdown+mermaid via the Task 6 `Markdown`; chunk coalescer (R3)                                                                                                  | a streaming re-render benchmark                                     |
| 18  | **ERD tab + diagram** — d3 + dagre ported, 26 hardcoded hexes → tokens, first theme-aware ERD                                                                                                                                                                         | both themes                                                         |
| 19  | **Welcome tab + query history dialog + create/rename DB + explorer object tab + output panel + the SHOULD tier** (execution plan, AI analysis, AI setup, Docker panel, schema diff, tours). Split if it exceeds one PR; Docker panel and tours are the natural spill. | `welcome-screen`, `shell`, `tabs`, `ui-actions` specs               |

### Phase C — Suite rebuild (Tasks 20-23)

**20. e2e harness for the React renderer.** The current suite is **20 spec files / 49 `test()`
blocks**, and `tests/helpers/joinery-actions.ts` is the biggest rewrite surface — Material-coupled
end to end: `fillField` locates `mat-form-field` filtered by `mat-label:text-is(…)` (`:78-88`,
with a comment explaining Material's label association defeats `getByLabel`),
`connectToTestPostgres` waits on `app-root` (`:98`) then drives `mat-dialog-container` /
`mat-select` / `mat-option` / `mat-checkbox` (`:100-119`) and dismisses
`.mat-mdc-snack-bar-container button` (`:127`), `selectDatabase` uses
`.mat-mdc-menu-panel [role="menuitem"]` (`:142-150`).
Produces: `electron-app.ts` temporarily parameterized by renderer package; a
`data-testid`-only `joinery-actions.ts` where `fillField` collapses to `getByLabel` (real
`<label for>` makes it work); a Playwright project per renderer. **Zero structural-class and
zero Material-internal locators** — the old suite's 62 locators included 7 Material internals
and 2 icon-ligature-text matches.
Two traps: (a) `electron-app.ts:88-99` force-loads **7 named font faces** (Inter 400/500/600/700,
JetBrains Mono 400/500, `24px "Material Icons"`) before any assertion — with brand fonts and
Lucide those calls silently resolve against nothing and baselines flip between fallback and real
renders, so update the list here; (b) the `.monaco-editor:visible` filters (`:154-175`) exist
only because Golden Layout keeps inactive tabs' Monaco mounted — if Dockview unmounts inactive
panels, assert the new behaviour rather than inheriting the workaround.
Gate: the ported Phase B specs green on both renderers.

**21. e2e coverage completion** — specs for surfaces Phase B didn't gate: palette, snippets,
object search, chat, ERD, table properties, docker panel.

**22. Visual baselines** — today: **11 PNGs** across 4 specs (`connected`, `connection-dialog`,
`dialogs`, `welcome`), mostly single-theme and already stale/RED per FOLLOW-UPS. Produce a
dark **and** light pair per major surface, then **inspect every PNG before committing** —
FOLLOW-UPS is explicit that `--update-snapshots` must not be run reflexively.

**23. Perf + a11y sweep** — grid at 100k rows, chat streaming, ERD at 200 tables,
`:focus-visible` on every interactive element, keyboard-operable resize handles and docking.

### Phase D — Cutover (Task 24)

**24. Cutover.** Everything in §3.1's last bullet: rename `renderer-react` → `renderer`, delete
the Angular package and its 7 specs, drop the `typescript` override and the four Angular
accelerators from `allowBuilds`, remove the `JOINERY_RENDERER` indirection, delete the old
e2e helper parameterization.
Gate: standard + full `pnpm run test:full` + `pnpm run package:mac` + `pnpm run verify:package`

- a manual launch of the packaged `.app` connecting to all three engines.

---

## 5. Decisions for Craig

**A. Radix UI as the Material replacement — or hand-rolled primitives?**
_Recommendation: Radix._ The Material surface being replaced is 16 dialog files, 129 tooltips,
127 form fields, 76 tabs, 70 menus, 44 selects. Hand-rolling means owning six focus traps,
six sets of `aria-*` wiring, and portal collision detection — and the audit already shows what
happens when this app hand-rolls overlays (24 implementations, 3 mechanisms, no `:focus-visible`).
Radix ships unstyled, so `design/` applies with no fight and the "one layer of magic" rule in
CLAUDE.md holds. Cost: ~8 small runtime deps. Say no if you'd rather own every line.

**B. AG Grid (port) or TanStack Table + Virtual (rewrite)?**
_Recommendation: AG Grid 36 via `ag-grid-react`._ The current usage is shallow enough to port
in one task, and it already meets CLAUDE.md's >1000-row rule. TanStack means re-implementing
column resize/reorder, multi-sort, range selection and clipboard to reach parity — real weeks,
for a lighter bundle that a desktop app doesn't need. Say TanStack if you want the grid fully
owned and are willing to spend three tasks on it instead of one.

**C. Does the saved Golden Layout config have to survive the swap?**
_Recommendation: no — migrate by reset._ `AppState.goldenLayoutConfig` is Golden Layout's
serialized tree; Dockview's is different. A translator is real work for a single user's window
arrangement. Cheaper: on first React launch, ignore `goldenLayoutConfig`, rebuild the workspace
from the still-valid `saveTabs`/`getTabs` list (which holds everything that matters — type,
title, connection, database, content, dirty, pinned), and write a Dockview config from then on.
The `LayoutConfig` type in `app-state.types.ts` stays, holding a different shape. **This is the
one place the plan touches persisted-data semantics, so it needs your yes.** Say no and Task 7
grows a translator.

**D. Should the SHOULD tier ship in v1?**
_Recommendation: onboarding tours and Docker panel yes; execution plan, AI analysis panel, and
schema diff deferred to v1.1._ The last three are single-entry-point surfaces (two are
palette-only) totalling ~1,700 LOC, and the schema-diff dialog doesn't actually diff — it
generates a comparison query. Deferring them takes ~1.5 tasks off the critical path. Say
otherwise if any of them is something you personally use.

---

### Decisions resolved (Craig, 2026-08-15 — binding)

- **A: Radix.** Unstyled primitives; the licensed design skills style them.
- **B: AG Grid 36 via `ag-grid-react`** — port, not TanStack rewrite.
- **C: Migrate by reset.** `goldenLayoutConfig` is ignored on first React launch; the workspace rebuilds from `saveTabs`/`getTabs` (which must be fully preserved); Dockview config written from then on. No translator.
- **D: OVERRIDDEN — nothing defers.** Execution plan, AI analysis panel, and schema diff all ship in v1 alongside onboarding tours and the Docker panel. The SHOULD tier is v1 scope in its entirety; the task list grows accordingly (the ~1.5 reclaimed tasks return to the critical path).

## 6. Risks

**R1 — Monaco under Vite + Electron `file://`.** The current AMD loader hack
(`query.component.ts:1221-1241`) exists because someone fought this. ESM Monaco needs 5 web
workers resolved relative to `base: './'`, and `@monaco-editor/react`'s CDN default is flatly
wrong here. _Mitigation:_ Task 10 begins with a spike that builds the editor, opens the
**packaged** app (not just `pnpm dev`) and confirms workers load, IntelliSense fires, and no
`will-navigate`/CSP violation appears. If ESM workers fight the file protocol, fall back to
`monaco-editor/esm/vs/editor/editor.main` with `MonacoEnvironment.getWorkerUrl` returning a
blob shim — decided in the spike, not mid-task.

**R2 — Grid performance regression.** CLAUDE.md requires virtualization >1000 rows and
`maxRowsToDisplay` defaults to 10,000 (`settings.types.ts`). A React port can accidentally
re-render 10k rows per keystroke through a badly-scoped store selector. _Mitigation:_ Task 11's
gate includes a 100k-row scroll/sort/filter assertion against `plans/perf-baselines.md`; the
grid subscribes to Zustand with `useShallow` and never to whole-store slices; row data is
passed by reference, never mapped in render.

**R3 — Chat streaming re-render pressure.** `onStreamChunk` fires per token and the panel
re-renders markdown → highlight.js → sanitize on every chunk. Angular's `OnPush` +
`ChangeDetectorRef` masked some of this; React will not. _Mitigation:_ Task 17 coalesces chunks
on a ~50ms rAF boundary, keeps in-flight text in a ref (not state) until the boundary, memoizes
`<Markdown>` per completed message, and re-parses only the streaming tail. Gate is a measured
benchmark, not a vibe.

**R4 — Packaging regression discovered only at Task 24.** The pnpm-hoisted-`node_modules`
comment in `pnpm-workspace.yaml` documents an app that "packaged and signed cleanly but crashed
on the first database connection." _Mitigation:_ Task 1 runs `pnpm run package:dir` +
`verify:package` against the placeholder React renderer and records the result. Every task after
Task 7 that adds a native-ish dep (Monaco workers, AG Grid, fontsource) re-runs
`pnpm run package:dir`. Cutover is then a rename, not a discovery.

**R5 — Dockview doesn't fit.** The tab workspace is load-bearing for five surfaces and the
requirements are specific: custom tab renderers for dirty/pinned/rename, JSON serialization,
and imperative add/focus/close driven by `tab.state`. _Mitigation:_ Task 7 spikes Dockview
against those four requirements _before_ building the shell around it. Documented fallback:
`react-resizable-panels` for the fixed splits plus an owned tab strip — less capable, fully
understood, and it retires the same Golden Layout debt. Decide in the spike; do not discover it
at Task 17.

**R5 RESOLVED (Task 7, Dockview 8.1.0 — spike evidence in `.superpowers/sdd/PLAN/task-7-spike.json`).**
All four requirements pass; **the fallback is not needed** and Dockview is the workspace.
Measured in a real Chromium, not read from docs:

1. _Custom tab renderers_ — `tabComponents` receives full React components. A dirty flag set in
   `tabStore` **after** the panel existed reaches the header with no `panel.update()` call, so tab
   headers subscribe to the store and `params` stay a serialization vehicle. Inline rename works,
   but a tab is a drag source: without `stopPropagation` on pointerdown/mousedown the input cannot
   be focused or selected.
2. _JSON serialize/restore_ — `toJSON()`/`fromJSON()` round-trip panel ids, group count and the
   active panel exactly, and the blob is `structuredClone`-able, i.e. it survives the IPC boundary.
3. _Imperative add/focus/close from `tabStore`_ — works, with one trap: **`addPanel` with no
   `position` creates a NEW GROUP per panel** (four tabs became four side-by-side groups). Tabs must
   be placed `within` an existing tab panel's group.
4. _Inactive panels_ — with the default `onlyWhenVisible` renderer the panel's React component
   **stays mounted** (no remount, local state survives a tab switch) while its **DOM subtree is
   detached from the document**: `document.querySelector` cannot find it and exactly one copy per
   visible group is in the tree. Opting a panel into `renderer: 'always'` keeps the DOM attached
   instead (all N queryable, one visible).

Two consequences for later tasks, and they are the reason this block exists:

- **Task 20's `.monaco-editor:visible` workaround is unnecessary under the default renderer** —
  there is only ever one `.monaco-editor` in the document per visible group, so assert the new
  behaviour as §Task 20 trap (b) instructs. It becomes necessary again _if_ Task 10 opts query tabs
  into `renderer: 'always'`.
- **Task 10 must call Monaco's `layout()` when a query tab is re-activated.** Under the default
  renderer the editor's host node is detached while hidden, so it comes back with stale (zero)
  measurements. `renderer: 'always'` avoids that at the cost of keeping every editor's DOM alive —
  a real trade to make with the R2/R3 perf work, not by default.

---

## 7. IPC contract warts — flagged, not redesigned

The React renderer consumes `window.joinery` exactly as it is. Logged for a later, separate PR
(line numbers are `packages/preload/src/index.ts` unless noted):

1. `connection.test`/`save` take **three consecutive optional `string`s** —
   `(profile, password?, sshPassword?, sshPassphrase?)` (`:83-94`). Any two transpose silently.
2. `explorer.getEnrichedColumns` returns a **15-field anonymous inline type** (`:215-238`) that
   no consumer can import by name. It belongs in `database.types.ts`.
3. `query.convertSql(sql, fromEngine: string, toEngine: string)` (`:249-253`) — bare strings
   where a `DatabaseEngine` union exists.
4. `queryResults.saveSnapshot` takes **5 positional args** (`:257-263`), two adjacent strings.
5. `app.setState(partial)` (`:361`) is an **unvalidated deep merge** — the renderer can write
   any shape into persisted state.
6. `chat.onStreamChunk` is a **single global subscription** (`:310`); per-conversation fan-out
   happens in the renderer, so every chat instance wakes on every token.
7. **Split-brain persistence.** `AppState` lives in main while every `AppSettings` value lives in
   renderer `localStorage` (`settings.service.ts:129,149`) — even though `AppState.aiSettings`
   proves settings _can_ live in main. This is what makes 0.5 necessary.
8. `logs.append` (`:344`) lets the renderer write arbitrary log entries, unthrottled.
9. Two disjoint channel trees, `IPC_CHANNELS` and `CHAT_IPC_CHANNELS`, with no shared naming.
10. **No menu channel for the palette-only surfaces** (snippets, object search, settings) —
    which is why the renderer grew 9 `joinery:*` DOM events, 8 of them dead (0.4).

Also, unrelated to the contract but confirmed while reading it: there is **no CSP, no
`will-navigate` guard and no `setWindowOpenHandler`** anywhere in main or preload, despite
`sandbox: true` — flagged in-code at `markdown-viewer.component.ts:234` and in FOLLOW-UPS.

---

## 8. Out of scope

- Any change to `packages/main`, `packages/preload`, `packages/shared` — including the §7 warts.
- `vitest.integration.config.ts` and the integration tier (constraint).
- New features. `plans/UX-IMPROVEMENTS-ROADMAP.md` stays a roadmap; discoveries go to
  `plans/rebrand/FOLLOW-UPS.md`.
- The FOLLOW-UPS security items (`will-navigate`, CSP, mermaid `<style>` escape, leaked `sa`
  password). The CSP must not ride in a UI PR — but adding one later interacts with Monaco
  workers, so Task 10's spike checks its own CSP compatibility.
- Screen-reader audit beyond the focus/contrast/keyboard work in Task 23.
- Window-size responsiveness — fixed 800×600 minimum; panel adaptation is `@container` (0.7).
