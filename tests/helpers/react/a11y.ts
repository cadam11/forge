/**
 * The keyboard walk: press Tab, look at what has focus, ask whether you can SEE that it does.
 *
 * PLAN.md Task 23 asks for "`:focus-visible` on every interactive element". A source scan answers a
 * weaker question — it finds the string `focus-visible:` in a file, not a ring on an element — and
 * it is blind to the three vendor surfaces this app mounts (Dockview's tab strip, AG Grid's cells,
 * Monaco's editor), which is exactly where a missing ring would hide. So the inventory is taken at
 * runtime, in the shipped bundle, by doing what a keyboard user does.
 *
 * ── What the gate is ──────────────────────────────────────────────────────────────────────────
 *
 * BOTH halves, per the Task 23 review (I4): the element must match **`:focus-visible`** — which is
 * the property the plan row actually names — and must show a visible indicator, meaning an
 * `outline` with a real width and a non-transparent colour, or a `box-shadow` (Tailwind's `ring`
 * utilities compile to one). Both are read from `getComputedStyle` after the Tab press, so what is
 * measured is the style the element really has while focused.
 *
 * Gating on the visible indicator alone was the original design and it is a proxy, not the spec: it
 * passes an element carrying a decorative `box-shadow` and no focus treatment whatsoever.
 *
 * ── Why the walk is bounded, and how it knows it is done ──────────────────────────────────────
 *
 * Every loop here has an explicit cap (house rule), and the walk distinguishes **four** ways of
 * ending rather than two — see `WalkOutcome`. The distinction that matters most is `cycled` versus
 * `stuck`: coming back round to an element already visited is healthy termination, while Tab
 * leaving focus exactly where it was is a trap (Monaco does this — it inserts a tab character).
 * Conflating them is how the first version of this file silently truncated two of its seven walks
 * and reported both as clean cycles.
 */

import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

/** One stop in the tab order, as measured. */
export interface FocusStop {
  /** 1-based position in the walk. */
  readonly order: number;
  /**
   * How the element is named in the report: its `data-testid` when it has one, else its role and
   * accessible name, else a tag/class fingerprint. Stable enough to diff two runs against.
   */
  readonly id: string;
  readonly tag: string;
  readonly role: string | null;
  /** The element's class list, truncated. The only handle the vendor exemptions below have. */
  readonly classes: string;
  /** Whether the element matches `:focus-visible` — i.e. whether the app's own rules can fire. */
  readonly focusVisible: boolean;
  readonly outlineStyle: string;
  /**
   * `--tw-outline-style` as resolved ON THIS ELEMENT.
   *
   * Recorded because it is the exact mechanism behind this task's headline finding: Tailwind v4
   * compiles every `outline-<width>` utility to `outline-style: var(--tw-outline-style)`, so a ring
   * can be fully specified and still render as nothing when that variable resolves to `none`.
   * Having it in the table turns "why is this row FAIL?" from an investigation into a glance.
   */
  readonly outlineStyleVar: string;
  readonly outlineWidthPx: number;
  readonly outlineColor: string;
  readonly boxShadow: string;
  /**
   * Which element paints the indicator: the focused one, an ancestor that paints it **because of**
   * this focus (the `ui/switch.tsx` / `ui/field.tsx` `has-focus-visible:` pattern), or nothing.
   *
   * `ancestor` is decided differentially — see `resolveAncestorCredits`. An ancestor that paints the
   * same thing whether or not the stop is focused earns nothing.
   */
  readonly indicatedOn: 'self' | 'ancestor' | 'none';
  /** The verdict: an outline or a ring a user can actually see, wherever it is drawn. */
  readonly indicated: boolean;
}

/** The cap on any single walk. Well above the longest surface measured (the connected shell). */
const MAX_STOPS = 120;

/**
 * How far up the tree an ancestor may be and still be credited with drawing a stop's indicator.
 *
 * Four is what `ui/switch.tsx` and `ui/field.tsx` need (control → label grid → field wrapper), with
 * one to spare. The bound is a house rule, but it is not what makes the credit safe — see
 * `resolveAncestorCredits` for the part that does.
 */
const MAX_ANCESTOR_LEVELS = 4;

