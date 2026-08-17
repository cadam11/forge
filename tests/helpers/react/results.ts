/**
 * The results pane: the grid, the row-detail rail, and the result-history tab.
 *
 * AG Grid is a vendor surface, so its internals are located structurally —
 * `.ag-row`, `.ag-header-cell`, `[col-id]` — which is the exemption PLAN.md's
 * test-hook rule grants ("Vendor internals (`.monaco-editor`, `.ag-*`,
 * Dockview's classes) may be located structurally"). Everything Joinery owns
 * around the cells has a `results-*` testid, the rail has `rowdetail-*`, and the
 * history tab has `history-*`.
 *
 * Two AG Grid 36 facts these helpers exist to hold in one place, both probed
 * against the running app rather than read from the docs:
 *
 *  1. rows live in `.ag-grid-scrolling-container`, not the `.ag-center-cols-container`
 *     of the v32-era DOM the Angular suite knew, and one row element carries
 *     every cell including the pinned ones;
 *  2. rows are ABSOLUTELY POSITIONED AND RECYCLED, so DOM order is not visual
 *     order. `row-index` is the only honest ordering, which is why
 *     `gridColumnValues` sorts by it. A spec that read `.ag-row` in DOM order
 *     would conclude a visibly descending grid had not sorted.
 */

import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { UI_TIMEOUT_MS } from './app';

/** The grid host. Joinery's element, not AG Grid's. */
export function resultsGrid(window: Page): Locator {
  return window.getByTestId('results-grid');
}

/** Every rendered row. The grid virtualizes, so this is rows *in view*. */
export function gridRows(window: Page): Locator {
  return resultsGrid(window).locator('.ag-grid-scrolling-container .ag-row');
}

/** One rendered row, addressed by its DISPLAYED index (see fact 2 above). */
function gridRow(window: Page, displayedIndex: number): Locator {
  return resultsGrid(window).locator(
    `.ag-grid-scrolling-container .ag-row[row-index="${displayedIndex}"]`
  );
}

/** The data column headers, in order — without the ordinal gutter or the checkbox column. */
export async function gridColumnHeaders(window: Page): Promise<string[]> {
  return resultsGrid(window)
    .locator(
      '.ag-header-row-column .ag-header-cell:not([col-id="rowNumber"]):not([col-id="ag-Grid-SelectionColumn"]) .ag-header-cell-text'
    )
    .allTextContents();
}

/**
 * One column's rendered values, in DISPLAYED order (see fact 2 above).
 *
 * Returns what the cells show, which is the formatted value — `NULL` for an absent one, a grouped
 * integer for a number. The raw values are what the clipboard carries; that is asserted separately.
 */
export async function gridColumnValues(window: Page, colId: string): Promise<string[]> {
  const rows = await gridRows(window).evaluateAll((elements, column) => {
    return elements
      .map(element => ({
        index: Number(element.getAttribute('row-index')),
        value: element.querySelector(`.ag-cell[col-id="${column}"]`)?.textContent ?? '',
      }))
      .sort((a, b) => a.index - b.index)
      .map(entry => entry.value);
  }, colId);
  return rows;
}

/** Click a column header once: unsorted → ascending → descending, as AG Grid cycles it. */
export async function sortGridColumn(window: Page, colId: string): Promise<void> {
  await resultsGrid(window)
    .locator(`.ag-header-row-column .ag-header-cell[col-id="${colId}"] .ag-header-cell-label`)
    .click();
}

/** What the grid says about a column's sort, through the ARIA contract rather than a class. */
export function gridSortState(window: Page, colId: string): Locator {
  return resultsGrid(window).locator(`.ag-header-row-column .ag-header-cell[col-id="${colId}"]`);
}

/**
 * Tick a row's checkbox, addressed by its DISPLAYED index.
 *
 * The input inside the wrapper is the hit target; clicking the cell around it does nothing.
 */
export async function selectGridRow(window: Page, displayedIndex: number): Promise<void> {
  await gridRow(window, displayedIndex)
    .locator('.ag-cell[col-id="ag-Grid-SelectionColumn"] input')
    .click({ force: true });
}

