/**
 * App settings, and with them the theme: the three-state preference, its resolution against the
 * OS, and the `[data-theme]` attribute the whole stylesheet keys off.
 *
 * Replaces two Angular files. `settings.service.ts` (232) is the port; `theme.service.ts` (31) is
 * dropped rather than ported — PLAN.md §1.6 found it has zero external references and every
 * consumer already used `SettingsService` directly, so its only real contribution was the
 * three-state cycle order, which survives as `nextThemePreference` below.
 *
 * ── Persistence (Task 5 moved this; Task 4's version read localStorage directly) ────────────
 *
 * Settings live in main-process `AppState`, under the one key the React renderer owns
 * (`persistence/renderer-state.ts`). This store no longer reads or writes `joinery-settings` at
 * all: it starts at `DEFAULT_SETTINGS` — bar the theme, which is seeded from the React-owned mirror
 * so the pre-mount paint is not undone (see the initial state below) — and `hydrate()`, called once
 * from `persistence/hydrate.ts` after the one-shot localStorage migration, merges the persisted
 * object over the defaults group by group, exactly as `settings.service.ts:127-145` did.
 *
 * `hydrate()` also decides whether the write path is open at all: writing a DEFAULT-derived settings
 * object into `AppState` before the migration has settled would permanently poison the migration's
 * precedence rule. `SettingsHydration.persistWrites` documents that failure in full.
 *
 * Not writing `joinery-settings` is a coexistence rule, not an aesthetic one. The Angular renderer
 * is still shipping and still owns that key; if this store wrote it, a settings change made here
 * would clobber a settings change made there after the migration ran. React reads Angular's
 * localStorage (once, in the migration) and never writes it.
 *
 * ── Three side effects, on purpose ───────────────────────────────────────────────────────────
 *
 * A settings write (a) mirrors the theme preference to one small React-owned localStorage key for
 * the pre-mount FOUC script, (b) writes `[data-theme]` on `<html>`, and (c) fires an async write to
 * `AppState`. (a) and (b) are synchronous inside the action rather than in a subscriber effect,
 * because effects run after commit: a component that measures a resolved token value in its own
 * effect would otherwise read the previous theme for one frame. That is the flash the pre-mount
 * script exists to eliminate, and re-introducing it one layer down would be silly. (c) cannot be
 * synchronous — it is IPC — which is exactly why (a) exists; see `persistence/theme-mirror.ts` for
 * the full argument and the rejected alternative.
 *
 * ── What is written, and how it meets the pre-mount script ──────────────────────────────────
 *
 * The DOM gets the RESOLVED theme (`dark` | `light`), never the literal `system`, which is what
 * `settings.service.ts:220-231` did and for the reason documented there: `prefers-color-scheme`
 * is not reliable inside Electron, so `system` is resolved through `nativeTheme` over IPC instead.
 * `index.html` writes the *preference* verbatim before the bundle loads (so `data-theme="system"`
 * paints the right canvas via the media query), and this store replaces it with the resolved value
 * on mount. `theme.css` honours both spellings deliberately, so the handover is not a flash.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '@joinery/shared';
import type { AppSettings, ThemePreference } from '@joinery/shared';
import { isIpcAvailable, useIpcEvent, useIpcQuery } from '../ipc';
// The leaf persistence modules, never the `persistence/` barrel — see the note in that barrel.
import {
  rendererStatePersistence,
  type PersistedSettings,
  type RendererStatePersistence,
} from '../persistence/renderer-state';
import {
  readMirroredThemePreference,
  writeMirroredThemePreference,
} from '../persistence/theme-mirror';
import { diagnostics } from './diagnostics';

const THEME_ATTRIBUTE = 'data-theme';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export type ResolvedTheme = 'dark' | 'light';

/**
 * Merges a persisted settings object over the defaults, group by group, so an object written by an
 * older version — or with a group missing entirely, or with a group replaced by a non-object by a
 * hand edit — still yields every field. Exported because `hydrate()` is not the only future caller:
 * a settings import/export surface needs the identical merge.
 */
export function mergePersistedSettings(persisted: PersistedSettings | undefined): AppSettings {
  if (!persisted) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...persisted,
    editor: { ...DEFAULT_SETTINGS.editor, ...persisted.editor },
    query: { ...DEFAULT_SETTINGS.query, ...persisted.query },
    grid: { ...DEFAULT_SETTINGS.grid, ...persisted.grid },
  };
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

/**
 * What `hydrate()` is handed. Two fields, because adopting the persisted values and *unlocking the
 * write path* are different decisions and only the caller knows the second one.
 */
