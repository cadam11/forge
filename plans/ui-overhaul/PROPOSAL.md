# Joinery UI overhaul — proposal

Design audit, 2026-08-15. Scope: **visual system only**, no feature work.
Inputs: `docs/brand/` (README, tokens.css, brand-board.png, SVGs), the licensed
`design` / `add-dark-mode` / `componentize` skill guidelines, the current renderer,
`plans/rebrand/FOLLOW-UPS.md` items 11 + 12.

---

## Decisions first — answer these 8 and the rest is mechanical

| # | Question | Recommendation |
| - | -------- | -------------- |
| D1 | Keep Angular Material and retheme it, or replace visible Material components? | **Keep.** Two scoped M2 themes. |
| D2 | Ink-first (dark canvas) or ivory-first workbench? | **Ink-first**, ivory at full parity. |
| D3 | Retarget existing token *names*, or a new `--j-*` namespace + migration? | **Retarget + alias.** Zero component churn in phase 1. |
| D4 | Welcome hero: editorial full-bleed surface, or shrink to app chrome? | **Stays editorial**, becomes theme-aware. |
| D5 | Sidebar + status bar: retheme, or restructure? | **Sidebar retheme, status bar restructure.** Mark → real SVG. |
| D6 | Golden Layout chrome: keep hand-restyling, wrap, or replace? | **Keep restyling.** Delete the dead `TabBarComponent`. |
| D7 | Ship the three brand typefaces (~3 deps)? | **Yes, all three.** Two are already referenced and silently failing. |
| D8 | Test hooks before restructuring, or fix selectors after? | **Before**, in a no-visual-change phase 0. |

Evidence and alternatives in §3.

---

## 1. Current-state assessment

### 1.1 The app was never rebranded — only the name and the logo were
`styles.scss:13-62` still defines a purple Material primary (`#7c6ef6`) and a green
accent. Both theme mixins (`:118-174` dark, `:177-233` light) are purple end to end —
dark canvas `#1e1e2e`, light canvas `#fafafe`, accent `#7c6ef6` in both. **No brand colour
appears in the global token layer.** Brand hexes occur in exactly two files:
`features/welcome/welcome.component.ts:410-415` and `layout/sidebar/sidebar.component.ts:415,421,427`.
→ severity **critical**, effort **low** (see 1.2).

### 1.2 The token plumbing is good; it points at the wrong values
2,872 custom-property occurrences; 85 distinct read via `var()`; 166 declared.
`--spacing-sm` 234×, `--border-primary` 203×, `--text-secondary` 200×. Material is already
wired through these vars by hand (`styles.scss:556-835` maps `--mdc-*`/`--mat-*` onto app
tokens). **Changing the *values* in the two mixins reskins Material, dialogs, form fields,
selects, menus and tooltips at once — a ~60-line diff.** Highest-leverage edit available.

### 1.3 27 tokens are read and never defined; some emit invalid CSS today
| Token | Uses | Worst site |
| ----- | ---- | ---------- |
| `--accent-primary` | 24 | `shell.component.ts:117` → resize handle is VS Code blue `#007acc`, never the accent. `sidebar.component.ts:653,657,658` → **AI button has no hover and no active state** (no fallback). `golden-layout-container.component.ts:247-254` → **tab-rename confirm has no background + white text = invisible in light mode**. |
| `--status-{success,warning,error}-rgb` | 10 | `result-diff-viewer.component.ts:318-328,382-392,441-449` — `rgba(var(--status-success-rgb),.1)` is invalid CSS; **9 diff highlights silently never render**. |
| `--text-tertiary` | 4 | `output-panel.component.ts:208,228,242,268` — always the `#888` fallback; fails contrast on light `#fafafe`. |
| `--radius-full` (3), `--border-color` (6), `--accent-error` (4), `--hover-bg` (4), `--accent-color` (3), `--accent-hover`, `--border-subtle`, `--panel-bg`, `--header-bg`, `--bg-selected`, `--selection-bg` … | | |

Three parallel naming schemes for the same ideas: `--accent`/`--accent-primary`/`--accent-color`;
`--border-primary`/`--border`/`--border-color`/`--border-subtle`; `--bg-hover`/`--hover-bg`;
`--status-error`/`--error-color`/`--accent-error`.
→ **high** severity, **low** effort — most are one-line aliases.

### 1.4 Material is themed dark-only, then patched for light by hand
`styles.scss:67` uses `mat.m2-define-dark-theme` and `:81` `mat.all-component-themes` —
**one theme, and it is dark**. Light mode is faked by re-pointing CSS vars, so Material's
own emitted values (elevation, ripples, disabled states) stay dark. The cost: a 58-line
light patch layer (`:658-715`), a white ripple on a light canvas (`:766`), and **276
`!important`s** in the global sheet, several reaching private MDC DOM (`.mdc-dialog__surface`
`:495`, `.mdc-notched-outline__notch` `:576`, `.mat-mdc-button-persistent-ripple::before` `:753`),
plus a documented brute-force hack absolutely centring every `mat-icon` (`:734-747`).
→ **high** / **medium**.

