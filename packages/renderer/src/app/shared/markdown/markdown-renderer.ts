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
 * The interactive controls (`button`, `select`, `textarea`, `option`, `label`) are
 * forbidden for a different reason than the rest: not because they can execute
 * anything — event handlers and `formaction` are stripped — but because chat
 * renders model output and tool results inside the app's own chrome, with no
 * visual boundary marking where untrusted content begins. A working text field
 * next to an "Approve" button is a credible spoof even when it is completely inert.
 *
 * `input` is the deliberate exception: GFM task lists render as disabled
 * checkboxes, and forbidding it would silently degrade a common model output. It
 * is narrowed to exactly that shape by the hook below.
 */
const FORBID_TAGS = [
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'svg',
  'math',
  'button',
  'select',
  'textarea',
  'option',
  'label',
];

const FORBID_ATTR = ['srcdoc', 'style', 'formaction', 'xlink:href', 'ping'];

/**
 * Narrows `input` to the disabled checkbox a GFM task list needs. Anything else —
 * a text field, `type="image"` (which is an outbound GET at render time) — is
 * dropped. Registered once at module scope; DOMPurify hooks are global.
 */
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName !== 'input') {
    return;
  }
  const element = node as Element;
  const isTaskListCheckbox = element.getAttribute('type')?.toLowerCase() === 'checkbox';
  if (!isTaskListCheckbox) {
    element.remove();
    return;
  }
  element.setAttribute('disabled', '');
});

const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  // Belt-and-braces: `class` is already in DOMPurify's html profile, so this
  // widens nothing. It is here so that a future profile change cannot silently
  // strip the language-*/hljs-* hooks the code styling hangs off.
  ADD_ATTR: ['class'],
  FORBID_TAGS,
  FORBID_ATTR,
  ALLOW_DATA_ATTR: false,
};

/**
 * Render markdown to HTML that is safe to bind with `[innerHTML]`.
 *
 * Pure apart from DOMPurify's use of a detached document. Tolerates any string,
 * including partial input — mid-stream chunks routinely arrive with unterminated
 * fences. Throws only on a non-string argument, which is a programming error;
 * callers read this inside a `computed()`, so a throw there takes down the view.
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
 *
 * KNOWN LIMITATION: `<style>` survives here, and a `<style>` inside an inline SVG
 * joins the *document* stylesheet set — so CSS that escapes the diagram can
 * restyle the whole app. It cannot be forbidden outright because every diagram
 * colour mermaid emits lives in that block. This is defence-in-depth only: mermaid
 * at `securityLevel: 'strict'` prefixes its selectors with the diagram id and
 * rejects `%%{init: themeCSS}%%` and `classDef` brace-escape attempts, so no
 * model-authored CSS is known to reach here. Scoping or re-providing that CSS from
 * app styles is tracked as follow-up work.
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
