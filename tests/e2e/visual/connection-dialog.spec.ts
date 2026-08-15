/**
 * Visual baselines — connection dialog variants.
 *
 * Joinery's connection dialog renders engine-specific form fields
 * (auth options, ports, defaults) and exposes an optional SSH-tunnel
 * section. These baselines lock down the layout for each meaningful
 * variant so a refactor that breaks one engine's form is caught.
 */

import { expect, test, type Page } from '@playwright/test';
import { withJoinery } from '../../helpers/electron-app';

async function openConnectionDialog(window: Page) {
  await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
  await window.locator('[data-testid="welcome-new-connection"]').click();
  const dialog = window.locator('mat-dialog-container');
  await expect(dialog).toBeVisible({ timeout: 10000 });
  return dialog;
}

async function selectEngine(window: Page, label: string) {
  // The engine dropdown is the first mat-select in the dialog.
  const dialog = window.locator('mat-dialog-container');
  await dialog.locator('mat-select').first().click();
  // mat-option lives in a CDK overlay panel outside the dialog DOM.
  await window.locator('mat-option').filter({ hasText: label }).first().click();
  // Settle deterministically before the screenshot. Two signals both
  // need to land or the visual is racy:
  //   1. Material's floating-label animation completes (the engine
  //      field's label floats above the now-populated select). The
  //      previous waitForTimeout(400) sometimes finished before this
  //      class was applied, producing a baseline-vs-actual mismatch
  //      where the label was missing in one frame and rendered in
  //      another.
  //   2. Angular's onEngineChange has run — it rewrites the port
  //      default, default-database visibility, and other engine-
  //      conditional fields. Wait on the engine-specific port value
  //      to confirm the form has settled.
  const engineField = dialog.locator('mat-form-field').first();
  await expect(engineField.locator('.mdc-floating-label--float-above')).toBeVisible({
    timeout: 5000,
  });
  const expectedPort = label === 'PostgreSQL' ? '5432' : label === 'MySQL' ? '3306' : '1433';
  // Port uses [(ngModel)], no formControlName. The dialog has two
  // type=number inputs (Port and SSH Port); SSH is collapsed in these
  // tests so .first() reliably resolves to Port.
  await expect(dialog.locator('input[type="number"]').first()).toHaveValue(expectedPort, {
    timeout: 5000,
  });
}

test.describe('Joinery — connection dialog variants', () => {
  test('postgresql engine selected', async () => {
    await withJoinery(async ({ window }) => {
      const dialog = await openConnectionDialog(window);
      await selectEngine(window, 'PostgreSQL');
      await expect(dialog).toHaveScreenshot('postgresql-engine-selected.png');
    });
  });

  test('mysql engine selected', async () => {
    await withJoinery(async ({ window }) => {
      const dialog = await openConnectionDialog(window);
      await selectEngine(window, 'MySQL');
      await expect(dialog).toHaveScreenshot('mysql-engine-selected.png');
    });
  });

  test('ssh tunnel section expanded', async () => {
    await withJoinery(async ({ window }) => {
      const dialog = await openConnectionDialog(window);
      // The SSH checkbox is a single mat-checkbox labeled "Connect via SSH tunnel".
      await dialog.locator('mat-checkbox').filter({ hasText: 'Connect via SSH tunnel' }).click();
      // Settle: Angular reveals the SSH form fields below the checkbox.
      await window.waitForTimeout(400);
      await expect(dialog).toHaveScreenshot('ssh-tunnel-section-expanded.png');
    });
  });

  test('password paste-artifact warning banner', async () => {
    await withJoinery(async ({ window }) => {
      const dialog = await openConnectionDialog(window);
      // Trailing space + smart quote — two advisory bullets in the banner.
      await dialog
        .locator('mat-form-field')
        .filter({ has: window.locator('mat-label:text-is("Password")') })
        .first()
        .locator('input')
        .fill('secret’ ');
      const banner = dialog.locator('app-password-hygiene-warning .password-warning');
      await expect(banner).toBeVisible({ timeout: 5000 });
      // Settle Material's floating-label animation on the password field.
      await window.waitForTimeout(400);
      await expect(dialog).toHaveScreenshot('password-hygiene-warning.png');
    });
  });
});
