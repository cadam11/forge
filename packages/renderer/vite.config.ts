import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The three settings below reproduce the Angular renderer's artifact contract
 * exactly (see plans/renderer-rewrite/PLAN.md §3.1). That is what made the
 * cutover a directory rename: the six places in the pipeline that hard-code a
 * renderer path or port — electron-builder.yml, window.ts:111 and :114,
 * tests/helpers/electron-app.ts, tests/reporter/build-report.mjs, and the root
 * `dev:main` wait-on — needed no change at all. They still hold this file to
 * that contract, so do not "modernise" them.
 */
export default defineConfig({
  // @tailwindcss/vite rather than the PostCSS plugin: it is the first-party v4
  // integration and it owns the `@import "tailwindcss"` in src/styles/theme.css.
  plugins: [react(), tailwindcss()],

  // Matches angular.json's production `baseHref: "./"`. Absolute asset URLs
  // 404 when the packaged app loads index.html over file://.
  base: './',

  build: {
    // Matches Angular's dist/browser output, which window.ts:114 loads.
    outDir: 'dist/browser',
    emptyOutDir: true,
  },

  server: {
    // window.ts:111 loads http://localhost:4200 in dev and the root `dev:main`
    // script waits on that URL. strictPort makes a collision fail loudly
    // instead of silently serving a port Electron will never look at.
    port: 4200,
    strictPort: true,
  },

  // ── Deleted at cutover: `resolve.dedupe: ['ag-grid-community']` ────────────
  //
  // It existed because `nodeLinker: hoisted` gives the repo root ONE copy of each
  // package and that slot was the Angular renderer's `ag-grid-community@35`, so
  // this package's `@36` landed beside it while `ag-grid-react` got a nested
  // second `@36`. `ModuleRegistry` is module state, so the grid ran on one copy
  // and had its modules registered on the other: AG Grid error #200 for
  // RowSelection, QuickFilter, ColumnFilter, CellStyle, NumberFilter, Tooltip
  // and ColumnAutoSize — sorting, filtering, selection and auto-size silently
  // absent (Task 11 report §1). Deleting the Angular package freed the slot;
  // there is one physical copy now and the workaround is dead weight.

  optimizeDeps: {
    // The mermaid/dagre chain is CJS-only: Angular needed it declared as
    // `allowedCommonJsDependencies` (angular.json:21) and Vite needs it
    // pre-bundled for the same reason. Declared now so the ERD and chat tasks
    // don't rediscover it.
    //
    // All three are direct devDependencies of this package even though nothing
    // imports them directly. That was load-bearing at cutover: Vite hard-errors
    // on a force-included dep it cannot resolve, and the hoisted root copies
    // were dragged in by the Angular renderer this PR deleted.
    include: [
      '@dagrejs/graphlib',
      '@dagrejs/dagre',
      'nearley',
      // `@joinery/shared` is a linked workspace package, and Vite does not pre-bundle those
      // by default — which for a CJS package is fatal in dev and only in dev. Its `dist` is
      // tsc CommonJS whose surface is a chain of `__exportStar(require(…))` calls, so the dev
      // server's ESM interop cannot see the named exports through it: importing
      // `DEFAULT_SETTINGS` threw "does not provide an export named" at runtime while both
      // `vite build` (Rollup's commonjs plugin) and vitest (which aliases the package to its
      // TypeScript source) were perfectly happy. Task 5 is where this surfaced, because it is
      // the first task whose code path actually reaches a runtime *value* from the package
      // rather than a type. Forcing pre-bundling is the documented fix for exactly this case.
      //
      // Cost: a change to `packages/shared` needs the dev server restarted (or `--force`) to be
      // picked up. Cheaper than the alternatives — aliasing the package to its source would
      // diverge dev from the build, and converting shared to ESM is a `packages/shared` change
      // this plan puts out of scope (PLAN.md §8).
      //
      // PLAN.md §3.1 pencilled the ESM conversion in for this cutover PR and it did NOT land:
      // `packages/main` is CommonJS Electron and consumes the same `dist`, so the change is a
      // dual-emit (or an `exports` map) plus a main-process verification pass — real work, and
      // unrelated to deleting Angular. Tracked as a follow-up; delete this entry with it.
      '@joinery/shared',
    ],
  },
});
