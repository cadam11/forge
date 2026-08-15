/**
 * Visual baselines — settings + keyboard shortcuts dialogs.
 *
 * Both are wired only through Joinery's macOS app menu (no keyboard binding
 * exists). Tests fire the same IPC channel the menu uses
 * (`menu:open-settings` / `menu:show-shortcuts`) directly via the main
 * process, which is what the menu items themselves do.
 */

import { expect, test } from '@playwright/test';
import { launchJoinery } from '../../helpers/electron-app';

async function fireMenuChannel(
  app: Awaited<ReturnType<typeof launchJoinery>>['app'],
  channel: string
) {
  await app.evaluate(({ BrowserWindow }, ch) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send(ch);
  }, channel);
}

test.describe('Joinery — dialog visual baselines', () => {
  test('settings panel', async () => {
    const launched = await launchJoinery();
    try {
      const { app, window } = launched;
      await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
      await fireMenuChannel(app, 'menu:open-settings');
      const panel = window
        .locator('app-settings-panel .settings-panel, app-settings-panel mat-dialog-container')
        .first();
      await expect(panel).toBeVisible({ timeout: 10000 });
      await window.waitForTimeout(600);
      await expect(panel).toHaveScreenshot('settings-panel.png');
    } finally {
      await launched.app.close();
    }
  });

  test('keyboard shortcuts dialog', async () => {
    const launched = await launchJoinery();
    try {
      const { app, window } = launched;
      await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
      await fireMenuChannel(app, 'menu:show-shortcuts');
      // ShortcutsDialogComponent renders its own overlay (not mat-dialog) —
      // capture the inner card so the screenshot frames the dialog itself.
      const dialog = window.locator('app-shortcuts-dialog .shortcuts-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await window.waitForTimeout(600);
      await expect(dialog).toHaveScreenshot('keyboard-shortcuts-dialog.png');
    } finally {
      await launched.app.close();
    }
  });
});
