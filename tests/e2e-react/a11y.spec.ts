/**
 * The a11y sweep: **every element a Tab press can reach shows a focus indicator, and every docking
 * move a drag can make is also reachable from the keyboard.**
 *
 * PLAN.md Task 23. The inventory is taken by walking the real tab order in the shipped bundle —
 * `tests/helpers/react/a11y.ts` explains why a source scan is the weaker instrument. Each test
 * attaches its walk as a markdown table, so a run of this file IS the inventory: open the
 * attachment on any test to see every stop, its role, whether it matched `:focus-visible`, and what
 * it was drawn with.
 *
 * ── The three vendor surfaces ────────────────────────────────────────────────────────────────
 *
 * Dockview, AG Grid and Monaco each own DOM this app does not write. Dockview needed a rule of its
 * own (`shell/dockview-theme.css` styles `.dv-tab:focus-visible` — the vendor sheet has none) and
 * so passes the ordinary check. The other two draw their indicator somewhere `getComputedStyle` on
 * the FOCUSED element cannot see it — Monaco on an ancestor, AG Grid on the cell rather than the
 * focus sink — so each has an exemption that carries its own positive assertion. Both are asserted
 * non-vacuous below: an exemption that stopped matching anything would quietly excuse whatever grew
 * that shape next.
 *
 * Out of scope, per PLAN.md §8: a screen-reader audit beyond focus, contrast and keyboard.
 */

import {
  AG_GRID_EXEMPTION,
  COMMAND_OVERLAY_INPUT_EXEMPTION,
  MONACO_EXEMPTION,
  UI_TIMEOUT_MS,
  connectFromSidebar,
  connectionEditor,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  executeQuery,
  expandTreeRow,
  attachFocusTable,
  gridRows,
  openConnectionEditor,
  openChatPanel,
  openQueryTab,
  openPalette,
  openRelationships,
  openSettings,
  overlay,
  queryEditor,
  selectDatabase,
  settingsDialog,
  typeSql,
  welcomePanel,
  openWelcome,
  unindicatedStops,
  walkTabOrder,
  withJoineryReact,
  workspaceTabs,
  type FocusExemption,
} from '../helpers/joinery-actions-react';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

const PROFILE = 'A11y PG';
const DATABASE = 'joinery_test';

/**
 * The three surfaces whose focus indicator `getComputedStyle` on the focused element cannot see.
 * Each carries its own positive check; the last test in this file runs all three of them.
 */
const EXEMPTIONS: readonly FocusExemption[] = [
  MONACO_EXEMPTION,
  AG_GRID_EXEMPTION,
  COMMAND_OVERLAY_INPUT_EXEMPTION,
];

test.beforeAll(async () => {
  await ensureJoineryTestSeeded();
});

