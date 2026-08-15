/**
 * The six Angular localStorage keys, read-only, forever.
 *
 * PLAN.md 0.5: these keys are the only home for real user data in the Angular renderer — the entire
 * snippet library exists nowhere else — and nothing in main has ever seen them. This module is the
 * one place in the React renderer that reads them, and it contains no `setItem` and no `removeItem`
 * by design, which is what makes the "the migration cannot destroy user data" claim reviewable:
 * grep this directory for `removeItem` and the answer is a single hit in a test.
 *
 * Why they are not deleted after migrating: the Angular renderer is still shipping alongside the
 * React one (PLAN.md §3) and still reads every one of them on boot. Cleanup belongs to the cutover
 * task, after Angular is gone.
 *
 * Each value is parsed defensively and independently. Corrupt JSON in the snippet key must not cost
 * the user their settings, so a failed key is reported and skipped, never fatal.
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

  /** One key, one parse, one outcome. `parse` returning undefined means "present but unusable". */
  const lift = (key: string, parse: (raw: string) => boolean): void => {
    const raw = readRaw(key);
    if (raw === null) return;
    keysPresent.push(key);
    if (!parse(raw)) keysRejected.push(key);
  };

  const parseJson = (key: string, raw: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch (error) {
      diagnostics.warn(`localStorage key ${key} is not valid JSON; leaving it untouched`, error);
      return undefined;
    }
  };

  lift(LEGACY_KEYS.settings, raw => {
    const parsed = parseJson(LEGACY_KEYS.settings, raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    lifted.settings = parsed as PersistedSettings;
    return true;
  });

  lift(LEGACY_KEYS.completedTours, raw => {
    const parsed = parseJson(LEGACY_KEYS.completedTours, raw);
    if (!Array.isArray(parsed)) return false;
    lifted.completedTours = parsed.filter((id): id is string => typeof id === 'string');
    return true;
  });

  lift(LEGACY_KEYS.welcomeDismissed, raw => {
    lifted.welcomeDismissed = raw === 'true';
    return true;
  });

  lift(LEGACY_KEYS.snippets, raw => {
    const parsed = parseJson(LEGACY_KEYS.snippets, raw);
    if (!Array.isArray(parsed)) return false;
    // Kept as-is beyond `isSqlSnippet`'s id/sql check: a snippet with an odd field is still the
    // user's snippet, and dropping it to satisfy a stricter type would be exactly the data loss
    // this migration exists to prevent.
    lifted.snippets = parsed.filter(isSqlSnippet);
    return true;
  });

  lift(LEGACY_KEYS.ctrlEConfirmed, raw => {
    lifted.confirmedCtrlEExecute = raw === 'true';
    return true;
  });

  lift(LEGACY_KEYS.flywayPlaceholderValues, raw => {
    const parsed = parseJson(LEGACY_KEYS.flywayPlaceholderValues, raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    const values: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === 'string') values[name] = value;
    }
    lifted.flywayPlaceholderValues = values;
    return true;
  });

  return { lifted, keysPresent, keysRejected };
}
