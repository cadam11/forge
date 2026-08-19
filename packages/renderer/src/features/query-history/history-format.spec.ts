/**
 * The row's four formatters. `formatRelativeTime` takes `now`, which is the only reason these are
 * testable at all — the Angular originals read the clock inside themselves.
 */

import { describe, expect, it } from 'vitest';

import { firstSqlLine, formatDuration, formatRelativeTime, shortError } from './history-format';

const NOW = Date.parse('2026-08-16T12:00:00.000Z');

describe('firstSqlLine', () => {
  it('takes the first line and trims it', () => {
    expect(firstSqlLine('  select 1\nfrom t\n')).toBe('select 1');
  });

  it('caps a long single line with an ellipsis', () => {
    expect(firstSqlLine('x'.repeat(200), 10)).toBe(`${'x'.repeat(10)}…`);
  });

  it('survives an empty statement', () => {
    expect(firstSqlLine('')).toBe('');
  });
});

describe('shortError', () => {
  it('leaves a short message alone and caps a long one', () => {
    expect(shortError('boom')).toBe('boom');
    expect(shortError('y'.repeat(80), 5)).toBe(`${'y'.repeat(5)}…`);
  });
});

describe('formatRelativeTime', () => {
  it('reads the four buckets', () => {
    expect(formatRelativeTime('2026-08-16T11:59:40.000Z', NOW)).toBe('Just now');
    expect(formatRelativeTime('2026-08-16T11:48:00.000Z', NOW)).toBe('12m ago');
    expect(formatRelativeTime('2026-08-16T09:00:00.000Z', NOW)).toBe('3h ago');
    expect(formatRelativeTime('2026-08-14T12:00:00.000Z', NOW)).toBe('2d ago');
  });

  it('falls back to a date past a week', () => {
    // The exact rendering is locale-dependent, so what is asserted is that it stopped being relative.
    expect(formatRelativeTime('2026-07-01T12:00:00.000Z', NOW)).not.toContain('ago');
  });

  it('loses the date rather than rendering "Invalid Date"', () => {
    expect(formatRelativeTime('not a date', NOW)).toBe('');
  });
});

describe('formatDuration', () => {
  it('switches unit at a second and at a minute', () => {
    expect(formatDuration(840)).toBe('840ms');
    expect(formatDuration(1400)).toBe('1.4s');
    expect(formatDuration(150_000)).toBe('2.5m');
  });
});
