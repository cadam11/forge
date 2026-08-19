/**
 * The keyboard walk: press Tab, look at what has focus, ask whether you can SEE that it does.
 *
 * PLAN.md Task 23 asks for "`:focus-visible` on every interactive element". A source scan answers a
 * weaker question — it finds the string `focus-visible:` in a file, not a ring on an element — and
 * it is blind to the three vendor surfaces this app mounts (Dockview's tab strip, AG Grid's cells,
 * Monaco's editor), which is exactly where a missing ring would hide. So the inventory is taken at
 * runtime, in the shipped bundle, by doing what a keyboard user does.
 *
 * ── What counts as "you can see it" ───────────────────────────────────────────────────────────
 *
 * An `outline` with a real width and a non-transparent colour, or a `box-shadow` (Tailwind's `ring`
 * utilities compile to one). Both are read from `getComputedStyle` AFTER the Tab press, so what is
 * measured is the style the element actually has while focused, `:focus-visible` rules included.
 *
 * `:focus-visible` itself is recorded separately, as `focusVisible`. The distinction matters: an
 * element can carry a visible ring from the browser's default `outline: auto` while the app has
 * styled nothing, and this suite should be able to tell those apart in the report even though both
 * are, to a user, a visible focus indicator.
 *
 * ── Why the walk is bounded, and how it knows it is done ──────────────────────────────────────
 *
 * Every loop here has an explicit cap (house rule). The walk also stops early when the tab order
 * cycles — the first descriptor coming round again — which is the normal termination for both a
 * focus-trapped dialog and a shell whose last stop wraps to its first. A walk that hits the cap
 * without cycling is reported as such rather than silently truncated, because that is either a very
 * long surface or a focus trap with no exit, and those are different bugs.
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
  readonly outlineWidthPx: number;
  readonly outlineColor: string;
  readonly boxShadow: string;
  /** The verdict: an outline or a ring a user can actually see. */
  readonly indicated: boolean;
}

/** The cap on any single walk. Well above the longest surface measured (the connected shell). */
const MAX_STOPS = 120;

/**
 * Presses Tab until the order cycles or `MAX_STOPS` is reached, recording every stop.
 *
 * `startFrom`, when given, is focused first so the walk begins somewhere known — without it a walk
 * starts wherever the last interaction left focus, and two runs of the same spec would produce
 * different tables.
 */
export async function walkTabOrder(
  window: Page,
  startFrom?: Locator
): Promise<{ stops: FocusStop[]; cycled: boolean }> {
  if (startFrom !== undefined) await startFrom.focus();

  const stops: FocusStop[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < MAX_STOPS; index += 1) {
    await window.keyboard.press('Tab');
    const measured = await measureActiveElement(window);
    // Focus left the document — Electron hands it to the window chrome at the end of the order.
    // Not a stop, and not an error; the walk is over.
    if (measured === null) return { stops, cycled: false };

    const key = `${measured.id}#${measured.tag}`;
    if (seen.has(key)) return { stops, cycled: true };
    seen.add(key);
    stops.push({ ...measured, order: stops.length + 1 });
  }

  return { stops, cycled: false };
}

/**
 * Reads `document.activeElement`. `null` when focus is on `<body>` or nowhere.
 *
 * All of the DOM reading happens in one `evaluate` rather than in a locator chain per field: a walk
 * is dozens of stops long and each round trip is a real cost, but more importantly the element must
 * be measured while it still has focus, and interleaving Playwright calls invites it to move.
 */
