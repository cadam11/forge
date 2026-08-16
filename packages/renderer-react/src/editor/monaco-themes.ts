/**
 * `joinery-ink` and `joinery-ivory`: the two editor themes, and the Monaco half of J-37.
 *
 * PROPOSAL §1.6 counted this as a defect rather than a gap — the Angular renderer set stock
 * `vs`/`vs-dark` (`query.component.ts:1062,1269`), so the six `--syntax-*` tokens it defined never
 * reached the editor and the brand stopped at the editor's border.
 *
 * ── Why the values are duplicated here, and what stops them drifting ────────────────────────
 *
 * Monaco theme data is a plain object of **hex strings**. It cannot hold `var(--color-canvas)`: the
 * colours are parsed once at `defineTheme` time and written into a `<style>` element as literals, so
 * a CSS custom property would arrive as an unparseable string and be dropped. Reading the resolved
 * values out of `getComputedStyle` at runtime was the alternative and it is worse: the resolved value
 * depends on the `data-theme` attribute currently on `<html>`, so building BOTH themes that way needs
 * two probe elements with forced attributes, and the resulting theme is un-unit-testable because
 * jsdom resolves no custom properties at all.
 *
 * So the tables below are the duplication, and `monaco-themes.spec.ts` is what makes it safe: it
 * parses `styles/theme.css`, resolves each token's `var()` alias chain and its `rgb(… / α)` form to
 * the same hex spelling used here, and fails if any one of them has moved. That is the same
 * arrangement `markdown/sanitize-parity.spec.ts` uses to hold the sanitize seam byte-identical to the
 * Angular original, and it is the reason a token rename cannot silently stop reaching the editor.
 *
 * ── The token tables ───────────────────────────────────────────────────────────────────────
 *
 * One entry per token this file consumes, so a reader can check the mapping against `theme.css`
 * without reading any Monaco code, and the spec has one list to walk. Alpha tokens are `#rrggbbaa`,
 * which Monaco parses.
 */

// Type-only, so this module pulls no Monaco code: `monaco.ts` stays the single runtime importer and
// this file is unit-testable in jsdom, where Monaco cannot be instantiated at all.
import type * as monaco from 'monaco-editor/editor/editor.api.js';

/** Every design token the editor themes read. Keys are the `--color-<key>` name, kebab dropped. */
export interface EditorThemeTokens {
  readonly canvas: string;
  readonly surface: string;
  readonly chrome: string;
  readonly elevated: string;
  readonly hover: string;
  readonly active: string;
  readonly fg: string;
  readonly fgMuted: string;
  readonly fgSubtle: string;
  readonly rule: string;
  readonly ruleStrong: string;
  readonly accent: string;
  readonly accentSubtle: string;
  readonly focus: string;
  readonly syntaxKeyword: string;
  readonly syntaxString: string;
  readonly syntaxNumber: string;
  readonly syntaxComment: string;
  readonly syntaxFunction: string;
  readonly syntaxType: string;
}

/** The CSS custom property each token comes from. The spec walks this to check every value. */
export const EDITOR_TOKEN_SOURCES: Readonly<Record<keyof EditorThemeTokens, string>> = {
  canvas: '--color-canvas',
  surface: '--color-surface',
  chrome: '--color-chrome',
  elevated: '--color-elevated',
  hover: '--color-hover',
  active: '--color-active',
  fg: '--color-fg',
  fgMuted: '--color-fg-muted',
  fgSubtle: '--color-fg-subtle',
  rule: '--color-rule',
  ruleStrong: '--color-rule-strong',
  accent: '--color-accent',
  accentSubtle: '--color-accent-subtle',
  focus: '--color-focus',
  syntaxKeyword: '--color-syntax-keyword',
  syntaxString: '--color-syntax-string',
  syntaxNumber: '--color-syntax-number',
  syntaxComment: '--color-syntax-comment',
  syntaxFunction: '--color-syntax-function',
  syntaxType: '--color-syntax-type',
};

export const INK_TOKENS: EditorThemeTokens = {
  canvas: '#171817',
  surface: '#1e211e',
  chrome: '#272a27',
  elevated: '#2f332e',
  hover: '#f2efe70f',
  active: '#e8654a24',
  fg: '#f2efe7',
  fgMuted: '#b4b3ab',
  fgSubtle: '#85887f',
  rule: '#f2efe71f',
  ruleStrong: '#f2efe738',
  accent: '#e8654a',
  accentSubtle: '#e8654a24',
  focus: '#e8654a',
  syntaxKeyword: '#e8654a',
  syntaxString: '#c8f04a',
  syntaxNumber: '#e6a23c',
  syntaxComment: '#85887f',
  syntaxFunction: '#f2efe7',
  syntaxType: '#b4b3ab',
};

export const IVORY_TOKENS: EditorThemeTokens = {
  canvas: '#f2efe7',
  surface: '#eae7dd',
  chrome: '#e2ded2',
  elevated: '#fbfaf5',
  hover: '#1718170d',
  active: '#d6492f1a',
  fg: '#171817',
  fgMuted: '#5a5d57',
  fgSubtle: '#7a7d74',
  rule: '#1718171a',
  ruleStrong: '#b9b8ae',
  accent: '#d6492f',
  accentSubtle: '#d6492f1a',
  focus: '#b83c22',
  syntaxKeyword: '#b83c22',
  syntaxString: '#4d7811',
  syntaxNumber: '#8a5a10',
  syntaxComment: '#666961',
  syntaxFunction: '#171817',
  syntaxType: '#5a5d57',
};

export const INK_THEME_NAME = 'joinery-ink';
export const IVORY_THEME_NAME = 'joinery-ivory';