### 1.5 No typographic scale in practice; the brand faces are not installed
- **371 literal `px` font-sizes across 21 distinct values** vs 218 tokenised. The 5 tokens
  (11/12/13/14/16px) cover 5 of the 21. `18px` appears 52× untokenised (it is icon sizing
  leaking into the type scale); `8px`/`9px` appear 8× — below any legibility floor.
- Spacing: **391 literal across 25 values** vs 403 tokenised; the 4/8/16/24/32 ladder has
  no rung for `12px` (84 uses), `6px` (59), `10px` (34). Off-grid: 3, 5, 7, 22, 30, 34, 38, 54, 88.
- Radius: **9 distinct literal values** (2–12px) against 3 tokens.
- **Archivo Narrow, Instrument Sans and IBM Plex Mono are not installed.** `angular.json`
  ships `@fontsource/inter` + `@fontsource/jetbrains-mono` + `material-icons`. Yet
  `sidebar.component.ts:391` and `welcome.component.ts:460` already request
  `'Instrument Sans'`, `welcome.component.ts:248` requests `'IBM Plex Mono'`, and
  `welcome.component.ts:271,298` approximate the display face with `'Arial Narrow'`.
  **The type system in `docs/brand/README.md:57-63` is currently unimplementable.**
→ **high** / **medium**.

### 1.6 Contrast and dark-mode bugs
- **`FOLLOW-UPS` item 12 is worse than recorded.** `sidebar.component.ts:421` paints the
  mark's middle bar `#f2efe7` on `--bg-tertiary` = `#e6e6f0` in light (`styles.scss:181`) —
  **1.08:1, invisible**. Undocumented: `:427` paints the third bar `#c8f04a` on the same
  surface — **1.06:1, also invisible**. In light mode the mark degrades to one orange dash.
  `sidebar.component.ts:387-390` already carries a comment deferring this to "the
  priority-2 UI overhaul."
- **The welcome screen ignores dark mode entirely.** `welcome.component.ts:25` applies
  `class="concept-shell joinery-concept"` unconditionally; `.concept-shell` defines dark
  `--concept-*` values (`:231-236`) and `.joinery-concept` overrides them with light ivory
  at equal specificity (`:410-415`). The dark block is dead code; the hero is hardcoded
  ivory on an ink app.
- **Three theme-blind vendor surfaces.** `angular.json` loads `highlight.js/styles/atom-one-dark.css`
  with no light counterpart and nothing overrides `.hljs-*`. `results-grid.component.ts:213`
  hardcodes `class="ag-theme-quartz-dark"` in both themes. `erd-diagram.component.ts` carries
  **26 hardcoded hexes**, so the ERD never follows the theme.
- **No `color-scheme` property or `theme-color` meta anywhere.** `index.html` is 13 lines,
  no inline style, no critical CSS; `:root` defaults dark (`styles.scss:236`) and
  `data-theme` is written only after Angular boots (`settings.service.ts:227,229`) → light
  users get a three-stage flash (white → dark → light). The dark-mode guideline requires
  the `color-scheme` hint for native scrollbars and controls.
- **126 hardcoded hexes across 18 component files.** The recurring values are VS Code
  chrome (`#3c3c3c` ×9, `#007acc` ×5, `#1e1e1e` ×4, `#252526` ×2) and Material palette
  primaries (`#f44336` ×5, `#2196f3` ×4, `#ffc107` ×3, `#9c27b0` ×2 at `query.component.ts:882,900`)
  — two foreign design systems bleeding through.
→ **critical** for the mark, **high** for the rest; **low–medium** effort.

### 1.7 No shared primitives, so every surface reinvented the same six things
53 components, **zero `.scss` files** — every style block is inline in a `.ts`
(`inlineStyleLanguage: "scss"`), ~11,300 lines of it. There is nowhere for a partial to
live, so duplication is structural:

| Pattern | Distinct implementations | Shared version |
| ------- | ----------------------- | -------------- |
| Empty state | **19** across 6 class names (`.empty-state` ×13, `.no-selection` ×3, `.empty-results`, `.no-results`, `.empty-text`) | none |
| Dialog/panel header | **13** — 7 re-style `h2[mat-dialog-title]` locally (`restore-dialog:354`, `backup-dialog:258`, `connection-dialog:400`, …) | 2 consumers |
| Overlay + backdrop | **24** across 3 mechanisms (13 hand-rolled, 9 MatDialog, 2 `document.body.appendChild`) | none |
| Loading state | 23 files hand-roll `<mat-spinner>` (32 instances) | `shared/components/loading/` exists, **2 consumers** |
| Button treatment | 7 Material variants + **25 bespoke classes**, 3 competing primary/secondary schemes (`.btn-primary`, `.btn-confirm`, `.concept-primary`), **7 different close buttons** | none |
| Toolbar | 3 (`query:168`, `results-grid:85`, `result-history-panel:149`); `mat-toolbar` used 0× | none |