test.describe('focus is visible everywhere a Tab press can land', () => {
  test('the shell — sidebar, tab strip, splitters and status bar', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, DATABASE);
      await dismissToasts(window);

      const walk = await walkTabOrder(window);
      const { stops } = walk;
      await attachFocusTable('shell-tab-order.md', 'Connected shell', walk);

      // Non-vacuous: a walk that found three stops would pass the assertion below and mean nothing.
      // The connected shell has the sidebar's controls, the tab strip, two splitters and the status
      // bar in its order; 12 is comfortably under that and well over an accidental early exit.
      expect(
        stops.length,
        'the tab order walk found too few stops to be meaningful'
      ).toBeGreaterThan(12);

      const missing = unindicatedStops(stops, EXEMPTIONS);
      expect(
        missing.map(stop => stop.id),
        'these focus stops draw no visible indicator'
      ).toEqual([]);
    });
  });

  test('a modal dialog rings every stop and traps focus inside itself', async () => {
    await withJoineryReact(async ({ window }) => {
      await openConnectionEditor(window);

      const walk = await walkTabOrder(window, connectionEditor(window));
      const { stops, cycled } = walk;
      await attachFocusTable('connection-editor-tab-order.md', 'Connection editor dialog', walk);

      // A modal's order MUST cycle: Radix traps focus, so Tab from the last control returns to the
      // first. A walk that ran to the cap instead would mean focus escaped the dialog, which is the
      // failure a keyboard user experiences as "I fell out of the form into the app behind it".
      expect(cycled, 'focus escaped the connection editor rather than cycling inside it').toBe(
        true
      );
      expect(stops.length).toBeGreaterThan(5);

      const missing = unindicatedStops(stops, EXEMPTIONS);
      expect(missing.map(stop => stop.id)).toEqual([]);
    });
  });

  test('the settings dialog and the command palette', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await openSettings(app, window);
      const settings = await walkTabOrder(window, settingsDialog(window));
      await attachFocusTable('settings-tab-order.md', 'Settings dialog', settings);
      expect(settings.cycled, 'focus escaped the settings dialog').toBe(true);
      expect(unindicatedStops(settings.stops, EXEMPTIONS).map(stop => stop.id)).toEqual([]);

      await window.keyboard.press('Escape');
      await expect(settingsDialog(window)).toBeHidden({ timeout: UI_TIMEOUT_MS });

      await openPalette(window);
      const palette = await walkTabOrder(window, overlay(window, 'palette'));
      await attachFocusTable('palette-tab-order.md', 'Command palette', palette);
      // The palette is a search overlay: its rows are driven by arrow keys off the input (cmdk's
      // roving model), so the TAB order is short by design. What matters is that whatever it does
      // reach is visibly focused.
      expect(unindicatedStops(palette.stops, EXEMPTIONS).map(stop => stop.id)).toEqual([]);
    });
  });

  test('the query tab, where the two vendor surfaces live', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, DATABASE);
      await dismissToasts(window);

      // A result set, so the grid is mounted and its cells are in the document.
      await typeSql(window, 'SELECT id, email FROM customers ORDER BY id LIMIT 20');
      await executeQuery(window);
      await expect(gridRows(window).first()).toBeVisible({ timeout: UI_TIMEOUT_MS });

      // From the top of the shell rather than from the editor: the query panel's own controls sit
      // between the sidebar and the status bar in DOM order, so a walk that starts inside Monaco
      // sees two stops and proves nothing about the surface around it.
      const walk = await walkTabOrder(window, window.getByTestId('sidebar-tree'));
      const { stops } = walk;
      await attachFocusTable('query-tab-order.md', 'Query tab with results', walk);

      const missing = unindicatedStops(stops, EXEMPTIONS);
      expect(missing.map(stop => stop.id)).toEqual([]);
    });
  });

  test('the chat side panel', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, DATABASE);
      await dismissToasts(window);

      // The chat panel is a docked side panel rather than a modal, so its controls join the shell's
      // own tab order — which is why this walk starts at the top of the shell rather than inside it.
      await openChatPanel(window);
      const chat = await walkTabOrder(window, window.getByTestId('sidebar-tree'));
      await attachFocusTable('chat-tab-order.md', 'Shell with the chat panel open', chat);
      expect(unindicatedStops(chat.stops, EXEMPTIONS).map(stop => stop.id)).toEqual([]);
      // Non-vacuous: the panel's composer and conversation controls have to be IN the walk for it to
      // say anything about the chat surface at all.
      expect(chat.stops.some(stop => stop.id.startsWith('chat-'))).toBe(true);
    });
  });

  test('the ERD canvas', async () => {
    await withJoineryReact(async ({ window }) => {
      // The same walk down the tree `erd.spec.ts` uses: "Show relationships" is a table node's
      // context-menu item, so the Tables folder has to be open before it exists.
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, DATABASE);
      await expandTreeRow(window, PROFILE);
      await expandTreeRow(window, DATABASE);
      await expandTreeRow(window, 'public');
      await expandTreeRow(window, 'Tables');
      await openRelationships(window, 'order_items');
      await dismissToasts(window);

      const erd = await walkTabOrder(window, window.getByTestId('sidebar-tree'));
      await attachFocusTable('erd-tab-order.md', 'ERD tab', erd);
      expect(unindicatedStops(erd.stops, EXEMPTIONS).map(stop => stop.id)).toEqual([]);
      expect(erd.stops.some(stop => stop.id.startsWith('erd-'))).toBe(true);
    });
  });

  test('all three exemptions draw the indicator they claim for themselves', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, DATABASE);
      await dismissToasts(window);
      await typeSql(window, 'SELECT id, email FROM customers ORDER BY id LIMIT 20');
      await executeQuery(window);
      await expect(gridRows(window).first()).toBeVisible({ timeout: UI_TIMEOUT_MS });

      // Each exemption's positive half, driven directly rather than through a walk: an exemption
      // whose element a walk happened not to reach would otherwise go unchecked, and an exemption
      // nobody checks is a hole in the sweep rather than a documented one.
      await queryEditor(window).locator('.view-lines').click();
      await MONACO_EXEMPTION.verify(window);

      await gridRows(window).first().locator('.ag-cell').first().click();
      await AG_GRID_EXEMPTION.verify(window);

      await openPalette(window);
      await COMMAND_OVERLAY_INPUT_EXEMPTION.verify(window);
    });
  });
});

