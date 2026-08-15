/**
 * The token inventory the preview page renders. Module-level and frozen by convention:
 * these arrays are effect dependencies, so they must be referentially stable.
 */

import type { PairSpec } from './contrast';
import type { TokenSpec } from './preview-parts';

export const BRAND_TOKENS: readonly TokenSpec[] = [
  { token: '--color-j-ivory', utility: 'bg-j-ivory', note: 'light canvas' },
  { token: '--color-j-paper', utility: 'bg-j-paper', note: 'light elevation' },
  { token: '--color-j-ink', utility: 'bg-j-ink', note: 'dark canvas' },
  { token: '--color-j-charcoal', utility: 'bg-j-charcoal', note: 'dark chrome' },
  { token: '--color-j-oxide', utility: 'bg-j-oxide', note: 'brand action' },
  { token: '--color-j-chartreuse', utility: 'bg-j-chartreuse', note: 'verification, scarce' },
  { token: '--color-j-rule', utility: 'bg-j-rule', note: 'drafting line' },
  { token: '--color-j-amber', utility: 'bg-j-amber', note: 'caution' },
];

export const DERIVED_TOKENS: readonly TokenSpec[] = [
  { token: '--color-j-oxide-deep', utility: 'bg-j-oxide-deep', note: 'oxide text/fill on ivory' },
  { token: '--color-j-oxide-lift', utility: 'bg-j-oxide-lift', note: 'oxide text on ink' },
  { token: '--color-j-amber-deep', utility: 'bg-j-amber-deep', note: 'caution text on ivory' },
  { token: '--color-j-verify-deep', utility: 'bg-j-verify-deep', note: 'success on ivory' },
];

export const SURFACE_TOKENS: readonly TokenSpec[] = [
  { token: '--color-canvas', utility: 'bg-canvas' },
  { token: '--color-surface', utility: 'bg-surface' },
  { token: '--color-chrome', utility: 'bg-chrome' },
  { token: '--color-elevated', utility: 'bg-elevated' },
  { token: '--color-hover', utility: 'bg-hover', note: 'translucent' },
  { token: '--color-active', utility: 'bg-active', note: 'translucent' },
];

export const TEXT_TOKENS: readonly TokenSpec[] = [
  { token: '--color-fg', utility: 'text-fg' },
  { token: '--color-fg-muted', utility: 'text-fg-muted' },
  { token: '--color-fg-subtle', utility: 'text-fg-subtle', note: 'metadata only' },
  { token: '--color-rule', utility: 'border-rule' },
  { token: '--color-rule-strong', utility: 'border-rule-strong' },
];

export const ACCENT_TOKENS: readonly TokenSpec[] = [
  { token: '--color-accent', utility: 'text-accent' },
  { token: '--color-accent-strong', utility: 'bg-accent-strong', note: 'fills' },
  { token: '--color-accent-subtle', utility: 'bg-accent-subtle', note: 'translucent' },
  { token: '--color-accent-fill-fg', utility: 'text-accent-fill-fg', note: 'on an accent fill' },
  { token: '--color-focus', utility: 'outline-focus' },
  { token: '--color-success', utility: 'text-success' },
  { token: '--color-warning', utility: 'text-warning' },
  { token: '--color-danger', utility: 'text-danger' },
];

export const ALL_TOKENS: readonly string[] = [
  ...BRAND_TOKENS,
  ...DERIVED_TOKENS,
  ...SURFACE_TOKENS,
  ...TEXT_TOKENS,
  ...ACCENT_TOKENS,
].map(spec => spec.token);

/**
 * PROPOSAL §2.3 verbatim, plus the two derived colours §2.3 never tabulated. Brand
 * constants only, so these ratios are identical in both themes — which is the point:
 * they certify the palette, not the current canvas.
 */
export const BRAND_PAIRS: readonly PairSpec[] = [
  { label: 'ivory on ink', fg: '--color-j-ivory', bg: '--color-j-ink', proposal: 15.98 },
  { label: 'oxide on ink', fg: '--color-j-oxide', bg: '--color-j-ink', proposal: 4.24 },
  { label: 'oxide-lift on ink', fg: '--color-j-oxide-lift', bg: '--color-j-ink', proposal: 5.59 },
  { label: 'oxide on ivory', fg: '--color-j-oxide', bg: '--color-j-ivory', proposal: 3.77 },
  {
    label: 'oxide-deep on ivory',
    fg: '--color-j-oxide-deep',
    bg: '--color-j-ivory',
    proposal: 4.93,
  },
  { label: 'white on oxide fill', fg: '--color-white', bg: '--color-j-oxide', proposal: 4.33 },
  {
    label: 'white on oxide-deep fill',
    fg: '--color-white',
    bg: '--color-j-oxide-deep',
    proposal: 5.67,
  },
  { label: 'chartreuse on ink', fg: '--color-j-chartreuse', bg: '--color-j-ink', proposal: 14.0 },
  {
    label: 'chartreuse on ivory',
    fg: '--color-j-chartreuse',
    bg: '--color-j-ivory',
    proposal: 1.14,
    note: 'expected — fill only, never a light-mode foreground',
  },
  {
    label: 'ink on chartreuse fill',
    fg: '--color-j-ink',
    bg: '--color-j-chartreuse',
    proposal: 14.0,
  },
  {
    label: 'amber on ivory',
    fg: '--color-j-amber',
    bg: '--color-j-ivory',
    proposal: 1.9,
    note: 'expected — fill only; amber-deep carries caution text',
  },
  { label: 'amber-deep on ivory', fg: '--color-j-amber-deep', bg: '--color-j-ivory' },
  {
    label: 'verify-deep on ivory',
    fg: '--color-j-verify-deep',
    bg: '--color-j-ivory',
    note: 'AA large / UI only — 0.06 short of body text',
  },
];

