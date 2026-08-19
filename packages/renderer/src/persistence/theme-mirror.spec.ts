/**
 * The FOUC mirror, after the Task 24 ruling (PLAN.md §3.1): the mirror STAYS — `index.html`'s
 * pre-mount script has no other synchronous source for the theme — and its `joinery-settings`
 * fallback is GONE, because the migration now deletes that key once it has lifted it.
 *
 * The two things worth asserting are therefore:
 *
 * - a read consults exactly one key, ours, and answers `system` for everything else;
 * - a write touches exactly one key, ours. This module is still the only `setItem` in the renderer
 *   (`no-local-storage-writes.spec.ts` is the structural half of that claim).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDiagnosticsSink } from '../state/diagnostics';
import { LEGACY_KEYS } from './legacy-local-storage';
import {
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
  it('reads the mirror', () => {
    window.localStorage.setItem(THEME_MIRROR_KEY, 'dark');

    expect(readMirroredThemePreference()).toBe('dark');
  });

  it('no longer falls back to the Angular settings object', () => {
    // The dropped fallback, asserted rather than described. A profile mid-migration reads `system`
    // for exactly one boot; `state/settings.ts`'s `hydrate` writes the mirror from the lifted
    // settings on that same boot, so every launch after it is flash-free.
    window.localStorage.setItem(LEGACY_KEYS.settings, JSON.stringify({ theme: 'light' }));

    expect(readMirroredThemePreference()).toBe('system');
  });

  it('answers `system` for nothing, junk and an unknown value', () => {
    expect(readMirroredThemePreference()).toBe('system');

    window.localStorage.setItem(THEME_MIRROR_KEY, 'chartreuse');
    expect(readMirroredThemePreference()).toBe('system');

    window.localStorage.setItem(THEME_MIRROR_KEY, '{not json');
    expect(readMirroredThemePreference()).toBe('system');
  });

  it('writes only its own key, and never an Angular one', () => {
    const angular = JSON.stringify({ theme: 'light', editor: { fontSize: 18 } });
    window.localStorage.setItem(LEGACY_KEYS.settings, angular);

    writeMirroredThemePreference('dark');

    expect(window.localStorage.getItem(THEME_MIRROR_KEY)).toBe('dark');
    expect(window.localStorage.getItem(LEGACY_KEYS.settings)).toBe(angular);
  });
});
