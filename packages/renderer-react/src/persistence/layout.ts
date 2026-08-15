/**
 * The workspace-layout persistence contract for the React renderer. Decision C, in code.
 *
 * ── The decision ─────────────────────────────────────────────────────────────────────────────
 *
 * Craig's binding answer to Decision C (PLAN.md §5): *migrate by reset*. `AppState.goldenLayoutConfig`
 * holds Golden Layout's serialized tree; Dockview's is a different shape and no translator gets
 * written. On its first launch the React renderer IGNORES whatever is stored, rebuilds the workspace
 * from the still-valid `saveTabs`/`getTabs` list, and writes its own shape from then on. The
 * `LayoutConfig` type in `app-state.types.ts` keeps serializing — it just holds something else.
 *
 * ── The shape, and why it is this shape ──────────────────────────────────────────────────────
 *
 * `LayoutConfig` is `{ root: LayoutNode; dimensions? }`, and `LayoutNode` has an optional
 * `componentType: string` and `componentState: Record<string, unknown>`. So a React layout is a
 * single component node — no `content` array — carrying the opaque Dockview blob in its
 * `componentState`. That satisfies the existing type with no change to `packages/shared`, and it
 * gives two properties for free:
 *
 * 1. **It is self-identifying.** A Golden Layout root is a `row`/`column`/`stack` with children; a
 *    React root is a `component` whose `componentType` is the marker below. `decodeReactLayout`
 *    returns `undefined` for anything else, which is exactly the "ignore it" half of Decision C.
 * 2. **The Angular renderer already ignores it.** Its loader guards with
 *    `savedLayout.root.content?.length` (`golden-layout-container.component.ts:404`) before touching
 *    a stored config, and a React root has no `content`. So during coexistence Angular falls
 *    straight through to its "no saved layout" branch and rebuilds from tabs, rather than trying to
 *    mount a panel type it has never heard of. `layout.spec.ts` asserts that guard directly.
 *
 * Task 7 owns the Dockview wiring and decides what goes in `dockview`; this module owns the envelope
 * and refuses to look inside it.
 */

import type { LayoutConfig } from '@joinery/shared';
import { ipc, isIpcAvailable } from '../ipc';
import { diagnostics } from '../state/diagnostics';
import { rendererStatePersistence, type RendererStatePersistence } from './renderer-state';

/** The marker that makes a stored `LayoutConfig` recognisably ours. Never change it in place. */
export const REACT_LAYOUT_COMPONENT_TYPE = 'joinery:react-workspace';

/** Bump when `ReactLayoutPayload`'s meaning changes; an older version decodes to `undefined`. */
export const REACT_LAYOUT_VERSION = 1;

export interface ReactLayoutPayload {
  readonly version: number;
  /** Dockview's serialized state, opaque here. JSON-serializable — it crosses the IPC boundary. */
  readonly dockview: Record<string, unknown>;
  /** The focused panel, kept beside the blob so a reader need not parse Dockview's tree to find it. */
  readonly activeTabId: string | null;
}

/** Wraps a payload in the one `LayoutConfig` shape the React renderer writes. */
export function encodeReactLayout(payload: ReactLayoutPayload): LayoutConfig {
  return {
    root: {
      type: 'component',
      componentType: REACT_LAYOUT_COMPONENT_TYPE,
      // `title` so a human reading app-state.json can tell what wrote this.
      title: 'Joinery React workspace',
      componentState: {
        version: payload.version,
        activeTabId: payload.activeTabId,
        dockview: payload.dockview,
      },
    },
  };
}

/**
 * The payload if this config is a React one of a version we understand, `undefined` otherwise —
 * which covers a Golden Layout tree, a future version, and a corrupted blob alike. Never throws.
 */
export function decodeReactLayout(
  config: LayoutConfig | undefined
): ReactLayoutPayload | undefined {
  const root = config?.root;
  if (!root || root.type !== 'component' || root.componentType !== REACT_LAYOUT_COMPONENT_TYPE) {
    return undefined;
  }

  const state = root.componentState;
  if (!state || state['version'] !== REACT_LAYOUT_VERSION) return undefined;

  const dockview = state['dockview'];
  if (typeof dockview !== 'object' || dockview === null || Array.isArray(dockview)) {
    diagnostics.warn('stored React layout has no usable Dockview state; rebuilding from tabs', {
      dockview,
    });
    return undefined;
  }

  const activeTabId = state['activeTabId'];
  return {
    version: REACT_LAYOUT_VERSION,
    dockview: dockview as Record<string, unknown>,
    activeTabId: typeof activeTabId === 'string' ? activeTabId : null,
  };
}

/** True for a config the Angular renderer wrote — the thing Decision C says to ignore. */
export function isLegacyGoldenLayout(config: LayoutConfig | undefined): config is LayoutConfig {
  return config !== undefined && decodeReactLayout(config) === undefined;
}

export interface LayoutPersistence {
  /**
   * The stored React layout, or `undefined` when there is none to honour. Read-only: a Golden
   * Layout config found here is left exactly where it is.
   */
  read(): Promise<ReactLayoutPayload | undefined>;
  /** Persists a React layout, archiving an Angular one on the way past. */
  save(payload: ReactLayoutPayload): Promise<'saved' | 'unavailable' | 'failed'>;
}

export function createLayoutPersistence(
  persistence: RendererStatePersistence = rendererStatePersistence
): LayoutPersistence {
  /**
   * Whether the archive step below has already been settled this session. A resource, not state:
   * it exists only to keep the common case at one IPC call instead of two, and being wrong about
   * it costs a redundant no-op `update()`, never a wrong write.
   */
  let archiveSettled = false;

  return {
    read: async () => {
      if (!isIpcAvailable()) return undefined;
      try {
        return decodeReactLayout(await ipc().app.getLayout());
      } catch (error) {
        diagnostics.error('failed to read the persisted layout', error);
        return undefined;
      }
    },

    save: async payload => {
      if (!isIpcAvailable()) return 'unavailable';
      try {
        // Decision C authorises discarding the Golden Layout tree. Keeping a copy anyway costs one
        // write, once, and makes "the swap deleted a user's window arrangement" false rather than
        // merely allowed. Nothing reads the copy; a future translator could.
        if (!archiveSettled) {
          const existing = await ipc().app.getLayout();
          if (isLegacyGoldenLayout(existing)) {
            await persistence.update(current =>
              current.legacyGoldenLayoutConfig
                ? undefined
                : { ...current, legacyGoldenLayoutConfig: existing }
            );
          }
          archiveSettled = true;
        }

        await ipc().app.saveLayout(encodeReactLayout(payload));
        return 'saved';
      } catch (error) {
        diagnostics.error('failed to persist the layout', error);
        return 'failed';
      }
    },
  };
}

/** The app-wide instance. */
export const layoutPersistence = createLayoutPersistence();
