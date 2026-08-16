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

/*
 * The four browser APIs the Task 6 primitives need and jsdom does not implement. Each one is
 * a real API used by real code, so stubbing it here is what keeps the product free of
 * `typeof x === 'function'` guards that could only ever be false under test.
 *
 * `ResizeObserver` — Radix's popper measures its trigger with one, and
 * `@tanstack/react-virtual` observes its scroll element with one. Inert rather than firing once,
 * because there is nothing for it to report: the size it would carry comes from the layout shim
 * below, which the virtualizer already reads directly.
 *
 * `scrollIntoView` / the pointer-capture trio — Radix's menus and select call them while
 * moving focus and while tracking a drag-to-select gesture. jsdom leaves all four undefined,
 * and an undefined call is a TypeError that surfaces as "arrow keys do nothing".
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.defineProperty(window, 'ResizeObserver', { writable: true, value: NoopResizeObserver });

Object.defineProperty(Element.prototype, 'scrollIntoView', {
  writable: true,
  value: () => undefined,
});
Object.defineProperty(Element.prototype, 'hasPointerCapture', {
  writable: true,
  value: () => false,
});
Object.defineProperty(Element.prototype, 'setPointerCapture', {
  writable: true,
  value: () => undefined,
});
Object.defineProperty(Element.prototype, 'releasePointerCapture', {
  writable: true,
  value: () => undefined,
});

/*
 * There is deliberately NO `offsetWidth`/`offsetHeight` shim here.
 *
 * jsdom has no layout engine, so every element reports both as 0, and the virtualized `Tree` is
 * the one primitive that reads them — `@tanstack/react-virtual` measures its scroll element with
 * exactly those two properties and renders no rows when told the element is 0px tall. Faking
 * them package-wide would answer for every element in every spec, including the layout
 * assertions Tasks 7+ will write, so the fake lives in `ui/tree.spec.tsx` scoped to the tree's
 * own scroll container. See `installTreeViewport` there.
 */
