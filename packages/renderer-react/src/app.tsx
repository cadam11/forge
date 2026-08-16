/**
 * Root. Renders the dev shell — the Task 2 token preview plus the Task 6 primitives gallery —
 * and nothing at all in a production build, until the real shell lands in Task 7 and takes the
 * other side of this branch.
 *
 * The `import.meta.env.DEV` guard is a build lever, not a runtime preference: it is statically
 * `false` in a production bundle, so the ternary and every module reachable only from `DevRoot`
 * are dropped by dead-code elimination. Verified by measuring the output, not assumed — the
 * main chunk went 766.14KB → 525.62KB (241.87 → 167.48KB gzip) and mermaid's 20 lazy chunks
 * disappeared, leaving one JS file where there were 21. What did NOT drop is `highlight.js` +
 * `marked` + DOMPurify: `render-markdown.ts` builds its `Marked` instance at module scope, and
 * a bundler preserves the top-level side effects of any module in the graph even when none of
 * its exports survive. Task 7 imports `Markdown` for real, so that is where it belongs anyway.
 *
 * `IpcQueryProvider` is mounted here rather than deeper because TanStack Query's cache is
 * app-wide: hoisting it later would discard every cached result at the seam.
 */

import { DevRoot } from './dev/dev-root';
import { IpcQueryProvider } from './ipc';

export function App() {
  return <IpcQueryProvider>{import.meta.env.DEV ? <DevRoot /> : null}</IpcQueryProvider>;
}
