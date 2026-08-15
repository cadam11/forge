import { describe, expect, it } from 'vitest';

// `?raw` so the guard reads the token authority itself rather than a restatement of it. The
// renderer-react vitest project sets `css: true` for exactly this — see vitest.config.ts.
import THEME_CSS from '../styles/theme.css?raw';
import { cn, OFF_LADDER_FONT_SIZES } from './cn';

/**
 * `cn` is the reason `className` on a primitive actually wins. These tests exist because the
 * failure mode is silent: an unmerged conflict leaves both utilities in the attribute and the
 * winner is decided by stylesheet order, so the bug looks like "my class did nothing".
 */

describe('cn — conflict resolution', () => {
  it('lets the caller win on the properties a primitive already sets', () => {
    expect(cn('h-8.5', 'h-7')).toBe('h-7');
    expect(cn('px-3', 'px-2')).toBe('px-2');
    expect(cn('rounded-sm', 'rounded-md')).toBe('rounded-md');
    expect(cn('bg-canvas', 'bg-surface')).toBe('bg-surface');
    expect(cn('border-rule', 'border-rule-strong')).toBe('border-rule-strong');
    expect(cn('stroke-current', 'stroke-accent')).toBe('stroke-accent');
  });

  it('keeps utilities that do not conflict', () => {
    expect(cn('inline-flex items-center', 'w-full')).toBe('inline-flex items-center w-full');
  });

  it('accepts the conditional forms clsx supports', () => {
    const applyOverride: boolean = Boolean(0);
    expect(cn('h-7', applyOverride && 'h-8.5', undefined, null, ['text-fg'])).toBe('h-7 text-fg');
  });
});

describe('cn — the closed type ladder', () => {
  it('treats every off-ladder display rung as a font size, not a colour', () => {
    for (const rung of OFF_LADDER_FONT_SIZES) {
      // Without the override, tailwind-merge classifies `text-display-sm` as a text colour and
      // this drops `text-fg`. Measured before the override was added.
      expect(cn('text-fg', `text-${rung}`)).toBe(`text-fg text-${rung}`);
      expect(cn('text-base', `text-${rung}`)).toBe(`text-${rung}`);
    }
  });

  it('understands every `--text-*` rung theme.css registers', () => {
    // The drift guard. A rung added to the theme whose name tailwind-merge cannot recognise
    // fails here, which is the only place that mistake is visible before it ships.
    for (const rung of registeredTextRungs()) {
      expect(
        cn('text-fg', `text-${rung}`),
        `text-${rung} is not being treated as a font size`
      ).toBe(`text-fg text-${rung}`);
    }
  });

  it('finds the rungs it claims to be checking', () => {
    // Guards the regex above: a parser that silently matches nothing would make the drift
    // guard vacuous.
    const rungs = registeredTextRungs();
    expect(rungs).toContain('2xs');
    expect(rungs).toContain('display-lg');
    expect(rungs.length).toBeGreaterThanOrEqual(10);
  });
});

/**
 * Every `--text-<name>:` declared in the theme, excluding the `--text-*: initial` reset and the
 * `--line-height` / `--letter-spacing` modifiers, which are not utilities.
 */
function registeredTextRungs(): readonly string[] {
  const names = new Set<string>();
  for (const match of THEME_CSS.matchAll(/^\s*--text-([a-z0-9-]+)\s*:/gim)) {
    const name = match[1];
    if (name === undefined || name === '*' || name.includes('--')) {
      continue;
    }
    names.add(name);
  }
  return [...names];
}
