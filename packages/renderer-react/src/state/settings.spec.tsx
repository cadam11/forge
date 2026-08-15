/**
 * Theme resolution — the part of the settings store with no Angular counterpart to port from,
 * because `settings.service.ts` had no spec. Three states, both directions, and the two OS-theme
 * sources: Electron's `nativeTheme` over the bridge, and `matchMedia` when there is no bridge.
 *
 * `matchMedia` is stubbed rather than used: jsdom implements the interface but never fires a
 * `change` event, so a real one could not prove the "system flips while the app is open" case.
 */

import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS } from '@joinery/shared';
import { createIpcQueryClient } from '../ipc/query-provider';
import { installJoineryMock, recordSubscription, removeJoineryMock } from '../test/joinery-mock';
import { createAppStateDouble } from '../test/app-state-double';
import { createRendererStatePersistence } from '../persistence/renderer-state';
import { THEME_MIRROR_KEY } from '../persistence/theme-mirror';
import { createSettingsStore, nextThemePreference, useNativeThemeSync } from './settings';
import { setDiagnosticsSink } from './diagnostics';

/** Angular-owned, and the point of the first test below: this store must never write it. */
const ANGULAR_STORAGE_KEY = 'joinery-settings';

/** A controllable `prefers-color-scheme: dark` media query. Returns the flip handle. */
function stubMatchMedia(initialMatches: boolean): { flip: (matches: boolean) => void } {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    // Present for interface completeness; nothing under test uses them.
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }));

  return {
    flip: next => {
      matches = next;
      for (const listener of [...listeners]) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
  };
}

const themeAttribute = () => document.documentElement.getAttribute('data-theme');

function ThemeSyncProbe({ store }: { store: ReturnType<typeof createSettingsStore> }) {
  useNativeThemeSync(store);
  return null;
}

function renderSync(store: ReturnType<typeof createSettingsStore>): void {
  render(
    <QueryClientProvider client={createIpcQueryClient()}>
      <ThemeSyncProbe store={store} />
    </QueryClientProvider>
  );
}

const teardowns: (() => void)[] = [];

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  vi.unstubAllGlobals();
});

/*
 * Task 5 moved this store's persistence from `localStorage['joinery-settings']` to main-process
 * `AppState`. The round trip, the migration and the group-by-group merge are proved in
 * `src/persistence/*.spec.ts`; what belongs here is the store's half of the contract — it starts at
 * the defaults, it adopts what hydration hands it, and it writes to `AppState` and the theme mirror
 * and to nothing else.
 */
