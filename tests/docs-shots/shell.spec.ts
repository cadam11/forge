/**
 * Documentation shots — the two hero images of the app frame.
 *
 * Framed differently on purpose, and for the same reasons the visual tier frames its equivalents
 * that way: the welcome panel is captured as an ELEMENT, because what it has to show a reader is its
 * own typography and its four actions rather than its position in a dock; the connected workspace is
 * captured as the WHOLE WINDOW, because the frame IS the subject — sidebar, dock, tab strip and
 * status bar are what a "this is Joinery" image has to contain.
 *
 * Both in both themes: these are the images the landing page, the README and the workspace tour show
 * at size, next to a theme toggle the reader can press.
 */

import type { Page } from '@playwright/test';

import { blurFocus, capture, expect, settleStatusBar, test, withDocsApp } from './fixtures';
import { HERO_THEMES } from './catalogue';
import {
  CONNECT_TIMEOUT_MS,
  connectFromSidebar,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  executeQuery,
  expandTreeRow,
  gridRows,
  openQueryTab,
  openWelcome,
  selectDatabase,
  treeRow,
  typeSql,
  workspaceTabs,
} from '../helpers/joinery-actions-react';

/**
 * The profile name every shot in this set uses.
 *
 * A deliberate choice rather than a test artefact: it is the string a reader sees in the sidebar of
 * the hero image, so it has to read like something a person would name a connection — and it has to
 * be a fixture name, never a real one (J-23).
 */
const PROFILE = 'Local Postgres';
const DATABASE = 'joinery_test';

/** A fixed statement. The picture is defeated if the SQL in it moves between captures. */
const SQL = 'SELECT id, sku, name, price_cents\nFROM products\nORDER BY id\nLIMIT 10;';

test.beforeAll(ensureJoineryTestSeeded);

async function buildWorkspace(window: Page): Promise<void> {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, DATABASE);
  await expandTreeRow(window, DATABASE);
  await expandTreeRow(window, 'public');
  await expandTreeRow(window, 'Tables');
  await expect(treeRow(window, 'products')).toBeVisible();

  await openQueryTab(window);
  await typeSql(window, SQL);
  // Run it. A hero image of the workspace with "No results yet" under the editor shows the frame
  // but not the thing the frame is for, and the grid is a third of the window.
  await executeQuery(window);
  await expect(gridRows(window)).toHaveCount(10);
}

for (const theme of HERO_THEMES) {
  test.describe(`docs shots — shell, ${theme}`, () => {
    test('welcome panel', async () => {
      await withDocsApp(theme, async ({ window }) => {
        const panel = await openWelcome(window);
        // Nothing has been done in this launch, so there is nothing to dismiss — asserted rather
        // than assumed, because a toast drifting through its fade would be baked into the image.
        await expect(window.locator('[data-sonner-toast]')).toHaveCount(0);

        // The Docker card's note is a real IPC round trip nothing else here waits on. Unsettled it
        // reads "Checking Docker…", which is a picture of a half-loaded panel. The COUNT it settles
        // to is host-derived and is the one thing in this set that will differ on another machine —
        // see `assertNoDockerPanel` in `fixtures.ts` for why it cannot be pinned from here.
        await expect(panel.getByTestId('welcome-action-docker')).toContainText(
          /Docker: \d+ of \d+ database containers running/,
          { timeout: CONNECT_TIMEOUT_MS }
        );

        await capture(panel, 'hero-welcome', theme, 'The welcome panel on first run');
      });
    });

    test('connected workspace', async () => {
      await withDocsApp(theme, async ({ window }) => {
        await buildWorkspace(window);
        // Welcome plus the query tab: the strip has to show more than one tab for its active and
        // inactive treatments to both be in the picture.
        await expect(workspaceTabs(window)).toHaveCount(2);
        await dismissToasts(window);
        // Monaco still holds focus from `typeSql`, and a focused Monaco draws its own caret that
        // Playwright's `caret: 'hide'` cannot reach.
        await blurFocus(window);
        await settleStatusBar(window);

        await capture(
          window,
          'hero-workspace',
          theme,
          'The whole window, connected: explorer, query editor and results in one frame'
        );
      });
    });
  });
}
