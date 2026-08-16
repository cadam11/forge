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
import type { IDockviewPanelHeaderProps } from 'dockview-react';
import { ArrowRightToLine, Copy, ListX, Pencil, Pin, PinOff, X } from 'lucide-react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Icon,
  cn,
} from '../../ui';
import { tabStore, useTabStore } from '../../state/tab';
import { logStore } from '../../state/logs';
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

export function PanelTab(props: IDockviewPanelHeaderProps) {
  const tabId = props.api.id;
  const tab = useTabStore(state => state.tabs.find(t => t.id === tabId));
  const [draft, setDraft] = useState<string | null>(null);

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
