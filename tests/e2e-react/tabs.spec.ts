/**
 * The workspace tab strip: opening tabs, activating them, closing them, and the four Window/File
 * menu channels that do those things without a pointer.
 *
 * **A gap port.** PLAN.md's Task 19a row named `tabs.spec.ts` and only `welcome-screen.spec.ts` was
 * delivered, so the three behaviours the Angular tier's `tests/e2e/tabs.spec.ts` covered — multiple
 * query tabs alongside Welcome, clicking one to activate it, closing one — had no React equivalent.
 * Neither did `query-editor.spec.ts` › `opens a new query tab via menu:new-query`, whose channel is
 * this file's entry point throughout.
 *
 * Two things are simpler here than in the Angular original, and both are the renderer being better:
 *
 *  - the Angular spec had a local `openAdditionalQueryTab` that typed a comment into the previous
 *    editor before opening the next one, because `openQueryTab` deduped against an empty tab and
 *    `menu:new-query` twice in a row produced one tab. React's `new-query` passes `reuseEmpty=false`
 *    (`shell-commands.tsx:111`) — "the user pressed ⌘N to get a new one" — so nothing has to be
 *    dirtied to get a second tab, and this file asserts that directly.
 *  - the Angular spec located tabs as `.lm_tab` filtered by `hasText` and read `.lm_active` for the
 *    active one. Here the tabs themselves are Joinery's own `workspace-tab-*` testids, matched on the
 *    exact title; only the ACTIVE marker is still a vendor class (`.dv-active-tab`, the Dockview
 *    exemption). THIS file reaches it only through `helpers/react/workbench.ts`'s `activeTabTitle`,
 *    which is where the exemption's rationale lives — but the exemption is not confined to that
 *    module tier-wide: `query-editor.spec.ts:144-152` counts and clicks `.dv-tab` directly, which
 *    predates Task 20 and is left alone rather than being churned into a helper it has one caller for.
 *
 * Also covered, having had no e2e coverage in either tier: `menu:close-tab`, `menu:next-tab` and
 * `menu:previous-tab` — three of the 31 channels `shell/menu-bridge.tsx` routes.
 */

import { expect, test, type Page } from '@playwright/test';
import {
  activeTabTitle,
  connectFromSidebar,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  newQueryTabFromMenu,
  selectDatabase,
  sendMenuCommand,
  withJoineryReact,
  workspaceTab,
  workspaceTabTitles,
  workspaceTabs,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Test PG';

test.beforeAll(ensureJoineryTestSeeded);

/** A connection and a database, which is what `new-query` needs before it will open anything. */
async function connected(window: Page): Promise<void> {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, 'joinery_test');
  await dismissToasts(window);
}

test.describe('Joinery (React) — the workspace tab strip', () => {
  test('opens a query tab per ⌘N, alongside the welcome tab', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await connected(window);

      // Connecting opens a query tab of its own (`sidebar.tsx`'s `openQueryForConnection`), so the
      // strip already holds Welcome plus one. Whatever it holds, three ⌘N presses must add three.
      const before = await workspaceTabTitles(window);
      expect(before).toContain('Welcome');

      await newQueryTabFromMenu(app, window);
      await newQueryTabFromMenu(app, window);
      await newQueryTabFromMenu(app, window);

      // Each press produced its own tab — nothing was reused, which is the `reuseEmpty=false` contract
      // and the reason this port needs no editor-dirtying dance.
      await expect(workspaceTabs(window)).toHaveCount(before.length + 3);

      const after = await workspaceTabTitles(window);
      expect(after).toContain('Welcome');
      // `generateQueryTitle` numbers them from the query-tab count (`state/tab.ts:74`), so the three
      // new ones are consecutively numbered and each title appears once.
      const queries = after.filter(title => /^Query \d+$/.test(title));
      expect(queries.length).toBeGreaterThanOrEqual(3);
      expect(new Set(queries).size).toBe(queries.length);

      // The last one opened is the one in front.
      expect(await activeTabTitle(window)).toBe(queries[queries.length - 1]);
    });
  });

  test('clicking a tab activates it, and the menu next/previous walk the strip', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await connected(window);
      await newQueryTabFromMenu(app, window);
      await newQueryTabFromMenu(app, window);

      const titles = (await workspaceTabTitles(window)).filter(title => /^Query \d+$/.test(title));
      const [first] = titles;
      const last = titles[titles.length - 1];
      if (first === undefined || last === undefined) throw new Error('expected two query tabs');
      expect(first).not.toBe(last);
      expect(await activeTabTitle(window)).toBe(last);

      // A click on an earlier tab brings it forward.
      await workspaceTab(window, first).click();
      await expect.poll(() => activeTabTitle(window)).toBe(first);

      // Window ▸ Next Tab, which no test in either tier had driven. It walks the strip in order, so
      // from the first query tab it lands on the next title along.
      await sendMenuCommand(app, 'menu:next-tab');
      await expect.poll(() => activeTabTitle(window)).not.toBe(first);

      // …and Previous Tab comes back, which is the pair being real rather than one being aliased.
      await sendMenuCommand(app, 'menu:previous-tab');
      await expect.poll(() => activeTabTitle(window)).toBe(first);
    });
  });

  test('closing a tab removes it, by its own button and by File ▸ Close Tab', async () => {
    await withJoineryReact(async ({ app, window }) => {
      await connected(window);
      await newQueryTabFromMenu(app, window);
      await newQueryTabFromMenu(app, window);

      const titles = (await workspaceTabTitles(window)).filter(title => /^Query \d+$/.test(title));
      const doomed = titles[titles.length - 1];
      const survivor = titles[0];
      if (doomed === undefined || survivor === undefined)
        throw new Error('expected two query tabs');

      // The tab's own ✕. `Close ${title}` is the accessible name `panel-tab.tsx` gives it, which is
      // what a screen-reader user hears and therefore the right handle.
      await window.getByLabel(`Close ${doomed}`).click();
      await expect(workspaceTab(window, doomed)).toHaveCount(0, { timeout: 10_000 });
      await expect(workspaceTab(window, survivor)).toBeVisible();
      // Welcome is not special-cased by the close path, but it is also not collateral.
      await expect(workspaceTab(window, 'Welcome')).toBeVisible();

      // And File ▸ Close Tab, which closes whatever is ACTIVE (`shell-commands.tsx:128`) — the second
      // of the three tab channels with no previous coverage.
      const active = await activeTabTitle(window);
      expect(active).not.toBe('');
      await sendMenuCommand(app, 'menu:close-tab');
      await expect(workspaceTab(window, active)).toHaveCount(0, { timeout: 10_000 });
    });
  });
});
