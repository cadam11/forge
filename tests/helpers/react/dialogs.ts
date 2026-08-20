/**
 * The four modal dialogs that are not wizards: settings, query history, schema comparison, AI setup.
 *
 * ── Settings ─────────────────────────────────────────────────────────────────
 *
 * One prefix, `settings-*`, and one entry point: the panel is opened by the
 * `menu:open-settings` channel, which is what ⌘, sends. There is no button for
 * it in the app chrome, so `sendMenuCommand` is not a shortcut around the UI
 * here — it IS the UI.
 *
 * Every control is located by testid and every value is read back through the
 * consumer rather than through the control, because that is the whole point of
 * this surface's tests (J-44): a toggle that flips and changes nothing is the
 * defect, so asserting the toggle flipped proves nothing.
 */

import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { UI_TIMEOUT_MS, sendMenuCommand } from './app';
import { openNodeMenu } from './explorer';
import { openPalette, runPaletteCommand } from './overlays';

/**
 * The five groups, which are Radix tabs — an inactive one is not in the DOM.
 *
 * Four hold preferences; `ai` holds a door to the AI setup dialog and no preference at all (J-92).
 */
export type SettingsGroup = 'appearance' | 'editor' | 'query' | 'grid' | 'ai';

/** The panel, if it is open. */
export function settingsDialog(window: Page): Locator {
  return window.getByTestId('settings-dialog');
}

/** Opens the panel the way ⌘, does, and waits for it. */
export async function openSettings(app: ElectronApplication, window: Page): Promise<Locator> {
  await sendMenuCommand(app, 'menu:open-settings');
  const dialog = settingsDialog(window);
  await expect(dialog).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return dialog;
}

/** Switches to one of the four groups and waits for its controls to be in the DOM. */
export async function openSettingsGroup(window: Page, group: SettingsGroup): Promise<Locator> {
  await window.getByTestId(`settings-tab-${group}`).click();
  const groupElement = window.getByTestId(`settings-group-${group}`);
  await expect(groupElement).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return groupElement;
}

/** Closes the panel with Escape, which is Radix's own dismissal. */
export async function closeSettings(window: Page): Promise<void> {
  await window.keyboard.press('Escape');
  await expect(settingsDialog(window)).toBeHidden({ timeout: UI_TIMEOUT_MS });
}

/**
 * Picks one of the three theme states in the panel and waits for the DOM to have adopted it.
 *
 * The wait is on `[data-theme]`, not on the radio: the settings store is the single writer of that
 * attribute, and the resolved value is the only observable proof the change landed. `system` resolves
 * through Electron's `nativeTheme`, so this returns the resolved value rather than asserting one.
 */
export async function setTheme(
  window: Page,
  preference: 'system' | 'light' | 'dark'
): Promise<string> {
  await window.getByTestId(`settings-theme-${preference}`).check();
  if (preference !== 'system') {
    await expect(window.locator('html')).toHaveAttribute('data-theme', preference, {
      timeout: UI_TIMEOUT_MS,
    });
    return preference;
  }
  // Whatever the OS says. Never the literal `system` — see `state/settings.ts`.
  await expect(window.locator('html')).toHaveAttribute('data-theme', /^(dark|light)$/, {
    timeout: UI_TIMEOUT_MS,
  });
  return (await window.locator('html').getAttribute('data-theme')) ?? '';
}

/** What the store has actually written to `<html>`. */
export async function resolvedTheme(window: Page): Promise<string | null> {
  return window.locator('html').getAttribute('data-theme');
}

/**
 * Sets a numeric setting and commits it with Enter.
 *
 * `NumberSetting` holds a draft and commits on blur or Enter rather than on every keystroke — a field
 * that committed per character would resize every open editor while the user was still typing, and
 * would clamp their next keystroke against a value they never chose. So `fill` alone changes nothing,
 * and pressing Enter is part of the interaction rather than a workaround for it.
 */
export async function setNumberSetting(window: Page, testId: string, value: number): Promise<void> {
  const field = window.getByTestId(testId);
  await field.fill(String(value));
  await field.press('Enter');
  await expect(field).toHaveValue(String(value), { timeout: UI_TIMEOUT_MS });
}

