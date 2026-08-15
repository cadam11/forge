/**
 * App settings, and with them the theme: the three-state preference, its resolution against the
 * OS, and the `[data-theme]` attribute the whole stylesheet keys off.
 *
 * Replaces two Angular files. `settings.service.ts` (232) is the port; `theme.service.ts` (31) is
 * dropped rather than ported — PLAN.md §1.6 found it has zero external references and every
 * consumer already used `SettingsService` directly, so its only real contribution was the
 * three-state cycle order, which survives as `nextThemePreference` below.
 *
 * ── Persistence (Task 5 owns migration; this reads what Angular writes) ─────────────────────
 *
 * One key, `joinery-settings`, holding the whole `AppSettings` object, merged over
 * `DEFAULT_SETTINGS` group by group on read exactly as `settings.service.ts:127-145` did. Same
 * key, same shape, same merge — a user moving between the two renderers keeps their settings, and
 * `index.html`'s pre-mount script reads the same `.theme` field.
 *
 * ── Two side effects, on purpose ─────────────────────────────────────────────────────────────
 *
 * Writing settings writes localStorage, and changing the resolved theme writes `[data-theme]` on
 * `<html>`. Both happen synchronously inside the action rather than in a subscriber effect,
 * because effects run after commit: a component that measures a resolved token value in its own
 * effect would otherwise read the previous theme for one frame. That is the flash the pre-mount
 * script exists to eliminate, and re-introducing it one layer down would be silly.
 *
 * ── What is written, and how it meets the pre-mount script ──────────────────────────────────
 *
 * This store writes the RESOLVED theme (`dark` | `light`), never the literal `system`, which is
 * what `settings.service.ts:220-231` did and for the reason documented there: `prefers-color-scheme`
 * is not reliable inside Electron, so `system` is resolved through `nativeTheme` over IPC instead.
 * `index.html` writes the preference verbatim before the bundle loads (so `data-theme="system"`
 * paints the right canvas via the media query), and this store replaces it with the resolved value
 * on mount. `theme.css` honours both spellings deliberately, so the handover is not a flash.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '@joinery/shared';
import type { AppSettings, ThemePreference } from '@joinery/shared';
import { isIpcAvailable, useIpcEvent, useIpcQuery } from '../ipc';
import { diagnostics } from './diagnostics';

/** PLAN.md 0.5's first localStorage key, and the one the pre-mount script reads. */
const STORAGE_KEY = 'joinery-settings';
const THEME_ATTRIBUTE = 'data-theme';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export type ResolvedTheme = 'dark' | 'light';

function loadSettings(): AppSettings {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppSettings>;
      // Group-by-group merge so a settings object written by an older version — or with a group
      // missing entirely — still yields every field.
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        editor: { ...DEFAULT_SETTINGS.editor, ...parsed.editor },
        query: { ...DEFAULT_SETTINGS.query, ...parsed.query },
        grid: { ...DEFAULT_SETTINGS.grid, ...parsed.grid },
      };
    }
  } catch (error) {
    diagnostics.error('failed to load settings', error);
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: AppSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    diagnostics.error('failed to save settings', error);
  }
}

/**
 * The synchronous OS-theme guess used to initialize the store. Electron's `nativeTheme` is
 * authoritative and corrects this over IPC a tick later; `matchMedia` is what is available
 * before then, and it is the only source at all in a plain browser tab.
 */
