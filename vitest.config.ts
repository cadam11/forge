/**
 * Vitest Configuration — Joinery
 *
 * Follows a standard Vitest monorepo testing pattern:
 * - Vitest with v8 coverage
 * - Per-package test projects
 * - Shared setup files with timeout configuration
 *
 * Two projects, because the two renderers need different environments while they
 * coexist (plans/renderer-rewrite/PLAN.md §3). Coverage, thresholds and the
 * reporter stay root-level: they are whole-run concerns, not per-project ones.
 */

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        // `extends: true` inherits the root plugins (vite-tsconfig-paths), so
        // this project resolves modules exactly as the single-project config did.
        extends: true,
        test: {
          name: 'node',

          // Test discovery. renderer-react is excluded rather than left to the
          // `.ts`-only glob: a stray `.spec.ts` there would otherwise run in the
          // node environment AND load the main-process setup file below.
          include: ['packages/*/src/**/*.{test,spec}.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', 'packages/renderer-react/**'],

          // Environment
          environment: 'node',

          // Timeouts
          testTimeout: 30000,
          hookTimeout: 30000,

          // Setup files
          setupFiles: ['./packages/main/src/__tests__/setup.ts'],

          // Module resolution
          alias: {
            '@joinery/shared': new URL('./packages/shared/src', import.meta.url).pathname,
            keytar: new URL('./packages/main/src/__mocks__/keytar.ts', import.meta.url).pathname,
            ssh2: new URL('./packages/main/src/__mocks__/ssh2.ts', import.meta.url).pathname,
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'renderer-react',
          include: ['packages/renderer-react/src/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          environment: 'jsdom',
          // Only so that `?raw` imports of CSS return the file's text. Vitest's default
          // (`css: false`) stubs every CSS module to an empty string, and `?raw` is stubbed
          // with it — which silently makes `ui/cn.spec.ts`'s type-ladder drift guard compare
          // against nothing. Measured, not assumed. No spec imports CSS as a module, so
          // enabling processing has no other effect.
          css: true,
          testTimeout: 30000,
          hookTimeout: 30000,
          setupFiles: ['./packages/renderer-react/src/test/setup.ts'],

          // ONE copy of ag-grid-community, stated as an absolute path.
          //
          // `packages/renderer-react/vite.config.ts` has the full argument (two physical copies of
          // `@36` exist under `nodeLinker: hoisted`, and `ModuleRegistry` is module state, so the
          // grid reports every feature unregistered). It fixes the app with `resolve.dedupe`, which
          // resolves from ITS root; this config's root is the repo, where the deduped copy would be
          // the Angular renderer's `@35` — the wrong major to run `@36` code against. So the path is
          // spelled out, the same way `@joinery/shared`, keytar and ssh2 are in the node project.
          alias: {
            'ag-grid-community': new URL(
              './packages/renderer-react/node_modules/ag-grid-community/dist/package/main.esm.mjs',
              import.meta.url
            ).pathname,
          },
          // The alias alone is not enough: Vitest externalises `node_modules` by default, so
          // `ag-grid-react`'s own `import 'ag-grid-community'` is resolved by Node and never sees it.
          // Inlining that one package puts it through Vite's resolution, where the alias applies —
          // which is what makes both halves of the grid share one `ModuleRegistry`.
          server: { deps: { inline: ['ag-grid-react'] } },
        },
      },
    ],

    // Coverage — scoped to packages that have tests
    coverage: {
      provider: 'v8',
      include: ['packages/main/src/**/*.ts', 'packages/shared/src/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/*.d.ts',
        '**/index.ts',
        '**/node_modules/**',
        '**/dist/**',
        '**/__tests__/**',
        '**/__mocks__/**',
        // Exclude packages without tests from coverage thresholds
        'packages/renderer/**',
        'packages/renderer-react/**',
        'packages/preload/**',
        'packages/cli/**',
      ],
      thresholds: {
        statements: 10,
        branches: 5,
        functions: 10,
        lines: 10,
      },
      reporter: ['text', 'text-summary', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
    },

    // Reporter
    reporters: ['default'],
  },
});
