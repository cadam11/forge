/**
 * The startup sequence, and the one place its ORDER is stated.
 *
 * PLAN.md Task 7: `migration → hydrateRendererState → stores hydrated → THEN interactive`. The
 * Angular equivalent was spread across `app.component.ts:103-127` and `shell.component.ts:209-217`
 * — a spinner, two awaits and a `finally`, with the tab restore last and conditional. Two things
 * about that shape are wrong and both are fixed here.
 *
 * **1. The restore was conditional, and the write path was not gated.** Angular restored tabs only
 * if a session reconnected, and `saveTabs` was callable from the first frame regardless. So a
 * launch where no connection came back left the store empty with the write path open, and the next
 * tab action serialized that emptiness over the user's saved SQL. Nothing in the Angular renderer
 * happened to trigger it, which is not the same as it being safe. Here the two write paths refuse
 * to write until `hydrateWorkspace` opens them (`state/tab.ts:unlockPersistence`,
 * `persistence/layout.ts:unlock`), the restore is unconditional, and this module's job is to reach
 * it on every path — including the failure ones.
 *
 * **2. "Interactive" was the wrong milestone.** Angular dropped the spinner after loading profiles
 * but before hydrating settings, so the first paint could use default settings and then re-theme.
 * Here the shell does not render until the stores are hydrated; the connection restore continues
 * behind a live UI, which is what the per-connection status indicators are for.
 *
 * **3. The window between `interactive` and `restore-workspace` is real, and the restore has to
 * survive it.** Step 4 awaits `connectionStore.restoreState()` — actual reconnects, so a saved
 * server that is now unreachable holds this step for a full connect timeout — while the user already
 * has a usable window. They can open a tab and type a query into it before the saved tabs arrive.
 * The restore therefore MERGES: `tabStore.restoreTabs` keeps live tabs (and their content and their
 * focus) and appends the restored ones. The alternative — hold `interactive` until the workspace is
 * restored — was rejected because it would put the startup spinner in front of the user for the
 * length of a dead server's connect timeout and because a merge protects any future caller of
 * `restoreTabs`, whereas an ordering only protects this one. See `state/tab.ts:restoreTabs` and the
 * survival test in `boot.spec.ts`.
 *
 * ── Why a store and a plain async function, rather than a hook ─────────────────────────────
 *
 * The ordering IS the contract, so it is a function whose statements are in order and whose steps
 * are observable (`onStep`), not an arrangement of effects whose order React owns. `boot.spec.ts`
 * asserts the sequence and asserts that neither write path is open before the restore step.
 */

import { create } from 'zustand';
import {
  hydrateRendererState,
  hydrateWorkspace,
  layoutPersistence,
  type LayoutPersistence,
  type ReactLayoutPayload,
} from '../persistence';
import { connectionStore, type ConnectionStore } from '../state/connection';
import { diagnostics } from '../state/diagnostics';
import { workbenchStore, type WorkbenchStore } from '../state/workbench';

/**
 * `starting` — nothing is hydrated; the shell must not render, because a component that measures a
 *   token or reads a setting during its first effect would read a default.
 * `interactive` — settings, the welcome flag and the shell geometry are in; the shell renders. The
 *   session restore and the workspace restore are still running.
 * `ready` — the workspace has been restored and the two persistence gates are open.
 */
export type BootPhase = 'starting' | 'interactive' | 'ready';

/** The steps, in the order `runBoot` performs them. Exported for the ordering test. */
export const BOOT_STEPS = [
  'hydrate-renderer-state',
  'hydrate-geometry',
  'load-profiles',
  'interactive',
  'restore-session',
  'restore-workspace',
  'ready',
] as const;

export type BootStep = (typeof BOOT_STEPS)[number];

/**
 * What the workspace needs to know. `pending` means "do not touch the dock yet"; `restored` carries
 * the saved arrangement (or `undefined` for Decision C's rebuild-from-tabs case) and `applied`
 * records that the workspace has consumed it, so a remounted dock cannot re-apply a layout over
 * whatever the user has done since.
 */
export type WorkspaceRestore =
  | { readonly status: 'pending'; readonly applied: false }
  | {
      readonly status: 'restored';
      readonly layout: ReactLayoutPayload | undefined;
      readonly applied: boolean;
    };

const PENDING_RESTORE: WorkspaceRestore = { status: 'pending', applied: false };

export interface BootState {
  readonly phase: BootPhase;
  readonly workspaceRestore: WorkspaceRestore;
  /** The last step reached. Rendered by nothing; useful in a report and in a failing test. */
  readonly lastStep: BootStep | null;

  readonly setPhase: (phase: BootPhase) => void;
  readonly setLastStep: (step: BootStep) => void;
  readonly setWorkspaceRestore: (layout: ReactLayoutPayload | undefined) => void;
  /**
   * The workspace has consumed the restored arrangement. **This is also what opens the layout
   * write gate** — see `createBootStore`.
   */
  readonly markRestoreApplied: () => void;
  /** Puts the store back to its pre-boot state. Tests only. */
  readonly reset: () => void;
}

export type BootStore = ReturnType<typeof createBootStore>;

