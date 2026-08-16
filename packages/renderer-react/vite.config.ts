import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The three settings below reproduce the Angular renderer's artifact contract
 * exactly (see plans/renderer-rewrite/PLAN.md §3.1), so the six places in the
 * pipeline that hard-code a renderer path or port need no change while the two
 * renderers coexist: electron-builder.yml:19, window.ts:111 and :114,
 * tests/helpers/electron-app.ts:22, tests/reporter/build-report.mjs:218, and the
 * root `dev:main` wait-on.
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

  resolve: {
    /**
     * ONE copy of `ag-grid-community` in the bundle, and this is not an optimisation.
     *
     * `nodeLinker: hoisted` (pnpm-workspace.yaml) puts a single version of each package at the repo
     * root, and that slot is taken by the **Angular** renderer's `ag-grid-community@35`. So this
     * package's `@36` lands in `packages/renderer-react/node_modules`, while `ag-grid-react@36` —
     * hoisted to the root, with `ag-grid-community@36` pinned as an exact dependency rather than a
     * peer — gets its own nested `@36`. Two physical copies of the same version.
     *
     * That is fatal rather than merely wasteful: `ModuleRegistry` is module state.
     * `results-grid.tsx` registers `AllCommunityModule` on the copy IT imports, the grid runs on the
     * copy `ag-grid-react` imports, and the grid then reports every feature as unregistered — AG
     * Grid error #200 for RowSelection, QuickFilter, ColumnFilter, CellStyle, NumberFilter, Tooltip
     * and ColumnAutoSize. Measured: that is exactly what the unit tier printed before this line
     * existed. A grid with no sorting and no filtering, with the only symptom a console error.
     *
     * `dedupe` resolves the specifier from this package's root, which is the `@36` next to us — the
     * exact version `ag-grid-react` pins. It goes away at cutover, when the Angular renderer and its
     * `@35` are deleted and the root slot is free. `vitest.config.ts` states the same rule as an
     * explicit alias, for the same reason.
     */
    dedupe: ['ag-grid-community'],
  },

  optimizeDeps: {
    // The mermaid/dagre chain is CJS-only: Angular needed it declared as
    // `allowedCommonJsDependencies` (angular.json:21) and Vite needs it
    // pre-bundled for the same reason. Declared now so the ERD and chat tasks
    // don't rediscover it.
    //
    // All three are direct devDependencies of this package even though nothing
    // imports them yet. That is load-bearing: Vite hard-errors on a force-included
    // dep it cannot resolve, and relying on the hoisted root node_modules would
    // mean the dev server stops booting the moment the cutover PR deletes the
    // Angular renderer that drags them in.
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
      '@joinery/shared',
    ],
  },
});
