/**
 * Mermaid, loaded on first use and rendered against the live DOM.
 *
 * Ported from `markdown-viewer.component.ts`. Two things about it are load-bearing:
 *
 * - **The dynamic import stays dynamic.** Mermaid is ~190KB and most assistant messages
 *   contain no diagram. CLAUDE.md's forbidden-patterns list rules out dynamic `import()`
 *   generally; this is the documented exception (the task brief states it), and it is the
 *   only one in the package.
 * - **`securityLevel: 'strict'`.** The renderer this replaces used `'loose'`, which permits
 *   click handlers and raw HTML labels inside diagrams whose source is model-authored.
 *
 * `initialize` runs on every call rather than only the first. Caching the module but skipping
 * it would let whichever component rendered the first diagram pin the theme for the rest of
 * the process, quietly making the theme argument a no-op.
 */

import { sanitizeDiagramSvg } from './render-markdown';

/** How many diagrams one message may render. Model output is not a trusted bound. */
const MAX_DIAGRAMS_PER_MESSAGE = 20;

export type MermaidTheme = 'default' | 'base' | 'dark' | 'forest' | 'neutral';

/** The subset of mermaid's API this module uses. */
interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

let mermaidModule: MermaidApi | null = null;

async function loadMermaid(theme: MermaidTheme): Promise<MermaidApi> {
  if (!mermaidModule) {
    const { default: mermaid } = await import('mermaid');
    mermaidModule = mermaid as unknown as MermaidApi;
  }
  mermaidModule.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
    fontFamily: 'inherit',
    suppressErrorRendering: true,
  });
  return mermaidModule;
}

/**
 * Replaces every `pre > code.language-mermaid` under `root` with rendered, re-sanitized SVG.
 *
 * Returns the diagram failures as messages rather than throwing: one malformed diagram in a
 * message must not blank the other nineteen, and a failure degrades to the readable source
 * rather than to empty space.
 *
 * Unavoidably imperative — mermaid renders against a live document. Called from an effect,
 * after the sanitized HTML has been committed.
 */
export async function renderDiagramsIn(
  root: HTMLElement,
  theme: MermaidTheme
): Promise<readonly string[]> {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')
  ).slice(0, MAX_DIAGRAMS_PER_MESSAGE);
  if (blocks.length === 0) {
    return [];
  }

  const mermaid = await loadMermaid(theme);
  const failures: string[] = [];

  for (const [index, block] of blocks.entries()) {
    const pre = block.parentElement;
    if (pre === null) {
      continue;
    }
    const container = document.createElement('div');
    try {
      const { svg } = await mermaid.render(
        `diagram-${index}-${Date.now()}`,
        block.textContent ?? ''
      );
      container.className = 'mermaid-diagram';
      container.innerHTML = sanitizeDiagramSvg(svg);
    } catch (error) {
      // A malformed diagram must degrade to readable source, not blank space.
      container.className = 'mermaid-error';
      container.textContent = block.textContent ?? '';
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`Diagram failed to render: ${reason}`);
    }
    pre.replaceWith(container);
  }

  return failures;
}
