/**
 * Multi-connection disconnect E2E specs — Phase 1 failing-test scaffolding for
 * the `multi-connection-first-class` change. These exercise the user-reported
 * bug (1.4) and the latent bug (1.5) that the change resolves.
 *
 * Scenario shape (mirrors `connection.spec.ts` for connection setup):
 *   - Three profiles connect to the seeded postgres test container, each with
 *     a distinct name so they appear as three separate server nodes in the
 *     sidebar tree.
 *   - 1.4: right-click Disconnect on the *focused* server. The other two
 *     server nodes must remain visible. On `main`, the sidebar template gates
 *     the entire tree on `connectionState.isConnected()` (singleton-style),
 *     so disconnecting the focused profile collapses the whole tree.
 *   - 1.5: focus profile A, right-click Disconnect on profile B. Profile A's
 *     node must remain and B's must disappear. On `main`, the right-click
 *     handler calls `connectionState.disconnect()` (no-arg) which targets
 *     `_activeConnectionId` — i.e. profile A — so the wrong server is killed.
 *
 * Both tests are expected to fail on `main` and pass after Phase 4 (and Phase
 * 3 for 1.4). The harness writes the failure to the live dashboard so the
 * implementer can watch the bug close as they land each commit.
 */

import { expect, test, type Page } from '@playwright/test';
import { withJoinery } from '../helpers/electron-app';
import {
  TEST_PG,
  ensureJoineryTestSeeded,
  fillField,
  connectToTestPostgres,
} from '../helpers/joinery-actions';

test.beforeAll(ensureJoineryTestSeeded);

/**
 * Open the sidebar's "New Connection" + button and create another postgres
 * profile pointing at the same seeded container, with the supplied name.
 * The flow mirrors `connectToTestPostgres` but skips the welcome-screen
 * card (which is no longer rendered once any connection is open).
 */
async function addAdditionalPostgresProfile(window: Page, profileName: string): Promise<void> {
  // The sidebar header's "+" icon button has `aria-label="New Connection"`.
  // After the first connect, the welcome card is gone and this button is the
  // only New Connection affordance.
  const sidebarNewConn = window
    .locator('app-sidebar')
    .getByRole('button', { name: /^New Connection$/ });
  await expect(sidebarNewConn).toBeVisible({ timeout: 10_000 });
  await sidebarNewConn.click();

  const dialog = window.locator('mat-dialog-container');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  await dialog.locator('mat-select').first().click();
  await window.locator('mat-option').filter({ hasText: 'PostgreSQL' }).first().click();
  await window.waitForTimeout(300);

  await fillField(dialog, 'Connection Name', profileName);
  await fillField(dialog, 'Server', TEST_PG.host);
  await fillField(dialog, 'Port', String(TEST_PG.port));
  await fillField(dialog, 'Username', TEST_PG.user);
  await fillField(dialog, 'Password', TEST_PG.password);
  await fillField(dialog, 'Default Database', TEST_PG.database);

  await dialog
    .locator('mat-checkbox')
    .filter({ hasText: 'Encrypt Connection' })
    .locator('input[type="checkbox"]')
    .uncheck({ force: true })
    .catch(() => {
      /* checkbox may already be off */
    });

  await dialog.getByRole('button', { name: /^Connect$/ }).click();

  // Wait for the new server node to appear in the tree.
  const newServerNode = window
    .locator('app-sidebar')
    .locator('.tree-item')
    .filter({ hasText: profileName })
    .first();
  await expect(newServerNode).toBeVisible({ timeout: 20_000 });

  // Dismiss the snackbar to avoid covering subsequent context-menu clicks.
  await window
    .locator('.mat-mdc-snack-bar-container button')
    .first()
    .click({ timeout: 2000 })
    .catch(() => {
      /* may have auto-dismissed */
    });
  await window.waitForTimeout(300);
}

/**
 * Right-click the named server node and choose "Disconnect" from the
 * resulting context menu. The context-menu component renders into the
 * document root with class `.context-menu`.
 */
async function rightClickDisconnectServer(window: Page, profileName: string): Promise<void> {
  const node = window
    .locator('app-sidebar')
    .locator('.tree-item[aria-label*="(server)"]')
    .filter({ hasText: profileName })
    .first();
  await expect(node).toBeVisible();
  await node.click({ button: 'right' });

  const menu = window.locator('.context-menu');
  await expect(menu).toBeVisible({ timeout: 5000 });
  await menu.locator('.menu-item').filter({ hasText: 'Disconnect' }).first().click();
  // Allow the disconnect IPC + state propagation to settle before the test
  // asserts on visibility.
  await window.waitForTimeout(800);
}

test.describe('Joinery — multi-connection disconnect', () => {
  test('1.4: right-click Disconnect on the focused server keeps the other two visible', async () => {
    await withJoinery(async ({ window }) => {
      // First profile uses the existing helper (welcome → New Connection card).
      await connectToTestPostgres(window);
      // Two more profiles, each with a distinct name, via the sidebar "+" button.
      await addAdditionalPostgresProfile(window, 'PG-Two');
      await addAdditionalPostgresProfile(window, 'PG-Three');

      const sidebar = window.locator('app-sidebar');
      // Sanity: three server nodes are present.
      await expect(
        sidebar.locator('.tree-item[aria-label*="(server)"]').filter({ hasText: 'Test PG' })
      ).toBeVisible();
      await expect(
        sidebar.locator('.tree-item[aria-label*="(server)"]').filter({ hasText: 'PG-Two' })
      ).toBeVisible();
      await expect(
        sidebar.locator('.tree-item[aria-label*="(server)"]').filter({ hasText: 'PG-Three' })
      ).toBeVisible();

      // PG-Three is the most recently connected — it is the "focused" server in
      // the legacy single-active model. Disconnecting it must NOT remove the
      // other two server nodes from the tree.
      await rightClickDisconnectServer(window, 'PG-Three');

      await expect(
        sidebar.locator('.tree-item[aria-label*="(server)"]').filter({ hasText: 'Test PG' })
      ).toBeVisible();
      await expect(
        sidebar.locator('.tree-item[aria-label*="(server)"]').filter({ hasText: 'PG-Two' })
      ).toBeVisible();
      // Empty-state must not be present.
      await expect(sidebar.locator('.empty-state')).not.toBeVisible();
    });
  });

  test('1.5: right-click Disconnect on a non-focused server kills the right one', async () => {
    await withJoinery(async ({ window }) => {
      await connectToTestPostgres(window);
      await addAdditionalPostgresProfile(window, 'PG-Two');
      await addAdditionalPostgresProfile(window, 'PG-Three');

      const sidebar = window.locator('app-sidebar');

      // PG-Three is currently focused (last-connected). Right-click Disconnect
      // on the *non-focused* PG-Two. Spec: only PG-Two disappears.
      await rightClickDisconnectServer(window, 'PG-Two');

      // PG-Two's node is gone.
      await expect(
        sidebar.locator('.tree-item[aria-label*="(server)"]').filter({ hasText: 'PG-Two' })
      ).toHaveCount(0);
      // The originally-focused PG-Three (and Test PG) remain.
      await expect(
        sidebar.locator('.tree-item[aria-label*="(server)"]').filter({ hasText: 'PG-Three' })
      ).toBeVisible();
      await expect(
        sidebar.locator('.tree-item[aria-label*="(server)"]').filter({ hasText: 'Test PG' })
      ).toBeVisible();
    });
  });
});