/** The semantic layer, measured in whichever theme is currently applied. */
export const SEMANTIC_PAIRS: readonly PairSpec[] = [
  { label: 'fg on canvas', fg: '--color-fg', bg: '--color-canvas' },
  { label: 'fg-muted on canvas', fg: '--color-fg-muted', bg: '--color-canvas' },
  { label: 'fg-subtle on canvas', fg: '--color-fg-subtle', bg: '--color-canvas' },
  { label: 'fg on surface', fg: '--color-fg', bg: '--color-surface' },
  { label: 'fg-muted on chrome', fg: '--color-fg-muted', bg: '--color-chrome' },
  { label: 'fg-subtle on chrome', fg: '--color-fg-subtle', bg: '--color-chrome' },
  { label: 'fg on elevated', fg: '--color-fg', bg: '--color-elevated' },
  { label: 'accent on canvas', fg: '--color-accent', bg: '--color-canvas' },
  {
    label: 'accent-fill-fg on accent-strong',
    fg: '--color-accent-fill-fg',
    bg: '--color-accent-strong',
  },
  { label: 'success on canvas', fg: '--color-success', bg: '--color-canvas' },
  { label: 'warning on canvas', fg: '--color-warning', bg: '--color-canvas' },
  { label: 'danger on canvas', fg: '--color-danger', bg: '--color-canvas' },
  {
    label: 'rule-strong on canvas',
    fg: '--color-rule-strong',
    bg: '--color-canvas',
    note: 'a divider, not text and not a control boundary — 1.4.11 does not apply',
  },
  { label: 'focus on canvas', fg: '--color-focus', bg: '--color-canvas' },
];

export interface ScaleRow {
  readonly utility: string;
  readonly px: string;
  readonly note: string;
}

export const TYPE_SCALE: readonly ScaleRow[] = [
  { utility: 'text-2xs', px: '10px', note: 'mono uppercase metadata only, never prose' },
  { utility: 'text-xs', px: '11px', note: 'status bar, badges, micro-labels' },
  { utility: 'text-sm', px: '12px', note: 'dense tree / grid rows — the body floor' },
  { utility: 'text-base', px: '13px', note: 'default interface text' },
  { utility: 'text-md', px: '14px', note: 'dialog body, chat prose' },
  { utility: 'text-lg', px: '16px', note: 'dialog titles, section heads' },
  { utility: 'text-xl', px: '20px', note: 'panel headings' },
];

export const DISPLAY_SCALE: readonly ScaleRow[] = [
  { utility: 'text-display-sm', px: '28px', note: 'empty states' },
  { utility: 'text-display-md', px: '40px', note: 'welcome secondary' },
  { utility: 'text-display-lg', px: '56px', note: 'welcome hero' },
];

export interface SpacingRung {
  readonly utility: string;
  readonly px: string;
  readonly widthClass: string;
}

/** PROPOSAL §2.4's ladder, expressed as bare multiples of Tailwind's `--spacing`. */
export const SPACING_LADDER: readonly SpacingRung[] = [
  { utility: 'p-0.5', px: '2px', widthClass: 'w-0.5' },
  { utility: 'p-1', px: '4px', widthClass: 'w-1' },
  { utility: 'p-1.5', px: '6px', widthClass: 'w-1.5' },
  { utility: 'p-2', px: '8px', widthClass: 'w-2' },
  { utility: 'p-2.5', px: '10px', widthClass: 'w-2.5' },
  { utility: 'p-3', px: '12px', widthClass: 'w-3' },
  { utility: 'p-4', px: '16px', widthClass: 'w-4' },
  { utility: 'p-6', px: '24px', widthClass: 'w-6' },
  { utility: 'p-8', px: '32px', widthClass: 'w-8' },
];

export const RADIUS_RUNGS: readonly ScaleRow[] = [
  { utility: 'rounded-xs', px: '2px', note: 'inputs, chips' },
  { utility: 'rounded-sm', px: '4px', note: 'buttons, wells' },
  { utility: 'rounded-md', px: '6px', note: 'dialogs — the ceiling' },
  { utility: 'rounded-full', px: '9999px', note: 'pips and pills only' },
];

export interface IconRung extends ScaleRow {
  readonly token: string;
}

export const ICON_RUNGS: readonly IconRung[] = [
  { token: '--icon-sm', utility: 'size-3.5', px: '14px', note: 'dense rows' },
  { token: '--icon-md', utility: 'size-4', px: '16px', note: 'app chrome default' },
  { token: '--icon-lg', utility: 'size-5', px: '20px', note: 'nav lists only' },
];
