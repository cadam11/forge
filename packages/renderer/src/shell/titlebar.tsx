/**
 * The window's own chrome row: the macOS drag region, traffic-light clearance, and the sidebar
 * toggle.
 *
 * `titleBarStyle: 'hiddenInset'` with `trafficLightPosition: {x: 15, y: 15}` (`main/src/window.ts:57`)
 * means the window has no title bar of its own and the three buttons float over whatever the
 * renderer paints in the top-left. Two things follow, and the Angular shell got both wrong
 * (audit §1.9):
 *
 *  - **`-webkit-app-region: drag` has to be somewhere**, or the window cannot be moved at all. This
 *    row is it, and every interactive child opts out with `no-drag` — otherwise the button is a
 *    drag handle that happens to look like a button.
 *  - **The traffic lights need clearance, and it is one number.** Angular had `38px` in four places
 *    with two different meanings and a fifth value (`36px`) for the one it was supposed to match.
 *    Here the row's height is `--titlebar-height` (the token Task 2 added for exactly this) and the
 *    left inset is `--spacing(20)` = 80px, which clears buttons that start at x=15 and run ~54px.
 *
 * Unlike the Angular shell, this row spans the WHOLE window rather than only the area right of the
 * sidebar. That is what lets the sidebar, the dock and the chat panel all start at the same y and
 * share one horizontal rule, instead of the sidebar carrying its own private 38px of padding.
 */

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { Icon, Tooltip, cn } from '../ui';
import { useWorkbenchStore } from '../state/workbench';

/** The one place `-webkit-app-region` is spelled, and it is spelled twice on purpose. */
const DRAG_REGION = '[-webkit-app-region:drag]';
const NO_DRAG_REGION = '[-webkit-app-region:no-drag]';

export function Titlebar() {
  const collapsed = useWorkbenchStore(state => state.sidebarCollapsed);
  const toggleSidebar = useWorkbenchStore(state => state.toggleSidebar);

  return (
    <header
      data-testid="titlebar"
      className={cn(
        'flex h-(--titlebar-height) shrink-0 items-center gap-2 border-b border-rule bg-chrome',
        // 80px of traffic-light clearance, then the normal chrome inset on the right.
        'pr-3 pl-20',
        DRAG_REGION
      )}
    >
      <Tooltip content={collapsed ? 'Show the sidebar (⌘\\)' : 'Hide the sidebar (⌘\\)'}>
        <button
          type="button"
          aria-label={collapsed ? 'Show the sidebar' : 'Hide the sidebar'}
          aria-pressed={!collapsed}
          data-testid="titlebar-sidebar-toggle"
          onClick={toggleSidebar}
          className={cn(
            'flex size-5 items-center justify-center rounded-xs border-0 bg-transparent',
            'text-fg-muted hover:bg-hover hover:text-fg',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
            NO_DRAG_REGION
          )}
        >
          <Icon icon={collapsed ? PanelLeftOpen : PanelLeftClose} size="sm" />
        </button>
      </Tooltip>

      {/* The wordmark, at chrome scale. The brand mark itself (docs/brand/assets/mark-on-*.svg)
          belongs to the sidebar header and lands with it in Task 8. */}
      <p className="font-display text-base text-fg-muted select-none">Joinery</p>
    </header>
  );
}
