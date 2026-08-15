import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest runs without `globals: true`, so Testing Library's automatic teardown
// never registers itself. Without this, mounted trees leak between test files
// in the same worker and queries match stale DOM.
afterEach(() => {
  cleanup();
});

// jsdom implements neither `matchMedia` nor a working `FontFaceSet`. Both are real
// browser APIs the theme depends on — matchMedia resolves the `system` state of the
// three-state theme control, and FontFaceSet is how the preview page proves the three
// brand faces loaded instead of silently falling back. Stubbing them here keeps the
// product code free of `typeof window.matchMedia === 'function'` guards that would only
// ever be false under test. The real behaviour is covered by the browser gate.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

Object.defineProperty(document, 'fonts', {
  writable: true,
  value: {
    ready: Promise.resolve(),
    load: () => Promise.resolve([]),
    // false, not true: a stub must not be able to make the font-load assertion pass.
    check: () => false,
  },
});
