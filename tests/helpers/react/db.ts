/**
 * Direct database work a spec needs that no UI offers — cleanup, mostly.
 *
 * The only module here that talks to a container instead of to the app. It is separate from the UI
 * helpers on purpose: a spec importing from this file is stating that it is reaching around Joinery,
 * which should always be a visible decision.
 */

import { Client as PgClient } from 'pg';
import { TEST_PG } from './app';

/**
 * Drops every database on the seeded PostgreSQL container whose name starts with `prefix`.
 *
 * The database-management specs create real databases and cannot delete them through the UI (the delete
 * dialog is Task 19b's), and leaving them behind is not neutral: the explorer tree is virtualized, so ten
 * extra databases under the server node push the rows below it out of the rendered window and an
 * unrelated spec that looks for a third server stops finding it. That is a real failure this suite hit
 * once, which is why the cleanup is a helper rather than a note in a comment.
 *
 * `WITH (FORCE)` because the app under test may have left a pooled session on the database it was last
 * pointed at; without it `DROP DATABASE` refuses and the cleanup silently does nothing.
 */
export async function dropDatabasesMatching(prefix: string): Promise<void> {
  const client = new PgClient({ ...TEST_PG });
  await client.connect();
  try {
    const found = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname LIKE $1',
      [`${prefix}%`]
    );
    for (const row of found.rows) {
      // The name comes from `pg_database`, so it is an existing identifier rather than user input; it is
      // still quoted, because a database created by a spec may legally contain characters that need it.
      await client.query(
        `DROP DATABASE IF EXISTS "${row.datname.replace(/"/g, '""')}" WITH (FORCE)`
      );
    }
  } finally {
    await client.end();
  }
}
