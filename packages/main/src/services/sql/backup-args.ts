/**
 * Pure helpers for building backup/restore CLI invocations.
 *
 * Kept free of any `electron` / Node-runtime imports so they can be unit
 * tested in isolation. The PG and MySQL backup services consume these.
 */

import type { RestoreRequest } from '@mj-forge/shared';

/**
 * Resolve whether the user asked to overwrite an existing database.
 *
 * The renderer restore dialog populates `withReplace`, while the legacy
 * service/IPC contract used `replaceExisting`. Both spellings mean the same
 * thing — honor either so the "Overwrite" checkbox can't be silently dropped.
 */
export function resolveReplaceExisting(request: RestoreRequest): boolean {
  // Either flag being truthy means "overwrite requested" — they are aliases,
  // never used to express conflicting intent.
  return Boolean(request.replaceExisting || request.withReplace);
}

/**
 * Build the argument vector for `pg_restore`. Options precede the positional
 * archive path, which pg_restore requires.
 */
export function buildPgRestoreArgs(
  profile: { server: string; port: number; username?: string },
  request: RestoreRequest,
  targetDb: string
): string[] {
  const args = [
    '-h',
    profile.server,
    '-p',
    String(profile.port),
    '-U',
    profile.username || 'postgres',
    '-d',
    targetDb,
    '-v', // verbose — drives progress reporting
  ];

  if (resolveReplaceExisting(request)) {
    // --clean drops objects before recreating them; --if-exists keeps the
    // drops from erroring when an object isn't present yet.
    args.push('--clean', '--if-exists');
  }

  args.push(request.backupPath);
  return args;
}

/**
 * Build the SQL prelude piped to the `mysql` CLI ahead of the dump stream.
 *
 * The mysql CLI connects without a default database (so restoring into a new
 * database doesn't error at connect time), then this prelude guarantees the
 * target exists and is selected. When replacing, the existing database is
 * dropped first so the dump lands in a clean schema instead of colliding
 * with existing objects.
 *
 * `targetDb` is validated by the caller to match /^[A-Za-z0-9_]+$/, so
 * backtick-quoting alone is safe here.
 */
export function buildMysqlRestorePrelude(targetDb: string, replace: boolean): string {
  if (replace) {
    return `DROP DATABASE IF EXISTS \`${targetDb}\`;\nCREATE DATABASE \`${targetDb}\`;\nUSE \`${targetDb}\`;\n`;
  }
  return `CREATE DATABASE IF NOT EXISTS \`${targetDb}\`;\nUSE \`${targetDb}\`;\n`;
}
