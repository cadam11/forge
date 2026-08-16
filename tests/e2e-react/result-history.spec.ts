/**
 * Result history and the inline diff, against the seeded PostgreSQL container.
 *
 * ── What only this tier proves ────────────────────────────────────────────────────────────────
 *
 * The diff itself is the MAIN process's (`config/query-results-store.ts:compareSnapshots`), computed
 * over snapshots on disk. `result-diff.spec.ts` pins the renderer's presentation over crafted
 * `ResultDiff`s; nothing below the e2e tier can prove that two real runs of two real queries produce
 * the counts a user reads. So this file crafts the three cases against real data:
 *
 *   - **changed** — the same three customers with `upper(full_name)`: same keys, different values;
 *   - **added** — the same query widened by one row;
 *   - **reordered** — the same query with `ORDER BY id DESC`, which must be reported as NO CHANGES,
 *     because main matches rows on their key columns rather than on position.
 *
 * ── Why every case captures, and why each one gets its own tab ────────────────────────────────
 *
 * The main process snapshots every execute of its own accord, asynchronously, AFTER the reply reaches
 * the renderer (`query.ipc.ts:59-78`). A spec that selected "the two most recent rows" would be
 * racing that write. `Capture` writes a PINNED snapshot synchronously from the renderer, so
 * `[data-pinned="true"]` names exactly the rows the spec made — and because the panel filters by
 * `tabId`, a fresh query tab per case means a list holding nothing else.
 */

import { expect, test } from './fixtures';
import {
  captureResult,
  connectFromSidebar,
  createPostgresProfile,
  ensureJoineryTestSeeded,
  executeQuery,
  historyRows,
  openQueryTab,
  openResultHistory,
  pinnedHistoryRows,
  resultsGrid,
  selectDatabase,
  typeSql,
  withJoineryReact,
} from '../helpers/joinery-actions-react';
import type { Page } from '@playwright/test';

const PROFILE = 'Test PG';

const THREE_CUSTOMERS = 'SELECT id, full_name FROM customers WHERE id <= 3 ORDER BY id';
const THREE_UPPERCASED =
  'SELECT id, upper(full_name) AS full_name FROM customers WHERE id <= 3 ORDER BY id';
const FOUR_CUSTOMERS = 'SELECT id, full_name FROM customers WHERE id <= 4 ORDER BY id';
const THREE_REVERSED = 'SELECT id, full_name FROM customers WHERE id <= 3 ORDER BY id DESC';

test.beforeAll(ensureJoineryTestSeeded);

async function readyEditor(window: Page) {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, 'joinery_test');
  return openQueryTab(window);
}

async function run(window: Page, sql: string): Promise<void> {
  await typeSql(window, sql);
  await executeQuery(window);
  await expect(resultsGrid(window).locator('.ag-row').first()).toBeVisible({ timeout: 20_000 });
}

/** Runs both statements, capturing each result as a pinned snapshot, then opens the diff. */
async function captureAndCompare(window: Page, base: string, compare: string) {
  await run(window, base);
  await openResultHistory(window);
  await captureResult(window, 1);

  await run(window, compare);
  await openResultHistory(window);
  await captureResult(window, 2);

  // Oldest first, so `base` is the base: the list is newest-first, and Compare takes the selection in
  // the order it was made. Selecting row 1 then row 0 makes the older snapshot the base.
  const pinned = pinnedHistoryRows(window);
  await pinned.nth(1).getByTestId('history-select').click();
  await pinned.nth(0).getByTestId('history-select').click();
  await window.getByTestId('history-compare').click();
  const diff = window.getByTestId('history-diff');
  await expect(diff).toBeVisible({ timeout: 20_000 });
  return diff;
}

