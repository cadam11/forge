/**
 * The backup and restore wizards, and the missing-CLI-tools view they share.
 *
 * ── Backup ───────────────────────────────────────────────────────────────────
 *
 * One dialog for the whole flow, including the server file browser: that step is a
 * body swap rather than a nested modal (PLAN.md §2.9), so there is exactly one
 * `backup-dialog` on screen at every point and no locator here has to disambiguate.
 *
 * Everything the dialog says, it says INLINE — J-42: a toast raised while a modal is
 * open is visible but inert, because Radix disables pointer events outside the dialog.
 * So the assertions below are on `backup-progress` / `backup-success` / `backup-error`,
 * never on a sonner toast, and `dismissToasts` is deliberately not used in this block
 * (it refuses to run with a dialog open, by its own precondition).
 *
 * ── Restore ──────────────────────────────────────────────────────────────────
 *
 * Restore is the one workflow in Joinery that destroys data, and the Angular
 * dialog it replaces had no confirmation at all. That is why there are two
 * separate run helpers below rather than one with a flag: `runRestoreIntoNew`
 * asserts the confirmation is NOT asked for, and `runRestoreOver` walks it.
 * A single helper that shrugged either way would hide the distinction the
 * wizard exists to make.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { UI_TIMEOUT_MS } from './app';
import { openNodeMenu } from './explorer';

/** How long a real dump of the seeded fixture database is allowed to take. */
const BACKUP_TIMEOUT_MS = 120_000;
/** How long a real restore of the seeded fixture database is allowed to take. */
const RESTORE_TIMEOUT_MS = 120_000;

/** The backup wizard. One per flow, whichever step it is showing. */
export function backupDialog(window: Page): Locator {
  return window.getByTestId('backup-dialog');
}

/**
 * Open the wizard from the sidebar's footer action — the entry point that needs no context menu
 * and is disabled until a database is selected, so reaching it also proves the selection landed.
 *
 * Waits for the **form**, not just for the dialog: on PG and MySQL the dialog opens on a
 * host-tool probe (`backup-tools-checking`), and a caller that filled the path field as soon as
 * the dialog appeared would race it.
 */
export async function openBackupDialog(window: Page): Promise<Locator> {
  await window.getByTestId('sidebar-backup').click();
  const dialog = backupDialog(window);
  await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(dialog.getByTestId('backup-path')).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return dialog;
}

/** Open the wizard from a database node's context menu, which carries its own target. */
export async function openBackupDialogFromNode(
  window: Page,
  databaseName: string
): Promise<Locator> {
  const menu = await openNodeMenu(window, databaseName);
  await menu.getByTestId('sidebar-menu-backup').click();
  const dialog = backupDialog(window);
  await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return dialog;
}

/**
 * Fill the destination and run the backup, returning once it has reached a terminal state.
 *
 * The wait is on the inline success panel and its **path readout**, which is the dialog's own
 * statement of what it wrote — the Angular spec waited on a snackbar, which is the thing J-42
 * makes unreliable above a modal.
 */
export async function runBackupTo(window: Page, destination: string): Promise<void> {
  const dialog = backupDialog(window);
  const path = dialog.getByTestId('backup-path');
  await path.fill(destination);
  await expect(path).toHaveValue(destination);

  await dialog.getByTestId('backup-start').click();
  // The stream is inline and it is the only "it started" signal there is.
  await expect(dialog.getByTestId('backup-progress')).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(dialog.getByTestId('backup-success')).toBeVisible({ timeout: BACKUP_TIMEOUT_MS });
  await expect(dialog.getByTestId('backup-success-path')).toHaveText(destination);
}

/** The missing-CLI-tools remediation view. Three of its testids are the legacy ones, verbatim. */
export function missingCliTools(window: Page): Locator {
  return window.getByTestId('missing-cli-tools');
}

/**
 * The server file browser, once a wizard's Choose… button has swapped it in.
 *
 * One component, two hosts: the backup wizard opens it in `mode="save"` and the restore wizard in
 * `mode="open"`, so the testid stays `backup-file-browser` in both — it names the component, not the
 * flow. `restore.spec.ts` drives it through this locator.
 */