/**
 * Why a walk ended. Four distinct things, and conflating any two of them hides a bug.
 *
 * `cycled` is the healthy end — Tab came back to an element it had already visited, which is what
 * both a focus-trapped dialog and a wrapping shell do. `stuck` is a **trap**: the next Tab left
 * focus exactly where it was, which is what Monaco does (it inserts a tab character instead of
 * moving focus). `left-document` is Electron handing focus to the window chrome. `cap` means
 * `MAX_STOPS` ran out, which is either a very long surface or a trap with no exit.
 */
export type WalkOutcome = 'cycled' | 'stuck' | 'left-document' | 'cap';

/** A completed walk: what it saw, and why it stopped seeing. */
export interface FocusWalk {
  readonly stops: FocusStop[];
  readonly outcome: WalkOutcome;
  /** When `outcome` is `stuck`, the stop focus refused to move off. */
  readonly stuckAt: FocusStop | null;
}

/**
 * The attribute stamped on every element the walk visits, so "have I been here?" is a question
 * about ELEMENT IDENTITY rather than about a descriptor.
 *
 * ── Why this replaced `${data-testid}#${tag}` ──────────────────────────────────────────────────
 *
 * That key was not unique and could not tell a cycle from a trap, and both failure modes fired in
 * practice (Task 23 review, I2):
 *
 *  - the ERD walk ended at stop 11 because `erd-relationship-row` is emitted **once per
 *    relationship** (`features/erd/erd-details.tsx:202,216`), so the second row looked like a
 *    return to the first — and the status bar, titlebar and sidebar triggers past it went
 *    unmeasured while the walk reported a clean `cycled: true`;
 *  - the query-tab walk ended at Monaco, whose Tab inserts a character rather than moving focus, so
 *    the same element measured twice read as a cycle. The results grid, the results toolbar and the
 *    status bar were never reached, in the test named "where the two vendor surfaces live".
 *
 * Stamped rather than held in a JS `Set` of element handles because the measurement already happens
 * inside a single `evaluate`, and an attribute survives the round trip that a handle would need a
 * second one for. Removed again by `clearWalkMarkers`, which every walk calls on the way out.
 */
const WALK_MARKER = 'data-a11y-walk';

/**
 * Presses Tab until the order cycles, gets stuck, leaves the document, or hits `MAX_STOPS`.
 *
 * `startFrom`, when given, is focused first so the walk begins somewhere known — without it a walk
 * starts wherever the last interaction left focus, and two runs of the same spec would produce
 * different tables. **Pass it.** Every caller in `a11y.spec.ts` does.
 */
export async function walkTabOrder(window: Page, startFrom?: Locator): Promise<FocusWalk> {
  if (startFrom !== undefined) await startFrom.focus();
  await clearWalkMarkers(window);

  const measured: MeasuredStop[] = [];
  let outcome: WalkOutcome = 'cap';

  try {
    for (let index = 0; index < MAX_STOPS; index += 1) {
      await window.keyboard.press('Tab');
      const stop = await measureActiveElement(window, index);
      // Focus left the document — Electron hands it to the window chrome at the end of the order.
      // Not a stop, and not an error; the walk is over.
      if (stop === null) {
        outcome = 'left-document';
        break;
      }

      if (stop.visitedAt !== null) {
        // Back on an element already visited. If it is the one we were *just* on, Tab did not move
        // focus at all — a trap, not a cycle.
        outcome = stop.visitedAt === index - 1 ? 'stuck' : 'cycled';
        break;
      }
      measured.push(stop);
    }

    // The differential half of the ancestor credit. It runs here, after the Tab walk, because it
    // has to move focus off each candidate — doing that mid-walk would change where the next Tab
    // starts from and corrupt the order being measured.
    const credited = await resolveAncestorCredits(window, measured);

    const stops = measured.map((stop, position) => finalise(stop, position, credited));
    return {
      stops,
      outcome,
      // `stuck` means the repeat was the element we were on last, which is by definition the stop
      // pushed most recently.
      stuckAt: outcome === 'stuck' ? (stops[stops.length - 1] ?? null) : null,
    };
  } finally {
    // Always, including on a thrown assertion: a stray `data-a11y-walk` on a live element would
    // outlive this walk and be the next one's phantom cycle.
    await clearWalkMarkers(window);
  }
}

