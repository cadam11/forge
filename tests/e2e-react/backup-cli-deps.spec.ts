/**
 * The missing-CLI-tools remediation view, against the React renderer.
 *
 * Rewrite of `tests/e2e/backup-cli-deps.spec.ts`. The mechanism is the same and is the only one that
 * works: launch Joinery with `PATH` stripped of the directories the brew-installed tools live in, so the
 * main process's own `which`-style probe genuinely fails. Nothing is stubbed — the point is that the
 * probe, the IPC channel, the phase machine and the view agree.
 *
 * The three legacy `data-testid`s are asserted verbatim (`missing-cli-tools`, `tool-status-pg_dump`,
 * `missing-cli-tools-recheck`): they are three of the seven that existed anywhere in the Angular
 * renderer, and keeping them is what makes this a rewrite of that spec rather than a different one.
 *
 * What is new: the **negative** assertion is now on a testid rather than on a Material label
 * (`mat-label:text-is("Backup File Path (local)")`), and the re-check's own failure path is asserted —
 * re-checking while the tools are still missing must leave the card up, not fall through to a form that
 * would produce a spawn ENOENT.
 *
 * `backup.spec.ts` is the other half of this pair: on an unrestricted PATH the same click reaches the
 * form and `missing-cli-tools` is absent. Neither test means much without the other.
 */

import { expect, test } from './fixtures';
import {
  backupDialog,
  connectFromSidebar,
  createPostgresProfile,
  ensureJoineryTestSeeded,
  missingCliTools,
  selectDatabase,
  TEST_PG,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Test PG';

/**
 * `PATH` with `/opt/homebrew/*` removed — where `pg_dump` and `pg_restore` live in dev — but the system
 * bins kept so Electron itself still launches. macOS-only, which matches Joinery's shipped targets.
 */
const RESTRICTED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

test.beforeAll(ensureJoineryTestSeeded);

test.describe('Joinery (React) — the missing-CLI-tools remediation view', () => {
  test.skip(
    process.platform !== 'darwin',
    'The restricted-PATH pattern is darwin-specific (it relies on the /opt/homebrew layout).'
  );

  test('replaces the backup form with setup instructions when pg_dump is not on PATH', async () => {
    await withJoineryReact({ envOverrides: { PATH: RESTRICTED_PATH } }, async ({ window }) => {
      // The `pg` driver is JavaScript, so connecting is unaffected by the stripped PATH — only the
      // shelled-out dump tools are.
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, TEST_PG.database);

      await window.getByTestId('sidebar-backup').click();
      const dialog = backupDialog(window);
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      const card = missingCliTools(window);
      await expect(card).toBeVisible({ timeout: 15_000 });

      // Both PG tools probed, both flagged.
      await expect(card.getByTestId('tool-status-pg_dump')).toContainText(/missing/i);
      await expect(card.getByTestId('tool-status-pg_restore')).toContainText(/missing/i);

      // The engine-aware title and the darwin install command, from `cli-install-instructions.ts`.
      await expect(card).toContainText(/install postgresql client tools/i);
      await expect(card).toContainText(/brew install postgresql@16/);

      // The form is NOT behind the card — the path field is the control only the form has.
      await expect(dialog.getByTestId('backup-path')).toHaveCount(0);
      await expect(dialog.getByTestId('backup-start')).toHaveCount(0);
    });
  });

  test('a re-check with the tools still missing stays on the card', async () => {
    await withJoineryReact({ envOverrides: { PATH: RESTRICTED_PATH } }, async ({ window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, TEST_PG.database);

      await window.getByTestId('sidebar-backup').click();
      const card = missingCliTools(window);
      await expect(card).toBeVisible({ timeout: 15_000 });

      // `recheckTools` forces a fresh probe past the cache (`backup.ipc.ts:43-46`), so this is a real
      // second look at the host rather than a re-render of the first answer.
      await card.getByTestId('missing-cli-tools-recheck').click();

      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card.getByTestId('tool-status-pg_dump')).toContainText(/missing/i);
      await expect(backupDialog(window).getByTestId('backup-path')).toHaveCount(0);
    });
  });

  test('copies the install command to the real clipboard, confirming in place', async () => {
    await withJoineryReact({ envOverrides: { PATH: RESTRICTED_PATH } }, async ({ app, window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, TEST_PG.database);

      await window.getByTestId('sidebar-backup').click();
      const card = missingCliTools(window);
      await expect(card).toBeVisible({ timeout: 15_000 });

      await app.evaluate(({ clipboard }) => clipboard.writeText(''));
      await card.getByTestId('backup-tools-copy-0').click();

      // Read through Electron's own main-process clipboard, for the reason `copyGridSelection`
      // documents: the renderer's `readText` needs a permission prompt a headless Electron never
      // answers, and the system clipboard is where the user's next ⌘V reads from anyway.
      await expect
        .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 })
        .toContain('brew install postgresql@16');

      // Confirmed on the button itself, not in a toast — a toast above this modal would be inert
      // (J-42), which is exactly the trap the Angular version fell into here. `data-copied` rather
      // than the `aria-label`: the accessible name is stable by design, so it would pass either way.
      await expect(card.getByTestId('backup-tools-copy-0')).toHaveAttribute('data-copied', 'true');
    });
  });
});
