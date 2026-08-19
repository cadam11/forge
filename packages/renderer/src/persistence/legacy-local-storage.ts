/**
 * The six Angular localStorage keys: read them, and — once they are safely elsewhere — remove them.
 *
 * PLAN.md 0.5: these keys are the only home for real user data in the Angular renderer — the entire
 * snippet library exists nowhere else — and nothing in main has ever seen them. This module is the
 * one place in the React renderer that touches them at all.
 *
 * ── What changed at the cutover (Task 24) ─────────────────────────────────────────────────────
 *
 * Until now this file contained no `setItem` and no `removeItem` by design: the Angular renderer
 * still read all six on boot, so the migration lifted them and left them exactly where they were.
 * Angular is gone, so the keys are now dead weight in the user's profile and
 * `clearLegacyLocalStorage` below removes them.
 *
 * **The module still has no `setItem`, and the removal is deliberately narrow.** It takes the
 * keys to remove as an argument rather than clearing the six by name, because `migration.ts`
 * passes exactly the ones it has just written into `AppState` and had acknowledged — never a key
 * that was present but unparseable, and never anything on a failed write. See that file for the
 * full ordering argument.
 *
 * Each value is parsed defensively and independently. Corrupt JSON in the snippet key must not cost
 * the user their settings, so a failed key is reported and skipped, never fatal.
 *
 * ── Three outcomes per key, not two ──────────────────────────────────────────────────────────
 *
 * A key is not simply readable or unreadable. Three of the six parsers filter *inside* a value —
 * `snippets` drops anything failing `isSqlSnippet`, `completedTours` drops non-strings,
 * `flywayPlaceholderValues` drops non-string values — so a key can parse, migrate most of itself,
 * and still leave entries behind. Reporting that as a clean parse would put the key in the removal
 * list and destroy those entries unwarned, which is precisely what this module exists to prevent.
 *
 * So `LiftOutcome` has three states and the reading has three lists: `keysPresent` (everything that
 * held a value), `keysRejected` (nothing came across) and `keysPartial` (some entries did not).
 * `migration.ts` removes a key only when it is in the first and neither of the other two.
 */

import { diagnostics } from '../state/diagnostics';
import { isSqlSnippet, type PersistedSettings, type ReactRendererState } from './renderer-state';

/**
 * Key name → the Angular source that owns it. Values are the literal strings the Angular renderer
 * writes; they are a data contract with the user's browser profile, so they are quoted here rather
 * than imported (nothing exports them) and must not be "tidied".
 */
export const LEGACY_KEYS = {
  /** `settings.service.ts:5` — the whole `AppSettings` object. */
  settings: 'joinery-settings',
  /** `onboarding.service.ts:28` — an array of completed tour ids. */
  completedTours: 'joinery:completed-tours',
  /** `tab.state.ts:32` — the literal string `'true'`, or absent. */
  welcomeDismissed: 'joinery:welcomeDismissed',
  /** `snippet-library.component.ts:27` — the entire snippet library. */
  snippets: 'joinery-snippets',
  /** `query.component.ts:1538` — the literal string `'true'`, or absent. */
  ctrlEConfirmed: 'joinery-ctrl-e-execute-confirmed',
  /** `query.component.ts:1539` — `Record<string, string>` of remembered placeholder values. */
  flywayPlaceholderValues: 'joinery-flyway-placeholder-values',
} as const;

export interface LegacyLocalStorageReading {
  /** The fields that were actually present, ready to merge into the persisted sub-object. */
  readonly lifted: ReactRendererState;
  /** Which of the six keys held a value at all. Empty means "fresh install, nothing to migrate". */
  readonly keysPresent: readonly string[];
  /** Keys that were present but unreadable. Reported so a migration can be honest about it. */
  readonly keysRejected: readonly string[];
  /**
   * Keys that parsed, migrated what they could, and DISCARDED at least one entry along the way.
   * Their surviving entries are in `lifted`; the discarded ones exist nowhere but localStorage, so
   * these keys must not be removed.
   */
  readonly keysPartial: readonly string[];
}

/**
 * What one parser did with one key's raw value.
 *
 * `dropped` is the number of entries the parser discarded from a value it otherwise accepted — the
 * whole point of the type, and the reason a plain boolean will not do here.
 */
interface LiftOutcome {
  /** Did anything come across at all? `false` puts the key in `keysRejected`. */
  readonly usable: boolean;
  /** Entries discarded from a usable value. Non-zero puts the key in `keysPartial`. */
  readonly dropped: number;
}

/** Everything in the value came across. */
const LIFTED: LiftOutcome = { usable: true, dropped: 0 };
/** Nothing came across: wrong shape, or not JSON at all. */
const UNUSABLE: LiftOutcome = { usable: false, dropped: 0 };
/** Most of the value came across; `dropped` entries did not. */
function partiallyLifted(dropped: number): LiftOutcome {
  return dropped > 0 ? { usable: true, dropped } : LIFTED;
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    // Storage blocked entirely. Reported once per key rather than swallowed; a migration that
    // silently finds nothing because storage threw is indistinguishable from a fresh install.
    diagnostics.warn(`could not read localStorage key ${key}`, error);
    return null;
  }
}

