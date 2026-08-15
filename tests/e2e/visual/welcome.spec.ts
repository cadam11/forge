/**
 * Visual regression baselines — welcome screen + connection dialog.
 *
 * Snapshots live at tests/__snapshots__/visual/<spec>/<arg>.png and are
 * committed to the repo. Regenerate with:
 *
 *   pnpm run test:visual:update
 *
 * Visual specs run macOS-only by design (per-developer M-series Macs all
 * produce the same baselines; CI is intentionally not in scope for this
 * tier). If you're on a different machine, expect to regenerate.
 */

import { expect, test } from '@playwright/test';
import { withJoinery } from '../../helpers/electron-app';

test.describe('Joinery — visual baselines', () => {
  test('welcome screen', async () => {
    await withJoinery(async ({ window }) => {
      await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
      await expect(window.locator('mat-card[aria-label="New Connection"]')).toBeVisible({
        timeout: 10000,
      });
      // Settle: wait briefly for any post-render layout / fade-in animations.
      await window.waitForTimeout(500);
      await expect(window).toHaveScreenshot('welcome-screen.png');
    });
  });

  test('connection dialog', async () => {
    await withJoinery(async ({ window }) => {
      await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
      await window.locator('mat-card[aria-label="New Connection"]').click();
      const dialog = window.locator('mat-dialog-container');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      // Wait for dialog enter animation to finish.
      await window.waitForTimeout(500);
      await expect(dialog).toHaveScreenshot('connection-dialog.png');
    });
  });
});
