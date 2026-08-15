/**
 * Split a multi-statement SQL string into individual top-level statements.
 *
 * Used by the PG executeDDL path because Postgres' simple query protocol
 * wraps multi-statement strings in a single implicit transaction, and a
 * few commands (DROP DATABASE, CREATE DATABASE, REINDEX DATABASE, etc.)
 * cannot run inside a transaction block. Splitting on top-level `;` and
 * running each piece as its own `client.query()` call gives us the
 * per-statement auto-commit semantics we need.
 *
 * Top-level here means "outside string literals, dollar-quoted blocks,
 * line comments, and block comments." The dialect-generated DDL we
 * actually run never contains anything fancier, but the parser is
 * robust to those constructs so the function can be used safely on
 * arbitrary user-typed multi-statement SQL too.
 */
export function splitTopLevelStatements(sql: string): string[] {
  const statements: string[] = [];
  let buf = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment: -- ... \n  — copy through but skip statement-end
    // semicolon detection inside it.
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end + 1;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Block comment: /* ... */
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Single-quoted string literal (PG, MySQL, MSSQL): doubled-quote escape.
    if (ch === "'") {
      buf += ch;
      i++;
      while (i < n) {
        const c = sql[i];
        buf += c;
        i++;
        if (c === "'") {
          if (sql[i] === "'") {
            // doubled-quote escape — consume the pair
            buf += sql[i];
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }

    // Double-quoted identifier (PG/MSSQL when QUOTED_IDENTIFIER ON).
    // Not strictly necessary for correctness — we don't put `;` inside
    // identifiers — but cheap to handle for completeness.
    if (ch === '"') {
      buf += ch;
      i++;
      while (i < n) {
        const c = sql[i];
        buf += c;
        i++;
        if (c === '"') break;
      }
      continue;
    }

    // PG dollar-quoted block: $tag$...$tag$. Used in CREATE FUNCTION bodies
    // etc. Tag may be empty: $$...$$.
    if (ch === '$') {
      const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        buf += tag;
        i += tag.length;
        const close = sql.indexOf(tag, i);
        const stop = close === -1 ? n : close + tag.length;
        buf += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }

    if (ch === ';') {
      const trimmed = buf.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      buf = '';
      i++;
      continue;
    }

    buf += ch;
    i++;
  }

  const tail = buf.trim();
  if (tail.length > 0) statements.push(tail);

  return statements;
}
