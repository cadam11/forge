# Joinery house rules

An **overlay** on the licensed `design` skill (`.claude/skills/design/`), not a
replacement. Load `design/design-guidelines.md` and its rule files as written, then apply
the amendments below. They exist because that skill is written for marketing web pages
and Joinery is a desktop workbench: a fixed 800×600-minimum Electron window
(`packages/main/src/window.ts:53-54`) with independently resizable dock panels, a
three-state theme control, and a virtualized data grid.

Source: `plans/renderer-rewrite/PLAN.md` 0.7, which fixes this content.
Token authority: `packages/renderer-react/src/styles/theme.css`.

---

## 1. No viewport breakpoints. `@container` instead.

`sm:` / `md:` / `lg:` / `xl:` / `2xl:` and their `max-*` forms are **banned** in the React
renderer, along with the "mobile-first, larger on mobile" rules in
`responsive-design.md`. There is no mobile. There is no viewport-sized layout: a panel in
a dock can be 240px wide in a 1600px window, so window width tells a component nothing
about the space it has.

Use container queries — the case `responsive-design.md` itself reserves them for:

```html
<div class="@container">
  <div class="grid grid-cols-2 gap-4 @md:grid-cols-4 @3xl:grid-cols-6">…</div>
</div>
```

- Put `@container` on the closest wrapper around the responsive content, never on a
  page-level or shell-level element.
- A layout still has to survive the 800×600 floor and a narrow dock panel. That is what
  gets checked, instead of a mobile breakpoint sweep.
- `min-h-dvh` still applies to the app root; `min-h-screen` remains deprecated.

## 2. The body floor is 12px, not 16px.

`typography.md` sets a 16px mobile floor and forbids `text-xs` for body text. Joinery is
information-dense desktop software, and PROPOSAL §2.4 sets the ladder accordingly. In this
renderer the type scale is **closed** — the `--text-*` namespace is cleared in theme.css,
so anything off the ladder fails to compile.

| Utility           | Size | Use                                            |
| ----------------- | ---: | ---------------------------------------------- |
| `text-2xs`        | 10px | mono uppercase metadata only. **Never prose.** |
| `text-xs`         | 11px | status bar, badges, micro-labels               |
| `text-sm`         | 12px | dense tree / grid rows — **the body floor**    |
| `text-base`       | 13px | default interface text                         |
| `text-md`         | 14px | dialog body, chat prose                        |
| `text-lg`         | 16px | dialog titles, section heads                   |
| `text-xl`         | 20px | panel headings                                 |
| `text-display-sm` | 28px | Archivo. Empty states.                         |
| `text-display-md` | 40px | Archivo. Welcome secondary.                    |
| `text-display-lg` | 56px | Archivo. Welcome hero.                         |

- **8px and 9px are banned outright** (the audit found 8 existing uses).
- Display sizes carry `letter-spacing: -0.03em` and `line-height: 0.92` in the token, so
  never add a `leading-*` or `tracking-*` override to them.
- Mono uppercase eyebrows use `tracking-eyebrow` (0.08em), which replaces
  `tracking-wide` for that one job.
- Everything else in `typography.md` stands, including: no `font-bold` for headings, no
  `leading-*` on headings, no named line-height values, `text-pretty` on paragraphs,
  `text-balance` on headings.
- Numbers that change — row counts, durations, byte sizes, cursor positions — get
  `tabular-nums`.

## 3. Dark mode is a manual three-state control, and ink is the default.

`dark-mode.md` says to follow `prefers-color-scheme` and only add a toggle if asked. The
toggle already exists and is persisted: `ThemePreference = 'system' | 'light' | 'dark'`
(`packages/shared/src/types/settings.types.ts:5`).

- `data-theme` is written on `<html>` **before React mounts**, by the inline script in
  `packages/renderer-react/index.html`. Anything that changes the theme writes that
  attribute; nothing styles off a React state flag.
- The `dark` and `light` variants are `@custom-variant`s matching `[data-theme]` **and**
  `prefers-color-scheme` for the `system` state. Tailwind's stock `dark:` behaviour is
  replaced, not extended.
