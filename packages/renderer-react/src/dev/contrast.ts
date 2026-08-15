/**
 * WCAG 2.1 contrast measurement against the *rendered* token values.
 *
 * This is the harness behind the contrast table on the token preview page. It exists
 * because PROPOSAL §2.3's derived colours were introduced to fix measured failures, so
 * the theme is only correct if the numbers can be reproduced from what the browser
 * actually resolved — not from the hexes retyped into a comment.
 */

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const HEX = /^#([0-9a-f]{3,8})$/i;
const FUNCTIONAL = /^rgba?\(([^)]+)\)$/i;

function fromHex(digits: string): Rgba {
  const wide = digits.length > 4;
  const step = wide ? 2 : 1;
  const channel = (index: number): number => {
    const raw = digits.slice(index * step, index * step + step);
    const value = parseInt(wide ? raw : raw + raw, 16);
    if (Number.isNaN(value)) throw new Error(`unparseable hex channel in #${digits}`);
    return value;
  };
  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    a: digits.length === 4 || digits.length === 8 ? channel(3) / 255 : 1,
  };
}

/** `50%` -> 0.5, `0.5` -> 0.5. `scale` is what a bare 100% maps to. */
function percentOrNumber(raw: string, scale: number): number {
  const text = raw.trim();
  const value = parseFloat(text);
  if (Number.isNaN(value)) throw new Error(`unparseable colour component "${raw}"`);
  return text.endsWith('%') ? (value / 100) * scale : value;
}

function fromFunctional(body: string): Rgba {
  // Accepts both the legacy comma form and the modern `r g b / a` form, which is what
  // theme.css authors the translucent hover/rule tokens in.
  const [rgb, alpha] = body.split('/');
  const parts = (rgb ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < 3) throw new Error(`expected 3 colour channels, got "${body}"`);
  const [r, g, b, legacyAlpha] = parts as [string, string, string, string | undefined];
  // The legacy form carries alpha as a fourth comma-separated value; the modern form puts
  // it after a slash. Both appear in real computed-style output.
  const rawAlpha = alpha ?? legacyAlpha;
  return {
    r: percentOrNumber(r, 255),
    g: percentOrNumber(g, 255),
    b: percentOrNumber(b, 255),
    a: rawAlpha === undefined ? 1 : percentOrNumber(rawAlpha, 1),
  };
}

/** Parses the subset of CSS colour syntax theme.css uses. Throws on anything else. */
export function parseCssColor(value: string): Rgba {
  const input = value.trim();
  const hex = HEX.exec(input);
  if (hex) return fromHex(hex[1]!);
  const fn = FUNCTIONAL.exec(input);
  if (fn) return fromFunctional(fn[1]!);
  throw new Error(`unsupported colour value: "${value}"`);
}

/** Flattens a translucent colour onto an opaque backdrop. */
export function composite(fg: Rgba, backdrop: Rgba): Rgba {
  if (backdrop.a !== 1) throw new Error('a backdrop must be opaque to composite against');
  if (fg.a === 1) return fg;
  const mix = (f: number, b: number): number => f * fg.a + b * (1 - fg.a);
  return { r: mix(fg.r, backdrop.r), g: mix(fg.g, backdrop.g), b: mix(fg.b, backdrop.b), a: 1 };
}

/** WCAG 2.1 relative luminance. Requires an opaque colour. */
export function relativeLuminance(colour: Rgba): number {
  if (colour.a !== 1) throw new Error('luminance is only defined for an opaque colour');
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(colour.r) + 0.7152 * linear(colour.g) + 0.0722 * linear(colour.b);
}

/** WCAG 2.1 contrast ratio, 1..21. Translucent foregrounds are flattened onto `bg`. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const front = relativeLuminance(composite(fg, bg));
  const back = relativeLuminance(bg);
  const [lighter, darker] = front >= back ? [front, back] : [back, front];
  return (lighter + 0.05) / (darker + 0.05);
}

export type ContrastVerdict = 'aa-body' | 'aa-large' | 'fail';

/** 4.5:1 is AA for body text; 3:1 is AA for large text and UI component boundaries. */
export function verdictFor(ratio: number): ContrastVerdict {
  if (ratio >= 4.5) return 'aa-body';
  if (ratio >= 3) return 'aa-large';
  return 'fail';
}

/**
 * Reads a registered theme variable off an element. Custom properties have their
 * `var()` substitutions already resolved at computed-value time, so a token declared as
 * `--color-canvas: var(--color-j-ink)` reads back as the literal ink hex.
 */
export function readToken(name: string, element: Element): string {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  if (!value) throw new Error(`theme variable ${name} is not defined on the element`);
  return value;
}

export interface MeasuredPair {
  readonly label: string;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly verdict: ContrastVerdict;
  /** What PROPOSAL §2.3 recorded, when it recorded anything for this pair. */
  readonly proposal?: number;
  /** Why a sub-threshold ratio is nonetheless correct. */
  readonly note?: string;
}

export interface PairSpec {
  readonly label: string;
  readonly fg: string;
  readonly bg: string;
  readonly proposal?: number;
  readonly note?: string;
}

/** Measures one pair of token names against the values `element` resolved them to. */
export function measurePair(spec: PairSpec, element: Element): MeasuredPair {
  const foreground = readToken(spec.fg, element);
  const background = readToken(spec.bg, element);
  const ratio = contrastRatio(parseCssColor(foreground), parseCssColor(background));
  return {
    label: spec.label,
    foreground,
    background,
    ratio,
    verdict: verdictFor(ratio),
    ...(spec.proposal === undefined ? {} : { proposal: spec.proposal }),
    ...(spec.note === undefined ? {} : { note: spec.note }),
  };
}
