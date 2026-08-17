/**
 * Visual baselines — the four dialogs whose layout is worth locking down.
 *
 * Each is captured as an ELEMENT rather than as a window: what a dialog has to get right is its own
 * header/body/actions rhythm and its form density, and framing the whole window would put the scrim
 * and whatever is behind it into the comparison for no gain.
 *
 * ── Two things every path here is deliberate about ────────────────────────────────────────────
 *
 *  1. **No date is left to the clock.** The backup wizard's path field opens holding
 *     `suggestedFileName(db, engine, new Date())` — a filename with today's date in it — so a
 *     baseline of the untouched form would go red at midnight. Both wizards are given a fixed
 *     absolute path instead, which is a fill rather than a mask: a path the shot can actually show is
 *     better than a pink rectangle where the path goes.
 *  2. **The restore shot stops AT the gate.** It is taken in the `confirming` phase — the screen that
 *     says "This cannot be undone" — and `restore-confirm-start` is never pressed. The spec asserts
 *     afterwards that no run started, so the picture is provably of a dialog that destroyed nothing.
 */

import { mkdirSync, writeFileSync } from 'node:fs';

import { VISUAL_THEMES, expect, shoot, test, withVisualApp } from './fixtures';
import {
  connectFromSidebar,
  connectionEditor,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  fillPostgresForm,
  fillRestoreForm,
  openBackupDialog,
  openConnectionEditor,
  openRestoreDialog,
  openSettings,
  openSettingsGroup,
  restoreDialog,
  selectDatabase,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Test PG';
const DATABASE = 'joinery_test';

/**
 * A fixed directory, and fixed filenames inside it.
 *
 * `os.tmpdir()` is not usable here: on macOS it is a per-user `/var/folders/**` path that differs
 * between machines and between reboots, and both wizards PRINT the path they were given. A literal
 * path is the only kind that can appear in a committed baseline.
 */
const FIXTURE_DIR = '/tmp/joinery-visual';
const BACKUP_DESTINATION = `${FIXTURE_DIR}/backup-target.dump`;
const RESTORE_SOURCE = `${FIXTURE_DIR}/restore-source.dump`;

test.beforeAll(ensureJoineryTestSeeded);
test.beforeAll(() => {
  // The restore wizard reads nothing out of the archive on PostgreSQL (the header inspection is the
  // MSSQL path), but a source file that exists keeps the shot honest about what it is describing.
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(RESTORE_SOURCE, 'not a real archive — this baseline never runs the restore\n');
});

for (const theme of VISUAL_THEMES) {
  test.describe(`Joinery (React) — dialog baselines, ${theme}`, () => {
    test('connection editor, filled for the seeded PostgreSQL container', async () => {
      await withVisualApp(theme, async ({ window }) => {
        await openConnectionEditor(window);
        // Filled rather than blank: an empty form shows the layout but none of the things that go
        // wrong in a populated one — label/value baselines, the mono treatment on host and port, and
        // how a long connection name behaves next to the engine select.
        await fillPostgresForm(window, PROFILE);
        await shoot(connectionEditor(window), `connection-editor-${theme}.png`);
      });
    });

    test('settings panel, appearance', async () => {
      await withVisualApp(theme, async ({ app, window }) => {
        await openSettings(app, window);
        const group = await openSettingsGroup(window, 'appearance');
        // The theme radio in this group reflects the pin `withVisualApp` applied, so the dark and
        // light baselines differ in the selected row as well as in every colour — which is correct,
        // and worth knowing when reviewing the pair.
        await expect(group.getByTestId(`settings-theme-${theme}`)).toBeChecked();
        await shoot(window.getByTestId('settings-dialog'), `settings-appearance-${theme}.png`);
      });
    });

    test('backup wizard, ready to run', async () => {
      await withVisualApp(theme, async ({ window }) => {
        await createPostgresProfile(window, PROFILE);
        await connectFromSidebar(window, PROFILE);
        await selectDatabase(window, DATABASE);
        await dismissToasts(window);

        const dialog = await openBackupDialog(window);
        // If `pg_dump` were missing the wizard would render the remediation view instead, and this
        // baseline would silently become a picture of that. Asserted, so the machine's missing tool
        // is reported as a missing tool.
        await expect(window.getByTestId('missing-cli-tools')).toHaveCount(0);

        const path = dialog.getByTestId('backup-path');
        await path.fill(BACKUP_DESTINATION);
        await expect(path).toHaveValue(BACKUP_DESTINATION);
        await shoot(dialog, `backup-form-${theme}.png`);

        // Nothing was started: the shot is of a wizard that has not run.
        await expect(dialog.getByTestId('backup-progress')).toHaveCount(0);
      });
    });

    test('restore wizard at the overwrite confirmation', async () => {
      await withVisualApp(theme, async ({ window }) => {
        await createPostgresProfile(window, PROFILE);
        await connectFromSidebar(window, PROFILE);
        await selectDatabase(window, DATABASE);
        await dismissToasts(window);

        const dialog = await openRestoreDialog(window);
        await expect(window.getByTestId('missing-cli-tools')).toHaveCount(0);

        // The target is a database that exists, which is what makes this an overwrite and puts the
        // confirmation in the way. `joinery_test` is the seeded fixture: naming it is safe precisely
        // because the confirmation is never given below.
        await fillRestoreForm(window, RESTORE_SOURCE, DATABASE);
        await expect(dialog.getByTestId('restore-target-note')).toContainText('already exists');
        await expect(dialog.getByTestId('restore-submit')).toHaveText(/Review the restore/);
        await dialog.getByTestId('restore-submit').click();
        await expect(dialog.getByTestId('restore-confirm')).toBeVisible();

        await shoot(dialog, `restore-confirm-${theme}.png`);

        // The gate held: no run began, and the button that would begin one is still waiting.
        await expect(dialog.getByTestId('restore-progress')).toHaveCount(0);
        await expect(dialog.getByTestId('restore-confirm-start')).toBeDisabled();
        await expect(restoreDialog(window)).toBeVisible();
      });
    });
  });
}