function detectInitialNativeTheme(): ResolvedTheme {
  if (typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(
  preference: ThemePreference,
  nativeTheme: ResolvedTheme
): ResolvedTheme {
  return preference === 'system' ? nativeTheme : preference;
}

/** The cycle order the dropped `ThemeService.toggle()` defined: dark → light → system → dark. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  if (current === 'dark') return 'light';
  if (current === 'light') return 'system';
  return 'dark';
}

/** The single writer of `[data-theme]` in the app. Exported so tests can assert on it. */
export function applyThemeAttribute(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute(THEME_ATTRIBUTE, resolved);
}

export interface SettingsStoreState {
  readonly settings: AppSettings;
  /** The OS theme as reported by Electron's `nativeTheme`, or by `matchMedia` outside Electron. */
  readonly nativeTheme: ResolvedTheme;
  /** Whether the settings panel is showing. */
  readonly isOpen: boolean;

  readonly open: () => void;
  readonly close: () => void;
  readonly toggle: () => void;

  readonly updateSettings: (partial: Partial<AppSettings>) => void;
  readonly updateTheme: (theme: ThemePreference) => void;
  readonly cycleTheme: () => void;
  readonly updateEditorSetting: <K extends keyof AppSettings['editor']>(
    key: K,
    value: AppSettings['editor'][K]
  ) => void;
  readonly updateQuerySetting: <K extends keyof AppSettings['query']>(
    key: K,
    value: AppSettings['query'][K]
  ) => void;
  readonly updateGridSetting: <K extends keyof AppSettings['grid']>(
    key: K,
    value: AppSettings['grid'][K]
  ) => void;
  readonly resetToDefaults: () => void;

  /** Called by `useNativeThemeSync` when the OS theme changes. */
  readonly setNativeTheme: (nativeTheme: ResolvedTheme) => void;
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;

export function createSettingsStore() {
  return create<SettingsStoreState>()((set, get) => {
    /** Persist, then re-apply the attribute. One place, so no write path can forget either. */
    const commit = (settings: AppSettings): void => {
      saveSettings(settings);
      set({ settings });
      applyThemeAttribute(resolveTheme(settings.theme, get().nativeTheme));
    };

    return {
      settings: loadSettings(),
      nativeTheme: detectInitialNativeTheme(),
      isOpen: false,

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set(state => ({ isOpen: !state.isOpen })),

      /**
       * One deliberate divergence from the Angular original: it re-applied the theme only from
       * `updateTheme`, so `updateSettings({ theme })` persisted a preference the DOM never
       * adopted. No caller did that, so nothing depended on the gap; closing it here means every
       * write path is correct rather than only the one the settings panel happens to use.
       */
      updateSettings: partial => commit({ ...get().settings, ...partial }),

      updateTheme: theme => commit({ ...get().settings, theme }),
      cycleTheme: () => get().updateTheme(nextThemePreference(get().settings.theme)),

      updateEditorSetting: (key, value) =>
        commit({ ...get().settings, editor: { ...get().settings.editor, [key]: value } }),
      updateQuerySetting: (key, value) =>
        commit({ ...get().settings, query: { ...get().settings.query, [key]: value } }),
      updateGridSetting: (key, value) =>
        commit({ ...get().settings, grid: { ...get().settings.grid, [key]: value } }),

      resetToDefaults: () => commit(DEFAULT_SETTINGS),

      setNativeTheme: nativeTheme => {
        if (get().nativeTheme === nativeTheme) return;
        set({ nativeTheme });
        // Only the `system` preference follows the OS, but re-applying unconditionally is both
        // correct and idempotent, and it repairs the attribute if anything else clobbered it.
        applyThemeAttribute(resolveTheme(get().settings.theme, nativeTheme));
      },
    };
  });
}

export const settingsStore = createSettingsStore();
export const useSettingsStore = settingsStore;

export function selectTheme(state: Pick<SettingsStoreState, 'settings'>): ThemePreference {
  return state.settings.theme;
}

export function selectEffectiveTheme(
  state: Pick<SettingsStoreState, 'settings' | 'nativeTheme'>
): ResolvedTheme {
  return resolveTheme(state.settings.theme, state.nativeTheme);
}

export function selectEditorSettings(
  state: Pick<SettingsStoreState, 'settings'>
): AppSettings['editor'] {
  return state.settings.editor;
}

export function selectQuerySettings(
  state: Pick<SettingsStoreState, 'settings'>
): AppSettings['query'] {
  return state.settings.query;
}

export function selectGridSettings(
  state: Pick<SettingsStoreState, 'settings'>
): AppSettings['grid'] {
  return state.settings.grid;
}

/**
 * Feeds the OS theme into a settings store, and is the store's only contact with the bridge.
 *
 * The source adapter is a hook rather than an imperative initializer so it can use the Task 3
 * layer as designed: `useIpcQuery` for the initial `theme.getNative()` and `useIpcEvent` for
 * `theme.onChanged`, which brings the availability guard, the StrictMode-safe teardown and the
 * pre-paint handler ref with it. The store itself stays free of IPC, which is what makes its
 * resolution logic testable without a bridge at all.
 *
 * Mount it exactly once, from the app root (Task 7).
 */
export function useNativeThemeSync(store: SettingsStore = settingsStore): void {
  const setNativeTheme = store(state => state.setNativeTheme);
  const bridgeAvailable = isIpcAvailable();

  const native = useIpcQuery({
    namespace: 'theme',
    operation: 'getNative',
    enabled: bridgeAvailable,
  });

  // Angular applied the attribute from the service constructor; the equivalent here is mount,
  // because a module-scope DOM write on import is a side effect nothing asked for. Idempotent:
  // `index.html` has already written the preference verbatim, and this replaces it with the
  // resolved value. Every later change goes through the store's own write path.
  useEffect(() => {
    applyThemeAttribute(selectEffectiveTheme(store.getState()));
  }, [store]);

  useEffect(() => {
    if (native.data) setNativeTheme(native.data);
  }, [native.data, setNativeTheme]);

  useIpcEvent('theme', 'onChanged', setNativeTheme);

  // The browser-mode fallback. Inside Electron `nativeTheme` is authoritative — PLAN.md 0.7 and
  // settings.service.ts:216-218 both note that `prefers-color-scheme` cannot be trusted there — so
  // this listener is deliberately not installed when the bridge exists.
  useEffect(() => {
    if (bridgeAvailable || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DARK_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent): void =>
      setNativeTheme(event.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [bridgeAvailable, setNativeTheme]);
}
