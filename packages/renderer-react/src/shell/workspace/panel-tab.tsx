/**
 * The workspace's tab header — the custom Dockview tab renderer, and the reason the Dockview
 * spike had to pass requirement 1 before any of this was built.
 *
 * It carries four things the default renderer cannot: a dirty dot, a pinned marker, an inline
 * rename affordance, and the tab context menu the Angular container hand-rolled
 * (`golden-layout-container.component.ts:56-86` for the menu, `:89-108` for a modal rename
 * dialog — which this replaces with editing in place, because a modal to rename a tab is a
 * dialog too many).
 *
 * ── It reads the store, not its params ────────────────────────────────────────────────────
 *
 * Dockview hands a tab renderer `params`, and the obvious design is to push title/dirty/pinned
 * through them and call `panel.update()` on every change. This subscribes to `tabStore` by id
 * instead. Two reasons, both measured in the spike: a dirty flag set AFTER the panel existed
 * reaches the header with no `update()` call at all, and `panel.update()` fires
 * `onDidLayoutChange`, so params-as-state would turn every keystroke that flips dirtiness into a
 * debounced layout save. Params stay a serialization vehicle (see `dockview-sync.ts`).
 *
 * `state.tabs.find(...)` returns the same object reference until that tab is replaced — the store
 * clones only the tab it changes — so this is a stable selector under Zustand's `Object.is`
 * comparison, not a new object per render.
 */

import { useCallback, useState } from 'react';
import type { DockviewGroupPanel, IDockviewPanelHeaderProps } from 'dockview-react';
import {
  ArrowRightToLine,
  Copy,
  ListX,
  Pencil,
  Pin,
  PinOff,
  SquareSplitHorizontal,
  X,
} from 'lucide-react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  Icon,
  cn,
} from '../../ui';
import { tabStore, useTabStore } from '../../state/tab';
import { logStore } from '../../state/logs';
import { diagnostics, notify } from '../../state/diagnostics';
import {
  DOCKING_BINDINGS,
  applyDockingMove,
  bindingFor,
  refusalMessage,
  type DockingBinding,
} from './panel-docking';
import { OUTPUT_PANEL_ICON, iconForTab } from './tab-icons';

/** Shared by the tab and the reserved-panel header so both close buttons look identical. */
const CLOSE_BUTTON_CLASSES = cn(
  'flex size-4 shrink-0 items-center justify-center rounded-xs text-fg-subtle opacity-0',
  'hover:bg-hover hover:text-fg group-hover:opacity-100 group-focus-within:opacity-100',
  'focus-visible:opacity-100 focus-visible:outline-2 focus-visible:-outline-offset-2',
  'focus-visible:outline-focus'
);

const TAB_CLASSES = cn(
  'group flex h-full min-w-0 items-center gap-1.5 px-2.5 text-base',
  // The tab strip is dense chrome, so the focus ring is inset (HOUSE-RULES §7).
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus'
);

/**
 * The Output / Console panel's header. A reserved panel has no `Tab`, so it cannot use the
 * component below: there is nothing in `tabStore` to subscribe to, no rename, and closing it has
 * to put the log store's own open flag back rather than close a tab that does not exist.
 */
export function ReservedPanelTab({ api }: IDockviewPanelHeaderProps) {
  return (
    <div className={TAB_CLASSES} data-testid="workspace-output-tab">
      <Icon icon={OUTPUT_PANEL_ICON} size="sm" className="stroke-fg-muted" />
      <span className="min-w-0 truncate">{api.title ?? 'Output'}</span>
      <button
        type="button"
        aria-label="Close the output panel"
        data-testid="workspace-output-tab-close"
        className={CLOSE_BUTTON_CLASSES}
        onClick={event => {
          event.stopPropagation();
          logStore.getState().close();
        }}
      >
        <Icon icon={X} size="sm" />
      </button>
    </div>
  );
}

/** What `aria-keyshortcuts` advertises on the tab. Built from the table, so it cannot go stale. */
const DOCKING_KEYSHORTCUTS = DOCKING_BINDINGS.map(binding => binding.accelerator).join(' ');

