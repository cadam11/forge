/**
 * The two chat commands, and why they are here rather than in `shell/shell-commands.tsx`.
 *
 * `toggle-chat-panel` was Task 7's, because in Task 7 there was no chat surface to own it — the
 * registry's rule is that a command names a consumer, and the shell was the only thing mounted. Task
 * 15 set the precedent for the hand-over when a real surface arrives (`open-settings` moved to
 * `features/settings`, so ⌘, is handled exactly once, by the panel that reads the flag), and this is
 * the same move for chat.
 *
 * **Mounted unconditionally by the shell, NOT inside the panel.** A closed side panel is unmounted, so
 * a `useCommand('toggle-chat-panel')` inside `ChatSurface` would be a handler that exists only while
 * the panel is already open — ⇧⌘I could close the assistant and never reopen it. This component
 * renders nothing and lives beside the shell's other non-visual mounts for exactly that reason.
 *
 * `open-chat-tab` is new. Angular reached the chat tab from one place only — the ⧉ button inside the
 * panel — so the palette could not open one and neither could the menu. The button is still there (it
 * carries the current conversation into the tab, which a palette entry cannot), and this is the
 * targetless entry point beside it: a fresh chat tab.
 */

import { useCommand } from '../../commands';
import { chatPanelStore } from '../../state/chat';
import { tabStore } from '../../state/tab';

export function ChatCommands() {
  useCommand('toggle-chat-panel', () => chatPanelStore.getState().togglePanel());
  useCommand('open-chat-tab', () => {
    tabStore.getState().openChatTab();
  });
  return null;
}
