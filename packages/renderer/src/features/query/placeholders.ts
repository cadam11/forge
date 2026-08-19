/**
 * Flyway-style `${placeholder}` detection and substitution.
 *
 * Ported from `query.component.ts:1630-1657` and `:1734-1738`, lifted out of the component so the
 * regex and the substitution rule can be tested without a dialog. The regex is verbatim.
 *
 * The substitution is deliberately `split`/`join` and not `String.replace`: `${name}` may appear many
 * times, and a `replace` with a string pattern only rewrites the first — while a `RegExp` built from
 * user text would need escaping and could be a ReDoS. The original made the same choice.
 */

/** `${anything-but-a-brace}`. Verbatim (`:1635`). */
const PLACEHOLDER_PATTERN = /\$\{([^}]+)\}/g;

/**
 * The distinct placeholder names in some SQL, in first-appearance order.
 *
 * Order matters to the reader, not to the machine: it is what the prompt lists, and a dialog whose
 * fields appear in a different order than the query does is harder to fill in. A `Set` preserves
 * insertion order, which is what the original relied on too.
 */
export function detectPlaceholders(sql: string): string[] {
  const names = new Set<string>();
  // `matchAll` rather than a `while (exec())` loop: the regex is module-level and therefore stateful,
  // and `exec` would leave `lastIndex` behind for the next caller. The original re-created the regex
  // per call to dodge that; this is the same fix with no allocation.
  for (const match of sql.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return [...names];
}

/** Replaces every `${name}` with its value. Names with no value are left in place, unsubstituted. */
export function substitutePlaceholders(
  sql: string,
  values: Readonly<Record<string, string>>
): string {
  let resolved = sql;
  for (const [name, value] of Object.entries(values)) {
    resolved = resolved.split(`\${${name}}`).join(value);
  }
  return resolved;
}
