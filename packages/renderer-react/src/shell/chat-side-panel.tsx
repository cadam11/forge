/**
 * The chat side panel's frame. Task 17 fills it.
 *
 * Chat is both a side panel and a tab type (`shell.component.ts:48` mounts the panel;
 * `tab.state.ts:openChatTab` makes the tab). The panel half is shell geometry — a persisted-width
 * split on the right edge, opened from the status bar or ⇧⌘I — so it lives here; the streaming,
 * tool confirmation, conversation list and per-instance state are Task 17's.
 *
 * Draws no border on its left edge: the divider owns that hairline.
 */

import { Sparkles, X } from 'lucide-react';

import { EmptyState, Icon, Tooltip, cn } from '../ui';
import { chatPanelStore } from '../state/chat';

export function ChatSidePanel() {
  return (
    <aside
      aria-label="AI assistant"
      data-testid="chat-panel"
      className="flex h-full min-h-0 min-w-0 flex-col bg-chrome"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-rule px-3">
        <h2 className="grow font-mono text-2xs tracking-eyebrow text-fg-subtle uppercase">
          AI assistant
        </h2>
        <Tooltip content="Close the assistant (⇧⌘I)">
          <button
            type="button"
            aria-label="Close the assistant"
            data-testid="chat-panel-close"
            onClick={() => chatPanelStore.getState().closePanel()}
            className={cn(
              'flex size-5 items-center justify-center rounded-xs border-0 bg-transparent',
              'text-fg-muted hover:bg-hover hover:text-fg',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus'
            )}
          >
            <Icon icon={X} size="sm" />
          </button>
        </Tooltip>
      </div>

      <div className="flex min-h-0 grow items-center justify-center p-4">
        <EmptyState
          size="sm"
          icon={Sparkles}
          title="Assistant"
          description="Streaming chat, tool confirmation and the conversation list land in Task 17."
        />
      </div>
    </aside>
  );
}
