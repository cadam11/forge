import { describe, expect, it } from 'vitest';
import type { RestoreRequest } from '@mj-forge/shared';
import {
  resolveReplaceExisting,
  buildPgRestoreArgs,
  buildMysqlRestorePrelude,
} from './backup-args';

const baseRequest = (over: Partial<RestoreRequest> = {}): RestoreRequest => ({
  connectionId: 'c1',
  backupPath: '/tmp/dump.sql',
  ...over,
});

describe('resolveReplaceExisting', () => {
  it('is false when neither flag is set', () => {
    expect(resolveReplaceExisting(baseRequest())).toBe(false);
  });

  it('honors replaceExisting', () => {
    expect(resolveReplaceExisting(baseRequest({ replaceExisting: true }))).toBe(true);
  });

  // The renderer restore dialog only ever populates `withReplace` — the bug
  // was that the PG/MySQL services checked `replaceExisting`, so the user's
  // "Overwrite" checkbox was silently dropped. Pin both spellings.
  it('honors withReplace (the alias the dialog actually sends)', () => {
    expect(resolveReplaceExisting(baseRequest({ withReplace: true }))).toBe(true);
  });

  it('treats either flag being true as true', () => {
    expect(resolveReplaceExisting(baseRequest({ replaceExisting: false, withReplace: true }))).toBe(
      true
    );
  });
});

describe('buildPgRestoreArgs', () => {
  const profile = { server: 'db.example.com', port: 5432, username: 'pguser' };

  it('builds base args with verbose and the backup path last', () => {
    const args = buildPgRestoreArgs(profile, baseRequest(), 'targetdb');
    expect(args).toEqual([
      '-h',
      'db.example.com',
      '-p',
      '5432',
      '-U',
      'pguser',
      '-d',
      'targetdb',
      '-v',
      '/tmp/dump.sql',
    ]);
  });

  it('adds --clean --if-exists when withReplace is set, before the positional path', () => {
    const args = buildPgRestoreArgs(profile, baseRequest({ withReplace: true }), 'targetdb');
    const cleanIdx = args.indexOf('--clean');
    expect(cleanIdx).toBeGreaterThan(-1);
    expect(args[cleanIdx + 1]).toBe('--if-exists');
    // pg_restore options must precede the positional archive path.
    expect(cleanIdx).toBeLessThan(args.indexOf('/tmp/dump.sql'));
  });

  it('defaults the username to postgres', () => {
    const args = buildPgRestoreArgs({ server: 'h', port: 5432 }, baseRequest(), 'd');
    expect(args[args.indexOf('-U') + 1]).toBe('postgres');
  });
});

describe('buildMysqlRestorePrelude', () => {
  it('creates the target database if missing and uses it (no replace)', () => {
    expect(buildMysqlRestorePrelude('mydb', false)).toBe(
      'CREATE DATABASE IF NOT EXISTS `mydb`;\nUSE `mydb`;\n'
    );
  });

  // With replace, the existing database must be dropped first so the dump
  // restores into a clean schema rather than colliding with existing objects.
  it('drops and recreates the target database when replace is set', () => {
    expect(buildMysqlRestorePrelude('mydb', true)).toBe(
      'DROP DATABASE IF EXISTS `mydb`;\nCREATE DATABASE `mydb`;\nUSE `mydb`;\n'
    );
  });
});
