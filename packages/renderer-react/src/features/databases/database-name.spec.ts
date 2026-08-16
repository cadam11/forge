/**
 * The name rule, and what it now says instead of greying a button.
 */

import { describe, expect, it } from 'vitest';

import { MAX_DATABASE_NAME_LENGTH, validateDatabaseName } from './database-name';

describe('validateDatabaseName', () => {
  it('accepts a portable identifier', () => {
    expect(validateDatabaseName('sales_2026')).toBeNull();
    expect(validateDatabaseName('_internal')).toBeNull();
  });

  it('asks for a name rather than complaining about the character set', () => {
    expect(validateDatabaseName('   ')?.message).toBe('Give the database a name.');
  });

  it('refuses what the main process would interpolate into SQL', () => {
    // The reason the rule stays narrow: main builds CREATE DATABASE by concatenation, so a name is
    // never a bound parameter anywhere in the path.
    for (const hostile of ['foo]; DROP DATABASE bar; --', 'a b', 'a-b', 'a"b', '1st', 'ünïcode']) {
      expect(validateDatabaseName(hostile)).not.toBeNull();
    }
  });

  it('caps the length at the lowest of the three engines', () => {
    expect(validateDatabaseName('a'.repeat(MAX_DATABASE_NAME_LENGTH))).toBeNull();
    expect(validateDatabaseName('a'.repeat(MAX_DATABASE_NAME_LENGTH + 1))?.message).toContain(
      '128'
    );
  });

  it('refuses the name a database already has', () => {
    expect(validateDatabaseName('sales', { currentName: 'sales' })?.message).toBe(
      'That is already its name.'
    );
    // Case-insensitively, because SQL Server and MySQL are.
    expect(validateDatabaseName('SALES', { currentName: 'sales' })).not.toBeNull();
  });

  it('names the colliding database rather than saying "taken"', () => {
    expect(validateDatabaseName('Sales', { taken: ['sales', 'orders'] })?.message).toBe(
      'This server already has a database called sales.'
    );
  });

  it('lets a rename change only the case of its own name through the collision check', () => {
    // `currentName` is checked first and refuses it, which is the correct refusal for a rename — the
    // collision message would have blamed the database for existing.
    expect(validateDatabaseName('Sales', { currentName: 'sales', taken: ['sales'] })?.message).toBe(
      'That is already its name.'
    );
  });
});
