/**
 * The app frame. Replaces `layout/shell/shell.component.ts` (453) — rebuilt, not ported, because
 * PLAN.md §1.1 says so and because three of the audit's §1.9 findings are in that file's stylesheet.
 *
 * ── The frame, and the one border rule ────────────────────────────────────────────────────
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │ Titlebar            --titlebar-height, drag region│
 *   ├────────┬───────────────────────────┬─────────────┤
 *   │ Sidebar│ Workspace (Dockview)      │ Chat panel  │
 *   ├────────┴───────────────────────────┴─────────────┤
 *   │ Status bar                                    28px│
 *   └──────────────────────────────────────────────────┘
 *
 * A three-row CSS grid with `minmax(0, 1fr)` in the middle, which is what keeps the dock from being
 * pushed past the viewport by its own content (`flexbox-layout.md`'s `min-w-0` rule, applied on the
 * block axis).
 *
 * **Border ownership, stated once because the audit found it confused:** the titlebar draws its own
 * bottom rule, the status bar draws its own top rule, and each vertical divider is drawn *by the
 * resize handle*. No pane draws a border on an edge where a divider already is. That is every
 * hairline in the shell, and there are no negative margins anywhere.
 *
 * ── What the frame owns ───────────────────────────────────────────────────────────────────
 *
 *  - the boot gate: nothing below renders until the stores are hydrated (`boot.ts`);
 *  - the two panel splits, both resizable by keyboard and persisted;
 *  - the global mounts nothing else may install — the toast sink and the log sink (the native-theme
 *    listener sits one level up, at the app root, because the dev pages need it too);
 *  - the shell's own keyboard shortcut, ⌘J, which has no menu item to come through;
 *  - the dirty-tab `beforeunload` guard (`app.component.ts:93-101`).
 */

import { useEffect, useLayoutEffect, type CSSProperties } from 'react';

import { Spinner, Toaster, TooltipProvider, cn, installToastNotifier } from '../ui';
import { dispatchCommand } from '../commands';
import { ConnectionDialogs } from '../features/connections';
import { diagnostics } from '../state/diagnostics';
import { installLogDiagnosticsSink, useLogStream } from '../state/logs';
import { useTabStore } from '../state/tab';
import { selectEffectiveTheme, useSettingsStore } from '../state/settings';
import { useChatPanelStore } from '../state/chat';
import {
  CHAT_PANEL_MAX_WIDTH,
  CHAT_PANEL_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useWorkbenchStore,
} from '../state/workbench';
import { runBoot, useBootStore } from './boot';
import { ChatSidePanel } from './chat-side-panel';
import { MenuBridge } from './menu-bridge';
import { ResizeHandle } from './resize-handle';
import { ShellCommands } from './shell-commands';
import { Sidebar } from './sidebar';
import { StatusBar } from './status-bar';
import { Titlebar } from './titlebar';
import { Workspace } from './workspace/workspace';

/**
 * A dynamic pixel width has to reach CSS somehow, and `general.md` prefers an arbitrary property
 * over an inline `width`. The compromise Tailwind v4 intends: the value goes through a custom
 * property (the one thing `style` is still for) and the utility reads it, so the class list stays
 * the styling surface. The cast is unavoidable — `CSSProperties` has no index signature for custom
 * properties.
 */
function widthVar(name: string, value: number): CSSProperties {
  return { [name]: `${value}px` } as CSSProperties;
}

/** The startup screen. Ported in spirit from `loading.component` behind `app.component.ts:36-39`. */
function StartupScreen() {
  return (
    <div
      data-testid="startup-screen"
      className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-canvas"
    >
      <p className="font-display text-display-sm text-fg">Joinery</p>
      <Spinner label="Starting…" />
    </div>
  );
}

