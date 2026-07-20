import { describe, it, expect } from 'vitest';
import {
  analyzePasswordHygiene,
  describePasswordHygiene,
  type PasswordHygieneIssueType,
} from './password-hygiene';

/**
 * The password is captured from a UI text field (typically pasted), unlike the
 * MJ server which reads it from a deliberately-set env var. These tests pin the
 * paste-artifact detection that protects that path — see the connection-dialog
 * warning (#2) and the AUTH_FAILED enrichment (#3).
 */
describe('analyzePasswordHygiene', () => {
  const typesOf = (pw: string): PasswordHygieneIssueType[] =>
    analyzePasswordHygiene(pw).issues.map(i => i.type);

  it('reports no issues for a clean ASCII password with special characters', () => {
    // Special characters are NOT a problem — the driver handles them natively.
    const result = analyzePasswordHygiene('P@ssw0rd!#$%&*()_+=');
    expect(result.hasIssues).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.length).toBe(19);
  });

  it('treats an empty password as clean', () => {
    const result = analyzePasswordHygiene('');
    expect(result.hasIssues).toBe(false);
    expect(result.length).toBe(0);
  });

  it('detects trailing whitespace (the classic paste artifact)', () => {
    expect(typesOf('secret ')).toContain('trailing-whitespace');
    expect(typesOf('secret\n')).toContain('trailing-whitespace');
    expect(typesOf('secret\t')).toContain('trailing-whitespace');
  });

  it('detects leading whitespace', () => {
    expect(typesOf(' secret')).toContain('leading-whitespace');
  });

  it('detects embedded control characters (e.g. a pasted line break)', () => {
    expect(typesOf('sec\nret')).toContain('control-char');
    expect(typesOf('sec\tret')).toContain('control-char');
  });

  it('detects smart/curly quotes substituted for straight quotes', () => {
    expect(typesOf('pass’word')).toContain('smart-quotes'); // ’
    expect(typesOf('pass“word”')).toContain('smart-quotes'); // “ ”
  });

  it('detects en/em dashes substituted for a hyphen-minus', () => {
    expect(typesOf('pass–word')).toContain('dash'); // –
    expect(typesOf('pass—word')).toContain('dash'); // —
  });

  it('detects a non-breaking space substituted for a regular space', () => {
    expect(typesOf('pass word')).toContain('nbsp');
  });

  it('flags other non-standard unicode as non-ascii', () => {
    expect(typesOf('passwörd')).toContain('non-ascii'); // ö
  });

  it('does not double-report a labeled look-alike as generic non-ascii', () => {
    const types = typesOf('pass’word');
    expect(types).toContain('smart-quotes');
    expect(types).not.toContain('non-ascii');
  });

  it('reports a trailing newline once — as trailing whitespace, not also control-char', () => {
    expect(typesOf('secret\n')).toEqual(['trailing-whitespace']);
    expect(typesOf('secret\t')).toEqual(['trailing-whitespace']);
    expect(typesOf(' secret')).toEqual(['leading-whitespace']);
  });

  it('does not double-report DEL as non-ascii (it is an ASCII control character)', () => {
    expect(typesOf('pass\u007Fword')).toEqual(['control-char']);
  });

  it('labels Unicode line separators as line breaks, not generic non-ascii', () => {
    expect(typesOf('sec\u2028ret')).toEqual(['control-char']); // LINE SEPARATOR
    expect(typesOf('sec\u2029ret')).toEqual(['control-char']); // PARAGRAPH SEPARATOR
    expect(typesOf('sec\u0085ret')).toEqual(['control-char']); // NEL
    // JS \s does not match NEL, so the whitespace checks miss a trailing one —
    // the control-char check must still catch it.
    expect(typesOf('secret\u0085')).toEqual(['control-char']);
  });

  it('labels non-breaking and soft hyphens as dash look-alikes', () => {
    expect(typesOf('pass\u2011word')).toEqual(['dash']); // NON-BREAKING HYPHEN
    expect(typesOf('pass\u00ADword')).toEqual(['dash']); // SOFT HYPHEN
  });

  it('labels zero-width joiners as invisible space characters', () => {
    expect(typesOf('pass\u200Cword')).toEqual(['nbsp']); // ZWNJ
    expect(typesOf('pass\u200Dword')).toEqual(['nbsp']); // ZWJ
  });

  it('counts characters as code points, not UTF-16 units', () => {
    expect(analyzePasswordHygiene('pass\u{1F4A5} ').length).toBe(6); // pass💥␠
  });

  it('each issue carries a human-readable message that does not echo the password', () => {
    const result = analyzePasswordHygiene('topsecret ');
    expect(result.hasIssues).toBe(true);
    for (const issue of result.issues) {
      expect(issue.message.length).toBeGreaterThan(0);
      expect(issue.message).not.toContain('topsecret');
    }
  });
});

describe('describePasswordHygiene', () => {
  it('returns an empty array for a clean password', () => {
    expect(describePasswordHygiene('cleanP@ss1')).toEqual([]);
  });

  it('includes the password length when issues are present (#3 diagnostic)', () => {
    const lines = describePasswordHygiene('topsecret ', { includeLength: true }); // 10 chars
    expect(lines.some(l => /10 character/.test(l))).toBe(true);
  });

  it('omits the length line by default (renderer warning #2)', () => {
    const lines = describePasswordHygiene('secret ');
    expect(lines.length).toBeGreaterThan(0);
    // No "<n> characters long" length line — that's the #3-only diagnostic.
    expect(lines.some(l => /\d+ character/.test(l))).toBe(false);
  });

  it('never includes the raw password text', () => {
    const lines = describePasswordHygiene('hunter2 ’', { includeLength: true });
    expect(lines.join(' ')).not.toContain('hunter2');
  });

  it('describes the length of the tested password — never claims storage', () => {
    // The analyzed value is whatever the test actually used (form-entered, or
    // keychain-resolved for a saved profile with a blank field), so the copy
    // must neither claim storage nor claim the user typed it.
    const lines = describePasswordHygiene('pass\u{1F4A5} ', { includeLength: true });
    expect(lines[0]).toMatch(/being tested is 6 characters/);
    expect(lines.join(' ')).not.toMatch(/stored/);
  });

  it('omits requested issue types (live banner drops the generic non-ascii bucket)', () => {
    // A typed international password (ö, é, …) is not a paste artifact; the live
    // warning suppresses 'non-ascii' while the post-failure diagnostic keeps it.
    expect(describePasswordHygiene('passwörd', { omit: ['non-ascii'] })).toEqual([]);
    const lines = describePasswordHygiene('passwörd ', { omit: ['non-ascii'] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ends with a space/);
  });

  it('emits no length line when every issue is omitted', () => {
    expect(
      describePasswordHygiene('passwörd', { omit: ['non-ascii'], includeLength: true })
    ).toEqual([]);
  });
});