Also 73 `::ng-deep` across 11 files (28 of them in `chat-panel.component.ts:1003-1122`,
an entire markdown stylesheet that belongs in `shared/markdown/`) and 36 `!important` in
components on top of the 276 global ones.

Worst single offender: **`query.component.ts:1557-1622` and `:1667-1717` build two modal
dialogs with `document.createElement` + `innerHTML`**, bypassing Angular, MatDialog and the
token system. All 27 inline `style="…"` attributes in the codebase live in those strings.
→ **medium** visual / **high** maintenance; **high** effort.

### 1.8 Dead UI to delete before restyling anything (~3,500 LOC)
| What | LOC | Evidence |
| ---- | --- | -------- |
| `shared/components/table-properties-panel/table-properties-panel.component.ts` | 1,373 | unreferenced near-clone of `table-properties-container.component.ts`; only the container is wired (`app.component.ts:10,29`) |
| `layout/tab-bar/tab-bar.component.ts` | 344 | referenced only by `layout/index.ts:3`; Golden Layout owns the tab strip |
| Duplicate routed pages: `features/backup` (495) + `features/restore` (677) + `features/connections` (635) | 1,807 | each duplicates a dialog in a *different* visual language (stepper+card vs tabs+expansion) |
| **10 of 30 command-palette commands** | — | `FOLLOW-UPS` 11, verified: dispatches at `command-palette.component.ts:331,341,354,366,376,411,425,535,546,599` have zero listeners. `:425`/`:535`/`:546` are one-line wires to existing owners (`settings.service.isOpen()`, `sidebar.component.ts:963`, `:1000`); `:523` and `:589` dispatch the same event (duplicate entry). |
| `packages/renderer/src/assets/icons/logo.png` | — | `FOLLOW-UPS` 12, verified: two prose references repo-wide, zero code references |

### 1.9 Shell chrome specifics
- **The status bar cannot fit its own contents.** `shell.component.ts:177` sets it to
  **24px** (`styles.scss:87`) while all four toggles inside are `height:24px` with zero
  padding (`status-bar.component.ts:291,321,370,400`) — and `:31-33` host-binds
  `border-top: 3px solid <profile.color>`, leaving a 21px content box. The unseen-error badge
  at `top:-2px` (`:350`) sits outside the bar and will clip. `.theme-toggle` (`:366-385`)
  lacks the `border`/`background` reset its three siblings have → UA chrome. None of the four
  has `:focus-visible`.
- **`38px` is a magic number in four places with two meanings**: traffic-light clearance
  (`sidebar.component.ts:369`, `shell.component.ts:121`) and GL header height
  (`styles.scss:870`), where the real header is `36px` (`:950`). No `--titlebar-height` token.
- `.resize-handle` is a 4px target with `margin: 0 -2px` (`shell.component.ts:103-113`), no
  `role="separator"`, no focus style, not keyboard-operable. Output panel is a hardcoded,
  non-resizable `220px` (`:183`) while sidebar width is resizable *and* persisted.
- Main-process `backgroundColor` is hardcoded `#1e1e1e`/`#ffffff` (`packages/main/src/window.ts:56`),
  matching neither canvas → wrong-colour flash on window create.
- Golden Layout loads **base CSS only** (`styles.scss:8`), so the ~360 lines at `:836-1198`
  *are* the theme yet are written almost entirely with `!important`. The close button is four
  inline SVG data-URIs with baked strokes (`:1092,1098,1107,1111`); drop indicators use a
  stale Solarized blue `rgba(38,139,210,…)` (`:1172,1184`); one selector is declared twice
  with different opacity (`:1029-1031` then `:1101-1103` — the first is dead).
- Monaco uses stock `vs`/`vs-dark` (`query.component.ts:1062,1269`), so the six `--syntax-*`
  tokens per theme never reach the editor. **OnPush adoption is 12/46 (26%)** — `app.component`,
  `shell`, `status-bar` (30s Docker poll at `:539`) and the 2,689-line `query.component` all
  run default change detection.

### 1.10 Test-hook reality — the overhaul's main risk
**7 `data-testid` attributes exist in the whole renderer**, in 4 files
(`welcome.component.ts:50`, `backup-dialog:76`, `restore-dialog:77`, `missing-cli-tools:28,48,98`).
**Zero in `layout/`.** The suite therefore keys on **62 distinct locators**, only 5 of which
are testids:
- Structural classes: `app-sidebar .connection-selector .connection-button`,
  `app-sidebar .database-selector button`, `.tree-container`, `.explorer-tree`,
  `app-status-bar button.docker-success`, `.query-toolbar:visible`, `.detail-panel`,
  `.empty-state`, `.historical-banner`, `.snapshot-item`, `.tree-item`, `.menu-item`, `.context-menu`
- Vendor internals: `.lm_tab`, `.lm_close_tab`, `.ag-cell`, `.ag-header-cell-label`,
  `.ag-root-wrapper`, `.monaco-editor .view-line`