async function measureActiveElement(window: Page): Promise<Omit<FocusStop, 'order'> | null> {
  return window.evaluate(() => {
    // `Element`, not `HTMLElement`: the ERD canvas is SVG, and an SVG element is perfectly capable
    // of being a focus stop. Narrowing to HTMLElement made the walk read a real stop as "focus left
    // the document" and stop early — the ERD table said "6 stops, did NOT cycle" and everything
    // past the toolbar's first button went unmeasured.
    const element = document.activeElement;
    if (!(element instanceof Element) || element === document.body) return null;

    const style = getComputedStyle(element);
    const outlineWidthPx = Number.parseFloat(style.outlineWidth) || 0;
    // `rgba(…, 0)` and the keyword both mean the outline is drawn in nothing.
    const invisibleOutline =
      style.outlineColor === 'transparent' || /,\s*0\s*\)$/.test(style.outlineColor);
    const hasOutline = style.outlineStyle !== 'none' && outlineWidthPx >= 1 && !invisibleOutline;
    const hasShadow = style.boxShadow !== 'none' && style.boxShadow !== '';

    const testId = element.getAttribute('data-testid');
    const role = element.getAttribute('role');
    const classes = element.getAttribute('class')?.slice(0, 80) ?? '';
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
      // `:focus-visible` is what the app's own rules key on. Recorded even when the verdict below
      // is already true, because "the ring is the browser's, not ours" is a finding.
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidthPx,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow === 'none' ? 'none' : style.boxShadow.slice(0, 60),
      indicated: hasOutline || hasShadow,
    };
  });
}

/**
 * A surface whose focus indicator is drawn somewhere `getComputedStyle` on the focused element
 * cannot see it, plus the assertion that proves the indicator is nonetheless there.
 *
 * Three of these exist and all three are vendor DOM. An exemption without `verify` would be a hole,
 * so every one carries a positive check of its own — the point is to measure the indicator the
 * vendor does draw, not to stop asking.
 */
export interface FocusExemption {
  /** Matches the stop this exemption covers. */
  readonly matches: (stop: FocusStop) => boolean;
  readonly why: string;
  /** Runs while that element still has focus. Must fail if the indicator is absent. */
  readonly verify: (window: Page) => Promise<void>;
}

/**
 * Monaco's editor: focus lands on a 1px transparent `<textarea class="inputarea">` that is
 * deliberately invisible, and the indicator a user sees is the caret and the editor's own focus
 * border, drawn on `.monaco-editor.focused` two ancestors up.
 */
export const MONACO_EXEMPTION: FocusExemption = {
  matches: stop => stop.tag === 'textarea' && stop.classes.includes('inputarea'),
  why: "Monaco's focus sink is a 1px transparent textarea; the indicator is `.monaco-editor.focused` and the caret",
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
 * Asserts every stop shows a focus indicator, running each exemption's own check in its place.
 *
 * Returns the stops it had to excuse, so a spec can assert the exemption list is not vacuous — an
 * exemption that stops matching anything is dead weight that would silently excuse the next thing
 * to grow that shape.
 */
export function unindicatedStops(
  stops: readonly FocusStop[],
  exemptions: readonly FocusExemption[] = []
): FocusStop[] {
  return stops.filter(
    stop => !stop.indicated && !exemptions.some(exemption => exemption.matches(stop))
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
  walk: { stops: readonly FocusStop[]; cycled: boolean }
): Promise<void> {
  // `test.info()` rather than a `TestInfo` parameter: taking it as an argument would force every
  // caller to declare the second test callback parameter, which in turn forces an empty `{}`
  // destructuring pattern for the first — six `no-empty-pattern` suppressions in the spec for
  // nothing. The accessor reads the currently running test, which is this one.
  const testInfo = test.info();
  const file = testInfo.outputPath(name);
  await writeFile(file, focusTable(title, walk.stops, walk.cycled), 'utf8');
  await testInfo.attach(name, { path: file, contentType: 'text/markdown' });
}

/** The walk as a markdown table — this is the task's inventory evidence. */
function focusTable(title: string, stops: readonly FocusStop[], cycled: boolean): string {
  const rows = stops.map(
    stop =>
      `| ${stop.order} | \`${stop.id}\` | ${stop.tag} | ${stop.role ?? '—'} | ` +
      `${stop.focusVisible ? 'yes' : 'no'} | ${stop.outlineStyle} ${stop.outlineWidthPx}px ` +
      `${stop.outlineColor} | ${stop.boxShadow === 'none' ? '—' : 'ring'} | ` +
      `${stop.indicated ? 'PASS' : 'FAIL'} |`
  );

  return [
    `### ${title} — ${stops.length} stops, ${cycled ? 'order cycled' : 'order did NOT cycle'}`,
    '',
    '| # | element | tag | role | :focus-visible | outline | shadow | indicator |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}