test.describe('Joinery (React) — result history', () => {
  test('lists what the tab has run, with its rows and duration', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await run(window, THREE_CUSTOMERS);
      await openResultHistory(window);

      // Main's own auto-save may or may not have landed yet; the capture is this spec's own row.
      await captureResult(window, 1);
      const captured = pinnedHistoryRows(window).first();
      await expect(captured.getByTestId('history-stats')).toContainText('3 rows');
      await expect(captured.getByTestId('history-view')).toContainText('SELECT id, full_name');
    });
  });

  test('labels a snapshot inline — the surface Angular built on a prompt that never opened', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await run(window, THREE_CUSTOMERS);
      await openResultHistory(window);
      await captureResult(window, 1);

      const captured = pinnedHistoryRows(window).first();
      await captured.getByTestId('history-label').click();
      await window.getByTestId('history-label-input').fill('the baseline');
      await window.keyboard.press('Enter');

      await expect(captured.getByTestId('history-view')).toHaveText('the baseline');

      // And it survives a reload from the main process, i.e. it was really written.
      await window.getByTestId('history-refresh').click();
      await expect(pinnedHistoryRows(window).first().getByTestId('history-view')).toHaveText(
        'the baseline',
        { timeout: 20_000 }
      );
    });
  });

  test('diffs two snapshots whose rows changed: three modified, nothing added', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      const diff = await captureAndCompare(window, THREE_CUSTOMERS, THREE_UPPERCASED);

      await expect(diff.getByTestId('history-diff-modified')).toHaveText('3');
      await expect(diff.getByTestId('history-diff-added')).toHaveText('0');
      await expect(diff.getByTestId('history-diff-removed')).toHaveText('0');
      await expect(diff.getByTestId('history-diff-unchanged')).toHaveText('0');

      // The cell-level before/after — the half the Angular panel discarded.
      await expect(diff.getByTestId('history-diff-row')).toHaveCount(3);
      await expect(diff.getByTestId('history-diff-row').first()).toContainText('Alice Anderson');
      await expect(diff.getByTestId('history-diff-row').first()).toContainText('ALICE ANDERSON');
    });
  });

  test('diffs two snapshots where a row appeared: one added, three unchanged', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      const diff = await captureAndCompare(window, THREE_CUSTOMERS, FOUR_CUSTOMERS);

      await expect(diff.getByTestId('history-diff-added')).toHaveText('1');
      await expect(diff.getByTestId('history-diff-modified')).toHaveText('0');
      await expect(diff.getByTestId('history-diff-removed')).toHaveText('0');
      await expect(diff.getByTestId('history-diff-unchanged')).toHaveText('3');

      const added = diff.getByTestId('history-diff-row');
      await expect(added).toHaveCount(1);
      await expect(added.first()).toHaveAttribute('data-kind', 'added');
      await expect(added.first()).toContainText('Dave Diaz');
    });
  });

  test('the same rows in a different order are no difference at all', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      const diff = await captureAndCompare(window, THREE_CUSTOMERS, THREE_REVERSED);

      await expect(diff.getByTestId('history-diff-identical')).toBeVisible();
      await expect(diff.getByTestId('history-diff-unchanged')).toHaveText('3');
      await expect(diff.getByTestId('history-diff-row')).toHaveCount(0);
    });
  });

  test('replaces the tab’s result with a saved one, and says it is not live', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await run(window, THREE_CUSTOMERS);
      await openResultHistory(window);
      await captureResult(window, 1);

      // A second, different run — so the tab is showing four rows when the saved three are opened.
      await run(window, FOUR_CUSTOMERS);
      await expect(window.getByTestId('results-row-count')).toHaveText('4');

      await openResultHistory(window);
      await pinnedHistoryRows(window).first().getByTestId('history-view').click();

      await expect(window.getByTestId('query-results-historical')).toBeVisible({ timeout: 20_000 });
      await expect(window.getByTestId('results-row-count')).toHaveText('3');

      // Running again returns the pane to live results, and the notice goes with it.
      await run(window, FOUR_CUSTOMERS);
      await expect(window.getByTestId('query-results-historical')).toBeHidden();
      await expect(window.getByTestId('results-row-count')).toHaveText('4');
    });
  });

  test('the list is this tab’s, and counts what it holds', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await run(window, THREE_CUSTOMERS);
      await openResultHistory(window);
      await captureResult(window, 1);

      // Every row in the list is a snapshot of THIS tab: the panel asks for `{ tabId }` and nothing
      // else, so the count and the list agree.
      await expect(window.getByTestId('history-count')).toHaveText(
        String(await historyRows(window).count())
      );
    });
  });
});