- **Material internals** (7): `mat-form-field`, `mat-select`, `mat-option`, `.mat-mdc-menu-panel`,
  `.mat-mdc-snack-bar-container`, `.mdc-floating-label--float-above`, `mat-label:text-is("Password")`
  — and **two match on icon *ligature text***: `button:has(mat-icon:text-is("download"))`,
  `mat-icon:text("history")`, so moving to SVG icons breaks them.

`welcome.component.ts:45-47` carries a comment saying exactly this. Baselines: **11 PNGs**
in `tests/__snapshots__/visual/`, already stale/RED (`FOLLOW-UPS` 1). `pnpm run lint` has
never worked and the renderer has no `typecheck` script (`FOLLOW-UPS` 6) — `pnpm run build`
is the only renderer type gate.

---

## 2. Design direction

### 2.1 What the brand asks for, translated
`docs/brand/README.md:80-86` is specific and maps cleanly onto a dense workbench: visible
rules and measured spacing; warm ivory canvases paired with dense charcoal product
surfaces; relationships as diagrams and rails; restrained corners, no soft bubbly cards, no
decorative gradients; operational and information-dense product UI. The board confirms it —
the product mockups are ink canvases with hairline rules and oxide used once per surface.
Three consequences, all contradicting the current UI:

1. **Rules replace shadows.** Surfaces separate with a 1px rule and a paper/charcoal lift.
   Shadows are for true overlays only, and per the dark-mode guideline there are **no
   shadows at all in dark mode** — `--shadow-sm/md` resolve to `none` under ink. Retires the
   hand-rolled shadows at `styles.scss:498-500,661-663,1153-1155,1209`.
2. **Corners tighten** from 9 literal values to three tokens: 2 / 4 / 6px. Nothing rounder
   than 6px, dialogs included (today `--radius-lg: 8px` plus literal 10 and 12px).
3. **Cards are the last resort** (surfaces guideline: whitespace → hairline rule → well →
   card). This kills the 3 `<mat-card>` uses in `features/connections/` and the 19 divergent
   empty states.

### 2.2 Token system
Two layers. **Keep every existing semantic name** — 2,872 usages stay valid — and add the
27 missing ones as real definitions or aliases. Values change; names do not.

**Layer 1 — brand constants, never themed** (from `docs/brand/tokens.css`):

```css
:root {
  --j-ivory:#F2EFE7; --j-paper:#FBFAF5; --j-ink:#171817; --j-charcoal:#272A27;
  --j-oxide:#D6492F; --j-chartreuse:#C8F04A; --j-rule:#B9B8AE; --j-amber:#E6A23C;
  /* derived, contrast-driven — see 2.3 */
  --j-oxide-deep:#B83C22;  --j-oxide-lift:#E8654A;
  --j-amber-deep:#8A5A10;  --j-verify-deep:#4E7A12;
}
```

**Layer 2 — semantic, per theme** (existing names, new values):

```scss
@mixin ink-theme {                                 @mixin ivory-theme {
  --bg-primary:   #171817;  // canvas                --bg-primary:   #F2EFE7;
  --bg-secondary: #1E211E;  // rails, wells          --bg-secondary: #EAE7DD;
  --bg-tertiary:  #272A27;  // chrome                --bg-tertiary:  #E2DED2;   // MUST be darker
  --bg-elevated:  #2F332E;  // overlays              --bg-elevated:  #FBFAF5;   //  than ivory (1.6)
  --bg-hover:  rgb(242 239 231/.06);                 --bg-hover:  rgb(23 24 23/.05);
  --bg-active: rgb(232 101 74/.14);                  --bg-active: rgb(214 73 47/.10);
  --text-primary:   #F2EFE7;  // 15.98:1            --text-primary:   #171817;
  --text-secondary: #B4B3AB;                         --text-secondary: #5A5D57;
  --text-muted:     #85887F;                         --text-muted:     #7A7D74;
  --border-primary:   rgb(242 239 231/.12);          --border-primary:   rgb(23 24 23/.10);
  --border-secondary: rgb(242 239 231/.22);          --border-secondary: var(--j-rule);
  --accent:        var(--j-oxide-lift);              --accent:        var(--j-oxide);
  --accent-strong: var(--j-oxide-lift);              --accent-strong: var(--j-oxide-deep);
  --accent-subtle: rgb(232 101 74/.14);              --accent-subtle: rgb(214 73 47/.10);
  --status-success: var(--j-chartreuse);             --status-success: var(--j-verify-deep);
  --status-warning: var(--j-amber);                  --status-warning: var(--j-amber-deep);
  --status-error:   #F0715A;                         --status-error:   #A5271B;
  --shadow-sm/md/lg: none;  // dark-mode rule        --shadow-*: subtle, as today
  --shadow-overlay: 0 0 0 1px rgb(242 239 231/.10);  --shadow-overlay: 0 8px 32px rgb(23 24 23/.12);
}                                                  }
// both themes:  --text-tertiary: var(--text-muted);  --border-focus: var(--accent-strong);
//               --accent-primary: var(--accent);     --status-info: var(--text-secondary)  ← NO BLUE
```

