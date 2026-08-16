import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderDiagramsIn } from './mermaid';

/**
 * `mermaid.ts` is orchestration around one vendor call, and the two branches worth asserting
 * are exactly the ones a happy-path render never reaches: what a malformed diagram does to the
 * other diagrams in the same message, and whether the per-message cap is real.
 *
 * The vendor module is mocked, which is also the only way to run this at all — the real one is
 * ~190KB behind a dynamic import, and `securityLevel`/theme handling is mermaid's business,
 * not this module's.
 */

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn<(id: string, source: string) => Promise<{ svg: string }>>(),
}));

vi.mock('mermaid', () => ({ default: mermaid }));

/** A trivially valid SVG, so the real `sanitizeDiagramSvg` has something to keep. */
const SVG = '<svg viewBox="0 0 10 10"><g><text>ok</text></g></svg>';

function mount(sources: readonly string[]): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = sources
    .map(source => `<pre><code class="language-mermaid">${source}</code></pre>`)
    .join('');
  document.body.append(root);
  return root;
}

beforeEach(() => {
  document.body.replaceChildren();
  mermaid.initialize.mockClear();
  mermaid.render.mockReset();
  mermaid.render.mockResolvedValue({ svg: SVG });
});

describe('renderDiagramsIn', () => {
  it('does not load mermaid for a message with no diagrams', async () => {
    const root = mount([]);
    root.innerHTML = '<p>No diagrams here.</p>';

    const failures = await renderDiagramsIn(root, 'dark');

    expect(failures).toEqual([]);
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('degrades a failed diagram to its readable source and renders the rest', async () => {
    mermaid.render.mockImplementation(async (_id, source) => {
      if (source.includes('broken')) {
        throw new Error('Parse error on line 1');
      }
      return { svg: SVG };
    });
    const root = mount(['graph TD; A-->B', 'broken diagram source', 'graph TD; C-->D']);

    const failures = await renderDiagramsIn(root, 'dark');

    // One failure reported, not thrown: one malformed diagram must not blank the others.
    expect(failures).toEqual(['Diagram failed to render: Parse error on line 1']);
    expect(root.querySelectorAll('.mermaid-diagram')).toHaveLength(2);

    const degraded = root.querySelector('.mermaid-error');
    // The source, still readable — the failure is not empty space, and it is text rather than
    // markup, so a diagram body cannot become live DOM on the way to the error state.
    expect(degraded?.textContent).toBe('broken diagram source');
    expect(degraded?.querySelector('*')).toBeNull();

    // Every block is replaced either way, so no `<pre>` is left behind next to its rendering.
    expect(root.querySelectorAll('pre')).toHaveLength(0);
  });

  it('renders at most 20 diagrams and leaves the rest as source', async () => {
    const root = mount(Array.from({ length: 25 }, (_, index) => `graph TD; A-->N${index}`));

    const failures = await renderDiagramsIn(root, 'dark');

    expect(failures).toEqual([]);
    // Model output is not a trusted bound: the cap is what stops one message rendering 500
    // diagrams, and the five over it stay as the `<pre>` blocks they already were.
    expect(mermaid.render).toHaveBeenCalledTimes(20);
    expect(root.querySelectorAll('.mermaid-diagram')).toHaveLength(20);
    expect(root.querySelectorAll('pre > code.language-mermaid')).toHaveLength(5);
  });

  it('re-initializes on every call, so the theme argument is never a no-op', async () => {
    const root = mount(['graph TD; A-->B']);

    await renderDiagramsIn(root, 'dark');
    await renderDiagramsIn(mount(['graph TD; A-->B']), 'neutral');

    expect(mermaid.initialize).toHaveBeenCalledTimes(2);
    expect(mermaid.initialize.mock.calls[0]?.[0]).toMatchObject({
      theme: 'dark',
      securityLevel: 'strict',
    });
    // Whichever component rendered the first diagram must not pin the theme for the process.
    expect(mermaid.initialize.mock.calls[1]?.[0]).toMatchObject({ theme: 'neutral' });
  });
});