/**
 * `layout` is injected so a test can watch the gate. The default is the module singleton the
 * workspace saves through.
 *
 * ── Why the layout gate opens HERE and not in `hydrateWorkspace` ───────────────────────────
 *
 * It used to open as `hydrateWorkspace`'s last statement, next to the tab gate. The two gates do not
 * become safe at the same moment, though: the tab list is restored *by* that function, but the saved
 * arrangement is only READ there — `workspace.tsx` applies it one effect (and one 500ms debounce
 * tick) later. Between those two moments Dockview is live, `onDidLayoutChange` is subscribed, and the
 * dock still holds whatever it built for itself, so an unlocked gate meant the empty arrangement
 * could be written over the saved one. Opening it from `markRestoreApplied` makes the gate mean
 * "restored", which is what `LayoutPersistence.unlock`'s comment always claimed it meant.
 */
export function createBootStore(options: { readonly layout?: LayoutPersistence } = {}) {
  const layout = options.layout ?? layoutPersistence;

  return create<BootState>()((set, get) => ({
    phase: 'starting',
    workspaceRestore: PENDING_RESTORE,
    lastStep: null,

    setPhase: phase => set({ phase }),
    setLastStep: step => set({ lastStep: step }),
    setWorkspaceRestore: layoutPayload =>
      set({ workspaceRestore: { status: 'restored', layout: layoutPayload, applied: false } }),
    markRestoreApplied: () => {
      // Nothing to apply means nothing to unlock: a caller that runs before the restore payload
      // arrived must not be able to open the gate by mistake.
      const restore = get().workspaceRestore;
      if (restore.status !== 'restored') return;
      set({ workspaceRestore: { ...restore, applied: true } });
      // The one side effect in this store, and it is stated at its call site in `workspace.tsx`
      // too. `unlock` is idempotent, so a second apply costs nothing.
      layout.unlock();
    },
    reset: () => set({ phase: 'starting', workspaceRestore: PENDING_RESTORE, lastStep: null }),
  }));
}

export const bootStore = createBootStore();
export const useBootStore = bootStore;

export interface BootDeps {
  readonly boot?: BootStore;
  readonly connection?: ConnectionStore;
  readonly workbench?: WorkbenchStore;
  readonly hydrateState?: typeof hydrateRendererState;
  readonly restoreWorkspace?: typeof hydrateWorkspace;
  /** Called as each step completes. The ordering test's only instrument. */
  readonly onStep?: (step: BootStep) => void;
}

/**
 * In-flight boot, so a second call joins the first instead of running the sequence twice.
 * StrictMode mounts every effect twice, and `loadProfiles` is a network-bound IPC call.
 */
let inFlight: Promise<void> | null = null;

/** Drops the once-only latch. Tests only — production boots once per window. */
export function resetBootLatch(): void {
  inFlight = null;
}

export function runBoot(deps: BootDeps = {}): Promise<void> {
  inFlight ??= performBoot(deps);
  return inFlight;
}

async function performBoot(deps: BootDeps): Promise<void> {
  const boot = deps.boot ?? bootStore;
  const connection = deps.connection ?? connectionStore;
  const workbench = deps.workbench ?? workbenchStore;
  const hydrateState = deps.hydrateState ?? hydrateRendererState;
  const restoreWorkspace = deps.restoreWorkspace ?? hydrateWorkspace;

  const step = (name: BootStep): void => {
    boot.getState().setLastStep(name);
    deps.onStep?.(name);
  };

  // 1. Migration + settings + the welcome flag. First and awaited: everything below reads state
  //    this writes, and the theme it settles is what the first paint uses.
  await hydrateState();
  step('hydrate-renderer-state');

  // 2. Shell geometry, before the first paint — otherwise the sidebar renders at its default width
  //    and visibly jumps to the saved one.
  await workbench.getState().hydrate();
  step('hydrate-geometry');

  // 3. Profiles. Network-bound work does NOT hold the UI (the Angular comment at
  //    `app.component.ts:105-108` is right about that), so the `finally` releases the shell even
  //    when this rejects — a user with an unreadable profile store still gets an app.
  try {
    await connection.getState().loadProfiles();
    step('load-profiles');
  } catch (error) {
    diagnostics.error('failed to load connection profiles', error);
  } finally {
    boot.getState().setPhase('interactive');
    step('interactive');
  }

  // 4. Reconnect last session's connections, then — always — restore the workspace.
  try {
    await connection.getState().restoreState();
    step('restore-session');
  } catch (error) {
    diagnostics.error('background session restore failed', error);
  } finally {
    // In a `finally` on purpose. `hydrateWorkspace` is what restores the tabs AND what opens the
    // two persistence gates, so skipping it on a failed reconnect would leave the app unable to
    // save for the whole session. Unconditional and last: see this module's header, point 1.
    const restoredConnectionId = [...connection.getState().connectedProfileIds][0] ?? null;
    const layout = await restoreWorkspace(restoredConnectionId);
    boot.getState().setWorkspaceRestore(layout);
    step('restore-workspace');

    boot.getState().setPhase('ready');
    step('ready');
  }
}
