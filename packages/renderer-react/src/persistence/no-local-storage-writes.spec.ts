/**
 * The structural guard behind Task 5's non-destructiveness claim.
 *
 * The Angular renderer's six localStorage keys are the only home for real user data in the app
 * today — the whole snippet library included (PLAN.md 0.5) — and the React renderer coexists with it
 * for another twenty tasks. So "React reads those keys and never writes them" cannot be a convention
 * that survives on comments: it has to be checkable. This spec is that check, and it is deliberately
 * about the source text rather than about behaviour, because behaviour tests can only cover the code
 * paths someone thought to test.
 *
 * The one permitted writer is `persistence/theme-mirror.ts`, which owns a React-only key that the
 * pre-mount FOUC script reads. Everything else in the package — including any future feature — must
 * persist through main-process `AppState`.
 *
 * `import.meta.glob` rather than `node:fs`: this package's tsconfig omits `@types/node` on purpose
 * (`tsconfig.json:28-32`), and Vite's raw-glob import is typed by `vite/client`, which it does not.
 */

import { describe, expect, it } from 'vitest';
import { THEME_MIRROR_KEY } from './theme-mirror';

/** Every non-spec source file in the package, as text. Keyed by a path relative to `src/`. */
const sources = import.meta.glob<string>('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Specs and test helpers seed and clear their own jsdom storage; that is not user data. */
function isProductionSource(path: string): boolean {
  return !path.includes('.spec.') && !path.startsWith('../test/');
}

/** `index.html`'s pre-mount script reads the same keys and must stay a reader. Not a module. */
const preMountScript = Object.values(
  import.meta.glob<string>('../../index.html', { query: '?raw', import: 'default', eager: true })
);

const WRITE_CALL = /localStorage\s*\.\s*(setItem|removeItem|clear)\b/;
/** `localStorage['setItem']` — a computed access defeats the pattern above. */
const COMPUTED_ACCESS = /localStorage\s*\[/;
/**
 * The alias escape: `const store = window.localStorage` (or a destructure, or passing it as an
 * argument) hands the object to code this spec cannot follow, and `store.setItem(…)` then looks
 * like any other method call. Reaching localStorage is only allowed to happen in place.
 */
const ALIASING =
  /(=\s*(window\s*\.\s*)?localStorage\b)|(\{[^}\n]*\blocalStorage\b[^}\n]*\}\s*=)|([(,]\s*(window\s*\.\s*)?localStorage\s*[,)])/;

function filesMatching(pattern: RegExp): { path: string; hits: string[] }[] {
  return Object.entries(sources)
    .filter(([path]) => isProductionSource(path))
    .map(([path, source]) => ({ path, hits: source.match(new RegExp(pattern.source, 'g')) ?? [] }))
    .filter(({ hits }) => hits.length > 0);
}

describe('no code path may write a localStorage key', () => {
  it('finds the sources at all, so a broken glob cannot pass this suite vacuously', () => {
    const paths = Object.keys(sources).filter(isProductionSource);
    expect(paths.length).toBeGreaterThan(20);
    expect(paths.some(path => path.endsWith('theme-mirror.ts'))).toBe(true);
    expect(paths.some(path => path.endsWith('state/tab.ts'))).toBe(true);
  });

  it('permits exactly one writer: the theme mirror', () => {
    const writers = filesMatching(WRITE_CALL);

    // Glob keys are relative to this file, so the mirror is a sibling.
    expect(writers.map(({ path }) => path)).toEqual(['./theme-mirror.ts']);
    expect(writers[0]?.hits).toEqual(['localStorage.setItem']);
  });

  it('has no removeItem and no clear anywhere', () => {
    // `tab.state.ts:465` — and Task 4's port of it — called `removeItem` on an Angular-owned key.
    // Nothing may do that again while the Angular renderer is still reading it.
    const destructive = filesMatching(/localStorage\s*\.\s*(removeItem|clear)\b/);
    expect(destructive).toEqual([]);
  });

  it('has no computed localStorage access, which would sidestep the check above', () => {
    expect(filesMatching(COMPUTED_ACCESS)).toEqual([]);
  });

  it('never aliases the storage object, which would sidestep it too', () => {
    expect(filesMatching(ALIASING)).toEqual([]);
  });

  it('keeps the pre-mount script in index.html a reader', () => {
    // It runs before any module and is the one place the mirror-then-Angular fallback is duplicated,
    // so it is outside the glob above and would otherwise never be checked at all.
    expect(preMountScript).toHaveLength(1);
    const html = preMountScript[0] ?? '';
    expect(html).toMatch(/localStorage\s*\.\s*getItem/);
    expect(html).not.toMatch(WRITE_CALL);
    expect(html).not.toMatch(COMPUTED_ACCESS);
    expect(html).not.toMatch(ALIASING);
  });

  it('writes a React-owned key, not one of the Angular six', () => {
    // The mirror's key name is the other half of the claim: one writer is only safe if what it
    // writes is ours. `legacy-local-storage.ts` owns the list of names that are not.
    expect(THEME_MIRROR_KEY.startsWith('joinery')).toBe(true);
    const quoted = (sources['./legacy-local-storage.ts'] ?? '').match(/'joinery[^']*'/g) ?? [];
    const angularKeys = new Set(quoted.map(literal => literal.slice(1, -1)));
    expect(angularKeys.size).toBeGreaterThanOrEqual(6);
    expect(angularKeys.has(THEME_MIRROR_KEY)).toBe(false);
  });
});
