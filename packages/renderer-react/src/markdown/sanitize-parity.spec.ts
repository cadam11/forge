import { describe, expect, it } from 'vitest';

// `?raw` on both sides, which is also why this file has no filesystem access: the package is
// compiled with no `@types/node` on purpose (see tsconfig.json), so Vite inlining the text at
// transform time is the only route a spec has to source code.
import angularSource from '../../../renderer/src/app/shared/markdown/markdown-renderer.ts?raw';
import reactSource from './render-markdown.ts?raw';

/**
 * The sanitize seam must not drift from the Angular original.
 *
 * The task brief is explicit that `render-markdown.ts` is a near-verbatim port and that the
 * sanitizer must not be "improved" — its config *is* the security review that was already done,
 * and every plausible edit to it (adding a tag so some model output renders, relaxing
 * `ALLOW_DATA_ATTR` to let a class hook through) widens the attack surface while looking like a
 * tidy-up. `render-markdown.spec.ts` catches a *behavioural* regression on the cases someone
 * thought of; this catches any edit at all.
 *
 * It compares code with comments and whitespace stripped, because the doc comments legitimately
 * differ: the Angular file names `bypassSecurityTrustHtml` and `computed()`, the React one names
 * `dangerouslySetInnerHTML` and the lint ban.
 *
 * AT CUTOVER (Task 24, which deletes `packages/renderer`) THIS FILE GOES WITH IT. The import
 * above is static, so the deletion fails the run at collection rather than quietly skipping —
 * which is the right way round: a drift guard that can silently stop guarding is worse than none.
 */

const REACT_SOURCE_PATH = 'packages/renderer-react/src/markdown/render-markdown.ts';

/**
 * Strips block comments, line comments and blank space. Safe on these two files specifically:
 * neither contains a string literal with `//` in it, which is the case this would mangle.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .join('\n');
}

describe('the sanitize seam is the Angular one', () => {
  it('is byte-identical to it once comments are stripped', () => {
    expect(codeOnly(reactSource)).toBe(codeOnly(angularSource));
  });

  it('is comparing something, not two empty strings', () => {
    // Guards `codeOnly`: a stripper that ate everything would make the check above vacuous.
    const react = codeOnly(reactSource);

    expect(react, REACT_SOURCE_PATH).toContain('FORBID_TAGS');
    expect(react).toContain('USE_PROFILES: { html: true }');
    expect(react).toContain('ALLOW_DATA_ATTR: false');
    expect(react.split('\n').length).toBeGreaterThan(40);
  });
});
