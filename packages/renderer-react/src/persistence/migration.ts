/**
 * The one-shot localStorage → `AppState` migration (PLAN.md 0.5, Task 5).
 *
 * ── The two properties that matter ───────────────────────────────────────────────────────────
 *
 * **Non-destructive.** It reads the six Angular keys and writes main-process `AppState`. It never
 * writes, clears or removes a localStorage key — `legacy-local-storage.ts` has no `setItem` in it
 * — because the Angular renderer still reads all six during coexistence. A user who ran Angular
 * yesterday keeps their settings, tours, snippets and editor confirmations in BOTH renderers.
 *
 * **Idempotent.** The marker is `reactRendererState.migratedFromLocalStorageAt`, and it lives in
 * `AppState`, never in localStorage — so wiping browser storage cannot make the migration run a
 * second time and re-lift stale data over newer main-process values. The check and the write happen
 * inside one `rendererStatePersistence.update()` critical section, which is what makes two
 * concurrent callers (a StrictMode double-effect, say) collapse into one migration rather than two.
 *
 * ── What happens if the process dies mid-migration ───────────────────────────────────────────
 *
 * Nothing is half-migrated. The lifted data and the marker are one object in one `setState` call,
 * and main merges it into its in-memory state in a single synchronous spread
 * (`app-state.ts:66-69`) before an `atomically`-backed debounced disk write. So the outcomes are:
 * the whole sub-object reaches disk, or none of it does and the migration runs again next boot —
 * which is safe precisely because localStorage was never touched. There is no ordering in which
 * the marker exists without the data it describes.
 *
 * ── Deliberately NOT written on a fresh install ──────────────────────────────────────────────
 *
 * With none of the six keys present, this writes nothing at all — not even the marker. Two reasons:
 * a fresh install should not dirty persisted state to record that it had nothing to do, and while
 * the two renderers coexist, a user who boots React first and then creates snippets in Angular
 * still gets them lifted on a later React boot. The cost of not marking is six localStorage reads
 * per launch.
 */

import { diagnostics } from '../state/diagnostics';
import { readLegacyLocalStorage } from './legacy-local-storage';
import {
  rendererStatePersistence,
  type ReactRendererState,
  type RendererStatePersistence,
} from './renderer-state';

export type MigrationOutcome =
  /** Data was found and lifted into `AppState`; the marker is now set. */
  | 'migrated'
  /** The marker was already present. Nothing was read, nothing was written. */
  | 'already-migrated'
  /** None of the six keys existed. Nothing was written — see the module comment. */
  | 'no-data'
  /** No preload bridge, so there is nowhere to migrate TO. localStorage is left as it was. */
  | 'unavailable'
  /** The bridge rejected the write. Logged; the caller carries on with un-migrated state. */
  | 'failed';

export interface MigrationResult {
  readonly outcome: MigrationOutcome;
  /** Which of the six keys were present. Reported for the double-boot proof and the specs. */
  readonly keysPresent: readonly string[];
  /** Keys that were present but unparseable, and so were skipped. */
  readonly keysRejected: readonly string[];
}

/**
 * Runs the migration if it has not run. Safe to call on every boot; safe to call twice.
 *
 * The mutator is where all three decisions happen, because that is the only place with a read of
 * the current sub-object that no concurrent write can invalidate.
 */
export async function migrateLegacyLocalStorage(
  persistence: RendererStatePersistence = rendererStatePersistence
): Promise<MigrationResult> {
  let outcome: MigrationOutcome = 'no-data';
  let keysPresent: readonly string[] = [];
  let keysRejected: readonly string[] = [];

  const writeResult = await persistence.update(current => {
    if (current.migratedFromLocalStorageAt !== undefined) {
      outcome = 'already-migrated';
      return undefined;
    }

    const reading = readLegacyLocalStorage();
    keysPresent = reading.keysPresent;
    keysRejected = reading.keysRejected;

    if (reading.keysPresent.length === 0) {
      outcome = 'no-data';
      return undefined;
    }

    outcome = 'migrated';
    // `current` on top: anything already in `AppState` wins over the older localStorage copy. That
    // is the right default for the collections — `snippets`, `completedTours`,
    // `flywayPlaceholderValues` — where a React-created entry losing to a stale Angular list would
    // be real data loss.
    const next: ReactRendererState = {
      ...reading.lifted,
      ...current,
      migratedFromLocalStorageAt: new Date().toISOString(),
    };

    // `settings` needs one more question answered, because it is the only field that can exist in
    // `AppState` *before* this migration runs, and both answers are destructive if applied to the
    // wrong case:
    //
    //   - Written while the migration was UNSETTLED (a `failed` boot): it is `DEFAULT_SETTINGS` plus
    //     at most a nudge, authored by a renderer that never saw the user's real settings. Letting it
    //     win would permanently discard what the user chose in Angular.
    //   - Written after a SETTLED migration — including the `no-data` case, where a fresh install
    //     deliberately leaves no marker so a later Angular session can still be lifted: it is a
    //     deliberate choice. Lifting over it would permanently discard THAT, and the Angular object
    //     it loses to is itself mostly Angular defaults, since `settings.service.ts:149` rewrites the
    //     whole object whenever one field changes.
    //
    // Neither the missing marker nor the shape of the object separates those two — a user may
    // deliberately choose the defaults. Only provenance does, so the settings store stamps it:
    // `settingsAuthoredByReactAt` is written in the same call as any settings value it authored after
    // hydration unlocked writes. No stamp, no considered choice, and the lift wins.
    if (reading.lifted.settings && current.settingsAuthoredByReactAt === undefined) {
      next.settings = reading.lifted.settings;
    }
    return next;
  });

  // `unavailable` and `failed` come from the writer, not from the mutator, so they overrule
  // whatever the mutator had decided — it ran (or didn't) against state that was never written.
  if (writeResult === 'unavailable') return { outcome: 'unavailable', keysPresent, keysRejected };
  if (writeResult === 'failed') return { outcome: 'failed', keysPresent, keysRejected };

  if (keysRejected.length > 0) {
    // Never silent: a key that was present and unreadable is the one case where a user's data
    // did not make it across, and they should be able to find out why from the log.
    diagnostics.warn('some localStorage keys could not be migrated', { keys: keysRejected });
  }
  return { outcome, keysPresent, keysRejected };
}