/** Turns a raw measurement into the `FocusStop` a caller sees, once the credit is known. */
function finalise(stop: MeasuredStop, position: number, credited: ReadonlySet<number>): FocusStop {
  const indicatedOn = stop.selfDraws ? 'self' : credited.has(stop.marker) ? 'ancestor' : 'none';
  return { ...stop, order: position + 1, indicatedOn, indicated: indicatedOn !== 'none' };
}

/**
 * Decides which stops are legitimately indicated by an ANCESTOR, by measuring the difference the
 * focus itself makes.
 *
 * ── Why the obvious test does not work ────────────────────────────────────────────────────────
 *
 * The first version of this credit asked `ancestor.matches(':has(:focus-visible)') && draws(ancestor)`
 * and claimed the `:has()` gate meant it "cannot excuse an arbitrary shadow somewhere up the tree".
 * **That gate does no work at all.** `:has(:focus-visible)` is true for *every* ancestor of a
 * focused element that matches `:focus-visible` — which is every ancestor of virtually every stop —
 * so the only surviving discriminator was "does this ancestor paint anything, for any reason".
 *
 * The re-review caught it live, twice, on the first run: `palette-input` and the settings dialog's
 * `TabsList` were both credited to `ui/dialog.tsx`'s `DialogContent`, one to three levels up, whose
 * `shadow-overlay` is **unconditional** in both themes. Seven of the thirteen walked surfaces are
 * built on that dialog, so the walk's core guarantee — the one that catches a `tree.tsx`-shaped
 * missing ring — was quietly off for the majority of its own surfaces.
 *
 * ── What this does instead ────────────────────────────────────────────────────────────────────
 *
 * It compares each candidate ancestor's painted outline and box-shadow **while the stop is focused**
 * against the same ancestor **after focus has left**, and credits only a level that both paints and
 * CHANGES. An always-on shadow reads identically in both samples and earns nothing; the switch
 * track's `has-focus-visible:` ring appears in one sample and not the other, which is exactly the
 * signal the pattern is made of.
 *
 * ── Why the focused sample is taken during the walk ───────────────────────────────────────────
 *
 * Because re-focusing an element afterwards cannot reproduce the state being measured. `:focus-visible`
 * on a programmatic `focus()` depends on a keyboard-modality heuristic, and a Radix roving-focus root
 * forwards focus away the moment it receives it — so a second-pass re-focus would silently
 * under-credit exactly the elements this exists for. The focused half is therefore captured by
 * `measureActiveElement` under the walk's own real Tab press, and only the blurred half is taken
 * here, which needs no focus at all.
 */
async function resolveAncestorCredits(
  window: Page,
  measured: readonly MeasuredStop[]
): Promise<ReadonlySet<number>> {
  // Only stops with no ring of their own can be credited to an ancestor, and most stops have one —
  // so this is usually a handful of elements and often none.
  const candidates = measured.filter(stop => !stop.selfDraws).map(stop => stop.marker);
  if (candidates.length === 0) return new Set();

  const blurredSignatures = await window.evaluate(
    ([attribute, wanted, levels]) => {
      // Focus off everything first: the whole point is to read these ancestors with no descendant
      // of theirs focus-visible.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

      const readings: Record<number, string[]> = {};
      for (const marker of wanted) {
        const element = document.querySelector(`[${attribute}="${marker}"]`);
        // Gone from the DOM since the walk — nothing to compare, so nothing is credited.
        if (element === null) continue;
        readings[marker] = ancestorPaintSignature(element, levels);
      }
      return readings;

      /**
       * One string per ancestor level: whether it paints, and what with. Declared as a hoisted
       * function so the identical code runs in both samples — `measureActiveElement` inlines the
       * same body, and the two must agree character for character or every level looks changed.
       */
      function ancestorPaintSignature(start: Element, maxLevels: number): string[] {
        const signature: string[] = [];
        let node: Element | null = start.parentElement;
        for (let level = 0; level < maxLevels && node !== null; level += 1) {
          const computed = getComputedStyle(node);
          const width = Number.parseFloat(computed.outlineWidth) || 0;
          const invisible =
            computed.outlineColor === 'transparent' || /,\s*0\s*\)$/.test(computed.outlineColor);
          const outlined = computed.outlineStyle !== 'none' && width >= 1 && !invisible;
          const shadowed = computed.boxShadow !== 'none' && computed.boxShadow !== '';
          signature.push(
            `${outlined || shadowed ? 'D' : '-'}|${computed.outlineStyle} ${computed.outlineWidth} ${computed.outlineColor}|${computed.boxShadow}`
          );
          node = node.parentElement;
        }
        return signature;
      }
    },
    [WALK_MARKER, candidates, MAX_ANCESTOR_LEVELS] as const
  );

  const credited = new Set<number>();
  for (const stop of measured) {
    const blurred = blurredSignatures[stop.marker];
    if (blurred === undefined) continue;
    // A level counts only if it PAINTS while focused (`D`) and reads differently once focus is
    // gone. Either half alone is what let the dialog's permanent shadow through.
    const changed = stop.ancestorPaintsFocused.some(
      (reading, level) => reading.startsWith('D') && reading !== blurred[level]
    );
    if (changed) credited.add(stop.marker);
  }
  return credited;
}

