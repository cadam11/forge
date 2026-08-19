/**
 * The connection flow on the React renderer: author a profile in the editor, connect with it, manage
 * it afterwards.
 *
 * Replaces `tests/e2e/connection.spec.ts`, whose three tests could not assert this at all — they
 * started from `connectToTestPostgres`, a Material-coupled helper, and then located everything
 * through structural classes (`app-sidebar .explorer-tree`, `app-sidebar .database-selector button`,
 * `[class*="status-bar"]`). More importantly, **no test in either tier had ever created a profile
 * through the UI**: Task 8's interim helper wrote one straight through the preload bridge because no
 * dialog existed yet. So the first test below is new coverage rather than a port — it is the first
 * time the app's gateway flow is exercised end to end.
 *
 * Everything here goes through `data-testid` and `getByLabel`. The Angular helper carried a comment
 * explaining that Material's label association defeats `getByLabel`; the Field primitive emits a real
 * `<label for>`, so it does not.
 */

import { expect, test } from '@playwright/test';
import {
  connectFromSidebar,
  connectionEditor,
  connectionManager,
  createAndConnectPostgres,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  fillPostgresForm,
  openConnectionEditor,
  selectDatabase,
  serverRow,
  serverRows,
  treeRow,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Test PG';

test.beforeAll(ensureJoineryTestSeeded);

test.describe('Joinery (React) — the connection editor', () => {
  test('creates a profile and connects with it, from an app with nothing saved', async () => {
    await withJoineryReact(async ({ window }) => {
      // The starting state: no profiles, so no picker and an explorer empty state.
      await expect(window.getByTestId('sidebar-empty')).toBeVisible();
      await expect(window.getByTestId('sidebar-connection-trigger')).toHaveCount(0);
      await expect(window.getByTestId('status-connection')).toContainText('Not connected');

      await createAndConnectPostgres(window, PROFILE);

      // The tree now has exactly one server, open, with the seeded database and the container's own
      // `postgres` under it.
      await expect(serverRows(window)).toHaveCount(1);
      await expect(serverRow(window, PROFILE)).toBeVisible();
      await expect(treeRow(window, 'joinery_test')).toBeVisible();
      await expect(treeRow(window, 'postgres')).toBeVisible();

      // And the status bar names it.
      await dismissToasts(window);
      await expect(window.getByTestId('status-connection')).toContainText(PROFILE);
    });
  });

  test('Test succeeds against the live container before anything is saved', async () => {
    await withJoineryReact(async ({ window }) => {
      const editor = await openConnectionEditor(window);
      await fillPostgresForm(window, PROFILE);

      await editor.getByTestId('connection-test').click();

      // A success is a toast, never the inline panel — the panel is for failures only, so one piece
      // of state can drive it.
      await expect(window.getByText(/^Connected to /)).toBeVisible({ timeout: 20_000 });
      await expect(editor.getByTestId('connection-test-result')).toHaveCount(0);
      // Nothing was persisted by a Test.
      await expect(window.getByTestId('sidebar-connection-trigger')).toHaveCount(0);
    });
  });

  test('Save persists without connecting, and the sidebar can then connect', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);

      // Saved, not connected: the picker exists, the explorer is still empty.
      await expect(window.getByTestId('sidebar-connection-trigger')).toBeVisible();
      await expect(window.getByTestId('sidebar-empty')).toBeVisible();
      await expect(window.getByTestId('status-connection')).toContainText('Not connected');

      await connectFromSidebar(window, PROFILE);
      await expect(serverRow(window, PROFILE)).toBeVisible();
    });
  });

  test('the database picker selects joinery_test and the status bar follows', async () => {
    await withJoineryReact(async ({ window }) => {
      await createAndConnectPostgres(window, PROFILE);

      await selectDatabase(window, 'joinery_test');

      await expect(window.getByTestId('sidebar-database-trigger')).toContainText('joinery_test');
      await dismissToasts(window);
      await expect(window.getByTestId('status-database')).toContainText('joinery_test');
    });
  });

  test('refuses a save that would duplicate a profile name, and keeps the form', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);

      const editor = await openConnectionEditor(window);
      await fillPostgresForm(window, PROFILE);
      await editor.getByTestId('connection-save').click();

      // The main process rejects the duplicate (`connection-profiles.ts:95`) and the store surfaces
      // its message. The dialog must survive it — closing would throw away everything typed.
      await expect(window.getByText(/already exists/)).toBeVisible({ timeout: 10_000 });
      await expect(editor).toBeVisible();
      await expect(editor.getByLabel('Connection name', { exact: true })).toHaveValue(PROFILE);
    });
  });

  test('blocks an invalid save at the field, and says why', async () => {
    await withJoineryReact(async ({ window }) => {
      const editor = await openConnectionEditor(window);

      // Nothing filled in at all.
      await editor.getByTestId('connection-save').click();

      // The summary line names the topmost problem, in the shared validator's own words
      // (`packages/shared/src/validators/connection.validator.ts:228`).
      await expect(editor.getByTestId('connection-validation-hint')).toContainText(
        'Server is required'
      );
      await expect(editor).toBeVisible();
      await expect(window.getByTestId('sidebar-connection-trigger')).toHaveCount(0);
    });
  });
});

test.describe('Joinery (React) — the connection manager', () => {
  test('lists the saved profile and launches the editor on it', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);

      await window.getByTestId('sidebar-connection-trigger').click();
      await window.getByTestId('sidebar-connection-manage').click();

      const manager = connectionManager(window);
      await expect(manager).toBeVisible();
      await expect(manager.getByTestId('connection-manager-row')).toHaveCount(1);
      await expect(manager.getByTestId('connection-manager-row')).toContainText(PROFILE);

      // Its only job: launching the editor. The editor replaces it rather than stacking on it.
      await manager.getByLabel(`Edit ${PROFILE}`).click();
      await expect(connectionEditor(window)).toBeVisible();
      await expect(manager).toHaveCount(0);
      await expect(
        connectionEditor(window).getByLabel('Connection name', { exact: true })
      ).toHaveValue(PROFILE);

      // And cancelling hands control back.
      await connectionEditor(window).getByTestId('connection-cancel').click();
      await expect(connectionManager(window)).toBeVisible();
    });
  });

  test('deletes a profile in two steps', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);

      await window.getByTestId('sidebar-connection-trigger').click();
      await window.getByTestId('sidebar-connection-manage').click();
      const manager = connectionManager(window);
      await expect(manager).toBeVisible();

      await manager.getByLabel(`Delete ${PROFILE}`).click();
      // Armed, not deleted.
      await expect(manager.getByTestId('connection-manager-row')).toHaveCount(1);

      await manager.getByLabel(`Confirm deleting ${PROFILE}`).click();
      await expect(manager.getByTestId('connection-manager-empty')).toBeVisible({
        timeout: 10_000,
      });
    });
  });
});
