/**
 * One `DatabaseOperationResult` read the same way by both dialogs.
 *
 * The bridge's create/rename/delete members all answer `{ success, tsql, error?, message? }`, and both
 * Angular dialogs unpacked it by hand — `result?.success` then `result?.error || 'Failed to …'`, with
 * the `tsql` field ignored entirely and the thrown case handled by a second, differently-worded branch.
 * Three shapes of failure (`success: false`, a rejected promise, and a resolved `undefined` from a
 * bridge that is not there) collapsed into two messages, one of which said nothing.
 *
 * Here they collapse into one type with the statement kept, so the caller has exactly two cases to
 * write and the SQL survives to be logged.
 */

import type { DatabaseOperationResult } from '@joinery/shared';

import { diagnostics } from '../../state/diagnostics';

export interface DatabaseOperationOutcome {
  /** The reason it did not work, or `null` when it did. */
  readonly error: string | null;
  /** The statement the main process ran, when it reported one. */
  readonly statement: string | undefined;
}

/**
 * Run one database operation and normalise every way it can fail.
 *
 * A rejection is logged as well as returned: the returned string is for the dialog, and the cause is
 * what makes a failing generator debuggable from the Output panel. The Angular dialogs discarded it.
 */
export async function runDatabaseOperation(
  call: () => Promise<DatabaseOperationResult | undefined>
): Promise<DatabaseOperationOutcome> {
  try {
    const result = await call();
    if (result === undefined) {
      return { error: 'The main process did not answer.', statement: undefined };
    }
    if (!result.success) {
      // `message` is main's human sentence and `error` its machine one; either is better than a
      // generic string, and the generic string is only reached when it sent neither.
      return {
        error: result.error ?? result.message ?? 'The server refused the change.',
        statement: result.tsql,
      };
    }
    return { error: null, statement: result.tsql };
  } catch (cause) {
    diagnostics.error('a database operation failed', cause);
    return {
      error: cause instanceof Error ? cause.message : 'The operation failed.',
      statement: undefined,
    };
  }
}
