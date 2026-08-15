/**
 * The startup path: migrate, then hydrate the stores from main-process persistence.
 *
 * Two functions, because the app has two moments, and the split is the Angular one
 * (`app.component.ts:103-127`) rather than an invention:
 *
 * - `hydrateRendererState()` — the first thing the shell does. Runs the one-shot localStorage
 *   migration, reads the sub-object once, and pushes the two pieces a store owns (settings,
 *   welcome-dismissed) into their stores. Everything else it returns, because the surfaces that own
 *   the rest — the snippet library (Task 16), the onboarding tours (Task 19), the query editor's ⌃E
 *   gate and placeholder prompts (Task 10) — do not exist yet, and inventing empty stores for them
 *   now would be three files nothing reads.
 * - `hydrateWorkspace(connectionId)` — after the connection restore, because a persisted tab is
 *   bound to a connection and the Angular original waited for the same reason. Restores the tabs
 *   through the tab store's own `getTabs` path and returns the React layout payload (or `undefined`,
 *   which means "rebuild the workspace from the tab list" — Decision C's first-launch case and its
 *   fresh-install case are the same case).
 *
 * Nothing here is a hook. Task 7 calls both from the shell's startup effect, where the loading
 * screen and the connection restore already are; a hook would put the ordering in React's hands,
 * and the ordering is the contract.
 */

import type { AppSettings } from '@joinery/shared';
import { settingsStore, type SettingsStore } from '../state/settings';
import { tabStore, type TabStore } from '../state/tab';
import { layoutPersistence, type LayoutPersistence, type ReactLayoutPayload } from './layout';
import { migrateLegacyLocalStorage, type MigrationResult } from './migration';
import {
  rendererStatePersistence,
  type RendererStatePersistence,
  type SqlSnippet,
} from './renderer-state';

/** What hydration found. The three unowned domains are handed back for their future owners. */
export interface HydratedRendererState {
  readonly migration: MigrationResult;
  /** The settings now in the store: persisted values merged over `DEFAULT_SETTINGS`. */
  readonly settings: AppSettings;
  readonly welcomeDismissed: boolean;
  /** Task 19 (onboarding tours). */
  readonly completedTours: readonly string[];
  /** Task 16 (snippet library). The whole library — this is the data 0.5 was about. */
  readonly snippets: readonly SqlSnippet[];
  /** Task 10 (query editor): the user has already confirmed the ⌃E execute gate. */
  readonly confirmedCtrlEExecute: boolean;
  /** Task 10 (query editor): remembered Flyway placeholder substitutions. */
  readonly flywayPlaceholderValues: Readonly<Record<string, string>>;
}

export interface HydrationDeps {
  readonly persistence?: RendererStatePersistence;
  readonly settings?: SettingsStore;
  readonly tabs?: TabStore;
}

/**
 * Runs the migration and hydrates the stores. Idempotent — the migration has a marker and both
 * store hydrations are plain assignments of the persisted value — so a double-invoked startup
 * effect is not a hazard.
 */
export async function hydrateRendererState(
  deps: HydrationDeps = {}
): Promise<HydratedRendererState> {
  const persistence = deps.persistence ?? rendererStatePersistence;
  const settings = deps.settings ?? settingsStore;
  const tabs = deps.tabs ?? tabStore;

  // Migration first, and awaited: everything below reads the state it writes.
  const migration = await migrateLegacyLocalStorage(persistence);
  const persisted = await persistence.read();

  // The settings store's write path stays shut unless the migration SETTLED. `failed` means the
  // marker is not set and another boot will migrate, so a settings write in the meantime would be
  // read as newer than the user's Angular data (`SettingsHydration.persistWrites`); `unavailable`
  // means there is no bridge, so a write has nowhere to go anyway.
  const migrationSettled = migration.outcome !== 'failed' && migration.outcome !== 'unavailable';
  settings.getState().hydrate({ settings: persisted.settings, persistWrites: migrationSettled });
  tabs.getState().hydrateWelcome(persisted.welcomeDismissed ?? false);

  return {
    migration,
    settings: settings.getState().settings,
    welcomeDismissed: persisted.welcomeDismissed ?? false,
    completedTours: persisted.completedTours ?? [],
    snippets: persisted.snippets ?? [],
    confirmedCtrlEExecute: persisted.confirmedCtrlEExecute ?? false,
    flywayPlaceholderValues: persisted.flywayPlaceholderValues ?? {},
  };
}

export interface WorkspaceHydrationDeps {
  readonly layout?: LayoutPersistence;
  readonly tabs?: TabStore;
}

/**
 * Restores the saved tabs for a restored connection and reads the saved React layout.
 *
 * `connectionId` is required for the same reason `restoreTabs` requires it: a persisted tab whose
 * own `connectionId` is missing adopts this one, and the Angular renderer only restored tabs once
 * a connection had come back (`app.component.ts:120-124`). Keeping that parity means this task
 * changes no restore semantics — it only moves where the call is made from.
 */
export async function hydrateWorkspace(
  connectionId: string,
  deps: WorkspaceHydrationDeps = {}
): Promise<ReactLayoutPayload | undefined> {
  const tabs = deps.tabs ?? tabStore;
  const layout = deps.layout ?? layoutPersistence;

  await tabs.getState().restoreTabs(connectionId);
  return layout.read();
}
