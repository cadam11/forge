/**
 * Visual baselines — the app frame.
 *
 * Two surfaces, and they are deliberately framed differently:
 *
 *  - **the welcome panel** is captured as an ELEMENT, because it is the one editorial surface in the
 *    app and what it has to get right is its own typography and rhythm, not its position in a dock;
 *  - **the connected shell** is captured as the WHOLE WINDOW, because there the frame IS the
 *    subject: titlebar clearance, the sidebar/dock/chat divider ownership, and the 28px status bar
 *    are three of the audit's §1.9 findings and all three are properties of the assembled frame
 *    rather than of any component in it.
 *
 * Both in both themes. The welcome hero was hardcoded light in Angular (the audit's finding: it
 * stayed cream while the app went dark), so a light-only baseline for it would have had nothing to
 * fail against.
 */

import type { Page } from '@playwright/test';

import {
  VISUAL_THEMES,
  blurFocus,
  expect,
  settleStatusBar,
  shoot,
  statusBarVolatile,
  test,
  withVisualApp,
} from './fixtures';
import {
  CONNECT_TIMEOUT_MS,
  connectFromSidebar,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  expandTreeRow,
  openQueryTab,
  openWelcome,
  selectDatabase,
  treeRow,
  typeSql,
  workspaceTabs,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Test PG';
const DATABASE = 'joinery_test';

test.beforeAll(ensureJoineryTestSeeded);

/**
 * Connect, walk the tree open, and leave a query tab holding a statement.
 *
 * Every value here is a constant — the profile name, the database, the SQL — because the point of a
 * populated-shell baseline is defeated if the strings in it move between runs.
 */
async function buildConnectedShell(window: Page): Promise<void> {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, DATABASE);
  await expandTreeRow(window, DATABASE);
  await expandTreeRow(window, 'public');
  await expandTreeRow(window, 'Tables');
  await expect(treeRow(window, 'products')).toBeVisible();

  await openQueryTab(window);
  await typeSql(window, 'SELECT id, sku, name, price_cents\nFROM products\nORDER BY id;');
}

for (const theme of VISUAL_THEMES) {
  test.describe(`Joinery (React) — shell baselines, ${theme}`, () => {
    test('welcome panel', async () => {
      await withVisualApp(theme, async ({ window }) => {
        const panel = await openWelcome(window);
        // Nothing has been done yet, so there is nothing to dismiss — asserted rather than assumed,
        // because a toast drifting through its fade is the classic single-run baseline.
        await expect(window.locator('[data-sonner-toast]')).toHaveCount(0);

        // The Docker card's note is a real IPC round trip that nothing else in this test waits on, so
        // it has to be waited for HERE — twice over. Unsettled, it reads "Checking Docker…" or
        // "Docker is not running", which (a) makes the mask below match nothing and (b) is a
        // different string of a different width, so the masked rectangle itself moves. Both are
        // ways this baseline can differ from itself, and one full-tier run hit exactly that.
        await expect(panel.getByTestId('welcome-action-docker')).toContainText(
          /Docker: \d+ of \d+ database containers running/,
          { timeout: CONNECT_TIMEOUT_MS }
        );

        await shoot(panel, `welcome-panel-${theme}.png`, {
          // "Docker: N of M database containers running" — the same live count the status-bar pip
          // reads, and a fact about the host rather than about this panel. Masked at the note, not
          // at the card, so the card's own frame and type are still compared.
          mask: [panel.getByText(/^Docker: \d+ of \d+/)],
        });
      });
    });

    test('connected shell with a populated sidebar and two tabs', async () => {
      await withVisualApp(theme, async ({ window }) => {
        await buildConnectedShell(window);
        // Welcome plus the query tab: the strip has to show more than one tab for its active/inactive
        // treatment to be in the picture at all.
        await expect(workspaceTabs(window)).toHaveCount(2);
        await dismissToasts(window);
        // The query editor still holds focus from `typeSql`, and a focused Monaco draws a caret that
        // `toHaveScreenshot`'s `caret: 'hide'` cannot reach. See `blurFocus`.
        await blurFocus(window);
        await settleStatusBar(window);

        await shoot(window, `shell-connected-${theme}.png`, { mask: statusBarVolatile(window) });
      });
    });
  });
}
