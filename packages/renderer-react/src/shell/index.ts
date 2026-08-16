/**
 * The shell: the app frame, the dock workspace, the status bar, and the native-menu bridge.
 *
 * Read in this order:
 *
 *   boot.ts                   the startup sequence, and the restore-before-save contract's caller
 *   app-shell.tsx             the frame, the two splits, and the global mounts
 *   titlebar.tsx              the drag region and the traffic-light clearance
 *   resize-handle.tsx         the keyboard-operable divider (audit §1.9)
 *   status-bar.tsx            the restructured bar (audit §1.9)
 *   menu-bridge.tsx           all 31 `menu.on*` channels → commands
 *   shell-commands.tsx        the handlers this task owns, plus the three placeholder dialogs
 *   workspace/workspace.tsx   Dockview, reconciled against `tabStore`
 *
 * `AppShell` is the only export the app root needs.
 */

export { AppShell } from './app-shell';
export {
  BOOT_STEPS,
  bootStore,
  createBootStore,
  resetBootLatch,
  runBoot,
  useBootStore,
  type BootDeps,
  type BootPhase,
  type BootState,
  type BootStep,
  type BootStore,
  type WorkspaceRestore,
} from './boot';
export { MENU_CHANNELS, MENU_COMMANDS, MenuBridge } from './menu-bridge';
export { ResizeHandle, type ResizeEdge, type ResizeHandleProps } from './resize-handle';
export {
  OUTPUT_PANEL_ID,
  RESERVED_PANEL_IDS,
  isTabPanelId,
  layoutHasOutputPanel,
  layoutTabStatesFrom,
  panelComponentFor,
  paramsSignature,
  tabPanelParams,
  type TabPanelParams,
} from './workspace/dockview-sync';
