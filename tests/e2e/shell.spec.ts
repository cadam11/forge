/**
 * Shell-level E2E specs — covers the legacy 31-test audit's tests 24
 * (connection menu) and 27 (sidebar resize via drag).
 *
 * "Shell" here means the persistent app chrome around the workspace —
 * the sidebar, status bar, and the resize handle that separates them
 * from the main panel. These specs check that the user can interact
 * with that chrome without needing a connection (or with a minimal one).
 */

import { expect, test } from '@playwright/test';
import { withJoinery } from '../helpers/electron-app';
import { connectToTestPostgres, ensureJoineryTestSeeded } from '../helpers/joinery-actions';

test.beforeAll(ensureJoineryTestSeeded);

test.describe('Joinery — shell chrome', () => {
  test('connection button opens the connection mat-menu', async () => {
    await withJoinery(async ({ window }) => {
      await connectToTestPostgres(window);
      // The sidebar's connection-button is a mat-menu trigger. Clicking
      // should reveal the menu panel; we don't assert specific options
      // (those depend on saved connections) — only that the panel opens.
      const connBtn = window.locator('app-sidebar .connection-selector .connection-button').first();
      await expect(connBtn).toBeVisible({ timeout: 10000 });
      await connBtn.click();
      await expect(window.locator('.mat-mdc-menu-panel').first()).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test('sidebar resize handle changes the sidebar width on drag', async () => {
    await withJoinery(async ({ window }) => {
      await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
      // app-shell renders a vertical resize handle between sidebar + main.
      // Filter to :visible because chat-panel and query.component each
      // have their own .resize-handle that we don't want to grab here.
      const handle = window.locator('app-shell .resize-handle:visible').first();
      await expect(handle).toBeVisible({ timeout: 10000 });

      const sidebar = window.locator('app-sidebar').first();
      const before = await sidebar.boundingBox();
      expect(before?.width ?? 0).toBeGreaterThan(0);

      const handleBox = await handle.boundingBox();
      if (!handleBox) throw new Error('resize handle has no bounding box');
      // Drag the handle ~80px to the right. Joinery clamps to a min/max
      // width so the actual delta may be smaller — we just want to know
      // the width changed in response to the drag.
      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;
      await window.mouse.move(startX, startY);
      await window.mouse.down();
      await window.mouse.move(startX + 80, startY, { steps: 8 });
      await window.mouse.up();
      await window.waitForTimeout(300);

      const after = await sidebar.boundingBox();
      expect(after?.width ?? 0).not.toBe(before?.width ?? 0);
    });
  });
});
