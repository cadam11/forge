/**
 * The query tab's toolbar and the surfaces it drives, against the seeded PostgreSQL container.
 *
 * Replaces `tests/e2e/query-toolbar.spec.ts`, which located the toolbar as `.query-toolbar:visible` and
 * its buttons by the ligature text inside their `<mat-icon>` (`button:has(mat-icon:text-is("download"))`)
 * — both of which PLAN.md's Task 20 lists as locator classes that die with the old suite.
 *
 * The split of responsibility with `query-editor.spec.ts`: that file is about Monaco, this one is about
 * everything Joinery renders around it — the buttons' enabled states, the executing indicator, the
 * results pane's states, and the two dialogs that used to be hand-built `innerHTML` overlays.
 */

import { expect, test } from './fixtures';
import {
  connectFromSidebar,
  createPostgresProfile,
  ensureJoineryTestSeeded,
  executeQuery,
  openQueryTab,
  selectDatabase,
  typeSql,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Test PG';

test.beforeAll(ensureJoineryTestSeeded);

async function readyEditor(window: Parameters<typeof openQueryTab>[0]) {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, 'joinery_test');
  return openQueryTab(window);
}

test.describe('Joinery (React) — the query toolbar', () => {
  test('offers execute, refuses cancel, and reports the tab’s target', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);

      const toolbar = window.getByTestId('query-toolbar');
      await expect(toolbar).toBeVisible();
      // Cancel is meaningless with nothing running, and the Angular toolbar's `[disabled]` binding
      // said so too — this is the assertion that keeps it true.
      await expect(toolbar.getByTestId('query-cancel')).toBeDisabled();
      await expect(toolbar.getByTestId('query-execute')).toBeEnabled();
      // Which server and database this tab will run against. Task 14's connection chip replaces this
      // read-only line; until then a user can still see what they are about to hit.
      await expect(toolbar.getByTestId('query-context')).toContainText(PROFILE);
      await expect(toolbar.getByTestId('query-context')).toContainText('joinery_test');
    });
  });

  test('runs a query, shows the executing indicator, and lands the rows', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      // `pg_sleep(1)` in a CTE, cross-joined: the SELECT list is untouched, so the result is still the
      // two columns and the same rows, but the run lasts long enough for the indicator's VISIBLE half to
      // be observable rather than a race. Without it the query settles in single-digit milliseconds and
      // "it appears" is unassertable — which is why the first version of this test only checked that it
      // went away, under a comment claiming both halves.
      await typeSql(
        window,
        'WITH slow AS (SELECT pg_sleep(1)) SELECT id, email FROM customers, slow ORDER BY id'
      );

      // The status bar's indicator is Task 10's store, and Task 7 shipped the slot empty rather than
      // inventing a second source of truth. Both halves are asserted: it appears, and it goes away.
      await window.getByTestId('query-execute').click();
      await expect(window.getByTestId('status-executing')).toBeVisible({ timeout: 10_000 });
      await expect(window.getByTestId('status-executing')).toBeHidden({ timeout: 20_000 });

      await expect(window.getByTestId('query-results')).toBeVisible();
      await expect(window.getByTestId('query-result-column')).toHaveCount(2);
      // The Messages tab is always there, and it carries the execution time the query really took.
      await window.getByTestId('query-results-tab-messages').click();
      await expect(window.getByTestId('query-messages')).toContainText('Execution time');
    });
  });

  test('reports a failed query in the pane rather than as a toast', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await typeSql(window, 'SELECT * FROM table_that_does_not_exist');

      await executeQuery(window);

      // A failed execute is a RESULT, not an exception: the store holds it and the pane renders its
      // message, which is what makes the error inspectable instead of a toast that vanishes.
      await expect(window.getByTestId('query-results-error')).toBeVisible();
      await expect(window.getByTestId('query-results-error-text')).toContainText(
        'table_that_does_not_exist'
      );
    });
  });

  test('refuses an empty run', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);

      await window.getByTestId('query-execute').click();

      // Filtered, not `.first()`: the connect and save toasts from `readyEditor` are still stacked, so
      // asserting on the front-most one would be asserting on whichever happened to be on top.
      await expect(
        window.locator('[data-sonner-toast]').filter({ hasText: 'No query to execute' })
      ).toHaveCount(1);
      await expect(window.getByTestId('query-results-empty')).toBeVisible();
      // No `dismissToasts` here: `readyEditor` leaves the connect and save toasts stacked and this test
      // ends immediately, so clearing them would only be tidying up after the app on its way out.
    });
  });

  test('hides and restores the results pane', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await expect(window.getByTestId('query-results-empty')).toBeVisible();
      await expect(window.getByTestId('query-split-handle')).toBeVisible();

      await window.getByTestId('query-toggle-results').click();

      // The editor takes the whole pane, and the divider goes with the pane it divided.
      await expect(window.getByTestId('query-results-empty')).toHaveCount(0);
      await expect(window.getByTestId('query-split-handle')).toHaveCount(0);

      await window.getByTestId('query-toggle-results').click();
      await expect(window.getByTestId('query-results-empty')).toBeVisible();
    });
  });

  test('the editor/results divider is keyboard-operable and persists its position', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      const handle = window.getByTestId('query-split-handle');

      // The ARIA window-splitter contract, on the axis a top/bottom split needs.
      await expect(handle).toHaveAttribute('role', 'separator');
      await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
      await expect(handle).toHaveAttribute('aria-valuenow', '50');

      await handle.focus();
      await window.keyboard.press('ArrowDown');
      await window.keyboard.press('ArrowDown');

      // 2% per press, and the value is what `AppState.editorHeightPercent` now round-trips — a field
      // that existed in main and that the Angular renderer never read or wrote.
      await expect(handle).toHaveAttribute('aria-valuenow', '54');
    });
  });

  test('prompts for Flyway placeholders, then substitutes them', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await typeSql(window, 'SELECT * FROM ${schema}.customers ORDER BY id');

      await window.getByTestId('query-execute').click();

      // The replacement for the second `innerHTML` modal. It is a real dialog: labelled fields, a
      // focus trap, and Escape works.
      const prompt = window.getByTestId('query-placeholders');
      await expect(prompt).toBeVisible();
      await expect(prompt.getByTestId('query-placeholders-blank')).toContainText('1 value is');

      await prompt.getByLabel('${schema}').fill('public');
      await prompt.getByTestId('query-placeholders-run').click();

      // Substituted and run: `public.customers` exists, so a successful result proves the value
      // reached the SQL rather than being sent as `${schema}`.
      await expect(window.getByTestId('status-executing')).toBeHidden({ timeout: 20_000 });
      await expect(window.getByTestId('query-results')).toBeVisible();
      await expect(window.getByTestId('query-results-error')).toHaveCount(0);
    });
  });

  test('opens Monaco’s find widget from the toolbar', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await typeSql(window, 'SELECT id FROM customers');

      await window.getByTestId('query-find').click();

      // Vendor internals, located structurally — the one exemption the test-hook rule grants.
      await expect(window.locator('.monaco-editor .find-widget')).toBeVisible();
      // The FIND field specifically: the widget also carries a (disabled) Replace textarea, so an
      // unqualified `textarea` matches two. `aria-label` is Monaco's own contract for these.
      await expect(
        window.locator('.monaco-editor .find-widget textarea[aria-label="Find"]')
      ).toBeFocused();
    });
  });
});
