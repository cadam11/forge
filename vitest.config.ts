/**
 * Vitest Configuration — Forge
 *
 * Follows a standard Vitest monorepo testing pattern:
 * - Vitest with v8 coverage
 * - Per-package test projects
 * - Shared setup files with timeout configuration
 */

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Test discovery
    include: ['packages/*/src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],

    // Environment
    environment: 'node',

    // Timeouts
    testTimeout: 30000,
    hookTimeout: 30000,

    // Setup files
    setupFiles: ['./packages/main/src/__tests__/setup.ts'],

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

    // Module resolution
    alias: {
      '@forgedb/shared': new URL('./packages/shared/src', import.meta.url).pathname,
      keytar: new URL('./packages/main/src/__mocks__/keytar.ts', import.meta.url).pathname,
      ssh2: new URL('./packages/main/src/__mocks__/ssh2.ts', import.meta.url).pathname,
    },

    // Reporter
    reporters: ['default'],
  },
});
