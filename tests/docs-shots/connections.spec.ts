/**
 * Documentation shots — the connection editor, once per engine, plus the SSH tunnel section.
 *
 * These are the pictures the four Getting Started ▸ Connect pages need, and they are filled rather
 * than blank: an empty form shows the layout but none of what a reader is actually looking for —
 * which field takes the port, where the default database goes, what the encryption toggles look like
 * when they are off.
 *
 * **Every value is a fixture value.** Host, port, user and database come from
 * `tests/helpers/react/app.ts`'s `TEST_PG`/`TEST_MYSQL` and from `db-fixtures.ts`'s
 * `TEST_CONNECTIONS`, i.e. from `tests/docker-compose.test.yml`. That is the structural fix for J-23,
 * where the deleted screenshots published an internal Azure SQL hostname: there is no path here by
 * which a real server can reach a committed PNG.
 *
 * Nothing here connects. The editor is filled and photographed, and the profile is never saved — so
 * these shots also cost no keychain entry and no container round trip.
 *
 * Each capture is preceded by `blurFocus`, because the last thing every one of these tests does is
 * type into or tick a control — and a focus ring on whichever field happened to be last is a picture
 * of the test's own order of operations rather than of the form.
 */

import { expect, type Page } from '@playwright/test';

import {
  assertFullyFramed,
  blurFocus,
  capture,
  scrollToFrameTop,
  scrollToTop,
  test,
  withDocsApp,
} from './fixtures';
import { PAGE_THEMES } from './catalogue';
import {
  TEST_MYSQL,
  TEST_PG,
  connectionEditor,
  fillMysqlForm,
  fillPostgresForm,
  openConnectionEditor,
  selectEditorOption,
} from '../helpers/joinery-actions-react';

/**
 * The seeded SQL Server container, as `tests/helpers/db-fixtures.ts`'s `TEST_CONNECTIONS.mssql`
 * spells it.
 *
 * Restated here rather than imported for the reason `TEST_MYSQL` gives in `helpers/react/app.ts`:
 * that module is the integration tier's, and this tier needs the connection facts, not its
 * create/drop machinery. The values match.
 */
const TEST_MSSQL = {
  host: '127.0.0.1',
  port: 11433,
  user: 'sa',
  password: 'JoineryTest!Pa55',
  database: 'joinery_test',
} as const;

/**
 * The bastion the harness runs for the tunnel specs (`tests/docker-compose.test.yml`).
 *
 * The private key path is a literal, and deliberately not a real one: `~/.ssh/id_ed25519` is the
 * conventional location a reader will recognise, and an absolute path from this machine would put
 * a developer's home directory into a committed image.
 */
const TEST_BASTION = {
  host: '127.0.0.1',
  port: 12222,
  user: 'joinery',
  keyPath: '~/.ssh/id_ed25519',
} as const;

/**
 * Fill the editor for the seeded SQL Server container.
 *
 * Engine first, and that ordering is load-bearing for the reason `fillPostgresForm` documents:
 * switching the engine rewrites the port and the username (`form-model.ts:applyEngineChange`), so
 * filling those first would have them overwritten.
 *
 * Local rather than in `tests/helpers/react/connections.ts`: the functional tiers have no MSSQL
 * profile helper because nothing there connects to that container through the UI, and adding one to
 * a shared module for a single screenshot would change a file three tiers compile against.
 */
async function fillSqlServerForm(window: Page, profileName: string): Promise<void> {
  const editor = connectionEditor(window);

  await selectEditorOption(window, 'connection-engine', 'SQL Server');
  await editor.getByLabel('Connection name', { exact: true }).fill(profileName);
  await editor.getByLabel('Server', { exact: true }).fill(TEST_MSSQL.host);
  await editor.getByLabel('Port', { exact: true }).fill(String(TEST_MSSQL.port));
  await editor.getByLabel('Username', { exact: true }).fill(TEST_MSSQL.user);
  await editor.getByLabel('Password', { exact: true }).fill(TEST_MSSQL.password);
  await editor.getByLabel('Default database', { exact: true }).fill(TEST_MSSQL.database);
  // The dev image ships a self-signed certificate, which is the configuration a reader following
  // the SQL Server page against a container will have.
  await editor.getByLabel('Trust the server certificate', { exact: true }).check();
}

