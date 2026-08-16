/**
 * The project-level guard for this tier: **every spec here must launch the React renderer, and must
 * launch it through `withJoineryReact`.**
 *
 * Why it exists (Task 8 review finding). `tests/helpers/electron-app.ts` defaults `renderer` to
 * `$JOINERY_E2E_RENDERER`, then to `angular` — that default IS the coexistence invariant, so it
 * cannot be changed. The consequence is that a spec in `tests/e2e-react/` which imports the plain
 * `withJoinery` by mistake runs green **against the Angular renderer**, asserting nothing about the
 * package it lives to test. Nothing in the type system distinguishes the two calls.
 *
 * The fixture closes that. `withJoineryReact` records `LaunchedApp.renderer` — the value the launcher
 * resolved, not the one the helper asked for — and this auto fixture checks the log after every test:
 *
 *  - **every recorded launch is `react`**, which catches an explicit `renderer: 'angular'`;
 *  - **at least one launch was recorded**, which catches the stray `withJoinery`, because a launch
 *    that did not go through the pinned helper leaves the log empty.
 *
 * Specs in this directory import `test` and `expect` from here rather than from `@playwright/test`.
 */

import { test as base, expect } from '@playwright/test';
import { launchedRenderers, resetLaunchedRenderers } from '../helpers/joinery-actions-react';

export const test = base.extend<{ reactRendererOnly: void }>({
  reactRendererOnly: [
    // Playwright reads the destructuring pattern to work out what this fixture depends on, and
    // rejects any other parameter shape. An empty pattern is how "depends on nothing" is spelled.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      resetLaunchedRenderers();
      await use();

      const launched = launchedRenderers();
      expect(
        launched.length,
        'this spec launched no Joinery app through withJoineryReact — a stray withJoinery() would ' +
          'have silently run against the Angular renderer'
      ).toBeGreaterThan(0);
      expect(launched, 'every launch in tests/e2e-react must show the React renderer').toEqual(
        launched.map(() => 'react')
      );
    },
    { auto: true },
  ],
});

export { expect };