/**
 * Wires the Option+Arrow docking keys to the element Dockview actually focuses.
 *
 * **This cannot be a React `onKeyDown` on the tab's own markup, and the reason is worth stating.**
 * A tab renderer's element is appended INSIDE Dockview's `.dv-tab` (`Tab.setContent`,
 * dockview-core 8.1.0), and `.dv-tab` is what carries `role="tab"`, `aria-selected` and the roving
 * `tabIndex` — so it, not anything this component renders, is what has focus when a key is pressed.
 * React events propagate from the event TARGET upward, and this component's subtree is *below* that
 * target, so a handler here would never run. The listener therefore goes on the ancestor, natively.
 *
 * `aria-keyshortcuts` goes on the same element for the same reason: it belongs on the thing the
 * user focuses, which is how the shortcuts are discoverable without opening the menu.
 *
 * `.dv-tab` is a vendor class name, which this codebase otherwise avoids. It is the third of the
 * three documented Dockview exemptions (`shell/dockview-theme.css` already styles `.dv-tab` for the
 * same reason: it is the focusable element and the vendor gives it no focus treatment). If it ever
 * disappears, this logs and does nothing — the tab still renders and the menu still offers all six
 * moves.
 *
 * A **ref callback with a cleanup** (React 19) rather than a `useEffect` reading a ref: the wiring
 * belongs to the NODE, and this component has a render path that produces no node at all — the
 * one-frame fallback for a tab that has left the store. An effect keyed on anything but the node
 * would either miss the node arriving or run against a stale one. `useCallback` keeps the identity
 * stable, so a re-render does not detach and reattach.
 */
function useDockingKeys(
  dock: (move: DockingBinding['move']) => void
): (node: HTMLDivElement | null) => (() => void) | undefined {
  return useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) return undefined;

      const tabElement = node.closest<HTMLElement>('.dv-tab');
      if (tabElement === null) {
        diagnostics.warn(
          'workspace tab: no .dv-tab ancestor, so keyboard docking is unavailable on this tab',
          new Error('dockview tab element not found')
        );
        return undefined;
      }

      const onKeyDown = (event: KeyboardEvent): void => {
        const binding = bindingFor(event);
        if (binding === undefined) return;
        // Only reached for a key this component claims, so everything else still reaches Dockview's
        // own tab navigation (`ctrl+[`, `ctrl+]`, F6) and the shell's shortcuts.
        event.preventDefault();
        event.stopPropagation();
        dock(binding.move);
      };

      tabElement.setAttribute('aria-keyshortcuts', DOCKING_KEYSHORTCUTS);
      tabElement.addEventListener('keydown', onKeyDown);
      return () => {
        tabElement.removeEventListener('keydown', onKeyDown);
        tabElement.removeAttribute('aria-keyshortcuts');
      };
    },
    [dock]
  );
}

