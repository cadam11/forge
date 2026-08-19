/**
 * The one localStorage key the React renderer writes, and the reason it has to exist.
 *
 * ── The problem ──────────────────────────────────────────────────────────────────────────────
 *
 * Settings now live in main-process `AppState` (`renderer-state.ts`), reachable only through async
 * IPC. But the FOUC fix that Task 2 built — and that PLAN.md 0.7 requires — is a script in
 * `index.html` that runs BEFORE the bundle is requested and writes `data-theme` synchronously.
 * There is no await there. Something local and synchronous has to hold the theme preference.
 *
 * ── The two options, and why this one ────────────────────────────────────────────────────────
 *
 * The alternative was to have main inject the theme (a query parameter on the dev URL, or a
 * `contextBridge` global set before load). Rejected on two counts: it needs changes in
 * `packages/main`/`packages/preload`, which this task is forbidden to touch, and a preload-injected
 * global still is not available to a `<head>` script that runs before preload's world is
 * consulted for anything.
 *
 * So: a mirror. It is deliberately NOT the Angular `joinery-settings` key.
 *
 * Writing `joinery-settings` would mean the React renderer overwrites the Angular renderer's whole
 * settings object every time a setting changes — clobbering any change made in Angular after the
 * one-shot migration ran. A separate key that holds ONE string means the React renderer never
 * writes an Angular-owned key at all, and the coexistence rule "React reads Angular's localStorage,
 * never writes it" holds literally.
 *
 * Reads are mirror-first with the Angular key as fallback, so a user whose migration has not run
 * yet still gets their real theme on the first React launch instead of a flash of `system`. That
 * exact two-step is duplicated, in ten lines of inline ES5, in `index.html` — it must be, since it
 * runs before any module exists. The duplication is the point of the comment there.
 */

import type { ThemePreference } from '@joinery/shared';
import { diagnostics } from '../state/diagnostics';

/** React-owned. One value: `'system' | 'light' | 'dark'`, unquoted. */
export const THEME_MIRROR_KEY = 'joinery:theme-preference';

/** Angular-owned, read-only fallback. `settings.service.ts:5`. */
export const ANGULAR_SETTINGS_KEY = 'joinery-settings';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * The preference the pre-mount script would have found: the mirror, else the theme field of the
 * Angular settings object, else `'system'`.
 *
 * Never throws. Storage can be blocked outright (some Electron sandboxes, some privacy modes) and
 * a theme is not worth failing a boot over.
 */
export function readMirroredThemePreference(): ThemePreference {
  const mirrored = readKey(THEME_MIRROR_KEY);
  if (isThemePreference(mirrored)) return mirrored;

  const angular = readKey(ANGULAR_SETTINGS_KEY);
  if (angular !== null) {
    try {
      const parsed: unknown = JSON.parse(angular);
      const theme: unknown =
        typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'theme') : null;
      if (isThemePreference(theme)) return theme;
    } catch (error) {
      diagnostics.warn(
        'could not parse the Angular settings object while reading the theme',
        error
      );
    }
  }
  return 'system';
}

/** Keeps the pre-mount script's source in step. Called on every settings write and on hydration. */
export function writeMirroredThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_MIRROR_KEY, preference);
  } catch (error) {
    diagnostics.warn('could not mirror the theme preference for the pre-mount script', error);
  }
}

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    diagnostics.warn(`could not read localStorage key ${key}`, error);
    return null;
  }
}