export function AppShell() {
  const phase = useBootStore(state => state.phase);

  // The sinks go in before the boot sequence runs, so a failure inside the boot itself lands in the
  // Output panel and in the log file rather than in a devtools console nobody has open. A layout
  // effect for the ordering: it runs before the passive effect below, on the same commit.
  useLayoutEffect(() => {
    const teardowns = [installToastNotifier(), installLogDiagnosticsSink()];
    return () => {
      for (const teardown of teardowns) teardown();
    };
  }, []);

  // The one caller of `runBoot`, which is itself latched, so StrictMode's double mount joins the
  // first run rather than starting a second.
  //
  // The `catch` is not decoration: `performBoot` awaits the migration and the geometry hydration
  // OUTSIDE any try, so a rejection there leaves the phase at `starting` — the startup screen up
  // forever. Without this the reason would be an unhandled rejection in a devtools console nobody
  // has open; with it, it is in the log file. The sinks are installed by the layout effect above, so
  // they are already in place when this runs.
  useEffect(() => {
    runBoot().catch(error => diagnostics.error('the startup sequence failed', error));
  }, []);

  // Mounted here rather than inside the frame so the log stream is running while the startup screen
  // is up — a boot slow enough to see is exactly when its log entries matter. `useNativeThemeSync`
  // is one level higher still, at the app root, because the dev pages need it too (`app.tsx`).
  useLogStream();

  if (phase === 'starting') return <StartupScreen />;
  return <ShellFrame />;
}

function ShellFrame() {
  const sidebarWidth = useWorkbenchStore(state => state.sidebarWidth);
  const sidebarCollapsed = useWorkbenchStore(state => state.sidebarCollapsed);
  const setSidebarWidth = useWorkbenchStore(state => state.setSidebarWidth);
  const resetSidebarWidth = useWorkbenchStore(state => state.resetSidebarWidth);
  const chatPanelWidth = useWorkbenchStore(state => state.chatPanelWidth);
  const setChatPanelWidth = useWorkbenchStore(state => state.setChatPanelWidth);
  const chatOpen = useChatPanelStore(state => state.panelOpen);
  const theme = useSettingsStore(selectEffectiveTheme);
  // A boolean, not `selectDirtyTabs`: that selector builds a fresh array on every call, so
  // subscribing to it without `useShallow` compares two new references and re-renders forever
  // (`state/capabilities.ts` rule 3, and the loop this cost before it was narrowed). The guard only
  // needs to know whether ANY tab is dirty.
  const hasDirtyTabs = useTabStore(state => state.tabs.some(tab => tab.isDirty === true));

  // ⌘J / Ctrl+J. The only shortcut the shell owns: every other binding in the app is a native menu
  // accelerator (`main/src/menu.ts`), which never reaches the renderer as a keystroke.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key !== 'j' && event.key !== 'J') return;
      event.preventDefault();
      dispatchCommand('toggle-output-panel');
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // The unsaved-work guard. Chromium ignores the message but still shows its own confirmation, and
  // `preventDefault()` is what arms it.
  useEffect(() => {
    if (!hasDirtyTabs) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = 'You have unsaved changes.';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasDirtyTabs]);

  return (
    <TooltipProvider>
      {/* `isolate` per general.md: the app container is its own stacking context, so a portalled
          overlay cannot be trapped under a panel. */}
      <div
        data-testid="app-shell"
        className={cn(
          'isolate grid h-dvh w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-canvas'
        )}
      >
        <Titlebar />

        <div className="flex min-h-0 min-w-0">
          {sidebarCollapsed ? null : (
            <>
              <div
                style={widthVar('--sidebar-width', sidebarWidth)}
                className="w-(--sidebar-width) shrink-0"
              >
                <Sidebar />
              </div>
              <ResizeHandle
                label="Sidebar width"
                testId="sidebar-resize-handle"
                value={sidebarWidth}
                min={SIDEBAR_MIN_WIDTH}
                max={SIDEBAR_MAX_WIDTH}
                edge="leading"
                onChange={setSidebarWidth}
                onReset={resetSidebarWidth}
              />
            </>
          )}

          <Workspace />

          {chatOpen ? (
            <>
              <ResizeHandle
                label="Assistant width"
                testId="chat-resize-handle"
                value={chatPanelWidth}
                min={CHAT_PANEL_MIN_WIDTH}
                max={CHAT_PANEL_MAX_WIDTH}
                edge="trailing"
                onChange={setChatPanelWidth}
              />
              <div
                style={widthVar('--chat-panel-width', chatPanelWidth)}
                className="w-(--chat-panel-width) shrink-0"
              >
                <ChatSidePanel />
              </div>
            </>
          ) : null}
        </div>

        <StatusBar />
      </div>

      {/* Non-visual mounts. Each renders nothing until something asks it to, and each must exist
          exactly once. `ConnectionDialogs` is Task 9's consumer of the three connection commands. */}
      <MenuBridge />
      <ShellCommands />
      <ConnectionDialogs />
      <Toaster theme={theme} />
    </TooltipProvider>
  );
}
