// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown-renderer';

/**
 * These tests are the contract for the only path that turns LLM output into HTML.
 *
 * The renderer this replaces never invoked Angular's sanitizer on that path
 * (`enableSvgRenderer` defaulted true, which set `bypassAngularSanitizer`), so its
 * only defence was five regexes. Every XSS case below is written against the output
 * string rather than against an assumed DOM shape, so it stays meaningful no matter
 * how DOMPurify chooses to neuter the payload — dropping the tag, dropping the
 * attribute, and escaping the markup are all acceptable outcomes; leaving it live
 * is not.
 */

/** Assertions that must hold for ANY output, regardless of input. */
function expectNoActiveContent(html: string): void {
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/\son\w+\s*=/i);
  expect(html).not.toMatch(/javascript:/i);
  expect(html).not.toMatch(/srcdoc/i);
  expect(html).not.toMatch(/<iframe/i);
  expect(html).not.toMatch(/formaction/i);
}

describe('renderMarkdown — XSS', () => {
  it('strips script elements', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expectNoActiveContent(html);
  });

  it('strips inline event handlers', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expectNoActiveContent(html);
  });

  it('strips javascript: hrefs written as raw HTML', () => {
    const html = renderMarkdown('<a href="javascript:alert(1)">click</a>');
    expectNoActiveContent(html);
  });

  it('strips entity-encoded javascript: hrefs', () => {
    // The regex-based filter this replaces matched the literal string only, so
    // &#x6a;avascript: sailed straight through it.
    const html = renderMarkdown('<a href="&#x6a;avascript:alert(1)">click</a>');
    expectNoActiveContent(html);
  });

  it('strips javascript: hrefs written as markdown links', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expectNoActiveContent(html);
  });

  it('strips iframe srcdoc', () => {
    // srcdoc appeared in none of the previous filter's five regexes.
    const html = renderMarkdown('<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>');
    expectNoActiveContent(html);
  });

  it('strips svg animation event handlers', () => {
    const html = renderMarkdown('<svg><animate onbegin="alert(1)" /></svg>');
    expectNoActiveContent(html);
    expect(html).not.toMatch(/<animate/i);
  });

  it('strips object elements pointing at data: html', () => {
    const html = renderMarkdown(
      '<object data="data:text/html,<script>alert(1)</script>"></object>'
    );
    expectNoActiveContent(html);
    expect(html).not.toMatch(/<object/i);
  });

  it('strips form controls carrying formaction', () => {
    const html = renderMarkdown(
      '<form action="/x"><button formaction="javascript:alert(1)">go</button></form>'
    );
    expectNoActiveContent(html);
    expect(html).not.toMatch(/<form/i);
  });

  it('strips style attributes carrying javascript urls', () => {
    const html = renderMarkdown('<div style="background:url(javascript:alert(1))">x</div>');
    expectNoActiveContent(html);
    expect(html).not.toMatch(/\sstyle\s*=/i);
  });

  it('strips style elements', () => {
    const html = renderMarkdown('<style>body{display:none}</style>');
    expect(html).not.toMatch(/<style/i);
  });

  it('strips data-* attributes', () => {
    const html = renderMarkdown('<div data-evil="1">x</div>');
    expect(html).not.toMatch(/data-evil/i);
  });
});

describe('renderMarkdown — fidelity', () => {
  it('renders GFM tables', () => {
    const html = renderMarkdown(['| a | b |', '| - | - |', '| 1 | 2 |'].join('\n'));
    expect(html).toMatch(/<table/);
    expect(html).toMatch(/<th/);
    expect(html).toMatch(/<td/);
  });

  it('renders GFM task lists', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');
    expect(html).toMatch(/<input/);
    expect(html).toMatch(/type="checkbox"/);
  });

  it('renders fenced code with a language- class', () => {
    // The language- class is what the code styling hangs off. DOMPurify drops
    // `class` unless it is explicitly allowed, so this is the canary for an
    // over-tight sanitizer config.
    const html = renderMarkdown('```sql\nSELECT 1;\n```');
    expect(html).toMatch(/<pre/);
    expect(html).toMatch(/<code[^>]*class="[^"]*language-sql/);
  });

  it('turns a single newline into a line break', () => {
    // breaks: true. This materially changes how LLM output reads.
    const html = renderMarkdown('one\ntwo');
    expect(html).toMatch(/<br\s*\/?>/);
  });

  it('renders the inline elements the chat CSS styles', () => {
    const html = renderMarkdown('**b** *i* `c`\n\n> quote\n\n1. one\n\n- bullet');
    expect(html).toMatch(/<strong>/);
    expect(html).toMatch(/<em>/);
    expect(html).toMatch(/<code>/);
    expect(html).toMatch(/<blockquote>/);
    expect(html).toMatch(/<ol>/);
    expect(html).toMatch(/<ul>/);
  });

  it('renders headings h1 through h4', () => {
    const html = renderMarkdown('# a\n\n## b\n\n### c\n\n#### d');
    expect(html).toMatch(/<h1[^>]*>/);
    expect(html).toMatch(/<h2[^>]*>/);
    expect(html).toMatch(/<h3[^>]*>/);
    expect(html).toMatch(/<h4[^>]*>/);
  });

  it('preserves ordinary links', () => {
    const html = renderMarkdown('[docs](https://example.com/a)');
    expect(html).toMatch(/<a[^>]+href="https:\/\/example\.com\/a"/);
  });

  it('highlights code in a known language', () => {
    // Highlighting has never actually rendered in this app — no theme CSS was
    // ever loaded — so this asserts the markup exists for the theme to colour.
    const html = renderMarkdown('```sql\nSELECT 1;\n```');
    expect(html).toMatch(/class="[^"]*hljs/);
  });

  it('leaves an unknown language unhighlighted rather than throwing', () => {
    const html = renderMarkdown('```notalanguage\nx\n```');
    expect(html).toMatch(/<code/);
    expect(html).toContain('x');
  });
});

describe('renderMarkdown — partial and hostile input', () => {
  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });

  it('tolerates an unterminated code fence mid-stream', () => {
    const html = renderMarkdown('```sql\nSELECT 1;');
    expect(html).toMatch(/<pre/);
  });

  it('tolerates a half-written table row mid-stream', () => {
    const html = renderMarkdown('| a | b |\n| - |');
    expect(typeof html).toBe('string');
  });

  it('tolerates a lone asterisk', () => {
    expect(typeof renderMarkdown('*')).toBe('string');
  });

  it('handles a 100KB document without throwing', () => {
    const big = 'lorem ipsum dolor sit amet\n\n'.repeat(4000);
    expect(big.length).toBeGreaterThan(100_000);
    const html = renderMarkdown(big);
    expect(html).toMatch(/<p>/);
  });
});