- **Ink-first.** The unprefixed token values are the dark theme; the `light` variant
  carries the ivory overrides. If the pre-mount script never runs, the app paints ink.
- Consequently you almost never write `dark:` or `light:` at all: use the semantic tokens
  (`bg-canvas`, `text-fg-muted`, `border-rule`) and both themes follow. A `dark:`/`light:`
  variant in a component is a signal that a token is missing.
- `scheme-only-dark` does **not** apply — both themes ship. `color-scheme` is set per
  theme in theme.css so native scrollbars and controls follow.
- Shadow rules stand and are enforced in the theme: the `--shadow-*` namespace is cleared,
  so `shadow-sm` and friends do not compile. Separation comes from a 1px rule and a
  surface step, not elevation.
- The single survivor is `shadow-overlay` — a hairline ring under ink, a real drop shadow
  under ivory. It is an `@utility` over the plain `--overlay-shadow` custom property, not a
  `--shadow-*` theme variable, and it has to stay that way: **Tailwind resolves
  `--shadow-*` at build time and inlines the value into the class**, so a per-theme
  override of a `--shadow-*` variable is emitted and then never read. The same trap applies
  to any other token you want to re-point per theme through a namespace Tailwind inlines.

## 4. `tables.md` is a look, not a markup contract.

The results grid is AG Grid over a virtualized viewport; it has no `<table>` to put
`w-full` on and no `<th>` to mark `whitespace-nowrap`. Take the _look_ from `tables.md`
and ignore its markup rules there:

- horizontal row rules only — no vertical lines, no outer border
- no card, no container: rows sit directly on the canvas
- sentence-case headers, never uppercase
- headers never wrap

