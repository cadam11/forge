/**
 * The four bits of text a history row renders. Pure, so they are tested without a DOM.
 *
 * Ported verbatim in behaviour from `query-history-dialog.component.ts:573-608`, with one change:
 * `formatRelativeTime` takes `now` as an argument instead of calling `new Date()` inside itself. The
 * Angular version could not be tested without freezing the clock, which is why it never was.
 */

/** The first line of a statement, capped. What a row shows before it is opened. */
export function firstSqlLine(sql: string, maxLength = 120): string {
  const firstLine = (sql.split('\n')[0] ?? '').trim();
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, maxLength)}…`;
}

/** An error message, capped for the meta line. The full text is the row's `title`. */
export function shortError(error: string, maxLength = 60): string {
  if (error.length <= maxLength) return error;
  return `${error.slice(0, maxLength)}…`;
}

/**
 * "Just now" / "12m ago" / "3h ago" / "2d ago" / a date past a week.
 *
 * An unparseable timestamp answers the empty string rather than "Invalid Date": a row whose date is
 * broken should lose its date, not become unreadable.
 */
export function formatRelativeTime(isoDate: string, now: number): string {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return '';

  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

/** `840ms` / `1.4s` / `2.5m`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