Plus `--status-*-rgb` triplets (fixes the 9 invalid declarations), `--radius-full:999px`,
`--titlebar-height:38px`, `--gl-header-height:36px` (retires the four magic 38s), and
`--border-color`/`--hover-bg`/`--accent-hover`/`--accent-error`/`--border-subtle`/`--panel-bg`/
`--header-bg`/`--bg-selected`/`--selection-bg`/`--accent-color` as aliases. Also set
`color-scheme` per theme, add a `theme-color` meta pair, and write `data-theme` before
Angular bootstraps to kill the 3-stage FOUC.

### 2.3 Contrast, measured (why the derived colours exist)
| Pair | Ratio | Verdict |
| ---- | ----- | ------- |
| ivory on ink | **15.98:1** | ✅ |
| oxide `#D6492F` on ink | **4.24:1** | large text / UI only → `--j-oxide-lift` on ink = **5.59:1** |
| oxide on ivory | **3.77:1** | ✅ large, ✗ body → `--j-oxide-deep` on ivory = **4.93:1** |
| white on oxide fill | **4.33:1** | ✗ at 13px → oxide *buttons* fill `--j-oxide-deep` (**5.67:1**) |
| chartreuse on ink | **14.0:1** | ✅ |
| chartreuse on ivory | **1.14:1** | ✗ **never a light-mode foreground** — fill only, ink text on top (14:1) |
| amber on ivory | **1.90:1** | ✗ fill only in light; `--j-amber-deep` for caution text |

### 2.4 Typography
Three faces as deps: display **Archivo** (variable — `wdth ~75` + `wght 800` reproduces
Archivo Narrow ExtraBold; Archivo Narrow itself ships only 400–700, so the variable family
is the correct source — verify at install), interface **Instrument Sans**, technical **IBM
Plex Mono**. Keep Inter and JetBrains Mono declared as fallbacks. Keep the `material-icons`
ligature font — **two e2e assertions match on ligature text (1.10)**.

```
--text-2xs  10px  mono uppercase metadata only, never prose
--text-xs   11px  status bar, badges, micro-labels
--text-sm   12px  dense tree / grid rows
--text-base 13px  default interface (= today's --font-size-md)
--text-md   14px  dialog body, chat prose
--text-lg   16px  dialog titles, section heads
--text-xl   20px  panel headings
--display-sm/md/lg  28 / 40 / 56px   Archivo; welcome + empty states only
```

