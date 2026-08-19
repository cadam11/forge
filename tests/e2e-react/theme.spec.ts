/**
 * The three-state theme control, and the one attribute the whole stylesheet keys off.
 *
 * Replaces `tests/e2e/theme.spec.ts`, which drove a `mat-select` with a substring filter over
 * `mat-option` because "mat-option's textContent includes the icon ligature name" — two of the locator
 * classes PLAN.md's Task 20 exists to delete. It asserted the right thing, though, and that assertion is
 * kept and extended: `[data-theme]` on `<html>`, for all three states rather than two.
 *
 * What is new:
 *
 *  - **`system` is asserted as a resolution, not as a literal.** The store never writes `system` to the
 *    DOM: `prefers-color-scheme` is not reliable inside Electron, so `system` resolves through
 *    `nativeTheme` over IPC (`state/settings.ts`). A test that expected `data-theme="system"` would be
 *    asserting the bug.
 *  - **Persistence is proved through `AppState`, with localStorage wiped.** Task 5 moved the settings
 *    object out of `localStorage['joinery-settings']`; the only key React writes there is the theme
 *    mirror the pre-mount FOUC script reads. Clearing localStorage before the reload is what makes the
 *    surviving preference evidence of the `AppState` round trip rather than of the mirror.
 *  - **The two theme controls agree.** The status bar's menu and the panel's radios write the same store
 *    action, so a change in one must be visible in the other. They were two independent surfaces in
 *    Angular, and the panel's select did not track the status-bar toggle at all.
 */

import { expect, test } from '@playwright/test';
import {
  closeSettings,
  openSettings,
  openSettingsGroup,
  resolvedTheme,
  setTheme,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

test.describe('Joinery — the theme control', () => {
  test('writes the resolved theme to <html> for each of the three states', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await openSettings(app, window);
      await openSettingsGroup(window, 'appearance');

      await setTheme(window, 'light');
      expect(await resolvedTheme(window)).toBe('light');

      await setTheme(window, 'dark');
      expect(await resolvedTheme(window)).toBe('dark');

      // `system` resolves through Electron's `nativeTheme`, so the value depends on the host — what is
      // asserted is that it is a RESOLVED one, and the panel says which.
      const resolved = await setTheme(window, 'system');
      expect(['dark', 'light']).toContain(resolved);
      await expect(window.getByTestId('settings-theme-resolved')).toContainText(
        resolved === 'dark' ? 'currently ink' : 'currently ivory'
      );
    });
  });

  test('paints the theme it was left in after a restart, with localStorage wiped', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await openSettings(app, window);
      await openSettingsGroup(window, 'appearance');
      await setTheme(window, 'light');
      await closeSettings(window);

      // The theme mirror is the one localStorage key React writes, and it exists only so the pre-mount
      // script can paint before the bundle loads. Wiping it leaves `AppState` as the only possible
      // source of the preference below.
      await window.evaluate(() => window.localStorage.clear());
      await window.reload();
      await expect(window.getByTestId('app-shell')).toBeVisible({ timeout: 20_000 });

      await expect(window.locator('html')).toHaveAttribute('data-theme', 'light', {
        timeout: 20_000,
      });
      // And the panel agrees about which state it is in, rather than merely the canvas being right.
      await openSettings(app, window);
      await openSettingsGroup(window, 'appearance');
      await expect(window.getByTestId('settings-theme-light')).toBeChecked();
    });
  });

  test('the status bar and the panel are the same control', async () => {
    await withJoineryReact(async ({ app, window }) => {
      // Through the status bar's menu…
      await window.getByTestId('status-theme-trigger').click();
      await window.getByTestId('status-theme-light').click();
      await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');

      // …and the panel shows that state, because both write the one store.
      await openSettings(app, window);
      await openSettingsGroup(window, 'appearance');
      await expect(window.getByTestId('settings-theme-light')).toBeChecked();

      // Back the other way.
      await setTheme(window, 'dark');
      await closeSettings(window);
      await expect(window.getByTestId('status-theme-trigger')).toHaveAttribute(
        'aria-label',
        'Theme: Ink'
      );
    });
  });

  test('there is exactly one writer of [data-theme]', async () => {
    await withJoineryReact(async ({ app, window }) => {
      // Records every mutation of the attribute while the theme is changed twice. Two changes, two
      // writes: a second writer — a component effect re-applying it, a stylesheet-driven class — shows
      // up here as extra mutations, which is the failure this test exists to catch. The store's own
      // `commit` writes synchronously inside the action, so there is no coalescing to hide behind.
      await window.evaluate(() => {
        const record: string[] = [];
        (window as unknown as { __themeWrites: string[] }).__themeWrites = record;
        new MutationObserver(() => {
          record.push(document.documentElement.getAttribute('data-theme') ?? 'absent');
        }).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-theme'],
        });
      });

      await openSettings(app, window);
      await openSettingsGroup(window, 'appearance');
      await setTheme(window, 'light');
      await setTheme(window, 'dark');

      const writes = await window.evaluate(
        () => (window as unknown as { __themeWrites: string[] }).__themeWrites
      );
      expect(writes).toEqual(['light', 'dark']);
    });
  });
});
