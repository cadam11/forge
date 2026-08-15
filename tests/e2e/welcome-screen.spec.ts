/**
 * Welcome screen smoke tests.
 *
 * Proves the E2E harness boots the built Joinery app and that the welcome
 * screen renders the expected entry-point UI. Equivalent to test 01 of the
 * legacy full-audit but plumbed through the new harness.
 */

import { test, expect } from '@playwright/test';
import { withJoinery } from '../helpers/electron-app';

test('app launches and shows the welcome screen', async () => {
  await withJoinery(async ({ window }) => {
    // Wait for Angular to bootstrap.
    await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });

    const title = await window.title();
    expect(title.toLowerCase()).toContain('joinery');

    // The welcome view's "New Connection" action card. (There's also a
    // sidebar mat-icon-button with the same label; we target the card.)
    const newConnectionCard = window.locator('mat-card[aria-label="New Connection"]');
    await expect(newConnectionCard).toBeVisible({ timeout: 10000 });
  });
});

test('clicking the New Connection action card opens the connection dialog', async () => {
  await withJoinery(async ({ window }) => {
    await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });

    await window.locator('mat-card[aria-label="New Connection"]').click();

    // The connection dialog is a Material dialog (CDK overlay).
    const dialog = window.locator('mat-dialog-container');
    await expect(dialog).toBeVisible({ timeout: 10000 });
  });
});
