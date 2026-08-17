/**
 * The React welcome tab.
 *
 * Replaces `tests/e2e/welcome-screen.spec.ts`, which asserted two things — that `app-root` appeared and
 * that a `[data-testid="welcome-new-connection"]` button existed and opened a `mat-dialog-container`.
 * Both survive here (the testid is the helper contract; the dialog is Task 9's editor), and three more
 * are added, because the audit's finding about this surface was not that it was missing anything:
 *
 *  1. **both themes**, which is the finding. The Angular hero declared its own ivory canvas in a
 *     `--concept-*` block of literal hexes, so under the ink theme it stayed cream inside a dark app.
 *     The assertion is that the panel's own background follows `[data-theme]` in both directions — a
 *     hardcoded surface would report the same colour twice.
 *  2. **the AI entry**, which is what makes the chat panel configurable at all (J-55).
 *  3. **the tour entry is honest**: `start-tour` has an owner named (Task 19b) and no handler, and the
 *     button says so rather than dispatching into silence.
 */

import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import {
  aiSetupDialog,
  closeSettings,
  connectionEditor,
  openSettings,
  openWelcome,
  setTheme,
  welcomePanel,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

/** The welcome panel's own resolved background. A hardcoded surface answers the same in both themes. */
async function panelBackground(window: Page): Promise<string> {
  return welcomePanel(window).evaluate(node => getComputedStyle(node).backgroundColor);
}

test.describe('Joinery (React) — welcome tab', () => {
  test('launches showing the welcome tab, and its CTA opens the connection editor', async () => {
    await withJoineryReact(async ({ window }) => {
      const title = await window.title();
      expect(title.toLowerCase()).toContain('joinery');

      const panel = await openWelcome(window);
      // The editorial content, not just the container: a panel that rendered its shell and none of its
      // sections would otherwise pass.
      await expect(panel).toContainText('Your database, fitted to the way you work.');
      await expect(panel.getByTestId('welcome-diagram')).toBeVisible();

      // THE contract testid, inherited from the Angular surface and depended on by
      // `tests/helpers/joinery-actions-react.ts`.
      const cta = window.getByTestId('welcome-new-connection');
      await expect(cta).toBeVisible();
      await cta.click();

      await expect(connectionEditor(window)).toBeVisible({ timeout: 10_000 });
    });
  });

  test('paints from tokens, so both themes are reachable on this surface', async () => {
    // `test.info()` rather than the `({}, testInfo)` parameter shape: Playwright reads the destructuring
    // pattern to decide which fixtures a test wants, and the empty pattern that shape needs is what
    // `no-empty-pattern` rejects. The two are the same object.
    const testInfo = test.info();

    await withJoineryReact(async ({ app, window }) => {
      await openWelcome(window);

      await openSettings(app, window);
      await setTheme(window, 'dark');
      await closeSettings(window);
      await expect(welcomePanel(window)).toBeVisible();
      const ink = await panelBackground(window);
      await testInfo.attach('welcome-ink.png', {
        body: await welcomePanel(window).screenshot(),
        contentType: 'image/png',
      });

      await openSettings(app, window);
      await setTheme(window, 'light');
      await closeSettings(window);
      const ivory = await panelBackground(window);
      await testInfo.attach('welcome-ivory.png', {
        body: await welcomePanel(window).screenshot(),
        contentType: 'image/png',
      });

      // The whole point of the rewrite of this surface: the Angular hero answered the same colour in
      // both themes, because its canvas was a literal hex rather than `bg-canvas`.
      expect(ink).not.toBe(ivory);
      // And both are real colours rather than a transparent panel borrowing the shell's.
      expect(ink).not.toContain('rgba(0, 0, 0, 0)');
      expect(ivory).not.toContain('rgba(0, 0, 0, 0)');
    });
  });

  test('offers the AI setup entry, which opens the dialog that closes J-55', async () => {
    await withJoineryReact(async ({ window }) => {
      await openWelcome(window);

      // No provider is configured in a fresh profile, so this is the offer rather than the active state.
      await expect(window.getByTestId('welcome-ai-setup')).toBeVisible();
      await window.getByTestId('welcome-ai-setup-open').click();

      await expect(aiSetupDialog(window)).toBeVisible({ timeout: 10_000 });
      // The vendor list comes from `ai-vendors.json` through the bridge, not from a hardcoded four.
      await expect(aiSetupDialog(window).getByTestId('ai-setup-vendor')).toBeVisible();
      await aiSetupDialog(window).getByTestId('ai-setup-done').click();
      await expect(aiSetupDialog(window)).toBeHidden();
    });
  });

  test('says the tour is not in this build rather than doing nothing', async () => {
    await withJoineryReact(async ({ window }) => {
      await openWelcome(window);

      await window.getByTestId('welcome-start-tour').click();
      // `start-tour` is registered with Task 19b named as its owner. The button is present — hiding it
      // is the "silently omits half its entries" failure the palette refuses — and it reports the truth.
      await expect(
        window.getByText('The guided tour is not in this build yet — Task 19b.')
      ).toBeVisible({ timeout: 10_000 });
    });
  });
});