/**
 * Press the toolbar's Copy button and return what landed on the system clipboard.
 *
 * Read through Electron's own `clipboard` module in the MAIN process rather than
 * `navigator.clipboard.readText()` in the page: the renderer's read requires a permission prompt
 * that a headless Electron never answers, while the main-process module is synchronous and needs no
 * permission. It is also the honest assertion — what is being checked is that the bytes reached the
 * *system* clipboard, which is where the user's next ⌘V reads from.
 */
export async function copyGridSelection(app: ElectronApplication, window: Page): Promise<string> {
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await window.getByTestId('results-copy').click();
  // The toast is the copy's own completion signal: the component only fires it once
  // `navigator.clipboard.writeText` has resolved.
  await expect(
    window.locator('[data-sonner-toast]').filter({ hasText: 'to clipboard' })
  ).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

/**
 * Opens the grid's export menu, and returns once its first item is on screen.
 *
 * The Angular twin located the trigger as `button:has(mat-icon:text-is("download"))` — an icon
 * ligature, one of the two locator kinds PLAN.md's test-hook rule names as the thing to delete.
 * `results-export` is the testid that replaced it. The three items are
 * `results-export-{csv,json,sql}`; the caller asserts on them, because *which* formats are offered
 * is the property under test rather than a detail of opening the menu.
 */
export async function openExportMenu(window: Page): Promise<void> {
  await window.getByTestId('results-export').click();
  await expect(window.getByTestId('results-export-csv')).toBeVisible({ timeout: UI_TIMEOUT_MS });
}

/** The row-detail rail, if it is open. */
export function rowDetailPanel(window: Page): Locator {
  return window.getByTestId('rowdetail-panel');
}

/**
 * Double-clicks a row, addressed by its DISPLAYED index, and waits for the rail.
 *
 * Double-click rather than click: a single click in this grid starts a text
 * selection or ticks a checkbox, so the rail deliberately does not claim it (see
 * `results-grid.tsx`'s `openRow`).
 */
export async function openRowDetail(window: Page, displayedIndex: number): Promise<Locator> {
  await gridRow(window, displayedIndex).locator('.ag-cell').first().dblclick();
  await expect(rowDetailPanel(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return rowDetailPanel(window);
}

/** One field of the inspected row, addressed by column name. */
export function rowDetailField(window: Page, column: string): Locator {
  return rowDetailPanel(window).locator(`[data-testid="rowdetail-field"][data-field="${column}"]`);
}

/** Every field's column name, in order. */
export async function rowDetailFields(window: Page): Promise<string[]> {
  const fields = await rowDetailPanel(window)
    .locator('[data-testid="rowdetail-field"]')
    .evaluateAll(elements => elements.map(element => element.getAttribute('data-field') ?? ''));
  return fields;
}

/**
 * Follows a foreign key: clicks the FK link on `column` and waits for the
 * referenced row's preview to have loaded (its own fields, not the spinner).
 */
export async function previewForeignKey(window: Page, column: string): Promise<Locator> {
  await rowDetailField(window, column).getByTestId('rowdetail-fk-link').click();
  const preview = rowDetailPanel(window).getByTestId('rowdetail-fk-preview');
  await expect(preview).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(preview.getByTestId('rowdetail-fk-target')).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return preview;
}

/** Switches the results pane to the History tab and waits for the panel. */
export async function openResultHistory(window: Page): Promise<Locator> {
  await window.getByTestId('query-results-tab-history').click();
  const panel = window.getByTestId('history-panel');
  await expect(panel).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return panel;
}

/** Every snapshot row in the history list. */
export function historyRows(window: Page): Locator {
  return window.getByTestId('history-row');
}

/** The pinned snapshots, which are the ones a spec captured itself. */
export function pinnedHistoryRows(window: Page): Locator {
  return historyRows(window).and(window.locator('[data-pinned="true"]'));
}

/**
 * Captures the result on screen as a pinned snapshot and waits for it to appear.
 *
 * Pinned is what makes it addressable: the main process auto-saves every execute
 * too (`query.ipc.ts:59-78`), so `[data-pinned="true"]` is how a spec names the
 * snapshots it created rather than the ones that appeared on their own.
 */
export async function captureResult(window: Page, expectedPinned: number): Promise<void> {
  await window.getByTestId('history-capture').click();
  await expect(pinnedHistoryRows(window)).toHaveCount(expectedPinned, { timeout: UI_TIMEOUT_MS });
}