Rules: **8px and 9px banned** (8 current uses). Display: `letter-spacing:-.03em`,
`line-height:.92`, no `leading-*` overrides. Mono uppercase eyebrows get `+.08em` tracking
(typography guideline; the board's `WORKFLOW` label). Numeric and ticking values get
`font-variant-numeric: tabular-nums`. Icons get their own scale — `--icon-sm/md/lg` =
14/16/20px, where app chrome uses **16px** and 20px is nav-list only (icons guideline);
this absorbs the 52 stray `18px`s and retires 8 ad-hoc icon sizes in `layout/` alone.
Spacing gains the missing rungs — 2/4/6/8/10/12/16/24/32 — with `--spacing-xs…xl` kept as
aliases.

### 2.5 Accent discipline
- **Oxide** — *at most one filled oxide affordance per visible surface* (buttons guideline:
  one primary per page; dialogs count as their own page). Its other jobs: active-tab
  indicator (`styles.scss:1051-1060`), focus ring, selected-row wash, destructive confirm.
  In dense chrome most "primary" buttons become ink/ivory-filled, not oxide.
- **Chartreuse** — verification and success *only*, and **fill-or-dark-canvas only**
  (1.14:1 on ivory). Permitted: connection-health pip, query-succeeded pip, test-connection
  pass, "safe" verdict on a destructive confirm, the mark's third bar. **Cap: two visible at
  once.** Never a surface, never the AI accent, never decoration — `README.md:53` is explicit.
- **Amber** — non-destructive caution only: password hygiene, missing CLI tools, stale results.
- **No blue.** Deletes `#007acc` (×5), `#4a9eff` (×5), `#2196f3` (×4), `#60a5fa`, `#6366f1`,
  `#3b82f6` and the GL drop-indicator `rgba(38,139,210,…)`.
- Interactivity guideline: `hover:` only on genuinely interactive elements; transitions only
  for things that move, not colour swaps.

### 2.6 How Material gets bent (not broken)
Material is broad but shallow — of ~800 usages, **~590 are `<mat-icon>` (444) and button
directives (143)**, and `chat-panel.component.ts` (1,567 LOC, zero Material imports) proves
the app runs Material-free where it matters. Only four surfaces are genuinely expensive:
form-field/select (174 uses), MatDialog (11 files), tabs (5), stepper (2 — both in the
duplicate routed pages slated for deletion).

The change is to **emit two M2 themes instead of one**, scoped by `[data-theme]`:

```scss
$joinery-dark:  mat.m2-define-dark-theme((color: (…), typography: $type, density: -1));
$joinery-light: mat.m2-define-light-theme((color: (…), typography: $type, density: -1));
@include mat.core();
@include mat.all-component-themes($joinery-dark);
:root[data-theme='light'] { @include mat.all-component-colors($joinery-light); }
```

with `$type` built from Instrument Sans (fixing the quoting bug at `styles.scss:73-74`,
where the whole font list is one quoted string). This deletes the 58-line light patch layer
and lets a large share of the 276 `!important`s go. **Not migrating to M3** here:
`mat.define-theme` renames the `--mdc-*`/`--mat-*` surface that `styles.scss:556-835`
overrides *and* that 7 e2e locators depend on.

Vendor surfaces, all from the same tokens: bind the ag-grid theme class to
`effectiveTheme()` and derive the 26 `--ag-*` from tokens; register `joinery-ink`/
`joinery-ivory` Monaco themes from `--syntax-*`; drop `atom-one-dark.css` and author
`.hljs-*` from `--syntax-*`; extract the GL block to a partial, swap the four baked SVG
data-URIs for `currentColor` masks, delete the dead duplicate rule.

### 2.7 Owned primitives to build (componentize skill)
| Component | Retires | API sketch |
| --------- | ------- | ---------- |
| `<j-empty-state>` | 19 | `icon`, `title`, `message`, action slot; no baked margins |
| `<j-dialog-shell>` | 13 headers + 24 overlays | `title`, `size`, header/content/actions slots; one MatDialog wrapper; keeps the `.dialog-header` class its 2 existing consumers use |
| `.j-btn` class set (not a component) | 25 bespoke classes + 3 competing naming schemes | `--primary/--outline/--ghost/--danger` × `--sm/--md`; **exactly two heights, ≥6px apart, 28–38px total** (buttons guideline) |
| `<j-toolbar>` | 3 | aligned to `--gl-header-height`; divider + spacer parts |

Plus: adopt `shared/components/loading/` across the 23 hand-rolled spinner sites, and move
chat's `::ng-deep .chat-md` block (`chat-panel.component.ts:1003-1122`) into `shared/markdown/`.

---

## 3. Decisions for Craig

Recommendation is in the table at the top; here is why, and what the alternative costs.

**D1 — Keep Material, or replace it?** *Keep, retheme via two scoped M2 themes (2.6).*
Replacing means 444 `<mat-icon>`, 174 form-field/select usages, 11 MatDialog files, and
rewriting 7 Material locators plus 2 icon-ligature assertions. The dual-theme change is
~40 lines and deletes more than it adds. Revisit M3 and selective replacement afterwards.

**D2 — Ink-first or ivory-first?** *Ink-first.* The brand pairs "warm ivory canvases with
dense charcoal product surfaces" (`README.md:83`) and the board's product mockups are ink;
today's default is already dark (`styles.scss:236`), so this is the no-migration answer.
Ivory ships at parity — every bug in 1.6 is a light-mode bug. Pick ivory-first instead if
you think of Joinery as a document tool rather than an operations tool, and 2.2 inverts.

**D3 — Retarget names, or new namespace?** *Retarget + alias.* 2,872 usages mean a rename is
a whole-codebase diff with no visual payoff; retargeting values touches ~60 lines and
reskins Material for free (1.2). `--j-*` exists only as brand constants.

**D4 — Welcome hero: editorial, or app chrome?** *Keep it editorial.* It is the only
brand-correct surface in the app and it establishes the patterns worth propagating — native
semantic buttons, hairline rules instead of cards, `clamp()` display type (the only
responsive type in the codebase), mono micro-labels. But promote `--concept-*` to the global
layer, delete the dead dark block (`:231-236`), make it theme-aware, and reconcile the second
half of the file (`:84+`), which reverts to the old `mat-icon`/`mat-stroked-button` language.

**D5 — Sidebar and status bar: retheme or restructure?** *Sidebar retheme, status bar
restructure, mark replaced.* The status bar is a broken box model (1.9), so a retheme just
repaints the bug; the sidebar's problems are colour and token discipline, and its class names
carry 9 e2e locators. For the mark: **inline the real `docs/brand/assets/mark-on-{dark,light}.svg`,
theme-swapped**, replacing the three hardcoded skewed `<span>`s (`sidebar.component.ts:397-428`)
— resolving `FOLLOW-UPS` 12 properly and letting the unreferenced `logo.png` go.

**D6 — Golden Layout: restyle, wrap, or replace?** *Keep restyling.* No GL theme is loaded,
so `styles.scss:836-1198` already *is* the theme — the work is extracting it to a partial,
retargeting tokens, dropping `!important`s that no longer fight anything, unifying 38/36px.
`.lm_tab`/`.lm_active`/`.lm_close_tab` appear in 6 assertions; wrapping or replacing breaks
them for a cosmetic gain. Separately, delete the 344 dead LOC in `layout/tab-bar/`.

**D7 — Ship the three brand faces?** *Yes, all three.* Instrument Sans and IBM Plex Mono are
already referenced and silently falling back (1.5); Archivo Narrow is approximated with
`Arial Narrow`. Cost is 3 deps and ~200–300KB of woff2 subsets against a 3.5MB initial budget
(`angular.json:47-58`). Not shipping them leaves `docs/brand/` aspirational.

**D8 — Test hooks before or after?** *Before, as phase 0.* The suite keys on 62 locators of
which 5 are testids (1.10). Adding `data-testid` to those targets in a pure-additive PR costs
about a day and makes every later phase free to restructure; the alternative mixes visual
regressions with selector breakage in one red run.

---

## 4. Phased execution plan

Each phase is one PR on a feature branch off `main` (never commit to `main`, per `CLAUDE.md`).
Standard gate for every phase — `pnpm run lint` has never worked and the renderer has no
`typecheck` script (`FOLLOW-UPS` 6), so `build` is the renderer type gate:

```
pnpm run build && pnpm run typecheck && pnpm test && pnpm run format:check
pnpm run test:harness:up && pnpm run test:e2e
```

Visual baselines stay RED until phase 5 — expected, not a regression. Watch the
`anyComponentStyle` budget (warn 16kB, `angular.json:47-58`); the inline styles in
`query`, `results-grid`, `sidebar` and `chat-panel` are already large.

### Phase 0 — Test hooks + dead code (no visual change) · `feat/ui-00-hooks-and-deletions`
- Add `data-testid` to every target behind the 62 locators (1.10), leaving existing classes
  in place. Migrate `tests/e2e/*.spec.ts` + `tests/helpers/joinery-actions.ts` to the
  testids, keeping vendor-internal locators (`.lm_*`, `.ag-*`, `.monaco-editor`) as-is.
- Delete `table-properties-panel.component.ts` (1,373), `layout/tab-bar/` (344),
  `assets/icons/logo.png`.
- Wire or drop the 10 dead palette commands; `:425`/`:535`/`:546` are one-liners;
  de-duplicate `open-snippets` (`:523`/`:589`).
- Define the 27 undefined tokens as aliases (1.3) — no value changes. Fixes the invisible
  rename button, the dead AI-button states, the 9 invalid diff backgrounds.
- **Test-hook impact:** additive only. **Gate:** full suite green; pixels must not move.

### Phase 1 — Token + type foundation · `feat/ui-01-tokens`
- Create `packages/renderer/src/styles/` (`_brand`, `_tokens`, `_typography`, `_reset`) and
  add `stylePreprocessorOptions.includePaths` — there is nowhere for a partial to live today.
- Replace both theme mixins' values with 2.2; add the type/icon/spacing/radius scales,
  `color-scheme`, `theme-color`, pre-bootstrap `data-theme`.
- Add `@fontsource-variable/archivo`, `@fontsource-variable/instrument-sans`,
  `@fontsource/ibm-plex-mono` to `angular.json` `styles`; keep Inter + JetBrains Mono as fallbacks.
- Fix `packages/main/src/window.ts:56` `backgroundColor` to the two canvas values.
- **Test-hook impact:** none (values only).
- **Gate:** standard + screenshot **both themes**: welcome, connected shell with explorer +
  grid, query editor, connection dialog, settings panel.

### Phase 2 — Material + vendor surfaces · `feat/ui-02-material-and-vendors`
- Dual M2 themes scoped by `[data-theme]` (2.6); delete the light patch layer (`:658-715`);
  prune `!important`s that no longer fight anything.
- Bind the ag-grid theme class to `effectiveTheme()` (`results-grid.component.ts:213`);
  derive all 26 `--ag-*` from tokens (`:921-956`).
- Register `joinery-ink`/`joinery-ivory` Monaco themes from `--syntax-*`
  (`query.component.ts:1062,1269`). Drop `atom-one-dark.css`; author `.hljs-*` from `--syntax-*`.
- Extract GL to `styles/_golden-layout.scss`; `currentColor` masks for the close button;
  delete the dead duplicate at `:1029-1031`; unify 38/36px on the new tokens.
- **Test-hook impact:** `mat-form-field`/`mat-select`/`mat-option`/`.mat-mdc-*` must keep
  resolving — verify the 7 Material locators and the 2 icon-ligature assertions explicitly.
  `.lm_*` and `.ag-*` classes unchanged.
- **Gate:** standard + both themes: results grid with data, Monaco with SQL, GL with 3 tabs
  incl. a dirty one, an open `mat-select`, a snackbar, a tooltip.

### Phase 3 — Owned primitives · `feat/ui-03-primitives`
- Build `<j-empty-state>`, `<j-dialog-shell>`, `.j-btn`, `<j-toolbar>` (2.7).
- Convert the 13 dialog headers and 24 overlays onto the shell; replace the two
  `innerHTML` modals (`query.component.ts:1557-1622,1667-1717`) — this also removes all 27
  inline `style=` attributes in the codebase.
- Convert the 19 empty states and 25 bespoke button classes; adopt `shared/components/loading/`
  across 23 sites; move chat's markdown block into `shared/markdown/`.
- **Test-hook impact:** highest of any phase — `.empty-state`, `.menu-item`, `.context-menu`,
  `.detail-panel`, `.query-toolbar` are all live locators. Phase 0 is what makes this safe.
  Keep `.dialog-header` as a class on the new shell.
- **Gate:** standard + both themes: confirm dialog, input dialog, empty explorer, empty
  results grid, restore dialog in its loading state.

### Phase 4 — Shell chrome · `feat/ui-04-shell`
- **Restructure the status bar**: real 28px content box, padded controls, `:focus-visible` on
  all four toggles, `.theme-toggle` button reset, badge inside bounds, profile colour as an
  inset rule rather than a 3px border that eats the box.
- **Sidebar**: inline the brand SVG mark (D5), retarget every hardcoded value, snap
  spacing/icons to the scales, add focus states, point `.tree-item:focus-visible` at
  `--border-focus` instead of `--status-info`.
- `shell.component.ts`: single owner for `-webkit-app-region`, `--titlebar-height` token,
  `.resize-handle` → 8px target + `role="separator"` + keyboard resize, resizable and
  persisted output-panel height, one border-ownership model for the four edges.
- Add `OnPush` to `app.component`, `shell`, `status-bar`, `golden-layout-container`.
- **Test-hook impact:** `app-sidebar .connection-selector .connection-button`,
  `.database-selector button`, `.tree-container`, `.explorer-tree`,
  `app-status-bar button.docker-success|.docker-warning`, `app-shell .resize-handle:visible`
  — keep these classes or migrate the specs in the same PR.
- **Gate:** standard + both themes: sidebar collapsed/expanded, mark at 1× and 2×, status bar
  connected / disconnected / executing, output panel open.

### Phase 5 — Feature surfaces + baseline regeneration · `feat/ui-05-features-and-baselines`
- Welcome: theme-aware, `--concept-*` promoted, dead dark block removed, second half of the
  file reconciled to the new primitives (D4).
- Purge remaining hardcoded hex: `fk-link` (26), `erd-diagram` (26 — makes the ERD
  theme-aware for the first time), `connection-dialog` (9), `output-panel` (9),
  `query.component` (6), `missing-cli-tools` (6), `row-detail-panel` (5).
- Snap all remaining off-scale sizes, spacing and radii; delete the 8px/9px uses.
- Decide the duplicate routed pages (~1,807 LOC): keep the dialogs and delete the pages, or
  the reverse — but not both visual languages.
- **Regenerate baselines last:** `pnpm run test:harness:up && pnpm run build && pnpm run test:visual:update`,
  then **inspect all 11 PNGs before committing** (`FOLLOW-UPS.md:23-24` — do not run
  `:update` reflexively). Consider adding dark/light pairs where only one exists.
- **Gate:** standard + `pnpm run test:visual` green on regenerated baselines + a final
  both-themes pass over every surface from phases 1–4.

---

## 5. Out of scope

- **All feature work in `plans/UX-IMPROVEMENTS-ROADMAP.md`** — IntelliSense (2.4), workspaces
  (2.5), the `joinery` CLI (2.6), NL-to-SQL (3.3), query cancellation (1.3), Docker management
  (1.5). That doc predates the rebrand and is a feature roadmap, not a design brief. Only
  4.2 / 4.4 / 4.5 overlap and they are absorbed into phases 3–5.
- **Angular Material M3 migration** — deferred (D1); its own PR and e2e pass.
- **Virtualizing the long lists** (`tree-view`, `snippet-library`, `object-search`,
  `query-history-dialog`, `result-history-panel`, `server-file-browser` — zero CDK virtual
  scroll today). A performance change with visual side effects, not the reverse.
- **Decomposing `query.component.ts`** (2,689 LOC, 1,744 logic). Phase 3 replaces its two
  `innerHTML` modals and phase 5 its colours; splitting the god component is separate.
- **Security items** — `FOLLOW-UPS` 2 (`will-navigate` guard, missing CSP), 5 (mermaid
  `<style>` escape), 10 (leaked `sa` password). Item 2 must not ride in a UI PR.
- **`FOLLOW-UPS` 3, 4, 9, 13** (README screenshots, `marked-alert` callouts, the Python
  prerequisite, userData directory case). Item 3 gets *easier* after phase 5.
- **Accessibility beyond contrast and focus.** Phases 3–4 add focus rings, hit targets and
  missing `role`s; a full keyboard and screen-reader audit is its own project.
- **Responsive / small-window layouts.** The design skill's responsive rules assume a web
  page; this is a fixed-minimum 800×600 window (`packages/main/src/window.ts:53-54`).
- **Icon set replacement** — staying on the `material-icons` ligature font is a deliberate
  constraint (2.4). **New features of any kind** — discoveries go to `FOLLOW-UPS.md`.
