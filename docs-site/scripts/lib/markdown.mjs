/**
 * The little bit of Markdown the generated pages need. Prettier does the alignment afterwards, so
 * nothing here pads a table cell — it only has to be correct.
 */

/** The width the repository's Markdown is wrapped to (`.prettierrc`'s `printWidth`). */
const PROSE_WIDTH = 100;

/**
 * One paragraph, wrapped like the hand-written pages.
 *
 * The parts are joined with spaces and re-wrapped rather than kept as written, because a count in
 * the middle of a sentence changes width whenever the app does — hard-wrapping the source by hand
 * would leave a ragged break somewhere new on every regeneration.
 */
export function paragraph(...parts) {
  return wrap(parts.join(' '), PROSE_WIDTH);
}

/**
 * A blockquote callout, wrapped to leave room for its own `> ` prefix.
 *
 * Blockquotes, never `:::` container directives — this site's Markdown processor drops those on
 * some platforms and ships the literal `:::note` into the page (astro.config.mjs's header, J-103).
 */
export function callout(...parts) {
  return wrap(parts.join(' '), PROSE_WIDTH - 2)
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
}

/** Greedy word wrap. Bounded by the word count, and it never splits a word. */
function wrap(text, width) {
  const lines = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const current = lines.length === 0 ? null : lines[lines.length - 1];
    if (current === null || current.length + 1 + word.length > width) {
      lines.push(word);
      continue;
    }
    lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines.join('\n');
}

/** One table cell: no pipes, no newlines, nothing that can end the row early. */
export function cell(text) {
  return String(text).replaceAll('|', '\\|').replaceAll('\n', ' ').trim();
}

/** A keystroke list as code spans: `⇧⌘N` or `⇧⌘C`. An empty list renders as an em dash. */
export function keystrokes(keys) {
  if (keys.length === 0) return '—';
  return keys.map(key => `\`${cell(key)}\``).join(' or ');
}

/** A GitHub-flavoured table. `rows` is an array of arrays, already cell-escaped by the caller. */
export function table(headers, rows) {
  const divider = headers.map(() => '---');
  const lines = [headers, divider, ...rows].map(columns => `| ${columns.join(' | ')} |`);
  return lines.join('\n');
}

/** The collapsed claims table every page on this site carries (PROPOSAL §5.1). */
export function claimsTable(claims) {
  return [
    '<details>',
    "<summary>Where this page's facts come from</summary>",
    '',
    table(
      ['Claim', 'Source'],
      claims.map(([claim, source]) => [cell(claim), cell(source)])
    ),
    '',
    '</details>',
  ].join('\n');
}

/** Frontmatter. Values are quoted, so a colon in a description cannot break the document. */
export function frontmatter({ title, description, order }) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    'sidebar:',
    `  order: ${order}`,
    '---',
  ].join('\n');
}