Real `<table>` markup (dialog detail tables, the token preview's contrast tables) follows
`tables.md` as written, minus the breakpoint-specific negative margins from rule 1.

## 5. The palette is closed.

The `--color-*` namespace is cleared in theme.css, so Tailwind's 22 default families do
not exist. `bg-blue-500`, `text-gray-400` and `border-slate-200` fail to compile. This is
the enforcement mechanism for `colors.md` and for PROPOSAL §2.5.

- **No blue anywhere.** The audit found `#007acc` ×5, `#4a9eff` ×5, `#2196f3` ×4 and
  three more, all inherited from VS Code and Material. Informational text is
  `text-fg-muted`; there is deliberately no `--color-info`.
- Consume **Layer 2** (semantic): `bg-canvas` / `bg-surface` / `bg-chrome` /
  `bg-elevated`, `text-fg` / `text-fg-muted` / `text-fg-subtle`, `border-rule` /
  `border-rule-strong`, `accent*`, `success` / `warning` / `danger`. Layer 1
  (`bg-j-oxide`, `text-j-ink`) is for the brand mark and for surfaces that must stay the
  same colour in both themes.
- Need a colour that does not exist? Add a token to theme.css with its measured contrast
  in the comment. Do not reach for an arbitrary hex.

### Accent discipline (PROPOSAL §2.5)

- **Oxide**: at most **one** filled oxide affordance per visible surface, and a dialog
  counts as its own surface. Its other jobs are the active-tab indicator, the focus ring,
  the selected-row wash, and destructive confirmation. In dense chrome, most "primary"
  buttons are ink/ivory-filled, not oxide.
- **Chartreuse**: verification and success only, **fill-or-dark-canvas only** (1.14:1 on
  ivory — never a light-mode foreground). Cap **two visible at once**. Never a surface,
  never the AI accent, never decoration.
- **Amber**: non-destructive caution only — password hygiene, missing CLI tools, stale
  results.

### Contrast

Every token is certified against **its own canvas**, which is what the token comments in
theme.css record and what the preview page re-measures live. Two consequences:

- `text-fg-subtle` is metadata, not prose. It measures 4.94:1 on the ink canvas but
  4.03:1 on `bg-chrome` and 3.11:1 on ivory `bg-chrome`. Use `text-fg-muted` for anything
  a user has to read.
- Light-mode `--color-success` is `--color-j-verify-deep` = `#4d7811`, **4.56:1 on ivory**,
  and it is legal for success prose. It is one step per channel darker than PROPOSAL
  §2.2's `#4e7a12`, which measured 4.44:1 — 0.06 short of AA body, and therefore not a
  colour a "derived, contrast-driven" token may be. Do not revert it; `contrast.spec.ts`
  fails if you do. (Its ratio on the ink canvas is irrelevant: under ink, success is
  chartreuse at 13.58:1.)
- `text-info` exists and resolves to the muted foreground in both themes. Informational
  text has a token; it is never blue.
- Accent text on `bg-elevated` drops below 4.5:1 in both themes (oxide-lift 3.91:1,
  oxide-deep 4.21:1). On elevated surfaces, accent is a fill or a border, not body text.

## 6. Spacing, radius and icons are ladders.

**Spacing** — Tailwind's `--spacing` multiplier is untouched, so the PROPOSAL §2.4 ladder
is just its bare rungs: `0.5 1 1.5 2 2.5 3 4 6 8` = 2/4/6/8/10/12/16/24/32px. Stay on
them. Off-grid values (3, 5, 7, 22, 30, 34, 38, 54, 88px — all present in the Angular
renderer) need a comment saying why. Use `--spacing(…)` for arbitrary spacing, never
`calc(var(--spacing)*…)` and never `theme(spacing.…)`.

**Radius** — three rungs and a pill: `rounded-xs` 2px, `rounded-sm` 4px, `rounded-md` 6px,
`rounded-full` for pips and pills. Everything above `md` is cleared from the namespace:
**nothing is rounder than 6px, dialogs included.** `border-radius.md`'s concentric rule
still applies to nested surfaces; its `min(1vw, …)` image rule does not (no viewport-scaled
imagery in a fixed window).

**Icons** — `--icon-sm` 14px / `--icon-md` 16px / `--icon-lg` 20px, i.e. `size-3.5` /
`size-4` / `size-5`. App chrome uses **16px**; 20px is nav-list only. `icons.md` stands:
never scale an icon to fit, match the size class to the `viewBox`, add `shrink-0` in flex
containers, and use `fill-*` / `stroke-*` rather than `text-*` + `currentColor`.

## 7. Everything else in `design/` applies as written.

Named explicitly because they carry the most weight here: `general.md` (the Tailwind
authoring rules — `antialiased` on the root, `isolate` on the app container, `gap-*`
instead of margins between flex children, `size-*` over `h-*`/`w-*`, arbitrary properties
instead of inline styles, `@utility` over bare classes), `surfaces.md` (whitespace →
hairline rule → well → card, in that order of preference; cards are the last resort),
`buttons.md` (one primary per surface; exactly two heights, ≥6px apart, 28–38px),
`form-controls.md`, `interactivity.md` (`hover:` only on genuinely interactive elements;
transitions only for things that move, not colour swaps), `shadows.md`, `flexbox-layout.md`
(`min-w-0` on flex children that can overflow — every tree row and tab label),
`svg.md`, and `copywriting.md`.

One carve-out inside `general.md`: it says to add `role="list"` to every `<ul>`, which is a
workaround for Safari/VoiceOver dropping list semantics when `list-style: none` is applied.
This renderer only ever runs in Chromium, where that bug does not exist, and Task 1's
`jsx-a11y/no-redundant-roles` rejects the attribute as an error. **The roles are omitted —
lint wins.** If a surface ever ships outside Electron, revisit this rule first.

Two additions of our own:

- **`data-testid` first.** The Playwright suites are being rewritten against testids
  precisely because the old ones keyed on structural classes, Material internals and icon
  ligature text. Any interactive or asserted element gets a `data-testid`; never key a
  test on a Tailwind class.
- **`:focus-visible` is not optional.** Every interactive element needs a visible focus
  ring in both themes — `outline-2 outline-offset-2 outline-focus` or an inset variant on
  dense chrome. The audit found four status-bar controls with none.
