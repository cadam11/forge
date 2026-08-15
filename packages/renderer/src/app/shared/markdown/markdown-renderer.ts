import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';

/**
 * The single seam that turns model-authored markdown into HTML.
 *
 * Parse with `marked`, then sanitize with DOMPurify. DOMPurify uses the browser's
 * real HTML parser rather than pattern matching, which is what makes it correct on
 * the cases a regex filter misses — entity-encoded scheme names, `srcdoc`, and
 * attribute smuggling generally.
 *
 * Callers must not bypass this function. `bypassSecurityTrustHtml` is applied to
 * its output, never to raw model text.
 */

/** Built once. Rebuilding per call would re-register every extension on each streamed chunk. */
const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang: string): string {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
  {
    gfm: true,
    // A single newline becomes <br>. Model output leans on this heavily; changing
    // it silently reflows every message in the app.
    breaks: true,
    async: false,
  }
);

/**
 * Tags with no legitimate place in chat output, each of which is an execution or
 * exfiltration vector on its own:
 * - `style` can hide or reposition UI over the rest of the app
 * - `iframe` / `object` / `embed` load and execute foreign documents
 * - `form` turns any nested control into an outbound request
 * - `svg` / `math` carry their own script-bearing element sets; mermaid's SVG is
 *   sanitized separately against the SVG profile, so it does not need this path
 *
 * `input` is deliberately NOT forbidden: GFM task lists render as disabled
 * checkboxes, and dropping it would silently degrade a common model output. Every
 * event handler is stripped regardless, and `formaction` is forbidden below, so an
 * input outside a form has no way to act.
 */
const FORBID_TAGS = ['style', 'iframe', 'object', 'embed', 'form', 'svg', 'math'];

const FORBID_ATTR = ['srcdoc', 'style', 'formaction', 'xlink:href', 'ping'];

const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  // `class` carries the language-*/hljs-* hooks the code styling depends on.
  // Without this, fenced code renders unstyled.
  ADD_ATTR: ['class'],
  FORBID_TAGS,
  FORBID_ATTR,
  ALLOW_DATA_ATTR: false,
};

/**
 * Render markdown to HTML that is safe to bind with `[innerHTML]`.
 *
 * Pure apart from DOMPurify's use of a detached document. Never throws on partial
 * or malformed input — mid-stream chunks routinely arrive with unterminated fences.
 */
export function renderMarkdown(md: string): string {
  if (typeof md !== 'string') {
    throw new TypeError(`renderMarkdown expects a string, received ${typeof md}`);
  }
  if (md === '') {
    return '';
  }

  // `async: false` above makes this synchronous; the cast documents that.
  const rawHtml = marked.parse(md) as string;
  return DOMPurify.sanitize(rawHtml, SANITIZE_CONFIG);
}

/**
 * Sanitize mermaid's rendered SVG against the SVG profile.
 *
 * Kept separate from {@link renderMarkdown} because that path forbids `svg`
 * outright. Mermaid runs with `securityLevel: 'strict'`, but its output is still
 * derived from model-authored diagram source, so it is sanitized rather than
 * trusted.
 */
export function sanitizeDiagramSvg(svg: string): string {
  if (typeof svg !== 'string') {
    throw new TypeError(`sanitizeDiagramSvg expects a string, received ${typeof svg}`);
  }
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject'],
    FORBID_ATTR: ['xlink:href', 'href', 'formaction'],
    ALLOW_DATA_ATTR: false,
  });
}
