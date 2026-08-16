/**
 * One chat store per chat TAB, and the `destroy()` that goes with the tab closing.
 *
 * `state/chat.ts` names this file's job in its own header: "Task 17 owns the tab-id → store map and
 * the `destroy()` on close." The map exists because the two lifetimes involved are not the same one:
 *
 *  - a chat tab lives until the user closes it;
 *  - the React component that renders it is **unmounted whenever Dockview deactivates the panel**
 *    (PLAN.md R5 finding 4 — an inactive panel's subtree is detached, and Dockview may drop it).
 *
 * So the store cannot be component state. If it were, switching to another tab and back would build a
 * second instance with a second bridge subscription, lose the transcript, and — because
 * `ChatStoreState.destroy` is the only thing that unsubscribes — leak the first one's listener for the
 * rest of the session. Holding it here means a tab keeps its conversation, its in-flight stream and
 * its ONE subscription across every activation, and the teardown happens on the event that actually
 * ends the tab.
 *
 * Module state, and therefore something to be careful about: `releaseChatStore` is the only way out,
 * and `chat-tab-panel.tsx` is its only caller.
 */

import { createChatTabStore, type ChatStore } from '../../state/chat';

const stores = new Map<string, ChatStore>();

/**
 * The store for one chat tab, created on first use.
 *
 * `conversationId` is read only when the store is created — it becomes the instance's
 * `initialConversationId`, which is how a tab restored from a persisted layout comes back pointing at
 * the transcript it had. A later call with a different id does NOT re-point the store: selecting a
 * conversation is `selectConversation`'s job, and quietly rebuilding the instance would drop an
 * in-flight stream.
 */
export function chatStoreForTab(tabId: string, conversationId?: string): ChatStore {
  const existing = stores.get(tabId);
  if (existing !== undefined) return existing;

  const created = createChatTabStore(conversationId);
  stores.set(tabId, created);
  return created;
}

/** Drops one tab's store and unsubscribes it from the bridge. Idempotent. */
export function releaseChatStore(tabId: string): void {
  const store = stores.get(tabId);
  if (store === undefined) return;
  stores.delete(tabId);
  store.getState().destroy();
}

/** How many tab stores are live. For tests, and for a leak assertion that means something. */
export function liveChatStoreCount(): number {
  return stores.size;
}

/** Drops every tab store. Tests only — production releases per tab. */
export function releaseAllChatStores(): void {
  for (const tabId of [...stores.keys()]) releaseChatStore(tabId);
}
