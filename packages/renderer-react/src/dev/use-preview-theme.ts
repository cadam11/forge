/**
 * The three-state theme control, minimal edition.
 *
 * Deliberately local to src/dev/: Task 4 owns the real `settings` store (theme
 * resolution plus the Electron `nativeTheme` IPC). This hook exists so the token preview
 * page can prove both themes render and that the pre-mount writer in index.html actually
 * survives a reload — nothing else should import it.
 *
 * Task 5 changed where it persists to. It used to write the theme field of the Angular
 * `joinery-settings` object; it now writes only the React-owned mirror key, because a dev
 * preview page must not be able to overwrite a user's Angular settings. Reads still fall
 * back to the Angular key, exactly as the pre-mount script and the real store do.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  readMirroredThemePreference,
  writeMirroredThemePreference,
} from '../persistence/theme-mirror';

const THEME_ATTRIBUTE = 'data-theme';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

/** Mirrors the inline reader in index.html — mirror key first, Angular settings as fallback. */
export function readPersistedTheme(): ThemePreference {
  return readMirroredThemePreference();
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
    writeMirroredThemePreference(next);
    setPreferenceState(next);
  }, []);

  return { preference, resolved: resolve(preference, prefersDark), setPreference };
}
