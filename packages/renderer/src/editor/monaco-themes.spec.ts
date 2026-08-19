/**
 * The drift guard for the two editor themes, and the executable half of J-37's "ONE code-token palette".
 *
 * `monaco-themes.ts` has to hold hex literals — Monaco parses its colours once and cannot read a CSS
 * custom property — so the token values are duplicated out of `styles/theme.css`. This spec is what makes
 * that safe: it parses the stylesheet, resolves each token's `var()` alias chain and its `rgb(… / α)`
 * form to the same spelling the theme tables use, and fails if any one of them has moved.
 *
 * Same mechanism as `markdown/sanitize-parity.spec.ts`: the source of truth is imported as `?raw` so the
 * assertion is against the shipped file rather than against a copy of its values.
 *
 * A note on what this canNOT check: whether Tailwind emits the variable at all. `@theme static` is what
 * guarantees that (`theme.css`'s own comment), and the browser gate measures the rendered token colours
 * in both themes — this spec's job is only that the two files agree.
 */

import { describe, expect, it } from 'vitest';
// `?raw` is Vite's own suffix, resolved by the bundler and typed by `vite/client`. Same mechanism
// `markdown/sanitize-parity.spec.ts` uses to hold that port byte-identical to its Angular original.
import themeCss from '../styles/theme.css?raw';
import {
  EDITOR_TOKEN_SOURCES,
  EDITOR_THEMES,
  INK_THEME_NAME,
  INK_TOKENS,
  IVORY_THEME_NAME,
  IVORY_TOKENS,
  type EditorThemeTokens,
} from './monaco-themes';

/**
 * The two token scopes in `theme.css`: the `@theme static { … }` block holds the ink values, and the
 * `@variant light { … }` block inside `:root` holds the ivory overrides.
 *
 * Located by their own delimiters rather than by line numbers, and each extraction is asserted to have
 * found something — a regex that silently matched nothing would make every comparison below vacuous.
 */
function blockAfter(marker: string): string {
  const start = themeCss.indexOf(marker);
  expect(start, `theme.css no longer contains ${marker}`).toBeGreaterThan(-1);

  // Brace-balanced, not "to the end of the file": the light block is nested inside `:root` and sits
  // BELOW `@theme static`, so an unbounded slice would fold the ivory overrides into the ink map and
  // every ink comparison would silently assert the ivory value against itself. That is exactly what the
  // first run of this spec did.
  const open = themeCss.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < themeCss.length; index += 1) {
    if (themeCss[index] === '{') depth += 1;
    else if (themeCss[index] === '}') {
      depth -= 1;
      if (depth === 0) return themeCss.slice(open + 1, index);
    }
  }
  throw new Error(`theme.css has an unbalanced block after ${marker}`);
}

/** Every `--name: value;` declaration in a block, in order, last-wins. */
function declarationsIn(source: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const match of source.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) declarations.set(name, value.trim());
  }
  return declarations;
}

const INK_DECLARATIONS = declarationsIn(blockAfter('@theme static {'));
const IVORY_DECLARATIONS = declarationsIn(blockAfter('@variant light {'));