/**
 * The token → Monaco-scope map, shared by both themes.
 *
 * The scopes are the ones the three SQL tokenizers actually emit, read out of
 * `languages/definitions/{sql,pgsql,mysql}/*.js` rather than guessed: `keyword` (plus the
 * `keyword.block` / `keyword.try` / … variants T-SQL adds), `predefined` (built-in functions and
 * variables — `COUNT`, `@@VERSION`), `operator` (which in these grammars covers the WORD operators
 * `AND` / `OR` / `IN` / `BETWEEN` as well as the symbolic ones), `string` (+ `string.double` in
 * MySQL), `number`, `comment` (+ `comment.quote` for block comments), `identifier` (+
 * `identifier.quote` for `[bracketed]` names) and `delimiter`.
 *
 * Monaco matches a rule's token by PREFIX, so `comment` covers `comment.quote` and `keyword` covers
 * every `keyword.*` — that is why the list is nine rules and not twenty.
 *
 * `identifier` and `delimiter` are deliberately absent: they inherit `editor.foreground`, which is
 * what an unhighlighted identifier should be. Naming them would only restate the default.
 */
function tokenRules(tokens: EditorThemeTokens): monaco.editor.ITokenThemeRule[] {
  const strip = (color: string): string => color.replace('#', '');
  return [
    { token: 'keyword', foreground: strip(tokens.syntaxKeyword), fontStyle: 'bold' },
    { token: 'predefined', foreground: strip(tokens.syntaxFunction), fontStyle: 'bold' },
    { token: 'operator', foreground: strip(tokens.syntaxType) },
    // Present in some grammars (and in the JSON/TS ones a future task might mount), harmless here.
    { token: 'type', foreground: strip(tokens.syntaxType) },
    { token: 'string', foreground: strip(tokens.syntaxString) },
    { token: 'number', foreground: strip(tokens.syntaxNumber) },
    { token: 'comment', foreground: strip(tokens.syntaxComment), fontStyle: 'italic' },
  ];
}

/**
 * The chrome map. Every value is a token, and the list is the set of Monaco colour ids this app can
 * actually put on screen: the editor body, the gutter, the selection, the find widget, the suggest
 * widget and the scrollbar. Ids Monaco defines but nothing here surfaces (the minimap is off, the
 * diff editor is never mounted, no markers are ever set) are left to `inherit`, which is what
 * `inherit: true` below is for — a shorter list that is entirely true beats a long one that is half
 * aspirational.
 */
function editorColors(tokens: EditorThemeTokens): monaco.editor.IColors {
  return {
    'editor.background': tokens.canvas,
    'editor.foreground': tokens.fg,
    'editorCursor.foreground': tokens.accent,
    // The caret line: a hairline rule, not a wash — PROPOSAL §2.1's "rules replace fills".
    'editor.lineHighlightBackground': tokens.hover,
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': tokens.fgSubtle,
    'editorLineNumber.activeForeground': tokens.fg,
    'editorIndentGuide.background1': tokens.rule,
    'editorIndentGuide.activeBackground1': tokens.ruleStrong,
    'editorWhitespace.foreground': tokens.rule,
    'editor.selectionBackground': tokens.active,
    'editor.inactiveSelectionBackground': tokens.hover,
    'editor.selectionHighlightBackground': tokens.accentSubtle,
    'editor.wordHighlightBackground': tokens.accentSubtle,
    'editor.wordHighlightStrongBackground': tokens.accentSubtle,
    'editor.findMatchBackground': tokens.active,
    'editor.findMatchHighlightBackground': tokens.accentSubtle,
    'editorBracketMatch.background': tokens.accentSubtle,
    'editorBracketMatch.border': tokens.accent,
    // Widgets — the find/replace bar, the suggest list, hovers. `elevated` is the dialog surface.
    'editorWidget.background': tokens.elevated,
    'editorWidget.foreground': tokens.fg,
    'editorWidget.border': tokens.rule,
    'editorSuggestWidget.background': tokens.elevated,
    'editorSuggestWidget.foreground': tokens.fg,
    'editorSuggestWidget.border': tokens.rule,
    'editorSuggestWidget.selectedBackground': tokens.active,
    'editorSuggestWidget.selectedForeground': tokens.fg,
    'editorSuggestWidget.highlightForeground': tokens.accent,
    'editorHoverWidget.background': tokens.elevated,
    'editorHoverWidget.border': tokens.rule,
    'input.background': tokens.surface,
    'input.foreground': tokens.fg,
    'input.border': tokens.rule,
    'inputOption.activeBorder': tokens.accent,
    focusBorder: tokens.focus,
    'list.hoverBackground': tokens.hover,
    'list.focusBackground': tokens.active,
    'list.focusForeground': tokens.fg,
    'scrollbarSlider.background': tokens.rule,
    'scrollbarSlider.hoverBackground': tokens.ruleStrong,
    'scrollbarSlider.activeBackground': tokens.ruleStrong,
    'editorOverviewRuler.border': '#00000000',
  };
}

export function themeData(
  tokens: EditorThemeTokens,
  base: monaco.editor.BuiltinTheme
): monaco.editor.IStandaloneThemeData {
  return { base, inherit: true, rules: tokenRules(tokens), colors: editorColors(tokens) };
}

/** The two themes, keyed by the resolved app theme so callers never spell a name. */
export const EDITOR_THEMES = {
  dark: { name: INK_THEME_NAME, data: themeData(INK_TOKENS, 'vs-dark') },
  light: { name: IVORY_THEME_NAME, data: themeData(IVORY_TOKENS, 'vs') },
} as const;
