/**
 * Vitest configuration for the integration tier of the regression harness.
 *
 * Picks up tests under `tests/integration/**` only. These tests require the
 * docker-compose.test.yml network to be running:
 *   npm run test:harness:up
 *
 * Kept separate from the default `vitest.config.ts` so that `npm run test`
 * remains a fast, no-infrastructure unit-test pass.
 */

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/integration/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],

    environment: 'node',

    // Integration ops involve DB roundtrips. Be patient but bounded.
    testTimeout: 60000,
    hookTimeout: 60000,

    // Run sequentially to keep DB contention obvious. Once we have more tests
    // we can revisit per-engine parallelism with `withFreshDatabase` isolation.
    fileParallelism: false,

    // Module resolution.
    //
    // - `@forgedb/shared` and `@forgedb/main` resolve to source so tests
    //   import the same code Forge runs in production.
    // - `keytar` is mocked so tests never touch the real macOS Keychain.
    //   The native module also wouldn't load reliably in a CI runner.
    // - `ssh2` is intentionally NOT mocked — the SSH tunnel integration tests
    //   need the real implementation to talk to the bastion container.
    alias: {
      '@forgedb/shared': new URL('./packages/shared/src', import.meta.url).pathname,
      '@forgedb/main': new URL('./packages/main/src', import.meta.url).pathname,
      keytar: new URL('./packages/main/src/__mocks__/keytar.ts', import.meta.url).pathname,
    },

    reporters: ['default'],
  },
});
