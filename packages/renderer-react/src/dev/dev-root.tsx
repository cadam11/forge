/**
 * The dev shell that switches between the two gate pages. Replaced by the real app frame in
 * Task 7, which is also when both pages stop being the whole renderer.
 *
 * Hash-driven rather than state-driven so the gate scripts can navigate straight to a page
 * with `page.goto(BASE + '#primitives')` and screenshot it without clicking anything. The
 * links are real `<a href="#…">`, so keyboard and back-button work for free.
 */

import { useEffect, useState } from 'react';

import { cn } from '../ui';
import { PrimitivesGallery } from './primitives-gallery';
import { TokenPreview } from './token-preview';

const PRIMITIVES_HASH = '#primitives';

const PAGES = [
  { hash: '#tokens', label: 'Tokens' },
  { hash: PRIMITIVES_HASH, label: 'Primitives' },
] as const;

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return hash;
}

export function DevRoot() {
  const hash = useHash();
  const showPrimitives = hash === PRIMITIVES_HASH;

  return (
    <div className="min-h-dvh bg-canvas">
      <nav
        aria-label="Dev pages"
        className="flex items-center gap-1 border-b border-rule bg-chrome px-3 py-1.5"
      >
        {PAGES.map(page => {
          const current = page.hash === PRIMITIVES_HASH ? showPrimitives : !showPrimitives;
          return (
            <a
              key={page.hash}
              href={page.hash}
              data-testid={`dev-nav-${page.label.toLowerCase()}`}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex h-7 items-center rounded-sm px-2.5 text-base',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                current ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover'
              )}
            >
              {page.label}
            </a>
          );
        })}
      </nav>
      {showPrimitives ? <PrimitivesGallery /> : <TokenPreview />}
    </div>
  );
}
