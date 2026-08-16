/**
 * Is this a database name this app will send to the server, and if not, why not.
 *
 * ── Why the rule is narrow, and why that is deliberate ──────────────────────────────────────
 *
 * Both Angular dialogs tested `/^[a-zA-Z_][a-zA-Z0-9_]*$/` and offered no reason when it failed — the
 * button simply stayed disabled, which is the "why can't I click this?" state the audit found in four
 * other places. Every engine here would accept far more than that in a *quoted* identifier, so the
 * rule is stricter than the servers are.
 *
 * It stays strict, because of where the name ends up. The main process builds `CREATE DATABASE` and
 * `ALTER DATABASE … MODIFY NAME` by interpolating this string
 * (`services/sql/database-operations.ts`), so the name is not a bound parameter anywhere in the path.
 * Widening the rule renderer-side would mean sending `foo]; DROP DATABASE bar; --` to a generator that
 * quotes by concatenation. That is main's bug to fix and a follow-up to file, not a reason to relax the
 * one check standing in front of it — and the character set below is what "a portable database name"
 * means on all three engines anyway.
 *
 * What changes here is that the refusal is now a **sentence**, returned to the caller, so the dialog
 * can say it under the field instead of greying a button.
 */

/** Letters, digits and underscores, not starting with a digit. */
const PORTABLE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** SQL Server's own limit, and the lowest of the three (PG and MySQL allow 63/64). */
export const MAX_DATABASE_NAME_LENGTH = 128;

export interface NameProblem {
  readonly message: string;
}

/**
 * `null` when `name` is usable. Otherwise the reason, phrased for a user.
 *
 * `taken` is the existing names on that server, compared case-insensitively — SQL Server and MySQL are
 * case-insensitive about database names by default, and a collision reported here is a better
 * experience than the server's own error a round trip later.
 */
export function validateDatabaseName(
  name: string,
  options: { readonly taken?: readonly string[]; readonly currentName?: string } = {}
): NameProblem | null {
  const trimmed = name.trim();
  if (trimmed === '') return { message: 'Give the database a name.' };

  if (trimmed.length > MAX_DATABASE_NAME_LENGTH) {
    return { message: `Names are at most ${MAX_DATABASE_NAME_LENGTH} characters.` };
  }

  if (!PORTABLE_IDENTIFIER.test(trimmed)) {
    return {
      message:
        'Use letters, numbers and underscores only, starting with a letter or an underscore.',
    };
  }

  if (options.currentName !== undefined && equalNames(trimmed, options.currentName)) {
    return { message: 'That is already its name.' };
  }

  const collision = (options.taken ?? []).find(existing => equalNames(existing, trimmed));
  if (collision !== undefined) {
    return { message: `This server already has a database called ${collision}.` };
  }

  return null;
}

/** Case-insensitive comparison, which is how SQL Server and MySQL treat database names by default. */
function equalNames(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
