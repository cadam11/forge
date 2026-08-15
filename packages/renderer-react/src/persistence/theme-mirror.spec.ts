/**
 * The FOUC mirror. Two assertions carry the whole decision:
 *
 * - reads are mirror-first with the Angular settings object as fallback, so the first React launch
 *   after a migration is not a flash of the wrong theme;
 * - writes never touch `joinery-settings`. That is the non-destructiveness rule at its narrowest
 *   point: this is the only module in the renderer that writes localStorage at all.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDiagnosticsSink } from '../state/diagnostics';
import {
  ANGULAR_SETTINGS_KEY,
  readMirroredThemePreference,
  THEME_MIRROR_KEY,
  writeMirroredThemePreference,
} from './theme-mirror';

const teardowns: (() => void)[] = [];

beforeEach(() => {
  window.localStorage.clear();
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  window.localStorage.clear();
});

describe('theme mirror', () => {
  it('prefers the mirror', () => {
    window.localStorage.setItem(THEME_MIRROR_KEY, 'dark');
    window.localStorage.setItem(ANGULAR_SETTINGS_KEY, JSON.stringify({ theme: 'light' }));

    expect(readMirroredThemePreference()).toBe('dark');
  });

  it('falls back to the Angular settings object when the mirror is not there yet', () => {
    // The first React launch for a user who has been running Angular: the migration has not run,
    // so the mirror does not exist, and the pre-mount script must still get `light`.
    window.localStorage.setItem(ANGULAR_SETTINGS_KEY, JSON.stringify({ theme: 'light' }));

    expect(readMirroredThemePreference()).toBe('light');
  });

  it('answers `system` for nothing, junk, corrupt JSON and an unknown value', () => {
    expect(readMirroredThemePreference()).toBe('system');

    window.localStorage.setItem(THEME_MIRROR_KEY, 'chartreuse');
    expect(readMirroredThemePreference()).toBe('system');

    window.localStorage.setItem(ANGULAR_SETTINGS_KEY, '{not json');
    expect(readMirroredThemePreference()).toBe('system');

    window.localStorage.setItem(ANGULAR_SETTINGS_KEY, JSON.stringify({ theme: 'neon' }));
    expect(readMirroredThemePreference()).toBe('system');
  });

  it('writes only its own key, and never the Angular one', () => {
    const angular = JSON.stringify({ theme: 'light', editor: { fontSize: 18 } });
    window.localStorage.setItem(ANGULAR_SETTINGS_KEY, angular);

    writeMirroredThemePreference('dark');

    expect(window.localStorage.getItem(THEME_MIRROR_KEY)).toBe('dark');
    expect(window.localStorage.getItem(ANGULAR_SETTINGS_KEY)).toBe(angular);
  });
});
