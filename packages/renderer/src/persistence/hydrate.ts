/**
 * The startup path: migrate, then hydrate the stores from main-process persistence.
 *
 * Two functions, because the app has two moments, and the split is the Angular one
 * (`app.component.ts:103-127`) rather than an invention:
 *
 * - `hydrateRendererState()` — the first thing the shell does. Runs the one-shot localStorage
 *   migration, reads the sub-object once, and pushes the pieces a store owns (settings,
 *   welcome-dismissed, the query editor's ⌃E gate and remembered placeholder values since Task 10,
 *   the snippet library since Task 16, and the onboarding tours' completion list since Task 19b) into
 *   their stores. It still RETURNS every piece it read, so the boot result stays a complete picture of
 *   what was on disk — which is what `dev/persistence-probe.tsx` renders.
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
import { editorPrefsStore, type EditorPrefsStore } from '../state/editor-prefs';
import { settingsStore, type SettingsStore } from '../state/settings';
import { snippetsStore, type SnippetsStore } from '../state/snippets';
import { tabStore, type TabStore } from '../state/tab';
import { toursStore, type ToursStore } from '../state/tours';
import { layoutPersistence, type LayoutPersistence, type ReactLayoutPayload } from './layout';
import { migrateLegacyLocalStorage, type MigrationResult } from './migration';
import {
  rendererStatePersistence,
  type RendererStatePersistence,
  type SqlSnippet,
} from './renderer-state';

/** What hydration found. The one still-unowned domain is handed back for its future owner. */
export interface HydratedRendererState {
  readonly migration: MigrationResult;
  /** The settings now in the store: persisted values merged over `DEFAULT_SETTINGS`. */
  readonly settings: AppSettings;
  readonly welcomeDismissed: boolean;
  /**
   * The tours the user has already been through. Now hydrated into `state/tours.ts` by this function
   * (Task 19b); still returned so the boot result stays complete.
   */
  readonly completedTours: readonly string[];
  /**
   * The whole snippet library — the data 0.5 was about. Now hydrated into `state/snippets.ts` by
   * this function; still returned so the boot result stays a complete picture of what was on disk.
   */
  readonly snippets: readonly SqlSnippet[];
  /** Now in `features/query/editor-prefs.ts`; still returned so the boot result stays complete. */
  readonly confirmedCtrlEExecute: boolean;
  /** Ditto. Both are hydrated into that store by this function. */
  readonly flywayPlaceholderValues: Readonly<Record<string, string>>;
}

export interface HydrationDeps {
  readonly persistence?: RendererStatePersistence;
  readonly settings?: SettingsStore;
  readonly tabs?: TabStore;
  readonly editorPrefs?: EditorPrefsStore;
  readonly snippets?: SnippetsStore;
  readonly tours?: ToursStore;
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
  const editorPrefs = deps.editorPrefs ?? editorPrefsStore;
  const snippets = deps.snippets ?? snippetsStore;
  const tours = deps.tours ?? toursStore;

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
  // The query editor's two preferences. Unconditional, unlike the settings store's gated write path:
  // this store's writes are gated on ITS OWN `hydrated` flag (`editor-prefs.ts`), so hydrating it is
  // also what opens them — and a default-valued write before that could not overwrite anything,
  // because there is nothing else that writes these two fields.
  editorPrefs.getState().hydrate({
    confirmedCtrlEExecute: persisted.confirmedCtrlEExecute ?? false,
    flywayPlaceholderValues: persisted.flywayPlaceholderValues ?? {},
  });
  // The snippet library, same arrangement: hydrating the store is also what opens its write gate, so
  // a library edit before this line could not overwrite the migrated snippets with an empty list.
  snippets.getState().hydrate(persisted.snippets ?? []);
  // The tours' completion list, same arrangement again — hydrating opens the write gate, so a tour
  // finished before this line could not persist an empty list over the migrated one. The tour CONTENT is
  // installed separately by `features/onboarding/TourHost`, which is where the shell's testids belong.
  tours.getState().hydrate(persisted.completedTours ?? []);

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
 * Restores the saved tabs, reads the saved React layout, and — last — opens the **tab** write
 * gate. **This function is half of the restore-before-save contract**; `shell/boot.ts`'s
 * `markRestoreApplied` is the other half.
 *
 * ── Why the tab unlock lives here and the layout unlock does not ──────────────────────────
 *
 * `tabStore.saveTabs` and `layoutPersistence.save` both refuse to write until they are unlocked,
 * so "no tab or layout write may fire before the restore has completed" is not a rule the shell
 * has to remember: it is the shape of the code. A component that saves too early gets a no-op
 * instead of overwriting the user's saved SQL with an empty list.
 * `TabStoreState.unlockPersistence` documents the loss in full.
 *
 * The two gates become safe at *different moments*, though, which is why only one of them opens
 * here. The tab list is restored BY this function, so its gate can open on the last line. The
 * layout is only READ here — `shell/workspace/workspace.tsx` applies the arrangement an effect and
 * a debounce tick later — so the layout gate is opened by `bootStore.markRestoreApplied()`, i.e.
 * by the workspace, once it has actually applied what was read. Opening it here left a window in
 * which Dockview's own initial (empty) arrangement could be saved over the user's.
 *
 * The unlock is the last statement, after both awaits, and nothing before it can throw —
 * `restoreTabs` and `layout.read()` each catch and report their own failures, which is
 * what makes "restored, or tried and reported" the only state this function returns in.
 *
 * ── Why `connectionId` is nullable now ────────────────────────────────────────────────────
 *
 * The Angular renderer restored tabs only if a connection had come back
 * (`app.component.ts:120-124`) and skipped the restore entirely otherwise. Under a gate that is
 * no longer safe to copy: skipping the restore would either leave the gate shut for the session
 * (tabs silently stop persisting) or open it over an unrestored store (the loss the gate exists
 * to prevent). So the restore always runs. A persisted tab carries its own `connectionId` and
 * only falls back to this one when it has none, so restoring with no live connection yields the
 * user's tabs pointing at connections that are not up — which is what a reconnect fixes, and is
 * strictly better than discarding their SQL.
 */
export async function hydrateWorkspace(
  connectionId: string | null,
  deps: WorkspaceHydrationDeps = {}
): Promise<ReactLayoutPayload | undefined> {
  const tabs = deps.tabs ?? tabStore;
  const layout = deps.layout ?? layoutPersistence;

  await tabs.getState().restoreTabs(connectionId ?? '');
  const payload = await layout.read();

  tabs.getState().unlockPersistence();

  return payload;
}
