/**
 * The one fuzzy matcher the three search surfaces share — the command palette, the object search
 * and the snippet library.
 *
 * ── Why not `fuse.js`, and why not cmdk's own filter ────────────────────────────────────────
 *
 * The Angular renderer built a `Fuse` index in each of those three components with
 * `threshold: 0.4` and different `keys` (`command-palette.component.ts:634`,
 * `object-search.component.ts:389`, `snippet-library.component.ts:704`). Fuse at 0.4 is very
 * permissive: it answered "customers" for "orders" — the two share five letters in order — so the
 * lists were noisy in a way that reads as "search is broken" rather than "no match".
 *
 * cmdk ships its own scorer and does its own filtering, and this file exists rather than using it
 * for two concrete reasons:
 *
 * 1. **cmdk filters by rendering.** `<Command>` mounts every item and hides the ones that do not
 *    match. The object search indexes every table, view, procedure and function in a database —
 *    thousands of rows on a real server — and mounting them all to hide most is exactly the DOM
 *    cost the palette cannot afford. Ranking first and rendering a capped list is a fixed budget.
 * 2. **`commandScore` is not a public export.** cmdk's `package.json` `exports` map has one entry,
 *    `"."` — `cmdk/command-score` resolves to nothing — so its scorer can neither be imported nor
 *    unit-tested here. A ranking nobody can test on fixtures is a ranking that drifts.
 *
 * So cmdk keeps the parts it is genuinely good at (roles, `aria-selected`, arrow-key movement,
 * typeahead, Enter/Escape) with `shouldFilter={false}`, and matching lives here where it has tests.
 *
 * ── The score model ─────────────────────────────────────────────────────────────────────────
 *
 * Deliberately a small ladder rather than an edit distance, because a user typing into a palette
 * is abbreviating a phrase they already know rather than misspelling it. Each field of a candidate
 * is scored independently and the best field wins, weighted so a match in the label beats the same
 * match in a description.
 *
 *   1.00  the field IS the query
 *   0.90  the field starts with the query
 *   0.80  a word inside the field starts with the query ("orders" in "sales orders")
 *   0.70  the field contains the query anywhere
 *   ≤0.50 the query's characters appear in order but not contiguously, scaled by how tightly
 *         ("ordid" → "order_id" scores well; "ordid" → "o…r…d…i…d" across 80 characters does not)
 *
 * A candidate that does not even match as a subsequence scores 0 and is dropped, which is the
 * property Fuse's threshold did not give: an unrelated row never appears.
 */

/** One searchable field of a candidate, and how much a match in it is worth. */
export interface FuzzyField {
  readonly text: string;
  /** 1 for the primary label; less for supporting text. Clamped to (0, 1]. */
  readonly weight?: number;
}

export interface FuzzyCandidate<T> {
  readonly item: T;
  readonly fields: readonly FuzzyField[];
}

export interface FuzzyResult<T> {
  readonly item: T;
  readonly score: number;
}

/** The separators a "word start" can follow. Covers `schema.table`, `snake_case` and paths. */
const WORD_BOUNDARY = /[\s._\-/:]/;

/**
 * How well `query` matches `text`, in [0, 1]. Case-insensitive; 0 means "not a match at all".
 *
 * Exported because both the ranking below and its spec want to talk about a single pair, and
 * because a caller that already knows which field it cares about should not have to build a
 * candidate to ask.
 */
export function fuzzyScore(query: string, text: string): number {
  const needle = query.trim().toLowerCase();
  const haystack = text.toLowerCase();
  if (needle.length === 0) return 0;
  if (haystack.length === 0) return 0;

  if (haystack === needle) return 1;
  if (haystack.startsWith(needle)) return 0.9;

  const index = haystack.indexOf(needle);
  if (index > 0) {
    const preceding = haystack[index - 1] ?? '';
    return WORD_BOUNDARY.test(preceding) ? 0.8 : 0.7;
  }

  return subsequenceScore(needle, haystack);
}

/**
 * The scattered-characters case: every character of `needle` in order, scored by how tight the
 * span it occupies is.
 *
 * The loop is bounded by `haystack.length` and each character is consumed at most once, so this is
 * one pass — no backtracking, which also means the first match of each character wins. That is the
 * standard greedy subsequence test and it is what makes the score cheap enough to run over every
 * object in a database on every keystroke.
 */
function subsequenceScore(needle: string, haystack: string): number {
  let start = -1;
  let cursor = 0;

  for (let position = 0; position < haystack.length && cursor < needle.length; position += 1) {
    if (haystack[position] !== needle[cursor]) continue;
    if (start === -1) start = position;
    cursor += 1;
    if (cursor === needle.length) {
      const span = position - start + 1;
      // needle.length / span is 1 for a contiguous run (already handled above, so this is < 1
      // here) and tends to 0 as the characters spread out. Halved so a scattered match can never
      // outrank a real substring match.
      return (needle.length / span) * 0.5;
    }
  }

  return 0;
}

/** The best weighted field score for one candidate, or 0 when nothing matched. */
function candidateScore(query: string, fields: readonly FuzzyField[]): number {
  let best = 0;
  for (const field of fields) {
    const weight = field.weight === undefined ? 1 : Math.min(Math.max(field.weight, 0.01), 1);
    const score = fuzzyScore(query, field.text) * weight;
    if (score > best) best = score;
  }
  return best;
}

export interface RankOptions {
  /** The most results to return. Required: every caller renders rows, so every caller has a cap. */
  readonly limit: number;
}

/**
 * Ranks candidates against a query, best first, capped at `limit`.
 *
 * An empty query is not a match of everything — it is "no filter": the candidates come back in the
 * order they were given, capped. That is what both the palette (which orders by group) and the
 * object search (which orders by the server's own ordering) want as their resting state.
 *
 * The sort is stable on score, so two equal scores keep the caller's order — which is how the
 * palette's grouping survives a query that ties.
 */
export function rankFuzzy<T>(
  query: string,
  candidates: readonly FuzzyCandidate<T>[],
  options: RankOptions
): readonly FuzzyResult<T>[] {
  const limit = Math.max(0, Math.trunc(options.limit));
  if (query.trim().length === 0) {
    return candidates.slice(0, limit).map(candidate => ({ item: candidate.item, score: 0 }));
  }

  const scored: FuzzyResult<T>[] = [];
  for (const candidate of candidates) {
    const score = candidateScore(query, candidate.fields);
    if (score > 0) scored.push({ item: candidate.item, score });
  }

  // `Array.prototype.sort` is required to be stable since ES2019, so equal scores keep input order.
  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, limit);
}
