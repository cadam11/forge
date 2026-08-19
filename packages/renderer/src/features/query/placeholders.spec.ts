/**
 * Flyway placeholder detection and substitution.
 *
 * The regex is the original's; the tests exist because the substitution is the step that changes what SQL
 * gets sent to a live database, and because the original's own dialog escaped exactly one HTML character
 * on the way in (see `placeholder-dialog.tsx`).
 */

import { describe, expect, it } from 'vitest';
import { detectPlaceholders, substitutePlaceholders } from './placeholders';

describe('detectPlaceholders', () => {
  it('finds each name once, in first-appearance order', () => {
    expect(detectPlaceholders('SELECT * FROM ${schema}.${table} WHERE x = ${schema}')).toEqual([
      'schema',
      'table',
    ]);
  });

  it('finds nothing in SQL with no placeholders', () => {
    expect(detectPlaceholders('SELECT 1')).toEqual([]);
  });

  it('ignores a lone dollar or an unclosed brace', () => {
    expect(detectPlaceholders('SELECT $1, ${unclosed')).toEqual([]);
  });

  it('accepts a name with dots and dashes, which Flyway allows', () => {
    expect(detectPlaceholders('${env.name}, ${a-b}')).toEqual(['env.name', 'a-b']);
  });

  it('is not left stateful by a previous call', () => {
    // The pattern is module-level and `g`-flagged, so an `exec` loop would leave `lastIndex` behind and
    // the SECOND call would start mid-string. `matchAll` is what prevents that; asserted because the
    // failure only shows on the second call.
    const sql = 'SELECT ${a}, ${b}';
    expect(detectPlaceholders(sql)).toEqual(['a', 'b']);
    expect(detectPlaceholders(sql)).toEqual(['a', 'b']);
  });
});

describe('substitutePlaceholders', () => {
  it('replaces every occurrence, not just the first', () => {
    expect(substitutePlaceholders('${s}.a JOIN ${s}.b', { s: 'public' })).toBe(
      'public.a JOIN public.b'
    );
  });

  it('leaves a placeholder with no value in place', () => {
    // Better a visibly unsubstituted token than a silently empty predicate.
    expect(substitutePlaceholders('WHERE id = ${id}', {})).toBe('WHERE id = ${id}');
  });

  it('substitutes an empty string when that is the answer', () => {
    expect(substitutePlaceholders('SELECT 1 ${suffix}', { suffix: '' })).toBe('SELECT 1 ');
  });

  it('treats a value containing regex metacharacters as literal text', () => {
    // `split`/`join` rather than `replace(new RegExp(name))`, so `$&` and friends are not expanded.
    expect(substitutePlaceholders('${t}', { t: '$& (1|2) [x]' })).toBe('$& (1|2) [x]');
  });

  it('does not re-substitute a value that itself looks like a placeholder', () => {
    // `a` is substituted first and its value mentions `${b}`; iteration order is `Object.entries`, so
    // this is the one ordering-sensitive case. Recorded rather than left to chance.
    expect(substitutePlaceholders('${a}', { a: '${b}', b: 'x' })).toBe('x');
  });
});
