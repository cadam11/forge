/**
 * The markdown surface. `Markdown` is the component; the two `render*`/`sanitize*` functions
 * are exported because the chat task needs to render sanitized HTML into places that are not
 * this component (a tool-result summary, a notification body) and must not grow a second
 * parser to do it.
 */

export { addCopyButtons, COPY_BUTTON_CLASS } from './copy-buttons';
export { Markdown, type MarkdownProps } from './markdown';
export { renderDiagramsIn, type MermaidTheme } from './mermaid';
export { renderMarkdown, sanitizeDiagramSvg } from './render-markdown';