export function PanelTab(props: IDockviewPanelHeaderProps) {
  const tabId = props.api.id;
  const tab = useTabStore(state => state.tabs.find(t => t.id === tabId));
  const [draft, setDraft] = useState<string | null>(null);

  /**
   * Runs a docking move and reports a refusal. The single side-effecting call this component makes
   * into Dockview's arrangement, shared by the key handler and the six menu items so neither can
   * drift from the other.
   */
  const dock = useCallback(
    (move: DockingBinding['move']): void => {
      // The type argument is stated rather than inferred: `moveTo` is a contravariant inference
      // site, so leaving it out lets TypeScript settle on the module's structural default and the
      // real api stops being assignable. Naming `DockviewGroupPanel` here is also what makes this
      // line the compile-time check that `panel-docking.ts`'s four-field view of Dockview is true.
      if (applyDockingMove<DockviewGroupPanel>(props.api, props.containerApi, move)) return;
      notify.info(refusalMessage(move));
    },
    [props.api, props.containerApi]
  );
  const dockKeyboardRef = useDockingKeys(dock);

  /** Focus + select the rename field the moment it attaches. See its `ref` below. */
  const focusRename = useCallback((node: HTMLInputElement | null): void => {
    node?.focus();
    node?.select();
  }, []);

  // A panel whose tab has already gone from the store — one frame during a close. Render the
  // title Dockview still holds rather than nothing, so the strip does not flicker empty.
  if (!tab) {
    return (
      <div className={TAB_CLASSES}>
        <span className="min-w-0 truncate">{props.api.title}</span>
      </div>
    );
  }

  const store = tabStore.getState();
  const renaming = draft !== null;

  const startRename = (): void => setDraft(tab.title);
  const commitRename = (): void => {
    if (draft !== null) store.renameTab(tabId, draft);
    setDraft(null);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={TAB_CLASSES}
          data-testid={`workspace-tab-${tabId}`}
          data-tab-type={tab.type}
          data-dirty={tab.isDirty === true}
          data-pinned={tab.isPinned === true}
          ref={dockKeyboardRef}
          onDoubleClick={startRename}
        >
          <Icon icon={iconForTab(tab)} size="sm" className="stroke-fg-muted" />

          {tab.isPinned === true ? (
            <Icon
              icon={Pin}
              size="sm"
              label={`${tab.title} is pinned`}
              data-testid={`workspace-tab-pinned-${tabId}`}
              className="stroke-accent"
            />
          ) : null}

          {renaming ? (
            <input
              // A ref callback rather than `autoFocus`: the prop is banned (jsx-a11y bans it
              // because a self-focusing field on page load is disorienting) and this is the case
              // the ban is not about — the input exists only because the user asked to rename, so
              // focusing AND selecting is the whole point. Stable identity, so it runs once on
              // attach. It is what the Angular rename dialog did at `:1000-1005`.
              ref={focusRename}
              type="text"
              aria-label="Tab name"
              data-testid={`workspace-tab-rename-${tabId}`}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={event => {
                if (event.key === 'Enter') commitRename();
                if (event.key === 'Escape') setDraft(null);
                // Dockview binds ctrl+[ / ctrl+] and f6 for tab navigation on the document;
                // typing in a tab must not also drive the dock.
                event.stopPropagation();
              }}
              // MEASURED IN THE SPIKE: a Dockview tab is a drag source, so without these the
              // pointer-down that should place the caret starts a tab drag instead and the input
              // can be neither focused nor selected.
              onPointerDown={event => event.stopPropagation()}
              onMouseDown={event => event.stopPropagation()}
              className={cn(
                'min-w-0 rounded-xs border border-rule-strong bg-elevated px-1 text-base text-fg',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus'
              )}
              size={Math.max(draft.length, 6)}
            />
          ) : (
            <span
              className="min-w-0 truncate"
              data-testid={`workspace-tab-title-${tabId}`}
              title={tab.title}
            >
              {tab.title}
            </span>
          )}

          {/* The dirty marker. A dot rather than the audit-era approach of restyling the whole
              tab: it is the one thing in the strip that means "you will lose work", and oxide is
              allowed to say so (HOUSE-RULES §5 — the accent's marker job). */}
          {tab.isDirty === true ? (
            <span
              aria-label={`${tab.title} has unsaved changes`}
              role="img"
              data-testid={`workspace-tab-dirty-${tabId}`}
              className="size-1.5 shrink-0 rounded-full bg-accent"
            />
          ) : null}

          <button
            type="button"
            aria-label={`Close ${tab.title}`}
            data-testid={`workspace-tab-close-${tabId}`}
            className={CLOSE_BUTTON_CLASSES}
            onClick={event => {
              event.stopPropagation();
              // Through Dockview, not the store: the panel's removal is what drives
              // `tabStore.closeTab` (see `workspace.tsx`), so going straight to the store would
              // leave the panel behind for one reconciliation pass.
              props.api.close();
            }}
          >
            <Icon icon={X} size="sm" />
          </button>
        </div>
      </ContextMenuTrigger>

      {/* The port of the Angular tab context menu. Same six actions, same order. */}
      <ContextMenuContent data-testid={`workspace-tab-menu-${tabId}`}>
        <ContextMenuItem
          icon={Pencil}
          data-testid="workspace-tab-menu-rename"
          onSelect={startRename}
        >
          Rename tab
        </ContextMenuItem>
        <ContextMenuItem
          icon={tab.isPinned === true ? PinOff : Pin}
          data-testid="workspace-tab-menu-pin"
          onSelect={() => store.togglePin(tabId)}
        >
          {tab.isPinned === true ? 'Unpin tab' : 'Pin tab'}
        </ContextMenuItem>
        {tab.type === 'query' ? (
          <ContextMenuItem
            icon={Copy}
            data-testid="workspace-tab-menu-duplicate"
            onSelect={() => {
              store.duplicateTab(tabId);
            }}
          >
            Duplicate tab
          </ContextMenuItem>
        ) : null}
        {/* Docking, by menu. The same six moves the Option+Arrow keys perform, from the same
            table — so the accelerators shown here cannot claim a key that does nothing. Radix opens
            this menu on Shift+F10 and the Menu key as well as on right-click, which is what makes
            the whole set reachable without a pointer (PLAN.md Task 23). */}
        <ContextMenuSub>
          <ContextMenuSubTrigger icon={SquareSplitHorizontal} data-testid="workspace-tab-menu-move">
            Move tab
          </ContextMenuSubTrigger>
          <ContextMenuSubContent data-testid={`workspace-tab-move-menu-${tabId}`}>
            {DOCKING_BINDINGS.map(binding => (
              <ContextMenuItem
                key={binding.testIdSuffix}
                shortcut={binding.accelerator}
                data-testid={`workspace-tab-menu-move-${binding.testIdSuffix}`}
                onSelect={() => dock(binding.move)}
              >
                {binding.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={X}
          data-testid="workspace-tab-menu-close"
          onSelect={() => props.api.close()}
        >
          Close tab
        </ContextMenuItem>
        <ContextMenuItem
          icon={ListX}
          data-testid="workspace-tab-menu-close-others"
          onSelect={() => store.closeOtherTabs(tabId)}
        >
          Close other tabs
        </ContextMenuItem>
        <ContextMenuItem
          icon={ArrowRightToLine}
          data-testid="workspace-tab-menu-close-right"
          onSelect={() => store.closeTabsToRight(tabId)}
        >
          Close tabs to the right
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
