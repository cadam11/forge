/**
 * The persistent app chrome: the sidebar's connection menu, and the divider between the sidebar and
 * the workspace.
 *
 * **A gap port.** PLAN.md's Task 19a row named `shell.spec.ts` and only `welcome-screen.spec.ts` was
 * delivered, so the two behaviours the Angular tier's `tests/e2e/shell.spec.ts` covered had no React
 * equivalent: the connection button opening its menu, and the resize handle moving the sidebar.
 *
 * Both are widened here, and in each case because the React control is a different control:
 *
 *  - the Angular test asserted only that `.mat-mdc-menu-panel` appeared and said in a comment that it
 *    deliberately did not check the options ("those depend on saved connections"). This tier creates
 *    its own profile, so the options ARE knowable and are asserted.
 *  - the Angular handle was a 4px pointer-only target with `margin: 0 -2px`, no `role="separator"`
 *    and no focus style — audit §1.9. The React one implements the ARIA window-splitter pattern in
 *    full (`shell/resize-handle.tsx`), so the keyboard half is tested too. That closes the
 *    capability assertion Task 8 deferred, which is why this file rather than a query-pane spec is
 *    where it lands: the sidebar divider is the handle the audit finding was about.
 */

import { expect, test } from '@playwright/test';
import {
  createPostgresProfile,
  dragResizeHandle,
  openConnectionMenu,
  resizeHandle,
  resizeHandleValue,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Test PG';

// No `ensureJoineryTestSeeded`, deliberately: nothing in this file talks to a database. The profile
// the connection-menu test needs is SAVED, never connected — `createPostgresProfile` is editor plus
// keychain plus `AppState` — and the substrate and resize tests need no profile at all. That makes
// this the one spec in the tier that runs with the containers down, which is worth keeping true.

/**
 * The six localStorage keys the ANGULAR renderer owned (`renderer/src/app/**`, as of the Task 20
 * audit). A launch on a fresh profile must have none of them.
 *
 * Until the cutover this asserted a race: the launcher reached the React renderer by SUPERSEDING an
 * already-loading Angular document, and a redirect slow enough to lose that race would let Angular's
 * bootstrap write some of these — which React's one-shot legacy migration
 * (`persistence/migration.ts`) would then import as if a real user had left them.
 *
 * There is no second renderer and no redirect now, so what is left is the other half, and it is the
 * half that still has teeth: **nothing in the shipped renderer may create one of these names.** The
 * migration reads them, lifts them into `AppState` and REMOVES them, so a key appearing on a profile
 * that never ran Angular would mean something is writing a name it does not own — and the next boot
 * would migrate it over the user's real state.
 */
const ANGULAR_LOCAL_STORAGE_KEYS = [
  'joinery:welcomeDismissed',
  'joinery:completed-tours',
  'joinery-settings',
  'joinery-snippets',
  'joinery-ctrl-e-execute-confirmed',
  'joinery-flyway-placeholder-values',
] as const;

test.describe('Joinery — the launch substrate', () => {
  test('a launch creates none of the six legacy localStorage keys', async () => {
    await withJoineryReact(async ({ window }) => {
      const keys = await window.evaluate(() => Object.keys(window.localStorage));
      for (const key of ANGULAR_LOCAL_STORAGE_KEYS) {
        expect(keys, `a legacy localStorage key was created by this launch: ${key}`).not.toContain(
          key
        );
      }
      // Non-vacuous: the launch DOES write one key — the React-owned theme mirror the pre-mount
      // FOUC script reads (`persistence/theme-mirror.ts`). Without this, an evaluate that returned
      // an empty list for any reason would pass every assertion above.
      expect(keys).toContain('joinery:theme-preference');

      // And the workspace store is empty on a fresh profile, which is what the tab assertions in the
      // rest of this tier assume as their starting point.
      const persisted = await window.evaluate(async () => {
        const api = (window as unknown as { joinery: JoineryProbeApi }).joinery;
        return api.app.getTabs();
      });
      expect(persisted.tabs).toEqual([]);
      expect(persisted.activeTabId).toBeNull();
    });
  });
});

/** The `app` members these tests read. Narrowed rather than pulling in the whole bridge type. */
interface JoineryProbeApi {
  readonly app: {
    readonly getTabs: () => Promise<{ tabs: unknown[]; activeTabId: string | null }>;
    readonly getState: () => Promise<{ sidebarWidth?: number }>;
  };
}

test.describe('Joinery (React) — shell chrome', () => {
  test('the connection menu opens from the sidebar header and offers the connection actions', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);

      const menu = await openConnectionMenu(window);

      // The saved-but-not-connected profile, offered as a Connect entry — the branch
      // `connection-picker.tsx:98-113` takes when `connectedProfileIds` does not hold it.
      await expect(menu.getByTestId('sidebar-connection-connect')).toHaveText(
        `Connect: ${PROFILE}`
      );
      // And the three standing actions, which are what make this a menu rather than a picker.
      await expect(menu.getByTestId('sidebar-connection-new')).toBeVisible();
      await expect(menu.getByTestId('sidebar-connection-manage')).toBeVisible();

      // Nothing is connected, so the two connection-dependent entries are not offered as live ones.
      await expect(menu.getByTestId('sidebar-connection-focus')).toHaveCount(0);

      await window.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    });
  });

  test('the sidebar resize handle drags the sidebar wider', async () => {
    await withJoineryReact(async ({ window }) => {
      const handle = resizeHandle(window, 'sidebar');
      await expect(handle).toBeVisible();

      // The ARIA splitter contract, which is the part the Angular handle did not have at all.
      await expect(handle).toHaveAttribute('role', 'separator');
      await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
      await expect(handle).toHaveAttribute('aria-label', 'Sidebar width');

      const before = await resizeHandleValue(window, 'sidebar');
      expect(before).toBeGreaterThan(0);
      const paneBefore = (await window.getByTestId('sidebar').boundingBox())?.width ?? 0;
      expect(paneBefore).toBeGreaterThan(0);

      await dragResizeHandle(window, 'sidebar', 80);

      // Wider, not merely different: the handle sits on the sidebar's trailing edge with
      // `edge="leading"`, so its `direction` is +1 and a rightward drag can only grow the pane. The
      // delta may be smaller than 80 because the store clamps to SIDEBAR_MAX_WIDTH.
      expect(await resizeHandleValue(window, 'sidebar')).toBeGreaterThan(before);
      // And the pane really followed — `--sidebar-width` is what the drag ultimately drives. Compared
      // against the pane's OWN earlier measurement, not against the aria value, so this does not
      // assume the sidebar element and its width-carrying wrapper measure identically.
      await expect
        .poll(async () => (await window.getByTestId('sidebar').boundingBox())?.width ?? 0)
        .toBeGreaterThan(paneBefore);
    });
  });

  test('the sidebar resize handle is keyboard-operable, and the width survives a reload', async () => {
    await withJoineryReact(async ({ window }) => {
      const handle = resizeHandle(window, 'sidebar');
      await handle.focus();
      await expect(handle).toBeFocused();

      const start = await resizeHandleValue(window, 'sidebar');

      // One arrow press is one `step` (8px, `resize-handle.tsx:73`). This is the capability Task 8
      // deferred asserting: a user who cannot use a mouse can still size the pane.
      await window.keyboard.press('ArrowRight');
      await expect(handle).toHaveAttribute('aria-valuenow', String(start + 8));

      // Shift coarsens it, which is the pattern's own convention rather than an invention.
      await window.keyboard.press('Shift+ArrowLeft');
      const coarse = await resizeHandleValue(window, 'sidebar');
      expect(coarse).toBeLessThan(start + 8);

      // End goes to the far edge for a leading-edge handle, i.e. the maximum.
      await window.keyboard.press('End');
      const max = Number(await handle.getAttribute('aria-valuemax'));
      await expect(handle).toHaveAttribute('aria-valuenow', String(max));

      // The width is a top-level `AppState` field (`state/workbench.ts:15`), not a localStorage key, so
      // wiping localStorage and reloading is what proves which store it came back from.
      //
      // The wait before the reload is required and is an assertion in its own right: the geometry write
      // is DEBOUNCED by 250ms (`SAVE_DEBOUNCE_MS`), so a reload issued straight after the keystroke
      // destroys the page before the timer fires and the value never leaves the renderer. Measured —
      // this test failed at exactly that, reporting the default 280 back. Polling `AppState` for the new
      // value is therefore both the bounded wait and the proof that the write happened at all.
      await expect
        .poll(
          () =>
            window.evaluate(async () => {
              const api = (window as unknown as { joinery: JoineryProbeApi }).joinery;
              return (await api.app.getState()).sidebarWidth;
            }),
          { timeout: 10_000, message: 'the debounced geometry write never reached AppState' }
        )
        .toBe(max);

      await window.evaluate(() => window.localStorage.clear());
      await window.reload();
      await expect(window.getByTestId('app-shell')).toBeVisible({ timeout: 20_000 });
      await expect(resizeHandle(window, 'sidebar')).toHaveAttribute('aria-valuenow', String(max));
    });
  });
});
