/**
 * Inline test-connection feedback — the two features from the
 * password-paste-artifacts PR, exercised end to end against the real
 * harness databases:
 *
 *  1. The live paste-artifact warning banner under the password field
 *     (app-password-hygiene-warning) appears for an artifact-bearing
 *     password and never for a clean one.
 *  2. A failed Test renders the inline error panel (app-test-result-panel)
 *     with the main process's guidance — including the password-hygiene
 *     lines. The MSSQL case is the regression pin for the ELOGIN mapping:
 *     login failures from pool.connect() carry code 'ELOGIN' with no
 *     `number`, and must still categorize as AUTH_FAILED.
 *  3. Editing any form field clears the panel so a stale error never
 *     describes a configuration the user has since changed.
 */

import { expect, test, type Page } from '@playwright/test';
import { withForge } from '../helpers/electron-app';
import { fillField, TEST_PG } from '../helpers/forge-actions';

const TEST_MSSQL = { host: '127.0.0.1', port: 11433, user: 'sa' } as const;

async function openConnectionDialog(window: Page) {
  await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
  await window.locator('mat-card[aria-label="New Connection"]').click();
  const dialog = window.locator('mat-dialog-container');
  await expect(dialog).toBeVisible({ timeout: 10000 });
  return dialog;
}

async function selectEngine(window: Page, label: string) {
  const dialog = window.locator('mat-dialog-container');
  await dialog.locator('mat-select').first().click();
  await window.locator('mat-option').filter({ hasText: label }).first().click();
  await window.waitForTimeout(300);
}

test.describe('Forge — inline test-connection feedback', () => {
  test('artifact-bearing password shows the live warning; clean password does not', async () => {
    await withForge(async ({ window }) => {
      const dialog = await openConnectionDialog(window);
      const banner = dialog.locator('app-password-hygiene-warning .password-warning');

      await fillField(dialog, 'Password', 'clean-P@ssw0rd!');
      await expect(banner).toHaveCount(0);

      // Trailing space — the classic paste artifact (a trailing newline can't
      // be typed into a single-line input; the browser strips it).
      await fillField(dialog, 'Password', 'secret ');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText('copy/paste artifacts');
      await expect(banner).toContainText('ends with a space');

      // Typed international characters are NOT branded paste artifacts.
      await fillField(dialog, 'Password', 'passwörd');
      await expect(banner).toHaveCount(0);
    });
  });

  test('failed MSSQL test (ELOGIN) renders AUTH_FAILED guidance with hygiene lines inline', async () => {
    await withForge(async ({ window }) => {
      const dialog = await openConnectionDialog(window);

      await fillField(dialog, 'Connection Name', 'Bad MSSQL');
      await fillField(dialog, 'Server', TEST_MSSQL.host);
      await fillField(dialog, 'Port', String(TEST_MSSQL.port));
      await fillField(dialog, 'Username', TEST_MSSQL.user);
      await fillField(dialog, 'Password', 'WrongPassword! ');

      await dialog.getByRole('button', { name: /^Test$/ }).click();

      // pool.connect() rejects with ConnectionError{code:'ELOGIN'} — the
      // panel must show the categorized AUTH_FAILED guidance, not the raw
      // driver message with the generic fallback line.
      const panel = dialog.locator('app-test-result-panel .test-result-error');
      await expect(panel).toBeVisible({ timeout: 30000 });
      await expect(panel).toContainText('Login failed');
      await expect(panel).toContainText('Check that the password is correct');
      await expect(panel).toContainText('ends with a space');
      await expect(panel).toContainText('being tested is 15 characters');

      // Editing the password clears the now-stale panel.
      await fillField(dialog, 'Password', 'WrongPassword!x');
      await expect(panel).toHaveCount(0);
    });
  });

  test('failed PostgreSQL test renders auth guidance with hygiene lines inline', async () => {
    await withForge(async ({ window }) => {
      const dialog = await openConnectionDialog(window);
      await selectEngine(window, 'PostgreSQL');

      await fillField(dialog, 'Connection Name', 'Bad PG');
      await fillField(dialog, 'Server', TEST_PG.host);
      await fillField(dialog, 'Port', String(TEST_PG.port));
      await fillField(dialog, 'Username', TEST_PG.user);
      await fillField(dialog, 'Password', 'wrongpass ');
      // Stock dev PG image doesn't speak SSL; Forge defaults to encrypt-on.
      await dialog
        .locator('mat-checkbox')
        .filter({ hasText: 'Encrypt Connection' })
        .locator('input[type="checkbox"]')
        .uncheck({ force: true });

      await dialog.getByRole('button', { name: /^Test$/ }).click();

      const panel = dialog.locator('app-test-result-panel .test-result-error');
      await expect(panel).toBeVisible({ timeout: 30000 });
      await expect(panel).toContainText('Check that the password is correct');
      await expect(panel).toContainText('ends with a space');
    });
  });
});