/**
 * The other half of the Task 23 plan line: docking, which was drag-only.
 *
 * Asserted through what a user SEES rather than through Dockview's group count: two panels visible
 * at once is what a split is, and exactly one visible is what a single group is (Dockview detaches
 * an inactive panel's DOM under the default renderer — PLAN.md R5 measurement 4). So no assertion
 * here names a vendor class except the one that cannot be avoided: `.dv-tab` is the element
 * Dockview focuses, and focusing it is the precondition for pressing a key at it at all.
 */
test.describe('docking is operable from the keyboard', () => {
  /**
   * Focuses the active tab header of the `index`-th group — the element Dockview gives the roving
   * `tabindex` to, and the only one a keystroke can reach.
   *
   * The `aria-keyshortcuts` assertion is not decoration: it is the one observable proof that
   * `panel-tab.tsx` found its `.dv-tab` ancestor and attached the listener. Without it a Dockview
   * upgrade that renamed the class would make every test below fail on a symptom four steps away.
   */
  async function focusActiveTab(window: Page, index = 0): Promise<void> {
    const tab = window.locator('.dv-tab.dv-active-tab').nth(index);
    await expect(tab).toBeVisible({ timeout: UI_TIMEOUT_MS });
    await tab.focus();
    await expect(tab).toHaveAttribute('aria-keyshortcuts', /⌥/, { timeout: UI_TIMEOUT_MS });
  }

  test('Option+Arrow splits a tab into a new group, and Option+Shift+Arrow merges it back', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, DATABASE);
      await dismissToasts(window);
      await openWelcome(window);
      await openQueryTab(window);

      // One group: only the active panel's DOM is in the document.
      await expect(welcomePanel(window)).toBeHidden({ timeout: UI_TIMEOUT_MS });

      // The query tab is the active one, so this splits it into a new group on the right and leaves
      // Welcome behind in the original.
      await focusActiveTab(window);
      await window.keyboard.press('Alt+ArrowRight');

      // Two groups, side by side — both panels are now mounted and visible at once.
      await expect(welcomePanel(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
      await expect(window.getByTestId('query-panel')).toBeVisible({ timeout: UI_TIMEOUT_MS });

      // Merge back the other way round: Welcome — the first group's only tab — moves INTO the second
      // group, which empties the first and leaves one group with both tabs in it. Welcome ends up
      // active there, so the query panel is the one that gets detached.
      await focusActiveTab(window);
      await window.keyboard.press('Alt+Shift+ArrowRight');

      await expect(window.getByTestId('query-panel')).toBeHidden({ timeout: UI_TIMEOUT_MS });
      await expect(welcomePanel(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
    });
  });

  test('a move it cannot make says so instead of doing nothing', async () => {
    await withJoineryReact(async ({ window }) => {
      // No connection: a launch with nothing connected shows the Welcome tab and only that, which is
      // exactly the one-tab-in-one-group state both refusals are about.
      await openWelcome(window);
      await expect(workspaceTabs(window)).toHaveCount(1);
      await dismissToasts(window);

      // A keyboard user's whole signal that the key was heard is the toast, so a refusal that said
      // nothing would be indistinguishable from a shortcut that does not exist.
      await focusActiveTab(window);
      await window.keyboard.press('Alt+ArrowRight');
      await expect(window.locator('[data-sonner-toast]')).toContainText(/only one in its group/, {
        timeout: UI_TIMEOUT_MS,
      });

      await dismissToasts(window);
      await focusActiveTab(window);
      await window.keyboard.press('Alt+Shift+ArrowRight');
      await expect(window.locator('[data-sonner-toast]')).toContainText(/no group on that side/, {
        timeout: UI_TIMEOUT_MS,
      });
    });
  });
});
