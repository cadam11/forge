/**
 * The workbench chrome: the welcome tab, the Dockview tab strip, and the shell's resize handles.
 *
 * ── The one Dockview exemption in this module ─────────────────────────────────
 *
 * Which tab is ACTIVE is Dockview's state, not Joinery's: `tabStore.activeTabId` follows the dock
 * rather than driving it (`shell/workspace/dockview-sync.ts`), and `panel-tab.tsx` renders the same
 * markup either way. So `activeTabTitle` reads `.dv-active-tab`, which is the exemption PLAN.md's
 * test-hook rule grants for "Dockview's classes". Every other locator here is a Joinery testid:
 * `workspace-tab-*` for the strip, `sidebar-resize-handle` / `chat-resize-handle` for the dividers.
 */

import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { UI_TIMEOUT_MS, exactly, sendMenuCommand } from './app';
import { openPalette, runPaletteCommand } from './overlays';

/** The welcome tab. Present from launch unless the user dismissed it. */
export function welcomePanel(window: Page): Locator {
  return window.getByTestId('panel-welcome');
}

/**
 * Shows the welcome tab and waits for it, whether or not it is already open.
 *
 * Through the palette rather than by clicking a tab: the tab may have been closed
 * in this session, and `show-welcome` is the command that re-opens it either way.
 */
export async function openWelcome(window: Page): Promise<Locator> {
  if ((await welcomePanel(window).count()) === 0) {
    await openPalette(window);
    await runPaletteCommand(window, 'command:show-welcome');
  }
  await expect(welcomePanel(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return welcomePanel(window);
}

/**
 * Every tab in the workspace strip.
 *
 * `[data-tab-type]` is what separates the tab container from the three `workspace-tab-*` testids
 * nested inside it (title, dirty marker, close button) — those share the prefix because they share
 * the tab's generated id, which no spec can know.
 */
export function workspaceTabs(window: Page): Locator {
  return window.locator('[data-testid^="workspace-tab-"][data-tab-type]');
}

/** One tab, by the exact title on it. */
export function workspaceTab(window: Page, title: string): Locator {
  return workspaceTabs(window).filter({
    has: window
      .locator('[data-testid^="workspace-tab-title-"]')
      .filter({ hasText: exactly(title) }),
  });
}

/** Every tab title, in strip order. Read from the `title` attribute, which is never truncated. */
export async function workspaceTabTitles(window: Page): Promise<string[]> {
  return window
    .locator('[data-testid^="workspace-tab-title-"]')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('title') ?? ''));
}

/** The title of the active tab. Empty when the workspace has none. */
export async function activeTabTitle(window: Page): Promise<string> {
  const title = window.locator('.dv-active-tab [data-testid^="workspace-tab-title-"]');
  if ((await title.count()) === 0) return '';
  return (await title.first().getAttribute('title')) ?? '';
}

/**
 * Opens a query tab through File ▸ New Query, and waits for the strip to have grown.
 *
 * The channel rather than the sidebar button, because the two are different code paths: the sidebar's
 * New Query refuses a second tab for a connection that already has one, while `new-query` passes
 * `reuseEmpty=false` (`shell-commands.tsx:111`) and always produces a fresh tab. This is the path the
 * Angular tier's `query-editor.spec.ts` and `tabs.spec.ts` drove.
 */
export async function newQueryTabFromMenu(app: ElectronApplication, window: Page): Promise<void> {
  const before = await workspaceTabs(window).count();
  await sendMenuCommand(app, 'menu:new-query');
  await expect(workspaceTabs(window)).toHaveCount(before + 1, { timeout: UI_TIMEOUT_MS });
}

/**
 * Closes a workspace tab by the title on it.
 *
 * By `aria-label`, not by testid: the close button's testid carries the tab's generated id, which no
 * spec can know. The label is `Close ${tab.title}` (`shell/workspace/panel-tab.tsx`).
 */
export async function closeTabTitled(window: Page, title: string): Promise<void> {
  const close = window.getByLabel(`Close ${title}`);
  await expect(close).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await close.click();
  await expect(close).toBeHidden({ timeout: UI_TIMEOUT_MS });
}

/**
 * One of the shell's two dividers.
 *
 * A `role="separator"` with `aria-valuenow`/`min`/`max` and `tabIndex=0`, which is the ARIA window
 * splitter pattern in full (`shell/resize-handle.tsx`) — the audit §1.9 finding that the Angular
 * handle was a 4px pointer-only target with no focus style is what it exists to fix.
 */
export function resizeHandle(window: Page, which: 'sidebar' | 'chat'): Locator {
  return window.getByTestId(`${which}-resize-handle`);
}

/** What the handle says its pane's size is, through the ARIA contract rather than a measurement. */
export async function resizeHandleValue(window: Page, which: 'sidebar' | 'chat'): Promise<number> {
  const raw = await resizeHandle(window, which).getAttribute('aria-valuenow');
  return Number(raw ?? Number.NaN);
}

/**
 * Drags a divider by `deltaPx` and returns once the value it reports has changed.
 *
 * The wait is on `aria-valuenow`, not on a measured bounding box: the handle clamps to its pane's
 * min/max, so the pixel delta the pane actually takes may be smaller than the one asked for, while
 * "the control reports a different value" is exactly the contract a user experiences.
 */
export async function dragResizeHandle(
  window: Page,
  which: 'sidebar' | 'chat',
  deltaPx: number
): Promise<void> {
  const handle = resizeHandle(window, which);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`[workbench] the ${which} resize handle has no bounding box`);
  const before = await resizeHandleValue(window, which);

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await window.mouse.move(startX, startY);
  await window.mouse.down();
  await window.mouse.move(startX + deltaPx, startY, { steps: 8 });
  await window.mouse.up();

  await expect(handle).not.toHaveAttribute('aria-valuenow', String(before), {
    timeout: UI_TIMEOUT_MS,
  });
}
