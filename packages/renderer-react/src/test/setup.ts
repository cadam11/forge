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
 * jsdom has no layout engine, so every element reports `offsetWidth`/`offsetHeight` as 0. That
 * is not a missing API but a wrong answer, and one primitive depends on the right one:
 * `@tanstack/react-virtual` measures its scroll element with exactly those two properties
 * (`virtual-core/dist/esm/index.js:14-17`) and renders zero rows when told the element is 0px
 * tall. A virtualized `Tree` would then satisfy every "does not render X" assertion vacuously,
 * which is why `tree.spec.tsx` opens by counting rows.
 *
 * A fixed viewport-sized box is the smallest coherent lie that fixes it. The `initialRect` the
 * Tree passes is NOT enough on its own: virtual-core calls its rect handler once, synchronously,
 * with the measured size, which overwrites the initial guess before the first render — measured,
 * not assumed.
 */
const JSDOM_VIEWPORT = { width: 1024, height: 768 };

Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get: () => JSDOM_VIEWPORT.width,
});
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get: () => JSDOM_VIEWPORT.height,
});
