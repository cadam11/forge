/**
 * Inline test-connection feedback on the React renderer, against the real harness databases.
 *
 * Ported from `tests/e2e/test-connection-feedback.spec.ts`, which located everything through Angular
 * component selectors (`app-password-hygiene-warning .password-warning`,
 * `app-test-result-panel .test-result-error`, `mat-dialog-container`, `mat-checkbox`). The three
 * properties it pins are unchanged, and all three are main-process behaviour the rewrite must not
 * silently lose:
 *
 *  1. the live paste-artifact banner appears for an artifact-bearing password and never for a clean
 *     one — including not for a typed international password;
 *  2. a failed Test renders the inline panel with the main process's **categorised** guidance. The
 *     MSSQL case is the regression pin for the ELOGIN mapping: `pool.connect()` rejects with
 *     `ConnectionError{code:'ELOGIN'}` and no `number`, and must still categorise as `AUTH_FAILED`
 *     rather than falling through to the generic message;
 *  3. editing any field clears the panel, so a stale error can never describe a configuration the
 *     user has since changed.
 *
 * One assertion is added: the panel must never echo the password. The guidance deliberately reports
 * its *length* (`packages/shared/src/validators/password-hygiene.ts`'s `includeLength`), and the line
 * between "15 characters long" and the characters themselves is the one this file guards.
 */

import { expect, test } from './fixtures';
import {
  TEST_PG,
  connectionEditor,
  fillPostgresForm,
  openConnectionEditor,
  testConnectionInEditor,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

/** The harness SQL Server, from tests/docker-compose.test.yml. */
const TEST_MSSQL = { host: '127.0.0.1', port: 11433, user: 'sa' } as const;

/** A wrong password with a trailing space — 15 characters, which the diagnostic reports. */
const WRONG_WITH_ARTIFACT = 'WrongPassword! ';

test.describe('Joinery (React) — the live password-hygiene banner', () => {
  test('appears for a paste artifact and not for a clean or international password', async () => {
    await withJoineryReact(async ({ window }) => {
      const editor = await openConnectionEditor(window);
      const password = editor.getByLabel('Password', { exact: true });
      const banner = editor.getByTestId('password-hygiene-warning');

      await password.fill('clean-P@ssw0rd!');
      await expect(banner).toHaveCount(0);

      // A trailing space is the classic artifact; a trailing newline cannot be typed into a
      // single-line input, because the browser strips it.
      await password.fill('secret ');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText('copy/paste artifacts');
      await expect(banner).toContainText('ends with a space');
      // And it never echoes the value.
      await expect(banner).not.toContainText('secret');

      // Typed international characters are NOT branded a paste artifact — the analyzer's
      // `non-ascii` bucket is omitted at this call site for exactly this reason.
      await password.fill('passwörd');
      await expect(banner).toHaveCount(0);
    });
  });

  test('watches the SSH secrets in their own banners', async () => {
    await withJoineryReact(async ({ window }) => {
      const editor = await openConnectionEditor(window);
      await editor.getByLabel('Connect through an SSH tunnel', { exact: true }).check();

      await editor.getByLabel('SSH password', { exact: true }).fill('bastion ');
      await expect(editor.getByTestId('ssh-password-hygiene-warning')).toBeVisible();
      // The connection password is clean, so its own banner stays absent.
      await expect(editor.getByTestId('password-hygiene-warning')).toHaveCount(0);
    });
  });
});

test.describe('Joinery (React) — a failed Test renders its guidance inline', () => {
  test('MSSQL (ELOGIN) shows the AUTH_FAILED guidance with the hygiene lines', async () => {
    await withJoineryReact(async ({ window }) => {
      const editor = await openConnectionEditor(window);

      // mssql is the default engine, so no engine switch is needed.
      await editor.getByLabel('Connection name', { exact: true }).fill('Bad MSSQL');
      await editor.getByLabel('Server', { exact: true }).fill(TEST_MSSQL.host);
      await editor.getByLabel('Port', { exact: true }).fill(String(TEST_MSSQL.port));
      await editor.getByLabel('Username', { exact: true }).fill(TEST_MSSQL.user);
      await editor.getByLabel('Password', { exact: true }).fill(WRONG_WITH_ARTIFACT);

      const panel = await testConnectionInEditor(window);
      await expect(panel).toBeVisible({ timeout: 30_000 });

      await expect(panel).toContainText('Login failed');
      // The categorised guidance, not the raw driver message with a generic fallback line.
      await expect(panel).toContainText('Check that the password is correct');
      // The hygiene diagnostic rides along with it, length line included.
      await expect(panel).toContainText('ends with a space');
      await expect(panel).toContainText('being tested is 15 characters');
      // The length, never the characters.
      await expect(panel).not.toContainText('WrongPassword!');

      // Editing the password clears the now-stale panel.
      await editor.getByLabel('Password', { exact: true }).fill('WrongPassword!x');
      await expect(panel).toHaveCount(0);
    });
  });

  test('PostgreSQL shows auth guidance with the hygiene lines', async () => {
    await withJoineryReact(async ({ window }) => {
      const editor = await openConnectionEditor(window);
      // Fills the engine, host, port, username and unchecks TLS for the stock dev image; the
      // password is then overwritten with a wrong one.
      await fillPostgresForm(window, 'Bad PG');
      await editor.getByLabel('Password', { exact: true }).fill('wrongpass ');
      // Guard against the fixture and the test disagreeing about the credentials under test.
      expect('wrongpass').not.toBe(TEST_PG.password);

      const panel = await testConnectionInEditor(window);
      await expect(panel).toBeVisible({ timeout: 30_000 });

      await expect(panel).toContainText('Check that the password is correct');
      await expect(panel).toContainText('ends with a space');
    });
  });

  test('a non-password edit clears the panel too', async () => {
    // The Angular dialog needed an `(input)` listener plus an explicit clear on every select and
    // checkbox, and the colour swatches were covered by none of them. One value subscription covers
    // the lot, and a checkbox is the case that proves it is not just a text-input listener.
    await withJoineryReact(async ({ window }) => {
      const editor = await openConnectionEditor(window);
      await editor.getByLabel('Connection name', { exact: true }).fill('Bad MSSQL');
      await editor.getByLabel('Server', { exact: true }).fill(TEST_MSSQL.host);
      await editor.getByLabel('Port', { exact: true }).fill(String(TEST_MSSQL.port));
      await editor.getByLabel('Username', { exact: true }).fill(TEST_MSSQL.user);
      await editor.getByLabel('Password', { exact: true }).fill('definitely-wrong');

      const panel = await testConnectionInEditor(window);
      await expect(panel).toBeVisible({ timeout: 30_000 });

      await editor.getByTestId('connection-color-teal').click();
      await expect(panel).toHaveCount(0);
    });
  });

  test('a successful Test leaves the panel absent', async () => {
    await withJoineryReact(async ({ window }) => {
      await openConnectionEditor(window);
      await fillPostgresForm(window, 'Good PG');

      const panel = await testConnectionInEditor(window);
      await expect(panel).toHaveCount(0);
      await expect(connectionEditor(window)).toBeVisible();
    });
  });
});