/** Removes every `WALK_MARKER` from the document. */
async function clearWalkMarkers(window: Page): Promise<void> {
  await window.evaluate(attribute => {
    for (const node of Array.from(document.querySelectorAll(`[${attribute}]`))) {
      node.removeAttribute(attribute);
    }
  }, WALK_MARKER);
}

/**
 * A raw measurement: everything `FocusStop` has except the two fields the walk can only decide once
 * it is over, plus the three it needs to decide them.
 */
type MeasuredStop = Omit<FocusStop, 'order' | 'indicatedOn' | 'indicated'> & {
  /** The `WALK_MARKER` value stamped on this element, so the blurred pass can find it again. */
  readonly marker: number;
  /** The marker of an earlier visit, or `null` on the first. Drives `cycled` vs `stuck`. */
  readonly visitedAt: number | null;
  /** Whether the focused element paints its own indicator. */
  readonly selfDraws: boolean;
  /** Ancestor paint signatures taken WHILE FOCUSED — half of the differential credit. */
  readonly ancestorPaintsFocused: string[];
};

/**
 * Reads `document.activeElement`. `null` when focus is on `<body>` or nowhere.
 *
 * All of the DOM reading happens in one `evaluate` rather than in a locator chain per field: a walk
 * is dozens of stops long and each round trip is a real cost, but more importantly the element must
 * be measured while it still has focus, and interleaving Playwright calls invites it to move.
 */
