/**
 * Theme switch E2E spec — adapted from the legacy 31-test audit's tests
 * 29 + 30 ("Theme: dark switch — verifies DOM class change").
 *
 * Joinery writes the chosen theme to `<html data-theme="…">`. Light + dark
 * mode toggle the CSS-variable cascade in styles.scss. We open settings
 * via the menu IPC, switch theme via the mat-select, and assert the DOM
 * attribute updates.
 */

import { expect, test, type Page } from '@playwright/test';
import { withJoinery } from '../helpers/electron-app';

async function openSettingsAndSelectTheme(window: Page, themeLabel: 'Light' | 'Dark' | 'System') {
  const panel = window.locator('app-settings-panel .settings-panel').first();
  await expect(panel).toBeVisible({ timeout: 10000 });
  await panel.locator('.theme-select mat-select').click();
  // Substring match (not anchored) — mat-option's textContent includes the
  // icon ligature name (e.g. "light_mode\nLight") so an anchored regex would
  // never match. Each theme label is unique enough across the three options.
  await window.locator('mat-option').filter({ hasText: themeLabel }).first().click();
  // The mat-option's overlay closes; settingsService writes through to the
  // store and the renderer applies data-theme on the <html> element.
  // String-form evaluate avoids needing dom-lib types in this Node-typed file.
  await window.waitForFunction(
    `document.documentElement.getAttribute('data-theme') === '${themeLabel.toLowerCase()}'`,
    null,
    { timeout: 5000 }
  );
}

test.describe('Joinery — theme switching', () => {
  test('selecting Light writes data-theme="light" to <html>', async () => {
    await withJoinery(async ({ app, window }) => {
      await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('menu:open-settings');
      });
      await openSettingsAndSelectTheme(window, 'Light');
    });
  });

  test('selecting Dark writes data-theme="dark" to <html>', async () => {
    await withJoinery(async ({ app, window }) => {
      await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('menu:open-settings');
      });
      await openSettingsAndSelectTheme(window, 'Dark');
    });
  });
});
