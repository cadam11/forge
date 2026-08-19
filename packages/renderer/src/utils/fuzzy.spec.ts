/**
 * The shared matcher, on crafted fixtures.
 *
 * The point of these tests is not that the scores are particular numbers — it is that the ORDER is
 * the one a user expects, and that a non-match scores zero. Both are properties the Angular `Fuse`
 * indexes at `threshold: 0.4` did not have: they answered "customers" for "orders".
 */

import { describe, expect, it } from 'vitest';

import { fuzzyScore, rankFuzzy, type FuzzyCandidate } from './fuzzy';

/** Candidates whose only searchable field is their own name. */
function named(...names: readonly string[]): FuzzyCandidate<string>[] {
  return names.map(name => ({ item: name, fields: [{ text: name }] }));
}

function order(query: string, ...names: readonly string[]): string[] {
  return rankFuzzy(query, named(...names), { limit: 50 }).map(result => result.item);
}

describe('fuzzyScore', () => {
  it('scores an exact match highest, then a prefix, then a word start, then a substring', () => {
    expect(fuzzyScore('orders', 'orders')).toBe(1);
    expect(fuzzyScore('orders', 'orders_archive')).toBe(0.9);
    expect(fuzzyScore('orders', 'sales.orders')).toBe(0.8);
    expect(fuzzyScore('orders', 'reorders')).toBe(0.7);
  });

  it('is case-insensitive in both directions', () => {
    expect(fuzzyScore('ORDERS', 'orders')).toBe(1);
    expect(fuzzyScore('orders', 'ORDERS')).toBe(1);
  });

  it('treats a scattered subsequence as a weak match, tighter spans scoring higher', () => {
    const tight = fuzzyScore('ordid', 'order_id');
    const loose = fuzzyScore('ordid', 'order_number_and_invoice_date');
    expect(tight).toBeGreaterThan(0);
    expect(tight).toBeLessThan(0.7);
    expect(tight).toBeGreaterThan(loose);
  });

  it('scores a non-match zero rather than something small', () => {
    // The Fuse-at-0.4 failure, named: five of "customers"' letters appear in order in "orders", so a
    // distance-based matcher rates them related. A subsequence test does not, because "orders" has no
    // `c`.
    expect(fuzzyScore('orders', 'customers')).toBe(0);
    expect(fuzzyScore('xyz', 'orders')).toBe(0);
  });

  it('scores nothing against an empty query or an empty field', () => {
    expect(fuzzyScore('', 'orders')).toBe(0);
    expect(fuzzyScore('   ', 'orders')).toBe(0);
    expect(fuzzyScore('orders', '')).toBe(0);
  });
});

describe('rankFuzzy', () => {
  it('puts the exact table before its prefixed and qualified neighbours', () => {
    expect(order('orders', 'work_order_items', 'sales.orders', 'orders_archive', 'orders')).toEqual(
      ['orders', 'orders_archive', 'sales.orders', 'work_order_items']
    );
  });

  it('drops candidates that do not match at all', () => {
    expect(order('orders', 'customers', 'orders', 'invoices')).toEqual(['orders']);
  });

  it('treats an empty query as "no filter", keeping the given order', () => {
    expect(order('', 'zeta', 'alpha', 'mid')).toEqual(['zeta', 'alpha', 'mid']);
    expect(order('  ', 'zeta', 'alpha')).toEqual(['zeta', 'alpha']);
  });

  it('caps the result at the limit, filtered and unfiltered alike', () => {
    const many = named(...Array.from({ length: 40 }, (_, index) => `orders_${index}`));
    expect(rankFuzzy('orders', many, { limit: 5 })).toHaveLength(5);
    expect(rankFuzzy('', many, { limit: 3 })).toHaveLength(3);
    expect(rankFuzzy('orders', many, { limit: 0 })).toHaveLength(0);
  });

  it('weights fields, so a label match beats the same match in a description', () => {
    const candidates: FuzzyCandidate<string>[] = [
      { item: 'described', fields: [{ text: 'Export results' }, { text: 'format', weight: 0.6 }] },
      { item: 'labelled', fields: [{ text: 'Format SQL' }, { text: 'indent', weight: 0.6 }] },
    ];

    expect(rankFuzzy('format', candidates, { limit: 5 }).map(r => r.item)).toEqual([
      'labelled',
      'described',
    ]);
  });

  it('scores a candidate on its best field, not its first', () => {
    const candidates: FuzzyCandidate<string>[] = [
      { item: 'tagged', fields: [{ text: 'Nightly job' }, { text: 'orders', weight: 1 }] },
    ];
    expect(rankFuzzy('orders', candidates, { limit: 5 }).map(r => r.item)).toEqual(['tagged']);
  });

  it('keeps input order between equal scores, which is what group order depends on', () => {
    // Both are pure prefix matches at 0.9. A stable sort is the only reason the palette's
    // group-by-group order survives a query.
    expect(order('or', 'orders', 'organisations')).toEqual(['orders', 'organisations']);
  });
});
