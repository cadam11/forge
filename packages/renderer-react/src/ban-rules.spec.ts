/**
 * The regression guard for the three path-scoped bans in `eslint.config.js`.
 *
 * This exists because the bans are *not* self-evidently correct. `no-restricted-syntax`
 * options do not merge across flat-config objects — for any given file the last matching
 * object replaces the rule's options wholesale — so the natural spelling of "two bans with
 * two different exemptions" silently deletes one of them. The config partitions its file
 * sets to work around that, and a partition is exactly the kind of thing that rots when
 * someone later adds a fourth block. So the behaviour is asserted rather than described.
 *
 * It drives ESLint's Node API over virtual file paths instead of committing fixture files.
 * A committed fixture that violates a ban would have to fail `pnpm lint` forever.
 */

import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

/**
 * Vite rewrites the two-argument `new URL(path, import.meta.url)` form as an asset
 * reference, which mangles it into a repo-relative path. Parsing the single-argument form
 * and trimming avoids that transform, and — unlike `__dirname` or `path.resolve` — needs no
 * `@types/node`, which this package's tsconfig deliberately omits.
 */
const PACKAGE_DIR = new URL(import.meta.url).pathname.replace(/\/src\/.*$/, '');

const INNER_HTML = 'export const a = () => <div dangerouslySetInnerHTML={{ __html: x }} />;\n';
const BRIDGE = 'export const b = () => window.joinery.app.getVersion();\n';
const BRIDGE_VIA_CAST = 'export const c = () => (window as unknown as W).joinery;\n';
// No identifier named `joinery` anywhere in this one — the property is a string literal, so
// it defeats both the `object.name="window"` and the bare-`Identifier` selectors.
const BRIDGE_VIA_COMPUTED = "export const d = () => (window as unknown as R)['joinery'];\n";
// The query-key door. Task 4's fence: only src/ipc/ may name it, so invalidation goes through
// `useInvalidateIpc` and reads go through `useIpcQuery`, which builds its own key.
const KEY_FACTORY = "import { ipcKeys } from '../ipc/keys';\nexport const e = ipcKeys.app.all;\n";

/** Rule ids reported for `source` when linted as if it lived at `relativePath`. */
async function lint(relativePath: string, source: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: PACKAGE_DIR });
  const [result] = await eslint.lintText(source, { filePath: `${PACKAGE_DIR}/${relativePath}` });
  return (result?.messages ?? []).map(message => message.ruleId ?? 'unknown');
}

const banned = (rules: string[]) => rules.includes('no-restricted-syntax');

describe('the dangerouslySetInnerHTML / window.joinery bans', () => {
  describe('an ordinary source file — both bans apply', () => {
    it('rejects dangerouslySetInnerHTML', async () => {
      expect(banned(await lint('src/features/thing.tsx', INNER_HTML))).toBe(true);
    });

    it('rejects window.joinery', async () => {
      expect(banned(await lint('src/features/thing.tsx', BRIDGE))).toBe(true);
    });

    it('rejects window.joinery reached through a cast', async () => {
      // The precise `MemberExpression[object.name="window"]` selector does not match a
      // TSAsExpression, so this is the case the backstop selector exists for. It is also the
      // first thing someone working around the guard would try.
      expect(banned(await lint('src/features/thing.tsx', BRIDGE_VIA_CAST))).toBe(true);
    });

    it('rejects window.joinery reached through computed access', async () => {
      // `(window as Cast)['joinery']` defeats both of the other selectors, and did lint clean
      // until the third one was added. This is the assertion that keeps it closed.
      expect(banned(await lint('src/features/thing.tsx', BRIDGE_VIA_COMPUTED))).toBe(true);
    });

    it('rejects ipcKeys', async () => {
      expect(banned(await lint('src/state/thing.ts', KEY_FACTORY))).toBe(true);
    });
  });

  describe('src/markdown/ — the sanitizing component (Task 6)', () => {
    it('permits dangerouslySetInnerHTML', async () => {
      expect(banned(await lint('src/markdown/markdown.tsx', INNER_HTML))).toBe(false);
    });

    it('still rejects window.joinery, because the exemption is narrow', async () => {
      expect(banned(await lint('src/markdown/markdown.tsx', BRIDGE))).toBe(true);
    });

    it('still rejects ipcKeys, for the same reason', async () => {
      expect(banned(await lint('src/markdown/markdown.tsx', KEY_FACTORY))).toBe(true);
    });
  });

  describe('src/ipc/ — the one bridge boundary', () => {
    it('permits window.joinery', async () => {
      expect(banned(await lint('src/ipc/api.ts', BRIDGE))).toBe(false);
    });

    it('permits ipcKeys, which lives here', async () => {
      expect(banned(await lint('src/ipc/thing.ts', KEY_FACTORY))).toBe(false);
    });

    it('still rejects dangerouslySetInnerHTML', async () => {
      expect(banned(await lint('src/ipc/thing.tsx', INNER_HTML))).toBe(true);
    });
  });

  it('keeps both bans live in the same file — the merge trap this config avoids', async () => {
    // The regression that matters. With the two bans written as separate blocks each
    // carrying its own `ignores`, this returned ZERO errors: the second block replaced the
    // first block's options rather than adding to them.
    const rules = await lint('src/features/thing.tsx', INNER_HTML + BRIDGE);

    expect(rules.filter(rule => rule === 'no-restricted-syntax').length).toBeGreaterThanOrEqual(2);
  });
});
