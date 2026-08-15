/**
 * Missing CLI tools — E2E spec.
 *
 * Joinery's PG/MySQL backup/restore services shell out to host-installed
 * CLI tools. When those binaries aren't on PATH, the dialogs render a
 * setup-instructions view (driven by the deps probe in
 * `services/sql/cli-deps.ts`) instead of the form.
 *
 * This spec proves the wiring: launch Joinery with PATH stripped of every
 * directory the brew-installed tools live in, open the Backup dialog on
 * a PostgreSQL connection, and assert the missing-cli-tools card shows
 * up — with the right tools flagged missing, the right install steps
 * for this platform, and a Re-check button that stays in the
 * missing-tools state when the host is still missing the binaries.
 *
 * The CLI dep probe is short-circuited per-engine, so dropping PATH for
 * `pg_dump`/`pg_restore` is enough to flip the PG dialog into the
 * setup-instructions state. We don't need to exercise MySQL separately
 * here — the probe + view are engine-agnostic and the integration tier
 * already covers per-engine probe logic.
 */

import { expect, test, type Page } from '@playwright/test';

import { withJoinery } from '../helpers/electron-app';
import {
  connectToTestPostgres,
  ensureJoineryTestSeeded,
  selectDatabase,
  TEST_PG,
} from '../helpers/joinery-actions';

test.beforeAll(ensureJoineryTestSeeded);

// PATH stripped of /opt/homebrew/* (where pg_dump and pg_restore live in
// dev). Keeps the system bins so Electron itself launches cleanly. macOS
// only — Joinery's Linux build target is unsupported (see CLAUDE.md), so
// scoping the spec to darwin matches the platforms we actually ship.
const RESTRICTED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

test.describe('Joinery — missing CLI tools instructions view', () => {
  test.skip(
    process.platform !== 'darwin',
    'Restricted-PATH test pattern is darwin-specific (relies on /opt/homebrew layout).'
  );

  test('backup dialog renders setup instructions when pg_dump is not on PATH', async () => {
    await withJoinery({ envOverrides: { PATH: RESTRICTED_PATH } }, async ({ window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, TEST_PG.database);

      await openBackupDialog(window);

      // The setup card replaces the backup form when deps are missing.
      const card = window.locator('[data-testid="missing-cli-tools"]');
      await expect(card).toBeVisible({ timeout: 10_000 });

      // Both PG tools should be probed and flagged missing.
      const pgDump = card.locator('[data-testid="tool-status-pg_dump"]');
      const pgRestore = card.locator('[data-testid="tool-status-pg_restore"]');
      await expect(pgDump).toBeVisible();
      await expect(pgRestore).toBeVisible();
      await expect(pgDump).toContainText(/missing/i);
      await expect(pgRestore).toContainText(/missing/i);

      // Card should carry the engine-aware title and a darwin install step
      // with the brew command. (We're on darwin per the test.skip above.)
      await expect(card).toContainText(/install postgresql client tools/i);
      await expect(card).toContainText(/brew install postgresql@16/);

      // The bottom-of-card Re-check button is wired to the recheck IPC.
      // Re-check while still missing should keep the card on screen.
      const recheck = card.locator('[data-testid="missing-cli-tools-recheck"]');
      await expect(recheck).toBeVisible();
      await recheck.click();
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(pgDump).toContainText(/missing/i);

      // The backup form fields are NOT rendered while the card is up.
      // We pick a label only the form has — the path input — to be sure.
      const dialog = window.locator('mat-dialog-container');
      await expect(dialog.locator('mat-label:text-is("Backup File Path (local)")')).toHaveCount(0);
    });
  });
});

async function openBackupDialog(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Backup Database' }).click();
  await expect(window.locator('mat-dialog-container')).toBeVisible({ timeout: 5_000 });
}
