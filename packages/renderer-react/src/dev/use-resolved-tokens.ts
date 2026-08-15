import { useEffect, useMemo } from 'react';

import { readToken } from './contrast';

export interface ResolvedTokens {
  readonly values: Readonly<Record<string, string>>;
  /** Tokens the stylesheet never registered. Empty in a healthy build. */
  readonly missing: readonly string[];
  /** The theme these values were read under. */
  readonly theme: string;
}

/**
 * Reads a fixed list of theme variables off `<html>`, re-reading whenever the resolved
 * theme changes. One read for the whole page instead of one per swatch.
 *
 * Computed during render rather than in an effect: `getComputedStyle` is an idempotent
 * read of a DOM node that exists before React mounts, and `data-theme` is written
 * synchronously by the theme control, so the render that reacts to a theme change already
 * sees the new values. An effect would run child-first and read the previous theme.
 *
 * `names` must be a stable (module-level) array — it is a memo dependency.
 */
export function useResolvedTokens(names: readonly string[], themeKey: string): ResolvedTokens {
  const resolved = useMemo<ResolvedTokens>(() => {
    const root = document.documentElement;
    const values: Record<string, string> = {};
    const missing: string[] = [];
    for (const name of names) {
      try {
        values[name] = readToken(name, root);
      } catch {
        missing.push(name);
      }
    }
    // themeKey is carried through rather than merely depended on: it is the invalidation
    // key for a DOM read the linter cannot see, and reporting which theme produced the
    // values is what makes a stale read visible instead of silent.
    return { values, missing, theme: themeKey };
  }, [names, themeKey]);

  // Nothing resolving at all means no stylesheet is attached — jsdom, or a build that
  // dropped theme.css — and there is nothing useful to say. Some resolving and some not
  // is the interesting case: a token theme.css failed to register, which must not pass
  // quietly.
  const partial = resolved.missing.length > 0 && Object.keys(resolved.values).length > 0;
  useEffect(() => {
    if (!partial) return;
    // eslint-disable-next-line no-console
    console.error('[joinery] theme variables are not registered:', resolved.missing.join(', '));
  }, [partial, resolved.missing]);

  return resolved;
}
