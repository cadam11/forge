/**
 * The two persisted query-editor preferences, and the owner Task 5 named for them.
 *
 * In `src/state/` rather than beside the query feature that reads it, for the same reason every other
 * store is: `persistence/hydrate.ts` hydrates it, and a persistence module reaching up into a feature
 * directory would invert the layering. Conventions: `capabilities.ts`.
 *
 * `persistence/hydrate.ts` returns `confirmedCtrlEExecute` and `flywayPlaceholderValues` as
 * `HydratedRendererState` fields with a `// Task 10 (query editor)` comment on each, because the
 * surface that owns them did not exist yet. This is that surface.
 *
 * Both were localStorage keys in the Angular renderer — `joinery-ctrl-e-execute-confirmed` and
 * `joinery-flyway-placeholder-values` (PLAN.md 0.5, `query.component.ts:1538-1539`) — and Task 5's
 * one-shot migration has already lifted them into main-process `AppState`. So this store **reads
 * through the hydrated state and writes through `rendererStatePersistence`**, and touches
 * `localStorage` nowhere: `persistence/no-local-storage-writes.spec.ts` permits exactly one `setItem`
 * in this package and it belongs to the theme mirror.
 *
 * ── Why a store and not a hook over `HydratedRendererState` ─────────────────────────────────
 *
 * The ⌃E flag is *written* by a dialog and *read* by every query tab, so a value threaded down from
 * the boot result would be stale in every tab but the one that changed it. The placeholder values are
 * the same shape: prompted for in one tab, remembered for all of them. One store, hydrated once.
 */

import { create } from 'zustand';
// The leaf persistence module, never the `persistence/` barrel — see the note in that barrel.
import {
  rendererStatePersistence,
  type RendererStatePersistence,
} from '../persistence/renderer-state';

export interface EditorPrefsState {
  /** The user ticked "Don't ask me again" on the ⌃E confirmation. */
  readonly confirmedCtrlEExecute: boolean;
  /** Remembered `${placeholder}` substitutions, keyed by placeholder name. */
  readonly flywayPlaceholderValues: Readonly<Record<string, string>>;
  /** Whether `hydrate` has run. Until it has, nothing may be persisted — see `hydrate`. */
  readonly hydrated: boolean;

  /**
   * Adopts the persisted values. Called once, from the shell's startup path, with the two fields
   * `hydrateRendererState()` returns.
   *
   * Until this runs the store's defaults are indistinguishable from "the user has never confirmed
   * ⌃E", which is the safe default (the dialog appears) — but a WRITE before hydration would
   * overwrite a real persisted value with a default, so `persist` refuses until this has run. Same
   * gate, and the same reason, as `state/settings.ts`'s `writesUnlocked`.
   */
  readonly hydrate: (values: {
    readonly confirmedCtrlEExecute: boolean;
    readonly flywayPlaceholderValues: Readonly<Record<string, string>>;
  }) => void;

  /** Records the "don't ask me again" tick. Idempotent. */
  readonly confirmCtrlEExecute: () => void;
  /**
   * Re-arms the ⌃E confirmation, so the next ⌃E shows the gate again. Idempotent.
   *
   * The settings panel's consumer (Task 15). The tick is one-way from the dialog — the dialog has no
   * "ask me again" — so without this the only way back is editing `AppState` by hand, which is what a
   * setting is for. Guarded on the current value so a user who has never confirmed cannot write a
   * `false` that already is false into `AppState`.
   */
  readonly resetCtrlEExecuteConfirmation: () => void;
  /** Merges the values a placeholder prompt collected over whatever was remembered before. */
  readonly rememberPlaceholderValues: (values: Readonly<Record<string, string>>) => void;
}

export type EditorPrefsStore = ReturnType<typeof createEditorPrefsStore>;

export function createEditorPrefsStore(
  persistence: RendererStatePersistence = rendererStatePersistence
) {
  return create<EditorPrefsState>()((set, get) => {
    /**
     * Fire-and-forget, like every other renderer-state write: the UI must not wait on IPC to close a
     * dialog, and `update()` serializes concurrent writes and reports its own failures.
     */
    const persist = (mutate: Parameters<RendererStatePersistence['update']>[0]): void => {
      if (!get().hydrated) return;
      void persistence.update(mutate);
    };

    return {
      confirmedCtrlEExecute: false,
      flywayPlaceholderValues: {},
      hydrated: false,

      hydrate: values =>
        set({
          confirmedCtrlEExecute: values.confirmedCtrlEExecute,
          flywayPlaceholderValues: values.flywayPlaceholderValues,
          hydrated: true,
        }),

      confirmCtrlEExecute: () => {
        if (get().confirmedCtrlEExecute) return;
        set({ confirmedCtrlEExecute: true });
        persist(current =>
          current.confirmedCtrlEExecute === true
            ? undefined
            : { ...current, confirmedCtrlEExecute: true }
        );
      },

      resetCtrlEExecuteConfirmation: () => {
        if (!get().confirmedCtrlEExecute) return;
        set({ confirmedCtrlEExecute: false });
        persist(current =>
          current.confirmedCtrlEExecute === false
            ? undefined
            : { ...current, confirmedCtrlEExecute: false }
        );
      },

      rememberPlaceholderValues: values => {
        // Merge, never replace: a query with one placeholder must not forget the other nine a
        // different query taught it. Verbatim from `:1731` (`{ ...remembered, ...values }`).
        const merged = { ...get().flywayPlaceholderValues, ...values };
        set({ flywayPlaceholderValues: merged });
        persist(current => ({ ...current, flywayPlaceholderValues: merged }));
      },
    };
  });
}

export const editorPrefsStore = createEditorPrefsStore();
export const useEditorPrefsStore = editorPrefsStore;

export function selectConfirmedCtrlEExecute(
  state: Pick<EditorPrefsState, 'confirmedCtrlEExecute'>
): boolean {
  return state.confirmedCtrlEExecute;
}