export function serverFileBrowser(window: Page): Locator {
  return window.getByTestId('backup-file-browser');
}

/** The restore wizard. One per flow, whichever step it is showing. */
export function restoreDialog(window: Page): Locator {
  return window.getByTestId('restore-dialog');
}

/**
 * Open the wizard from the sidebar's footer action.
 *
 * Unlike the backup twin this needs no database selected — a restore creates its target, which is why
 * the sidebar enables it at the server level. Waits for the **form**, not just the dialog: on PG and
 * MySQL the dialog opens on a host-tool probe and a caller that filled the path field as soon as the
 * dialog appeared would race it.
 */
export async function openRestoreDialog(window: Page): Promise<Locator> {
  await window.getByTestId('sidebar-restore').click();
  const dialog = restoreDialog(window);
  await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(dialog.getByTestId('restore-path')).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return dialog;
}

/** Open the wizard from a database node's context menu, which carries its own target. */
export async function openRestoreDialogFromNode(
  window: Page,
  databaseName: string
): Promise<Locator> {
  const menu = await openNodeMenu(window, databaseName);
  await menu.getByTestId('sidebar-menu-restore').click();
  const dialog = restoreDialog(window);
  await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(dialog.getByTestId('restore-path')).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return dialog;
}

/** Fill the source and the target name, leaving the wizard ready to submit. */
export async function fillRestoreForm(
  window: Page,
  archivePath: string,
  targetDatabase: string
): Promise<void> {
  const dialog = restoreDialog(window);
  const path = dialog.getByTestId('restore-path');
  await path.fill(archivePath);
  await expect(path).toHaveValue(archivePath);

  const name = dialog.getByTestId('restore-target-name');
  await name.fill(targetDatabase);
  await expect(name).toHaveValue(targetDatabase);
}

/**
 * Restore into a database the server has never heard of, and return once it has succeeded.
 *
 * **Asserts that no confirmation was demanded.** Extra ceremony for a safe action is how users learn
 * to click through the dangerous one, so "the safe path is one button" is a property worth pinning.
 */
export async function runRestoreIntoNew(
  window: Page,
  archivePath: string,
  targetDatabase: string
): Promise<void> {
  const dialog = restoreDialog(window);
  await fillRestoreForm(window, archivePath, targetDatabase);

  // The label is the signal that no confirmation is coming — the testid is the same either way, on
  // purpose, so this is an assertion about the flow rather than about a selector.
  await expect(dialog.getByTestId('restore-submit')).toHaveText(/Start restore/);
  await dialog.getByTestId('restore-submit').click();

  await expect(dialog.getByTestId('restore-confirm')).toHaveCount(0);
  await expect(dialog.getByTestId('restore-success')).toBeVisible({
    timeout: RESTORE_TIMEOUT_MS,
  });
  await expect(dialog.getByTestId('restore-success-target')).toHaveText(targetDatabase);
}

/**
 * Restore over a database that already exists, walking the confirmation.
 *
 * The confirmation is the target's name, typed exactly. This helper types it — the spec's job is to
 * prove the button is refused *before* it does.
 */
export async function runRestoreOver(
  window: Page,
  archivePath: string,
  targetDatabase: string,
  options: { readonly overwrite?: boolean } = {}
): Promise<void> {
  const dialog = restoreDialog(window);
  await fillRestoreForm(window, archivePath, targetDatabase);
  if (options.overwrite === true) await dialog.getByTestId('restore-overwrite').check();

  await expect(dialog.getByTestId('restore-submit')).toHaveText(/Review the restore/);
  await dialog.getByTestId('restore-submit').click();
  await expect(dialog.getByTestId('restore-confirm')).toBeVisible({ timeout: UI_TIMEOUT_MS });

  await dialog.getByTestId('restore-confirm-input').fill(targetDatabase);
  await dialog.getByTestId('restore-confirm-start').click();

  await expect(dialog.getByTestId('restore-success')).toBeVisible({
    timeout: RESTORE_TIMEOUT_MS,
  });
  await expect(dialog.getByTestId('restore-success-target')).toHaveText(targetDatabase);
}
