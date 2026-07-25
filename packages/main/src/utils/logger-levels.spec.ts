import { describe, expect, it } from 'vitest';
import { meetsLevel } from './logger';

describe('meetsLevel', () => {
  it('orders debug < info < warn < error', () => {
    expect(meetsLevel('debug', 'info')).toBe(false);
    expect(meetsLevel('info', 'info')).toBe(true);
    expect(meetsLevel('warn', 'info')).toBe(true);
    expect(meetsLevel('error', 'info')).toBe(true);
    expect(meetsLevel('info', 'error')).toBe(false);
    expect(meetsLevel('debug', 'debug')).toBe(true);
  });
});