/** `rgb(242 239 231 / 0.12)` → `#f2efe71f`, which is the spelling Monaco parses. */
function rgbToHex(value: string): string | null {
  const match = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(value);
  if (!match) return null;
  const [, r, g, b, alpha] = match;
  const channels = [r, g, b].map(channel => Number(channel).toString(16).padStart(2, '0')).join('');
  if (alpha === undefined) return `#${channels}`;
  const alphaHex = Math.round(Number(alpha) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${channels}${alphaHex}`;
}

/**
 * Resolves one token to a hex string, following `var(--other)` aliases.
 *
 * Ink first, then the theme's own block: that is the cascade `theme.css` builds — the light block
 * overrides a subset of the ink tokens, and anything it does not mention (a brand constant like
 * `--color-j-oxide-deep`) still comes from `@theme`. Bounded at ten hops so a circular alias fails the
 * test rather than hanging it.
 */
function resolveToken(name: string, overrides: Map<string, string>): string {
  let value = overrides.get(name) ?? INK_DECLARATIONS.get(name);
  for (let hop = 0; hop < 10; hop += 1) {
    expect(value, `theme.css declares no ${name}`).toBeDefined();
    if (value === undefined) return '';
    const alias = /^var\((--[\w-]+)\)$/.exec(value.trim());
    if (alias === null) break;
    const target = alias[1];
    if (target === undefined) break;
    value = overrides.get(target) ?? INK_DECLARATIONS.get(target);
  }
  const resolved = (value ?? '').trim();
  return rgbToHex(resolved) ?? resolved;
}

const CASES: readonly {
  name: string;
  tokens: EditorThemeTokens;
  overrides: Map<string, string>;
}[] = [
  { name: 'ink', tokens: INK_TOKENS, overrides: new Map() },
  { name: 'ivory', tokens: IVORY_TOKENS, overrides: IVORY_DECLARATIONS },
];

describe.each(CASES)('$name tokens match theme.css', ({ tokens, overrides }) => {
  it.each(Object.keys(EDITOR_TOKEN_SOURCES) as (keyof EditorThemeTokens)[])('%s', tokenName => {
    const cssName = EDITOR_TOKEN_SOURCES[tokenName];
    expect(tokens[tokenName].toLowerCase()).toBe(resolveToken(cssName, overrides).toLowerCase());
  });
});

describe('the parser this spec relies on', () => {
  it('found both blocks and a plausible number of declarations', () => {
    // The guard on the guard: if either extraction silently matched nothing, every `expect` above would
    // compare a value against itself-shaped emptiness and pass.
    expect(INK_DECLARATIONS.size).toBeGreaterThan(40);
    expect(IVORY_DECLARATIONS.size).toBeGreaterThan(15);
    expect(INK_DECLARATIONS.get('--color-canvas')).toBe('var(--color-j-ink)');
  });

  it('resolves an alias chain and an rgb-with-alpha token', () => {
    expect(resolveToken('--color-canvas', new Map())).toBe('#171817');
    expect(resolveToken('--color-hover', new Map())).toBe('#f2efe70f');
  });

  it('fails a token whose declaration is missing rather than passing quietly', () => {
    // `resolveToken` asserts internally; this proves the assertion is reachable.
    expect(() => resolveToken('--color-does-not-exist', new Map())).toThrow();
  });
});

describe('the theme data Monaco is handed', () => {
  it('names the two brand themes and bases them on the right built-ins', () => {
    expect(EDITOR_THEMES.dark.name).toBe(INK_THEME_NAME);
    expect(EDITOR_THEMES.light.name).toBe(IVORY_THEME_NAME);
    expect(EDITOR_THEMES.dark.data.base).toBe('vs-dark');
    expect(EDITOR_THEMES.light.data.base).toBe('vs');
    // `inherit` is what keeps the colour list honest: it is the ids this app can actually surface, and
    // everything else falls back to the built-in rather than being half-specified here.
    expect(EDITOR_THEMES.dark.data.inherit).toBe(true);
  });

  it('paints the token scopes the three SQL tokenizers emit, bare AND `.sql`-suffixed', () => {
    const scopes = EDITOR_THEMES.dark.data.rules.map(rule => rule.token);
    // `comment` covers `comment.quote` and `keyword` covers `keyword.try` by Monaco's prefix matching,
    // which is why this is nine roles and not twenty. Each is registered twice: Monarch appends the
    // grammar's `.sql` postfix, and the base theme's own `string.sql` / `operator.sql` /
    // `predefined.sql` rules are MORE SPECIFIC than a bare `string` and win against it. Measured — the
    // first gate run photographed a red string, a magenta COUNT and a slate-grey operator.
    expect(scopes).toEqual([
      'keyword',
      'keyword.sql',
      'predefined',
      'predefined.sql',
      'operator',
      'operator.sql',
      'type',
      'type.sql',
      'string',
      'string.sql',
      'number',
      'number.sql',
      'comment',
      'comment.sql',
      'delimiter',
      'delimiter.sql',
      'identifier',
      'identifier.sql',
    ]);
  });

  it('claims every scope the base theme defines an SQL rule for', () => {
    // `standalone/common/themes.js` defines exactly three, and every one of them has to be overridden
    // by name or `inherit: true` lets it through.
    const scopes = new Set(EDITOR_THEMES.light.data.rules.map(rule => rule.token));
    for (const baseRule of ['string.sql', 'operator.sql', 'predefined.sql']) {
      expect(scopes.has(baseRule), `the base theme's ${baseRule} is unclaimed`).toBe(true);
    }
  });

  it('strips the leading # from token foregrounds, which is the form Monaco requires', () => {
    for (const rule of EDITOR_THEMES.light.data.rules) {
      expect(rule.foreground).toMatch(/^[0-9a-f]{6}$/i);
    }
  });

  it('gives keywords weight and comments italics, so the closed palette still separates roles', () => {
    const byToken = new Map(EDITOR_THEMES.dark.data.rules.map(rule => [rule.token, rule]));
    expect(byToken.get('keyword')?.fontStyle).toBe('bold');
    expect(byToken.get('predefined')?.fontStyle).toBe('bold');
    expect(byToken.get('comment')?.fontStyle).toBe('italic');
    // And the suffixed twin carries the same weight, since it is the one that actually applies.
    expect(byToken.get('keyword.sql')?.fontStyle).toBe('bold');
    expect(byToken.get('comment.sql')?.fontStyle).toBe('italic');
    // Everything else is separated by hue or the neutral ramp, not by weight.
    expect(byToken.get('string.sql')?.fontStyle).toBeUndefined();
  });

  it('paints the editor background from the canvas token in both themes', () => {
    expect(EDITOR_THEMES.dark.data.colors['editor.background']).toBe(INK_TOKENS.canvas);
    expect(EDITOR_THEMES.light.data.colors['editor.background']).toBe(IVORY_TOKENS.canvas);
  });
});
