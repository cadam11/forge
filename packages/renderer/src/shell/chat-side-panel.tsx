/**
 * The chat side panel: the shell's half of a surface that is also a tab.
 *
 * Chat is both (`shell.component.ts:48` mounted the panel; `tab.state.ts:openChatTab` made the tab).
 * The panel half is shell geometry — a persisted-width split on the right edge, opened from the status
 * bar or ⇧⌘I, resized by a keyboard-operable divider — and that is all still in `app-shell.tsx`. What
 * is left here is one decision: **which store instance the surface renders.**
 *
 * `chatPanelStore` is the module singleton, and it is the panel's for the whole session. Its bridge
 * subscription is set up once, at construction — which is why this component does not `destroy()` it
 * when the panel closes (see `features/chat/chat-surface.tsx`, and `state/chat.ts`'s note on why the
 * subscription is not deferred to first use).
 *
 * Draws no border on its left edge: the divider owns that hairline.
 */

import { ChatSurface } from '../features/chat';
import { chatPanelStore } from '../state/chat';

export function ChatSidePanel() {
  return (
    <aside aria-label="AI assistant" className="flex h-full min-h-0 min-w-0 flex-col">
      <ChatSurface store={chatPanelStore} mode="panel" />
    </aside>
  );
}