async function measureActiveElement(window: Page, index: number): Promise<MeasuredStop | null> {
  return window.evaluate(
    ([attribute, step, levels]) => {
      // `Element`, not `HTMLElement`: the ERD canvas is SVG, and an SVG element is perfectly capable
      // of being a focus stop. Narrowing to HTMLElement made the walk read a real stop as "focus left
      // the document" and stop early — the ERD table said "6 stops, did NOT cycle" and everything
      // past the toolbar's first button went unmeasured.
      const element = document.activeElement;
      if (!(element instanceof Element) || element === document.body) return null;

      // Identity, stamped. `null` on the first visit; the step it was first seen at afterwards, which
      // is what lets the caller separate "came back round" from "never left".
      const stamped = element.getAttribute(attribute);
      const visitedAt = stamped === null ? null : Number(stamped);
      if (stamped === null) element.setAttribute(attribute, String(step));

      const style = getComputedStyle(element);
      const outlineWidthPx = Number.parseFloat(style.outlineWidth) || 0;
      // `rgba(…, 0)` and the keyword both mean the outline is drawn in nothing.
      const invisibleOutline =
        style.outlineColor === 'transparent' || /,\s*0\s*\)$/.test(style.outlineColor);
      const selfDraws =
        (style.outlineStyle !== 'none' && outlineWidthPx >= 1 && !invisibleOutline) ||
        (style.boxShadow !== 'none' && style.boxShadow !== '');

      /**
       * The FOCUSED half of the ancestor differential.
       *
       * Taken here, under the walk's own real Tab press, because it is the only moment the state
       * being measured actually exists — see `resolveAncestorCredits` for why re-focusing later
       * cannot reproduce it. The blurred half is taken there, and the two signatures are compared
       * level by level, so this body and that one must stay character-identical.
       */
      const ancestorPaintsFocused: string[] = [];
      let node: Element | null = element.parentElement;
      for (let level = 0; level < levels && node !== null; level += 1) {
        const computed = getComputedStyle(node);
        const width = Number.parseFloat(computed.outlineWidth) || 0;
        const invisible =
          computed.outlineColor === 'transparent' || /,\s*0\s*\)$/.test(computed.outlineColor);
        const outlined = computed.outlineStyle !== 'none' && width >= 1 && !invisible;
        const shadowed = computed.boxShadow !== 'none' && computed.boxShadow !== '';
        ancestorPaintsFocused.push(
          `${outlined || shadowed ? 'D' : '-'}|${computed.outlineStyle} ${computed.outlineWidth} ${computed.outlineColor}|${computed.boxShadow}`
        );
        node = node.parentElement;
      }

      const testId = element.getAttribute('data-testid');
      const role = element.getAttribute('role');
      // 200, not 80: the class list is the first thing anyone reads when a row says FAIL, and the
      // utility that explains it is as likely to be at the end as at the start — the Task 23 review's
      // settings finding was diagnosed one truncation at a time until this was widened.
      const classes = element.getAttribute('class')?.slice(0, 200) ?? '';
      const label =
        element.getAttribute('aria-label') ??
        (element.textContent?.trim().slice(0, 40) || classes.split(' ')[0]) ??
        '?';
      const id = testId ?? `${role ?? element.tagName.toLowerCase()}:${label}`;

      return {
        id,
        tag: element.tagName.toLowerCase(),
        role,
        classes,
        marker: step,
        visitedAt,
        selfDraws,
        ancestorPaintsFocused,
        // `:focus-visible` is what the plan row actually names, so it is asserted as well as the
        // visible-indicator check — see `unindicatedStops`.
        focusVisible: element.matches(':focus-visible'),
        outlineStyle: style.outlineStyle,
        outlineStyleVar: style.getPropertyValue('--tw-outline-style').trim() || '(unset)',
        outlineWidthPx,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow === 'none' ? 'none' : style.boxShadow.slice(0, 60),
      };
    },
    [WALK_MARKER, index, MAX_ANCESTOR_LEVELS] as const
  );
}

/**
 * A stop the ordinary gate cannot judge, plus the assertion that says what is true instead.
 *
 * Four of these exist and no two share a reason: two vendor surfaces draw the indicator on a
 * different element (Monaco, AG Grid), one surface's field is its own only focus stop so the caret
 * is the indicator (the command overlay), and one element cannot hold focus at all (a Radix
 * roving-focus group root). An exemption without a `verify` would be a hole rather than a documented
 * edge, so every one carries a positive check — the point is to measure what IS there, not to stop
 * asking.
 *
 * Note what is deliberately NOT an exemption: an indicator drawn by an ancestor through
 * `has-focus-visible:` (`ui/switch.tsx`, `ui/field.tsx`). That one the measurement understands
 * directly — see `indicatedOn` — because the ring genuinely exists and a rule excusing it would
 * excuse its absence too.
 */
export interface FocusExemption {
  /** Matches the stop this exemption covers. */
  readonly matches: (stop: FocusStop) => boolean;
  readonly why: string;
  /** Runs while that element still has focus. Must fail if the indicator is absent. */
  readonly verify: (window: Page) => Promise<void>;
}

/**
 * Monaco's editor.
 *
 * ── Which element Monaco focuses is a vendor detail that has already moved ────────────────────
 *
 * This predicate was written for `<textarea class="inputarea">` — the 1px transparent sink Monaco
 * has used for years, whose focus indication is the caret plus `.monaco-editor.focused` two
 * ancestors up. **It never matched.** The Monaco build this app ships focuses
 * `<div role="textbox" class="native-edit-context">` instead (the `EditContext` input path), which
 * the untruncated walk found sitting at stop 8 of the query tab. That the mismatch went unseen is
 * itself a consequence of review finding I2: the walk that would have surfaced it was terminating
 * two stops early.
 *
 * Both class names are matched, because either can be live depending on `EditContext` support and
 * Monaco's own configuration, and a predicate pinned to one of them is a predicate that silently
 * stops covering the surface it names.
 *
 * **The exemption is not currently load-bearing, and that is worth stating**: the
 * `native-edit-context` div carries its own `outline: solid 1px` in the brand focus colour (from
 * `editor/monaco-themes.ts`) and matches `:focus-visible`, so it passes the ordinary gate on its
 * own. The exemption exists for the textarea path, where the focused element is deliberately
 * invisible and only `verify` can speak for it.
 */
