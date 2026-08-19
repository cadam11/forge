/**
 * Pure helpers for the snippet library: tag parsing, the previews, and the relative date.
 *
 * Separated from the surface for the usual reason — these are the parts with a right answer, and the
 * Angular original had them as private methods on a 710-line component
 * (`snippet-library.component.ts:659-682`), where the truncation rules could not be tested.
 */

import type { SqlSnippet } from '../../state/snippets';

/** `"reporting, month end"` → `['reporting', 'month end']`. Empty and duplicate tags dropped. */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of input.split(',')) {
    const tag = part.trim();
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

/** The inverse, for the edit form. */
export function formatTags(tags: readonly string[] | undefined): string {
  return (tags ?? []).join(', ');
}

/** One line of SQL for a row or a save preview, whitespace collapsed. */
export function previewSql(sql: string, maxLength: number): string {
  const collapsed = sql.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

/** The row preview length, and the save-form preview length. Both carried over from Angular. */
export const ROW_PREVIEW_LENGTH = 100;
export const FORM_PREVIEW_LENGTH = 120;

/**
 * "Today" / "Yesterday" / "4d ago" / a locale date, from `snippet-library.component.ts:659-669`.
 *
 * `now` is a parameter rather than a `new Date()` inside, so the spec can state a date instead of
 * mocking the clock. A snippet with no `createdAt` — possible, because the persisted shape only
 * guarantees `id` and `sql` (`persistence/renderer-state.ts`) — gets an empty string rather than
 * "Invalid Date".
 */
export function formatSnippetDate(createdAt: string | undefined, now: Date = new Date()): string {
  if (createdAt === undefined) return '';
  const created = new Date(createdAt);
  const elapsed = now.getTime() - created.getTime();
  if (Number.isNaN(elapsed)) return '';

  const days = Math.floor(elapsed / 86_400_000);
  if (days < 1) return 'Today';
  if (days < 2) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return created.toLocaleDateString();
}

/** The name a row shows. A snippet may legally have no name — see `SqlSnippet`. */
export function snippetName(snippet: SqlSnippet): string {
  const name = snippet.name?.trim() ?? '';
  return name.length > 0 ? name : 'Untitled snippet';
}