/**
 * Put the editor's scroll position back at the very top, and prove the first field is not clipped.
 *
 * ── The bug this replaces, because "scroll to the top" is not what the first version did ────────
 *
 * Filling a field scrolls it into view, so an editor photographed straight after the last `fill` is
 * scrolled to wherever that field was. The first fix called `scrollIntoViewIfNeeded()` on the
 * connection-name input — and that scrolls the MINIMUM distance to reveal the *input*, which leaves
 * its own `<label>` above the top edge of the scroll box. All four Getting Started ▸ Connect shots
 * shipped with a horizontally bisected first label (review M3): "Connection name" sliced in half on
 * two of them, "Database engine" on a third, the colour-swatch row on the fourth.
 *
 * `scrollToTop` sets every scrolling box in the dialog back to zero instead, which is the property
 * the comment always claimed. The assertion is the other half: a label clipped by an ancestor's
 * `overflow` is still `toBeVisible` as far as Playwright is concerned — visibility is about layout
 * and opacity, not about being inside the box that will be photographed — so nothing the tier had
 * before would have caught this. `assertFullyFramed` compares the boxes.
 */
async function frameEditorFromTheTop(window: Page, firstLabel: string): Promise<void> {
  const editor = connectionEditor(window);
  await scrollToTop(editor);
  await assertFullyFramed(
    editor.getByText(firstLabel, { exact: true }),
    editor,
    `the connection editor's "${firstLabel}" label`
  );
}

for (const theme of PAGE_THEMES) {
  test.describe(`docs shots — connection editor, ${theme}`, () => {
    test('PostgreSQL', async () => {
      await withDocsApp(theme, async ({ window }) => {
        const editor = await openConnectionEditor(window);
        await fillPostgresForm(window, 'Local Postgres');
        await expect(editor.getByLabel('Server', { exact: true })).toHaveValue(TEST_PG.host);
        await frameEditorFromTheTop(window, 'Database engine');
        await blurFocus(window);
        await capture(
          editor,
          'connect-postgresql',
          theme,
          'The connection editor filled for a PostgreSQL server'
        );
      });
    });

    test('MySQL', async () => {
      await withDocsApp(theme, async ({ window }) => {
        const editor = await openConnectionEditor(window);
        await fillMysqlForm(window, 'Local MySQL');
        await expect(editor.getByLabel('Port', { exact: true })).toHaveValue(
          String(TEST_MYSQL.port)
        );
        await frameEditorFromTheTop(window, 'Database engine');
        await blurFocus(window);
        await capture(
          editor,
          'connect-mysql',
          theme,
          'The connection editor filled for a MySQL server'
        );
      });
    });

    test('SQL Server', async () => {
      await withDocsApp(theme, async ({ window }) => {
        const editor = await openConnectionEditor(window);
        await fillSqlServerForm(window, 'Local SQL Server');
        await expect(editor.getByLabel('Port', { exact: true })).toHaveValue(
          String(TEST_MSSQL.port)
        );
        await frameEditorFromTheTop(window, 'Database engine');
        await blurFocus(window);
        await capture(
          editor,
          'connect-sql-server',
          theme,
          'The connection editor filled for a SQL Server instance'
        );
      });
    });

    test('through an SSH tunnel', async () => {
      await withDocsApp(theme, async ({ window }) => {
        const editor = await openConnectionEditor(window);
        await fillPostgresForm(window, 'Postgres via bastion');

        await editor.getByTestId('connection-ssh-enabled').check();
        // The whole section is conditional on the toggle (`connection-editor.tsx:652`), so the
        // fields below do not exist until it is on — waited for rather than assumed.
        await expect(editor.getByTestId('connection-ssh-host')).toBeVisible();
        await editor.getByLabel('SSH host', { exact: true }).fill(TEST_BASTION.host);
        await editor.getByLabel('SSH port', { exact: true }).fill(String(TEST_BASTION.port));
        await editor.getByLabel('SSH username', { exact: true }).fill(TEST_BASTION.user);
        // Key auth rather than the default password auth: it is what the Connect over SSH page
        // recommends, and the two branches are mutually exclusive in the form
        // (`connection-editor.tsx:698`) so only one of them can be in the picture.
        await selectEditorOption(window, 'connection-ssh-auth-type', 'Private key');
        await editor.getByLabel('Private key path', { exact: true }).fill(TEST_BASTION.keyPath);

        // The tunnel fields are below the fold of a filled editor, and an element screenshot frames
        // the element's visible box — so without this the shot is of the part of the form the page
        // is NOT about. The SECTION's own top edge is put at the frame's top edge rather than
        // scrolling a field into view, which is what left this shot opening on a sliced colour-swatch
        // row (review M3).
        const section = editor.getByTestId('connection-section-ssh');
        await scrollToFrameTop(section);
        await assertFullyFramed(
          section.getByText('SSH tunnel', { exact: true }),
          editor,
          "the connection editor's SSH tunnel heading"
        );
        await blurFocus(window);
        await capture(
          editor,
          'connect-ssh',
          theme,
          'The connection editor with the SSH tunnel section filled in'
        );
      });
    });
  });
}