/** Sets a switch to an explicit state. Idempotent, so a spec can state what it wants. */
export async function setToggleSetting(
  window: Page,
  testId: string,
  checked: boolean
): Promise<void> {
  const toggle = window.getByTestId(testId);
  if (checked) await toggle.check();
  else await toggle.uncheck();
}

/** The query-history dialog. */
export function queryHistoryDialog(window: Page): Locator {
  return window.getByTestId('query-history-dialog');
}

/**
 * Opens the history through the NATIVE MENU channel, which is how ⇧⌘H reaches it.
 *
 * `sendMenuCommand`, not a keystroke: Electron's menu accelerators are not
 * reachable from CDP-injected keys, so the channel is the only honest route —
 * the same choice `query-editor.spec.ts` makes for Execute Selection.
 */
export async function openQueryHistory(app: ElectronApplication, window: Page): Promise<Locator> {
  await sendMenuCommand(app, 'menu:query-history');
  await expect(queryHistoryDialog(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return queryHistoryDialog(window);
}

/** Every row currently listed in the history. */
export function historyEntryRows(window: Page): Locator {
  return queryHistoryDialog(window).getByTestId('query-history-row');
}

/**
 * The history row whose statement CONTAINS `sql`.
 *
 * Substring, deliberately, unlike the tree and picker locators: a history row shows the statement
 * elided, so its text is a prefix of what was run and an exact match could never hit.
 */
export function historyEntryRow(window: Page, sql: string): Locator {
  return historyEntryRows(window).filter({ hasText: sql });
}

/**
 * Narrows the history, and waits for the debounced round trip to land.
 *
 * **Precondition: `term` must change how many entries match** — the wait below is the count line
 * (`{n} queries`, `query-history-dialog.tsx:161`) reporting a different number than it did before the
 * fill, and that line is derived from the main process's ANSWER. That makes it the search's own
 * completion signal, where the `waitForTimeout(400)` it replaces was a guess at 200ms of debounce
 * plus an IPC round trip on an unknown machine. A term that matches the same set would make this
 * fail on its timeout rather than silently proceed against a stale list, which is the right failure.
 */
export async function searchQueryHistory(window: Page, term: string): Promise<void> {
  const dialog = queryHistoryDialog(window);
  const count = dialog.getByTestId('query-history-count');
  await expect(count).toBeVisible({ timeout: UI_TIMEOUT_MS });
  const before = (await count.textContent()) ?? '';

  await dialog.getByTestId('query-history-search').fill(term);
  await expect(
    count,
    `searching for ${JSON.stringify(term)} did not change the match count`
  ).not.toHaveText(before, { timeout: UI_TIMEOUT_MS });
}

/** The schema-comparison dialog. */
export function schemaDiffDialog(window: Page): Locator {
  return window.getByTestId('schema-diff-dialog');
}

/** Open it through the palette — its only entry point in the Angular renderer, and still one here. */
export async function openSchemaDiff(window: Page): Promise<Locator> {
  await openPalette(window);
  await runPaletteCommand(window, 'command:open-schema-diff');
  await expect(schemaDiffDialog(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return schemaDiffDialog(window);
}

/** Open it from a database node, which is Task 19b's new contextual entry point. */
export async function openSchemaDiffFromNode(window: Page, databaseName: string): Promise<Locator> {
  const menu = await openNodeMenu(window, databaseName);
  await menu.getByTestId('sidebar-menu-compare-schemas').click();
  await expect(schemaDiffDialog(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return schemaDiffDialog(window);
}

/** Pick one side of the comparison. The two selects are Radix, so the option is a listbox row. */
export async function selectDiffDatabase(
  window: Page,
  side: 'source' | 'target',
  databaseName: string
): Promise<void> {
  await window.getByTestId(`schema-diff-${side}`).click();
  await window.getByRole('option', { name: databaseName, exact: true }).click();
}

/** The AI setup dialog. */
export function aiSetupDialog(window: Page): Locator {
  return window.getByTestId('ai-setup-dialog');
}

/** Opens the AI setup dialog through the palette, which is one of its three producers. */
export async function openAiSetup(window: Page): Promise<Locator> {
  await openPalette(window);
  await runPaletteCommand(window, 'command:open-ai-setup');
  await expect(aiSetupDialog(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return aiSetupDialog(window);
}
