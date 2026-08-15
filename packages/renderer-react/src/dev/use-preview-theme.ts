/**
 * The three-state theme control, minimal edition.
 *
 * Deliberately local to src/dev/: Task 4 owns the real `settings` store (theme
 * resolution plus the Electron `nativeTheme` IPC) and Task 5 owns the localStorage
 * migration. This hook exists so the token preview page can prove both themes render
 * and that the pre-mount writer in index.html actually survives a reload — nothing
 * else should import it.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'joinery-settings';
const THEME_ATTRIBUTE = 'data-theme';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** Mirrors the inline reader in index.html — same key, same field, same fallback. */
export function readPersistedTheme(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const stored: unknown = raw === null ? null : JSON.parse(raw).theme;
    if (isThemePreference(stored)) return stored;
  } catch (error) {
    // Dev-only surface; Task 7 brings the real logging bridge. Silence here would hide
    // corrupt persisted settings entirely.
    // eslint-disable-next-line no-console
    console.warn('[joinery] could not read the persisted theme:', error);
  }
  return 'system';
}

/** Writes the theme field without disturbing the rest of the persisted settings. */
function persistTheme(preference: ThemePreference): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const existing: unknown = raw === null ? {} : JSON.parse(raw);
    const settings = typeof existing === 'object' && existing !== null ? existing : {};
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, theme: preference }));
  } catch (error) {
    // See above.
    // eslint-disable-next-line no-console
    console.warn('[joinery] could not persist the theme:', error);
  }
}

function resolve(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

export interface PreviewTheme {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly setPreference: (next: ThemePreference) => void;
}

export function usePreviewTheme(): PreviewTheme {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPersistedTheme);
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  // The variants in theme.css read prefers-color-scheme themselves, so this listener is
  // only here to keep the *measured* contrast table in step with a live OS switch.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => setPrefersDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Idempotent backstop for mount and for a re-mount without index.html's inline writer
  // (jsdom). The authoritative write is the synchronous one in setPreference below:
  // effects run child-first, so anything reading resolved token values in its own effect
  // would otherwise see the previous theme for one frame.
  useEffect(() => {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, preference);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference): void => {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, next);
    persistTheme(next);
    setPreferenceState(next);
  }, []);

  return { preference, resolved: resolve(preference, prefersDark), setPreference };
}