export interface SettingsHydration {
  /** The persisted settings, or `undefined` for "there are none" / "they could not be read". */
  readonly settings: PersistedSettings | undefined;
  /**
   * Whether this store may write to `AppState` from now on.
   *
   * FALSE when the localStorage migration has not settled — it failed, or there is no bridge. This
   * is not caution for its own sake; it closes a permanent, silent data loss. `migration.ts` only
   * ever runs once, and a `settings` object sitting in `AppState` when it runs is treated as newer
   * than the localStorage copy for every field it mentions. So: boot 1 migration fails → the user
   * nudges any setting → a DEFAULT-derived settings object lands in `AppState` → boot 2's migration
   * sees it, sets the marker, and the user's real Angular settings are never lifted and never can
   * be. Locking the write path until the migration has had its turn is the fix at the source.
   */
  readonly persistWrites: boolean;
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

  /**
   * Adopts the persisted settings and decides whether the write path is open. Called once, from
   * `persistence/hydrate.ts`, after the one-shot localStorage migration. Idempotent, and it does NOT
   * write back to `AppState` — hydration is a read.
   */
  readonly hydrate: (hydration: SettingsHydration) => void;

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

export function createSettingsStore(
  persistence: RendererStatePersistence = rendererStatePersistence
) {
  return create<SettingsStoreState>()((set, get) => {
    /**
     * Whether `AppState` writes are allowed yet. Closed until `hydrate()` opens it — see
     * `SettingsHydration.persistWrites` for the data loss that shuts. A closure variable rather than
     * store state: nothing renders it, and no component may flip it.
     */
    let writesUnlocked = false;

    /**
     * The one write path. Mirror the theme (synchronous, for the next boot's pre-mount script),
     * set the state, re-apply the attribute, then persist to `AppState` (async, error-logged
     * inside the persistence layer). One place, so no caller can forget a step.
     *
     * The `AppState` write is fire-and-forget by design: a settings change must land in the UI on
     * the same tick, and `update()` already serializes concurrent writes and reports its own
     * failures. `void` rather than a floating promise so that is legible at the call site.
     */
    const commit = (settings: AppSettings): void => {
      writeMirroredThemePreference(settings.theme);
      set({ settings });
      applyThemeAttribute(resolveTheme(settings.theme, get().nativeTheme));

      if (!writesUnlocked) {
        // Never silent. The change is live in the UI and in the theme mirror; it is only the
        // `AppState` write that is withheld, and hydration is about to replace this object anyway.
        diagnostics.warn('settings changed before hydration; not persisting to AppState', {
          reason:
            'the localStorage migration has not settled — see SettingsHydration.persistWrites',
        });
        return;
      }
      void persistence.update(current => ({ ...current, settings }));
    };

    return {
      // Not the persisted settings: `AppState` is only reachable over async IPC, so the store cannot
      // be constructed from it, and `hydrate()` replaces this a tick later.
      //
      // The theme is the one field that cannot wait for that tick. `useNativeThemeSync` applies the
      // resolved theme on mount, so a store that started at the DEFAULT `system` would paint the OS
      // theme over the preference `index.html` had already resolved — light → dark → light for a
      // light-preferring user on a dark OS, which is the exact flash the pre-mount script exists to
      // kill. So the initial theme comes from the same synchronous source that script reads: the
      // React-owned mirror, falling back to Angular's settings object. Read-only, and the only
      // localStorage this store touches.
      settings: { ...DEFAULT_SETTINGS, theme: readMirroredThemePreference() },
      nativeTheme: detectInitialNativeTheme(),
      isOpen: false,

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set(state => ({ isOpen: !state.isOpen })),

      /**
       * Not `commit`: hydration must not write back what it just read. It still mirrors the theme
       * and applies the attribute, so a user whose preference came from the migration gets a
       * flash-free *next* boot without having to touch the settings panel first.
       */
      hydrate: ({ settings: persisted, persistWrites }) => {
        writesUnlocked = persistWrites;
        // No persisted object means either a fresh install or a read that failed, and this cannot
        // tell them apart — so the theme already in the store (seeded from the mirror) is kept
        // rather than stamped back to `system`. On a genuine fresh install those are the same value.
        const settings = mergePersistedSettings(persisted ?? { theme: get().settings.theme });
        writeMirroredThemePreference(settings.theme);
        set({ settings });
        applyThemeAttribute(resolveTheme(settings.theme, get().nativeTheme));
      },

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
