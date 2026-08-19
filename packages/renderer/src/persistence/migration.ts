/**
 * The one-shot localStorage → `AppState` migration (PLAN.md 0.5, Task 5).
 *
 * ── The two properties that matter ───────────────────────────────────────────────────────────
 *
 * **Lossless.** It reads the six Angular keys, writes main-process `AppState`, and — since the
 * cutover (Task 24) — removes the keys it lifted. Removal happens only AFTER `update()` has
 * resolved `'written'`, i.e. after main acknowledged the write, and covers only the keys that were
 * actually parsed and carried across. So the two failure orderings are:
 *
 *   - write acknowledged, process dies before the removal → the marker and the data are on disk and
 *     the keys are still there. A stale copy, read by nothing. Harmless.
 *   - write not acknowledged (`failed` / `unavailable`) → nothing is removed, the marker is not
 *     set, and the next boot migrates for real.
 *
 * There is no ordering in which a key is removed before the data it held is safe somewhere else.
 *
 * **Idempotent.** The marker is `reactRendererState.migratedFromLocalStorageAt`, and it lives in
 * `AppState`, never in localStorage — so wiping browser storage cannot make the migration run a
 * second time and re-lift stale data over newer main-process values. The check and the write happen
 * inside one `rendererStatePersistence.update()` critical section, which is what makes two
 * concurrent callers (a StrictMode double-effect, say) collapse into one migration rather than two.
 *
 * ── Two keys it deliberately does NOT remove ─────────────────────────────────────────────────
 *
 * **A key that was present but unparseable** (`keysRejected`) is left exactly where it is. It did
 * not make it across, so removing it would be the data loss this whole module exists to prevent —
 * and a human can still open devtools and read it.
 *
 * **Every key, on an `already-migrated` boot.** The marker says a previous run lifted whatever was
 * there THEN; it says nothing about a key written since. During coexistence a user could migrate in
 * React and then create snippets in Angular, and those would be unlifted, newer data. Sweeping them
 * because a marker exists would destroy exactly the library PLAN.md 0.5 is about. The cost of not
 * sweeping is that a profile which migrated under a pre-cutover build keeps six dead keys forever;
 * that is a bounded cosmetic residue, and it is the right side of the trade.
 *
 * ── What happens if the process dies mid-migration ───────────────────────────────────────────
 *
 * Nothing is half-migrated. The lifted data and the marker are one object in one `setState` call,
 * and main merges it into its in-memory state in a single synchronous spread
 * (`app-state.ts:66-69`) before an `atomically`-backed debounced disk write. So the outcomes are:
 * the whole sub-object reaches disk, or none of it does and the migration runs again next boot —
 * which is safe precisely because the keys are only removed after the acknowledgement. There is no
 * ordering in which the marker exists without the data it describes.
 *
 * ── Deliberately NOT written on a fresh install ──────────────────────────────────────────────
 *
 * With none of the six keys present, this writes nothing at all — not even the marker. A fresh
 * install should not dirty persisted state to record that it had nothing to do. The cost of not
 * marking is six localStorage reads per launch.
 */

import { diagnostics } from '../state/diagnostics';
import { clearLegacyLocalStorage, readLegacyLocalStorage } from './legacy-local-storage';
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
  /** Keys that were present but unparseable, and so were skipped. Never removed. */
  readonly keysRejected: readonly string[];
  /**
   * Keys removed from localStorage because their contents are now in `AppState`. Empty unless the
   * write was acknowledged; always a subset of `keysPresent` minus `keysRejected`.
   */
  readonly keysCleared: readonly string[];
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
  // Neither removes a key: nothing was persisted, so nothing is safe to drop.
  if (writeResult === 'unavailable') {
    return { outcome: 'unavailable', keysPresent, keysRejected, keysCleared: [] };
  }
  if (writeResult === 'failed') {
    return { outcome: 'failed', keysPresent, keysRejected, keysCleared: [] };
  }

  if (keysRejected.length > 0) {
    // Never silent: a key that was present and unreadable is the one case where a user's data
    // did not make it across, and they should be able to find out why from the log.
    diagnostics.warn('some localStorage keys could not be migrated', { keys: keysRejected });
  }

  // The removal, and the only call site of the only function in the package that removes a
  // localStorage key.
  //
  // `writeResult === 'written'` is the whole guard, and it carries BOTH facts the module comment
  // requires. It means main acknowledged a write; and the mutator above returns a value in exactly
  // one branch — the one that read the keys and set `outcome = 'migrated'` — so it also means THIS
  // run did the lifting. An `already-migrated` or `no-data` run returns `undefined` from the
  // mutator and lands on `'unchanged'`, which removes nothing.
  //
  // Rejected keys are excluded: they were present but unparseable, so their contents did not make
  // it across and removing them would be the data loss this module exists to prevent.
  const lifted =
    writeResult === 'written' ? keysPresent.filter(key => !keysRejected.includes(key)) : [];
  const keysCleared = clearLegacyLocalStorage(lifted);

  return { outcome, keysPresent, keysRejected, keysCleared };
}