export const MONACO_EXEMPTION: FocusExemption = {
  matches: stop =>
    stop.classes.includes('inputarea') || stop.classes.includes('native-edit-context'),
  why: "Monaco's focus sink is its own input element; the indicator is `.monaco-editor.focused` and the caret",
  verify: async window => {
    await expect(
      window.locator('.monaco-editor.focused'),
      'Monaco took focus but its own focused treatment did not appear'
    ).toHaveCount(1);
  },
};

/**
 * The command overlay's search field (palette, object search, snippet library).
 *
 * `ui/command-overlay.tsx` states the reason it has no ring and it is a real one: the field is
 * focused from the moment the overlay opens until it closes, so a ring on it carries no
 * information — the caret does, and it is the WCAG-recognised indicator for a text entry. The
 * claim the rationale rests on is "it is the only place focus can be", and `verify` checks exactly
 * that rather than taking it on trust: pressing Tab from the field must land back on the field.
 */
export const COMMAND_OVERLAY_INPUT_EXEMPTION: FocusExemption = {
  matches: stop => stop.tag === 'input' && stop.role === 'combobox' && stop.id.endsWith('-input'),
  why: "the command overlay's field is the surface's only focus stop; the caret is the indicator",
  verify: async window => {
    const before = await window.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    expect(before, 'the command overlay field did not have focus to begin with').not.toBeNull();
    await window.keyboard.press('Tab');
    expect(
      await window.evaluate(() => document.activeElement?.getAttribute('data-testid')),
      'Tab moved focus off the command overlay field, so a ringless field is no longer defensible'
    ).toBe(before);
  },
};

/**
 * A Radix roving-focus group root — in this app, every `TabsList`.
 *
 * Radix gives the root `tabIndex: 0` (`@radix-ui/react-roving-focus/dist/index.mjs:92`) so that Tab
 * enters the group and arrows move within it, which is the standard model. But the root cannot HOLD
 * focus: its own focus handler forwards immediately to the current item, so the element a walk
 * momentarily records is one the user never sees focused. A ring on it would paint for at most a
 * frame; `ui/tabs.tsx` says the same thing from the other side.
 *
 * `verify` is the measurement that claim rests on, re-run rather than restated: focus the list and
 * assert focus is not on it afterwards, and that whatever took it is a `role="tab"` that draws a
 * real outline.
 */
export const ROVING_TABLIST_EXEMPTION: FocusExemption = {
  matches: stop => stop.role === 'tablist',
  why: 'a roving-focus group root cannot hold focus — Radix forwards it to the current tab, which carries the ring',
  verify: async window => {
    const result = await window.evaluate(() => {
      const list = document.querySelector<HTMLElement>('[role="tablist"]:not(.dv-tabs-container)');
      if (list === null) return null;
      list.focus();
      const landed = document.activeElement;
      if (!(landed instanceof Element)) return null;
      const style = getComputedStyle(landed);
      return {
        keptFocus: landed === list,
        landedRole: landed.getAttribute('role'),
        landedOutline: `${style.outlineStyle} ${style.outlineWidth}`,
      };
    });

    expect(result, 'no non-Dockview tablist in the document to check').not.toBeNull();
    expect(result?.keptFocus, 'the tablist kept focus, so it does need a ring after all').toBe(
      false
    );
    expect(result?.landedRole, 'focus left the tablist but not onto a tab').toBe('tab');
    expect(result?.landedOutline, 'the tab that took focus draws no outline').toMatch(/^solid \d/);
  },
};

/**
 * AG Grid: a focused cell is indicated by a border on `.ag-cell-focus` sourced from
 * `--ag-active-color`, which `results-grid-theme.css` points at the brand focus token.
 */
