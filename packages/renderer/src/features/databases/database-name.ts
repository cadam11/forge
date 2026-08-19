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
 * It stays strict for PORTABILITY, which is the whole of the reason. The character set below is what "a
 * database name that means the same thing on all three engines" comes to: an unquoted identifier is
 * folded to lower case by PostgreSQL and left alone by SQL Server, `.`/`-`/space force every future
 * reference to be quoted, and a name that needs quoting is a name that will one day be typed without
 * them in a script somebody wrote by hand.
 *
 * It is emphatically **not** an injection guard, and an earlier version of this header said it was.
 * That was wrong: all three dialects escape the identifier before interpolating it — `TsqlBuilder`
 * doubles `]` (`utils/tsql-builder.ts:40-43`), `PgDialect` doubles `"` and `MySqlDialect` doubles the
 * backtick (`services/sql/dialect/{pg,mysql}-dialect.ts:27-30`) — so `foo]; DROP DATABASE bar; --`
 * arrives at the server as one absurd but harmless identifier. Relaxing this rule would produce awkward
 * names, not unsafe SQL, and describing it as a security control invited the next reader to trust it as
 * one.
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