describe('settings store — persistence', () => {
  it('starts at the defaults, because AppState is only reachable asynchronously', () => {
    stubMatchMedia(true);
    window.localStorage.setItem(
      ANGULAR_STORAGE_KEY,
      JSON.stringify({ theme: 'light', editor: { fontSize: 18 } })
    );

    // Not read at construction any more — nor ever, by this store.
    expect(createSettingsStore().getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it('adopts hydrated settings, merged group by group over the defaults', () => {
    stubMatchMedia(true);
    const store = createSettingsStore();

    store.getState().hydrate({ theme: 'light', editor: { fontSize: 18 } });

    expect(store.getState().settings.theme).toBe('light');
    expect(store.getState().settings.editor.fontSize).toBe(18);
    // Merged group-by-group over the defaults, so a field the stored object omits still exists.
    expect(store.getState().settings.editor.tabSize).toBe(DEFAULT_SETTINGS.editor.tabSize);
    expect(store.getState().settings.grid).toEqual(DEFAULT_SETTINGS.grid);
    // Hydration is a read: it must not write back what it was handed.
    expect(themeAttribute()).toBe('light');
  });

  it('hydrating nothing leaves the defaults in place', () => {
    stubMatchMedia(false);
    const store = createSettingsStore();

    store.getState().hydrate(undefined);

    expect(store.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it('writes the whole settings object into AppState, under the React-owned key', async () => {
    stubMatchMedia(false);
    const bridge = createAppStateDouble();
    teardowns.push(installJoineryMock({ app: bridge.app }));
    const persistence = createRendererStatePersistence();
    const store = createSettingsStore(persistence);

    store.getState().updateGridSetting('copyFormat', 'csv');
    await persistence.read(); // flushes the store's unawaited write

    const written = bridge.snapshot().reactRendererState?.settings;
    expect(written?.grid?.copyFormat).toBe('csv');
    expect(written?.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('mirrors the theme preference for the pre-mount script, and writes no Angular key', () => {
    // The FOUC source, and the coexistence rule in one assertion: the Angular settings object is
    // byte-identical after a write that changes both the theme and an editor setting.
    stubMatchMedia(false);
    const angular = JSON.stringify({ theme: 'system', editor: { fontSize: 11 } });
    window.localStorage.setItem(ANGULAR_STORAGE_KEY, angular);
    const store = createSettingsStore();

    store.getState().updateTheme('dark');
    store.getState().updateEditorSetting('fontSize', 20);

    expect(window.localStorage.getItem(THEME_MIRROR_KEY)).toBe('dark');
    expect(window.localStorage.getItem(ANGULAR_STORAGE_KEY)).toBe(angular);
  });

  it('does not fail a settings change when there is no bridge to persist to', () => {
    stubMatchMedia(false);
    const store = createSettingsStore();

    store.getState().updateGridSetting('rowHeight', 32);

    expect(store.getState().settings.grid.rowHeight).toBe(32);
  });
});

describe('settings store — three-state theme resolution', () => {
  it('resolves an explicit preference regardless of the OS theme', () => {
    stubMatchMedia(true); // OS is dark
    const store = createSettingsStore();

    store.getState().updateTheme('light');
    expect(themeAttribute()).toBe('light');

    store.getState().updateTheme('dark');
    expect(themeAttribute()).toBe('dark');
  });

  it('resolves `system` through the native theme, and writes the resolved value', () => {
    stubMatchMedia(false); // OS is light
    const store = createSettingsStore();

    store.getState().updateTheme('system');
    // Never the literal 'system': settings.service.ts:220-231 resolves it, because
    // prefers-color-scheme is not reliable inside Electron.
    expect(themeAttribute()).toBe('light');

    store.getState().setNativeTheme('dark');
    expect(themeAttribute()).toBe('dark');
  });

  it('ignores native-theme changes while the preference is explicit', () => {
    stubMatchMedia(false);
    const store = createSettingsStore();

    store.getState().updateTheme('dark');
    store.getState().setNativeTheme('light');

    expect(store.getState().nativeTheme).toBe('light');
    expect(themeAttribute()).toBe('dark');
  });

  it('cycles dark → light → system → dark', () => {
    expect(nextThemePreference('dark')).toBe('light');
    expect(nextThemePreference('light')).toBe('system');
    expect(nextThemePreference('system')).toBe('dark');
  });
});

describe('useNativeThemeSync — Electron nativeTheme over the bridge', () => {
  it('adopts theme.getNative() on mount and theme.onChanged afterwards', async () => {
    stubMatchMedia(false);
    const onChanged = recordSubscription<'dark' | 'light'>();
    installJoineryMock({
      theme: { getNative: () => Promise.resolve('dark'), onChanged: onChanged.subscribe },
    });

    const store = createSettingsStore();
    store.getState().updateTheme('system');

    renderSync(store);

    await waitFor(() => expect(store.getState().nativeTheme).toBe('dark'));
    expect(themeAttribute()).toBe('dark');

    // The OS flips while the app is open.
    onChanged.emit('light');
    await waitFor(() => expect(themeAttribute()).toBe('light'));
  });

  it('does not install the matchMedia fallback when the bridge is present', async () => {
    // Inside Electron `nativeTheme` is authoritative; a second source would fight it.
    const media = stubMatchMedia(false);
    const onChanged = recordSubscription<'dark' | 'light'>();
    installJoineryMock({
      theme: { getNative: () => Promise.resolve('light'), onChanged: onChanged.subscribe },
    });

    const store = createSettingsStore();
    store.getState().updateTheme('system');
    renderSync(store);

    await waitFor(() => expect(onChanged.liveCount()).toBe(1));

    media.flip(true);
    expect(store.getState().nativeTheme).toBe('light');
  });
});

describe('useNativeThemeSync — browser fallback', () => {
  it('follows matchMedia when there is no bridge', async () => {
    const media = stubMatchMedia(false);
    const store = createSettingsStore();
    store.getState().updateTheme('system');

    renderSync(store);
    await waitFor(() => expect(themeAttribute()).toBe('light'));

    media.flip(true);
    await waitFor(() => expect(themeAttribute()).toBe('dark'));

    media.flip(false);
    await waitFor(() => expect(themeAttribute()).toBe('light'));
  });

  it('repairs the attribute the pre-mount script wrote, on mount', async () => {
    // index.html writes the preference verbatim before the bundle loads. The store replaces it
    // with the resolved value once it mounts — the handover PLAN.md 0.7 requires.
    stubMatchMedia(true);
    document.documentElement.setAttribute('data-theme', 'system');
    const store = createSettingsStore();
    store.getState().updateTheme('system');
    document.documentElement.setAttribute('data-theme', 'system');

    renderSync(store);

    await waitFor(() => expect(themeAttribute()).toBe('dark'));
  });
});
