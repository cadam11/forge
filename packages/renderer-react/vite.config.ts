import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The three settings below reproduce the Angular renderer's artifact contract
 * exactly (see plans/renderer-rewrite/PLAN.md §3.1), so the six places in the
 * pipeline that hard-code a renderer path or port need no change while the two
 * renderers coexist: electron-builder.yml:19, window.ts:111 and :114,
 * tests/helpers/electron-app.ts:22, tests/reporter/build-report.mjs:218, and the
 * root `dev:main` wait-on.
 */
export default defineConfig({
  plugins: [react()],

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

  optimizeDeps: {
    // The mermaid/dagre chain is CJS-only: Angular needed it declared as
    // `allowedCommonJsDependencies` (angular.json:21) and Vite needs it
    // pre-bundled for the same reason. Declared now so the ERD and chat tasks
    // don't rediscover it. Entries resolve through the hoisted root
    // node_modules today; the ERD task adds them as direct dependencies.
    include: ['@dagrejs/graphlib', '@dagrejs/dagre', 'nearley'],
  },
});
