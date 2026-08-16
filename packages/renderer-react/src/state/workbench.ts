/**
 * The shell's own geometry: how wide the sidebar is, whether it is collapsed, and how wide the
 * chat side panel is. Conventions: `capabilities.ts`.
 *
 * These three values are the ones the Angular shell kept in component signals and wrote to
 * `AppState` by hand (`shell.component.ts:425-448`), which is why they were the only shell
 * state that survived a restart. They live in a store here for two reasons: the native-menu
 * bridge toggles the sidebar without owning the component that renders it, and the boot
 * sequence has to hydrate them before the shell paints or the sidebar visibly jumps from 280px
 * to its saved width on first frame.
 *
 * ── Which `AppState` fields, and why not the React sub-object ─────────────────────────────
 *
 * `sidebarWidth`, `sidebarCollapsed` and `chatPanelWidth` are TOP-LEVEL `AppState` fields that
 * already exist and that the Angular renderer reads and writes today (PLAN.md §1.7). So this
 * store writes them where they already live rather than shadowing them under
 * `reactRendererState` — during coexistence a user who resizes the sidebar in one renderer
 * should find it resized in the other. `app.setState` is a shallow top-level merge, so writing
 * these three cannot disturb the React sub-object sitting beside them.
 *
 * ── The write path ────────────────────────────────────────────────────────────────────────
 *
 * Writes are debounced, because the drag handler runs per pointer-move frame and every write is
 * an IPC call ending in a synchronous `electron-store` write on the main thread. The Angular
 * original avoided that by writing only on mouse-up, which is the same idea implemented at the
 * call site — and therefore forgettable at the next call site. Here it is the store's property.
 *
 * Nothing gates these writes on hydration, unlike tabs and layout (see `state/tab.ts`), and the
 * asymmetry is deliberate: the worst case here is a saved sidebar width being overwritten with
 * the default, whereas an early tab write destroys the user's unsaved SQL. Hydration still
 * happens before the shell paints, and every write path is a user gesture that cannot fire
 * before then.
 */

import { create } from 'zustand';
import { ipc, isIpcAvailable } from '../ipc';
import { diagnostics } from './diagnostics';

/** PROPOSAL §2.4 has no opinion on these; they are the Angular values (`shell.component.ts:23-25`). */
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 500;
export const SIDEBAR_DEFAULT_WIDTH = 280;

export const CHAT_PANEL_MIN_WIDTH = 280;
export const CHAT_PANEL_MAX_WIDTH = 640;
export const CHAT_PANEL_DEFAULT_WIDTH = 360;

/** One frame is 16ms; 250 collapses a whole drag into one write without feeling lossy. */
const SAVE_DEBOUNCE_MS = 250;

/** Keeps a hand-edited or stale persisted value from producing an unusable shell. */
export function clampWidth(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export interface WorkbenchState {
  readonly sidebarWidth: number;
  readonly sidebarCollapsed: boolean;
  readonly chatPanelWidth: number;

  /** Reads the three fields out of `AppState`. Called once, from the boot sequence. */
  readonly hydrate: () => Promise<void>;

  readonly setSidebarWidth: (width: number) => void;
  readonly resetSidebarWidth: () => void;
  readonly toggleSidebar: () => void;
  readonly setSidebarCollapsed: (collapsed: boolean) => void;
  readonly setChatPanelWidth: (width: number) => void;
}

export type WorkbenchStore = ReturnType<typeof createWorkbenchStore>;

export function createWorkbenchStore() {
  // A debounce handle is a resource, not state — the same call the tab store makes.
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  return create<WorkbenchState>()((set, get) => {
    const persist = (): void => {
      if (!isIpcAvailable()) return;
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        saveTimeout = null;
        void ipc()
          .app.setState({
            sidebarWidth: get().sidebarWidth,
            sidebarCollapsed: get().sidebarCollapsed,
            chatPanelWidth: get().chatPanelWidth,
          })
          .catch((error: unknown) => diagnostics.error('failed to persist shell geometry', error));
      }, SAVE_DEBOUNCE_MS);
    };

    return {
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      sidebarCollapsed: false,
      chatPanelWidth: CHAT_PANEL_DEFAULT_WIDTH,

      hydrate: async () => {
        if (!isIpcAvailable()) return;
        try {
          const state = await ipc().app.getState();
          set({
            sidebarWidth: clampWidth(
              state.sidebarWidth,
              SIDEBAR_MIN_WIDTH,
              SIDEBAR_MAX_WIDTH,
              SIDEBAR_DEFAULT_WIDTH
            ),
            sidebarCollapsed: state.sidebarCollapsed === true,
            chatPanelWidth: clampWidth(
              state.chatPanelWidth ?? CHAT_PANEL_DEFAULT_WIDTH,
              CHAT_PANEL_MIN_WIDTH,
              CHAT_PANEL_MAX_WIDTH,
              CHAT_PANEL_DEFAULT_WIDTH
            ),
          });
        } catch (error) {
          diagnostics.error('failed to read shell geometry; using defaults', error);
        }
      },

      setSidebarWidth: width => {
        const next = clampWidth(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_DEFAULT_WIDTH);
        if (next === get().sidebarWidth) return;
        set({ sidebarWidth: next });
        persist();
      },

      resetSidebarWidth: () => get().setSidebarWidth(SIDEBAR_DEFAULT_WIDTH),

      toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),

      setSidebarCollapsed: collapsed => {
        if (collapsed === get().sidebarCollapsed) return;
        set({ sidebarCollapsed: collapsed });
        persist();
      },

      setChatPanelWidth: width => {
        const next = clampWidth(
          width,
          CHAT_PANEL_MIN_WIDTH,
          CHAT_PANEL_MAX_WIDTH,
          CHAT_PANEL_DEFAULT_WIDTH
        );
        if (next === get().chatPanelWidth) return;
        set({ chatPanelWidth: next });
        persist();
      },
    };
  });
}

export const workbenchStore = createWorkbenchStore();
export const useWorkbenchStore = workbenchStore;
