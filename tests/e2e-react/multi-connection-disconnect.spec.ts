/**
 * Multi-connection disconnect, on the React renderer.
 *
 * Ported from `tests/e2e/multi-connection-disconnect.spec.ts`, which was written as failing-first
 * scaffolding for the `multi-connection-first-class` change and pins two bugs that a rewritten
 * sidebar could reintroduce for free:
 *
 *   1.4 — the tree was gated on a singleton `isConnected()`, so disconnecting the focused profile
 *         collapsed the entire tree and took the other two servers with it;
 *   1.5 — the right-click handler called `disconnect()` with no argument, which targeted the
 *         single `_activeConnectionId`, so the WRONG server was killed.
 *
 * Both are properties of the new sidebar too: 1.4 is "the explorer renders `rootNodes`, never a
 * connection flag", and 1.5 is "every menu action carries its own node's connection id". The React
 * store makes them structurally hard (`state/connection.ts`'s `disconnect` has no default
 * argument, by design) — which is exactly why they are still asserted from the outside.
 */

import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  connectFromSidebar,
  createPostgresProfile,
  createPostgresProfiles,
  disconnectServer,
  ensureJoineryTestSeeded,
  serverRow,
  serverRows,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PROFILES = ['PG-One', 'PG-Two', 'PG-Three'];

test.beforeAll(ensureJoineryTestSeeded);

/** All three profiles seeded once, then connected in order so `PG-Three` is the focused one. */
async function connectAllThree(window: Page): Promise<void> {
  await createPostgresProfiles(window, PROFILES);
  for (const profileName of PROFILES) {
    await connectFromSidebar(window, profileName);
  }
  await expect(serverRows(window)).toHaveCount(3);
}

test.describe('Joinery (React) — multi-connection disconnect', () => {
  test('1.4: disconnecting the focused server keeps the other two in the tree', async () => {
    await withJoineryReact(async ({ window }) => {
      await connectAllThree(window);

      // `PG-Three` connected last, so it is the focused connection in every "most recent" sense.
      await disconnectServer(window, 'PG-Three');

      await expect(serverRow(window, 'PG-One')).toBeVisible();
      await expect(serverRow(window, 'PG-Two')).toBeVisible();
      await expect(serverRow(window, 'PG-Three')).toHaveCount(0);
      await expect(serverRows(window)).toHaveCount(2);
      // The explorer's empty state must not appear while anything is still open.
      await expect(window.getByTestId('sidebar-empty')).toHaveCount(0);
    });
  });

  test('1.5: disconnecting a non-focused server kills exactly that one', async () => {
    await withJoineryReact(async ({ window }) => {
      await connectAllThree(window);

      // `PG-Three` is focused; act on `PG-Two`.
      await disconnectServer(window, 'PG-Two');

      await expect(serverRow(window, 'PG-Two')).toHaveCount(0);
      await expect(serverRow(window, 'PG-One')).toBeVisible();
      await expect(serverRow(window, 'PG-Three')).toBeVisible();
      await expect(serverRows(window)).toHaveCount(2);
    });
  });

  test('disconnecting the last connection returns the explorer to its empty state', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, 'PG-One');
      await connectFromSidebar(window, 'PG-One');

      await disconnectServer(window, 'PG-One');

      await expect(window.getByTestId('sidebar-empty')).toBeVisible();
      await expect(window.getByTestId('sidebar-tree')).toHaveCount(0);
      // The profile still exists, so the picker stays — it is the list of profiles, not of
      // connections.
      await expect(window.getByTestId('sidebar-connection-trigger')).toBeVisible();
    });
  });
});