export const AG_GRID_EXEMPTION: FocusExemption = {
  matches: stop =>
    stop.role === 'gridcell' || stop.role === 'columnheader' || stop.classes.includes('ag-'),
  why: 'AG Grid indicates the focused cell with a `.ag-cell-focus` border from `--ag-active-color`',
  verify: async window => {
    await expect(
      window.locator('.ag-cell-focus, .ag-header-cell-focus'),
      'a grid cell took focus but AG Grid drew no focused-cell treatment'
    ).not.toHaveCount(0);
  },
};

/**
 * The stops that fail the gate: no visible indicator, **or** no `:focus-visible` match, minus the
 * documented exemptions.
 *
 * ── Both halves, and why the second one was missing ───────────────────────────────────────────
 *
 * The plan row's property is literally `:focus-visible`. Until the Task 23 review (I4) this
 * function gated on `indicated` alone — an outline or ANY box-shadow — and `focusVisible` was
 * measured, printed in every table, and never asserted. That proxy passes an element with a
 * decorative `box-shadow` and no focus treatment at all: `ui/dialog.tsx:102` already pairs
 * `shadow-overlay` with `outline-hidden` and is saved only by being `tabindex="-1"`. That is the
 * shape of the next regression, not a defect today, and asserting the real property is free —
 * every stop in every walk already reports `focusVisible: yes`.
 *
 * The exemptions cover both halves for the same three vendor surfaces, because the reason
 * `getComputedStyle` cannot see their indicator is the same reason `:focus-visible` on the focused
 * element is not where their treatment lives.
 */
export function unindicatedStops(
  stops: readonly FocusStop[],
  exemptions: readonly FocusExemption[] = []
): FocusStop[] {
  return stops.filter(
    stop =>
      (!stop.indicated || !stop.focusVisible) &&
      !exemptions.some(exemption => exemption.matches(stop))
  );
}

/**
 * Writes a walk's table into the test's output directory and attaches it.
 *
 * `path` rather than `body`: an attachment given a body is held in the reporter's memory and the
 * `list` reporter — the one this suite runs by default — truncates it to a couple of lines. The
 * whole point of the table is that somebody can read every row afterwards, so it goes to a file
 * first and the attachment points at it.
 */
export async function attachFocusTable(
  name: string,
  title: string,
  walk: FocusWalk
): Promise<void> {
  // `test.info()` rather than a `TestInfo` parameter: taking it as an argument would force every
  // caller to declare the second test callback parameter, which in turn forces an empty `{}`
  // destructuring pattern for the first — six `no-empty-pattern` suppressions in the spec for
  // nothing. The accessor reads the currently running test, which is this one.
  const testInfo = test.info();
  const file = testInfo.outputPath(name);
  await writeFile(file, focusTable(title, walk), 'utf8');
  await testInfo.attach(name, { path: file, contentType: 'text/markdown' });
}

/** The walk as a markdown table — this is the task's inventory evidence. */
function focusTable(title: string, walk: FocusWalk): string {
  const rows = walk.stops.map(
    stop =>
      `| ${stop.order} | \`${stop.id}\` | ${stop.tag} | ${stop.role ?? '—'} | ` +
      `${stop.focusVisible ? 'yes' : 'no'} | ${stop.outlineStyle} ${stop.outlineWidthPx}px ` +
      `${stop.outlineColor} | ${stop.outlineStyleVar} | ` +
      `${stop.boxShadow === 'none' ? '—' : 'ring'} | ${stop.indicatedOn} | ` +
      `${stop.indicated && stop.focusVisible ? 'PASS' : 'FAIL'} | \`${stop.classes}\` |`
  );

  const ending =
    walk.outcome === 'stuck'
      ? `ended STUCK on \`${walk.stuckAt?.id ?? '?'}\` (Tab did not move focus)`
      : walk.outcome === 'cycled'
        ? 'order cycled'
        : walk.outcome === 'left-document'
          ? 'focus left the document'
          : 'hit the step cap';

  return [
    `### ${title} — ${walk.stops.length} stops, ${ending}`,
    '',
    '| # | element | tag | role | :focus-visible | outline | --tw-outline-style | shadow | drawn on | gate | classes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}
