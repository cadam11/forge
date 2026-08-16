/**
 * The snippet library, end to end: save the SQL in the editor, insert it back, and survive a restart.
 *
 * The restart is the test that matters, and it is the one PLAN.md 0.5 asks for. The whole library used
 * to live in `localStorage` and nowhere else, so the assertion here wipes browser storage before
 * reloading: a snippet that comes back can only have come from main-process `AppState`. That is the
 * same proof `settings.spec.ts` makes about settings, applied to the data whose migration Task 5 built.
 */

import { expect, test } from './fixtures';
import {
  closeOverlay,
  connectFromSidebar,
  createPostgresProfile,
  createSnippet,
  ensureJoineryTestSeeded,
  filterOverlay,
  openPalette,
  openQueryTab,
  openSnippets,
  overlayRows,
  selectDatabase,
  runPaletteCommand,
  snippetRow,
  typeSql,
  visibleSql,
  waitForShell,
  withJoineryReact,
} from '../helpers/joinery-actions-react';
import type { Page } from '@playwright/test';

const PROFILE = 'Test PG';
const SNIPPET_SQL = 'SELECT id, email FROM customers ORDER BY id';

test.beforeAll(ensureJoineryTestSeeded);

/** A connection, a database and a query tab with Monaco painted. */
async function readyEditor(window: Page): Promise<void> {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, 'joinery_test');
  await openQueryTab(window);
}

test.describe('Joinery — the snippet library', () => {
  test('saves the editor’s SQL, inserts it back, and keeps it across a restart', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await typeSql(window, SNIPPET_SQL);

      // Save. The form is seeded with what the editor holds, which is the Angular "Save Current"
      // behaviour and the reason the library is reachable from a query tab at all.
      await openSnippets(window);
      await expect(window.getByTestId('snippets-empty')).toContainText('No snippets yet');
      await createSnippet(window, { name: 'Customer emails', tags: 'reporting, demo' });
      await expect(snippetRow(window, 'Customer emails')).toContainText('FROM customers');
      await expect(window.getByTestId('snippets-count')).toHaveText('1 of 1');
      await closeOverlay(window, 'snippets');

      // Insert into a DIFFERENT editor state: the tab is emptied first, so the text appearing can only
      // have come from the snippet.
      await typeSql(window, '-- empty');
      await openSnippets(window);
      await snippetRow(window, 'Customer emails').click();
      await expect(window.getByTestId('snippets-overlay')).toBeHidden();
      await expect.poll(() => visibleSql(window), { timeout: 20_000 }).toContain('FROM customers');

      // The tab is closed before the reload, and that is not incidental: the shell arms a
      // `beforeunload` guard while any tab is dirty (`app-shell.tsx`, ported from
      // `app.component.ts:93-101`), and an inserted snippet dirties the editor. Closing it through the
      // palette is the same `close-active-tab` command ⌘W sends, so the reload below is a clean one.
      await openPalette(window);
      await runPaletteCommand(window, 'command:close-active-tab');

      // Everything the renderer keeps in browser storage is wiped, so what comes back after the reload
      // came from `AppState` — which is what Task 5's migration lifted it into.
      await window.evaluate(() => window.localStorage.clear());
      await window.reload();
      await waitForShell(window);

      await openSnippets(window);
      await expect(snippetRow(window, 'Customer emails')).toBeVisible();
      await expect(snippetRow(window, 'Customer emails')).toContainText('reporting');
    });
  });

  test('searches by name, tag and SQL, and edits and deletes a snippet', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await typeSql(window, SNIPPET_SQL);
      await openSnippets(window);
      await createSnippet(window, { name: 'Customer emails', tags: 'reporting' });
      await createSnippet(window, {
        name: 'Order totals',
        tags: 'finance',
        sql: 'SELECT order_id, SUM(quantity) FROM order_items GROUP BY order_id',
      });

      await filterOverlay(window, 'snippets', 'finance');
      await expect(overlayRows(window, 'snippets')).toHaveCount(1);
      await filterOverlay(window, 'snippets', 'order_items');
      await expect(overlayRows(window, 'snippets')).toHaveCount(1);
      await filterOverlay(window, 'snippets', '');

      // Edit: same snippet, new name.
      await snippetRow(window, 'Order totals').getByTestId('snippets-edit').click();
      await window.getByTestId('snippets-form-name').fill('Totals by order');
      await window.getByTestId('snippets-form-save').click();
      await expect(snippetRow(window, 'Totals by order')).toBeVisible();
      await expect(snippetRow(window, 'Order totals')).toHaveCount(0);

      // Delete.
      await snippetRow(window, 'Totals by order').getByTestId('snippets-delete').click();
      await expect(snippetRow(window, 'Totals by order')).toHaveCount(0);
      await expect(window.getByTestId('snippets-count')).toHaveText('1 of 1');
    });
  });

  test('refuses to insert when no editor can receive it, and says why', async () => {
    await withJoineryReact(async ({ window }) => {
      // A snippet exists, but there is no query tab: the insert command's only consumer is the query
      // editor, so the row is inert and states the reason rather than dispatching into silence.
      await readyEditor(window);
      await typeSql(window, SNIPPET_SQL);
      await openSnippets(window);
      await createSnippet(window, { name: 'Customer emails' });
      await closeOverlay(window, 'snippets');

      // Close the only query tab through the palette, which is the same `close-active-tab` command ⌘W
      // sends — and one more command proven live while we are here.
      await openPalette(window);
      await runPaletteCommand(window, 'command:close-active-tab');
      await expect(window.getByTestId('query-panel')).toHaveCount(0);

      await openSnippets(window);
      const row = snippetRow(window, 'Customer emails');
      await expect(row).toHaveAttribute('data-disabled', 'true');
      await expect(row.getByTestId('snippets-row-blocked')).toContainText('query tab');
      // The editing affordances still work on an insert-blocked row — the two have nothing to do with
      // each other.
      await expect(row.getByTestId('snippets-edit')).toBeVisible();
    });
  });
});
