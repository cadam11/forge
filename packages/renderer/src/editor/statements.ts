/**
 * What "execute" means when the caret is somewhere in a script: the selection, the statement around
 * the caret, or the whole buffer.
 *
 * Ported from `query.component.ts:2125-2189` (`getSelectedOrAllText` / `getStatementAtCursor`) and
 * lifted out of the component, because the boundary rules are the part worth testing and in Angular
 * they were reachable only through a live Monaco instance. Here they are pure functions over line
 * arrays, so `statements.spec.ts` covers the semicolon and `GO` cases directly.
 *
 * The rules, unchanged:
 *
 *  - a non-empty selection always wins, whatever the setting says;
 *  - otherwise `ExecuteScope` decides: `currentStatement` scans for boundaries, `all` sends the buffer;
 *  - a boundary is a semicolon anywhere on a line, or `GO` alone on a line (case-insensitive).
 *
 * The known limitation is the original's and is kept: boundaries are LINE-granular. `select 1; select
 * 2` on one line is one statement to this code, and the original's comment says so — "for practical
 * SQL editing, semicolons are typically at line end". Column-level tracking is the fix and it is not
 * this task's.
 */

import type { ExecuteScope } from '@joinery/shared';

/** A `GO` batch separator: the word alone on its line. Verbatim (`:2155`, `:2173`). */
const GO_LINE = /^\s*GO\s*$/i;

/**
 * The statement surrounding a 1-based cursor line.
 *
 * Scans backwards for the line AFTER the previous boundary and forwards for the line ON which the next
 * boundary sits — asymmetric on purpose, and asymmetric in the original: a trailing semicolon belongs
 * to the statement it terminates, while a leading one belonged to the statement before. A `GO` is
 * excluded from both sides because it is a batch separator, not part of any statement.
 *
 * Both scans are bounded by the line count, so a buffer with no boundaries at all yields the whole
 * buffer rather than running off either end.
 */
export function statementAtCursor(lines: readonly string[], cursorLine: number): string {
  const lineCount = lines.length;
  if (lineCount === 0) return '';
  // Clamp rather than trust: a caret line past the end would silently produce an empty statement.
  const caret = Math.min(Math.max(cursorLine, 1), lineCount);

  let startLine = 1;
  for (let index = caret - 1; index >= 1; index -= 1) {
    const line = lines[index - 1] ?? '';
    if (GO_LINE.test(line) || line.includes(';')) {
      startLine = index + 1;
      break;
    }
  }

  let endLine = lineCount;
  for (let index = caret; index <= lineCount; index += 1) {
    const line = lines[index - 1] ?? '';
    if (GO_LINE.test(line)) {
      endLine = index - 1;
      break;
    }
    if (line.includes(';')) {
      endLine = index;
      break;
    }
  }

  return lines
    .slice(startLine - 1, endLine)
    .join('\n')
    .trim();
}

/** Everything the decision needs, so the caller reads it out of Monaco once and this stays pure. */
export interface ExecutionSource {
  /** The whole buffer. */
  readonly value: string;
  /** The selected text, or an empty string when the selection is empty. */
  readonly selection: string;
  /** 1-based caret line. */
  readonly cursorLine: number;
}

/**
 * The SQL an execute should send.
 *
 * `!== ''` rather than `.trim() !== ''`, which matches the original's `selection && !isEmpty()`
 * exactly: Monaco's `isEmpty()` is a zero-WIDTH check, so a selection of nothing but whitespace is a
 * real selection. It then fails the caller's own `!sql.trim()` guard and the user is told "No query to
 * execute" — which is the right answer. Trimming here instead would silently execute the whole buffer
 * because the user happened to have a blank line selected.
 */
export function textToExecute(source: ExecutionSource, scope: ExecuteScope): string {
  if (source.selection !== '') return source.selection;
  if (scope === 'currentStatement') {
    return statementAtCursor(source.value.split('\n'), source.cursorLine);
  }
  return source.value;
}