/**
 * Reads all six keys. Never throws, never writes.
 *
 * The two boolean keys use the Angular comparison exactly — `=== 'true'` — so a key holding
 * anything else reads as false, which is what the Angular renderer does with it today.
 */
export function readLegacyLocalStorage(): LegacyLocalStorageReading {
  const lifted: ReactRendererState = {};
  const keysPresent: string[] = [];
  const keysRejected: string[] = [];
  const keysPartial: string[] = [];

  /** One key, one parse, one of the three outcomes. */
  const lift = (key: string, parse: (raw: string) => LiftOutcome): void => {
    const raw = readRaw(key);
    if (raw === null) return;
    keysPresent.push(key);

    const outcome = parse(raw);
    if (!outcome.usable) {
      keysRejected.push(key);
      return;
    }
    if (outcome.dropped > 0) {
      // Never silent: this is the one path where part of a user's value did not come across, and it
      // is also the reason the key survives the migration. Both facts belong in the log together.
      diagnostics.warn(
        `localStorage key ${key} parsed with entries discarded; keeping the key so nothing is lost`,
        { key, dropped: outcome.dropped }
      );
      keysPartial.push(key);
    }
  };

  const parseJson = (key: string, raw: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch (error) {
      diagnostics.warn(`localStorage key ${key} is not valid JSON; leaving it untouched`, error);
      return undefined;
    }
  };

  // The whole object is taken as-is, so there is nothing to drop: either it is an object and all of
  // it comes across, or it is not and none of it does.
  lift(LEGACY_KEYS.settings, raw => {
    const parsed = parseJson(LEGACY_KEYS.settings, raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return UNUSABLE;
    lifted.settings = parsed as PersistedSettings;
    return LIFTED;
  });

  lift(LEGACY_KEYS.completedTours, raw => {
    const parsed = parseJson(LEGACY_KEYS.completedTours, raw);
    if (!Array.isArray(parsed)) return UNUSABLE;
    const tours = parsed.filter((id): id is string => typeof id === 'string');
    lifted.completedTours = tours;
    return partiallyLifted(parsed.length - tours.length);
  });

  lift(LEGACY_KEYS.welcomeDismissed, raw => {
    lifted.welcomeDismissed = raw === 'true';
    return LIFTED;
  });

  lift(LEGACY_KEYS.snippets, raw => {
    const parsed = parseJson(LEGACY_KEYS.snippets, raw);
    if (!Array.isArray(parsed)) return UNUSABLE;
    // Kept as-is beyond `isSqlSnippet`'s id/sql check: a snippet with an odd field is still the
    // user's snippet, and dropping it to satisfy a stricter type would be exactly the data loss
    // this migration exists to prevent. What it CANNOT keep — an entry with no id or no sql — is
    // counted, which is what stops the key being removed out from under it.
    const snippets = parsed.filter(isSqlSnippet);
    lifted.snippets = snippets;
    return partiallyLifted(parsed.length - snippets.length);
  });

  lift(LEGACY_KEYS.ctrlEConfirmed, raw => {
    lifted.confirmedCtrlEExecute = raw === 'true';
    return LIFTED;
  });

  lift(LEGACY_KEYS.flywayPlaceholderValues, raw => {
    const parsed = parseJson(LEGACY_KEYS.flywayPlaceholderValues, raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return UNUSABLE;
    const entries = Object.entries(parsed);
    const values: Record<string, string> = {};
    for (const [name, value] of entries) {
      if (typeof value === 'string') values[name] = value;
    }
    lifted.flywayPlaceholderValues = values;
    return partiallyLifted(entries.length - Object.keys(values).length);
  });

  return { lifted, keysPresent, keysRejected, keysPartial };
}

/**
 * Removes the named keys. The ONLY destructive call in the package, and the only reason it is safe
 * is the precondition its single caller establishes: every key passed here has already been written
 * into main-process `AppState` and acknowledged, in full (`migration.ts`'s `keysSafeToRemove`).
 *
 * **"Single caller" is asserted, not merely stated.** `no-local-storage-writes.spec.ts` counts the
 * files that CALL this function and requires the set to be exactly `['./migration.ts']`, and
 * `persistence/index.ts` deliberately does not re-export it — a barrel export would offer it to
 * every future feature with none of the preconditions attached.
 *
 * Returns the keys it actually removed, so the caller can report what happened rather than assume
 * it. A key whose removal throws — storage blocked outright, which is a real state in some Electron
 * sandboxes — is reported and left out of the result rather than swallowed; the data is already
 * safe in `AppState`, so a key that could not be removed costs a stale copy on disk and nothing
 * else.
 */
export function clearLegacyLocalStorage(keys: readonly string[]): readonly string[] {
  const removed: string[] = [];
  for (const key of keys) {
    try {
      window.localStorage.removeItem(key);
      removed.push(key);
    } catch (error) {
      diagnostics.warn(`could not remove migrated localStorage key ${key}`, error);
    }
  }
  return removed;
}
