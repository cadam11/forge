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
 * ── Why the release is watched here rather than done on unmount ────────────────────────────
 *
 * The obvious cleanup — release in the panel's unmount effect when the tab is gone — cannot see the
 * case that matters. Closing a tab that is NOT the active one removes a panel whose React component
 * was already unmounted at deactivation, so no unmount runs at the moment the tab dies and the store,
 * its transcript and its bridge subscription stay live for the rest of the session. (The query panel's
 * `forgetTab` cleanup has the same shape and the same hole, for query results rather than a listener.)
 *
 * So the map watches the thing that actually ends a tab: `tabStore.tabs`. One subscription, started
 * with the first tab store rather than at import so a renderer that never opens a chat tab pays
 * nothing, and stopped when the last store goes.
 */

import { createChatTabStore, type ChatStore } from '../../state/chat';
import { tabStore } from '../../state/tab';

const stores = new Map<string, ChatStore>();

/** The `tabStore` subscription that prunes closed tabs. Non-null exactly while `stores` is non-empty. */
let unwatchTabs: (() => void) | null = null;

/** Releases the store of every tab that is no longer open. Bounded by the size of the map. */
function releaseClosedTabs(): void {
  const live = new Set(tabStore.getState().tabs.map(tab => tab.id));
  for (const tabId of [...stores.keys()]) {
    if (!live.has(tabId)) releaseChatStore(tabId);
  }
}

function watchTabs(): void {
  if (unwatchTabs !== null) return;
  unwatchTabs = tabStore.subscribe((state, previous) => {
    // Identity, not content: `tabs` is replaced only when a tab is opened, closed, renamed or
    // reordered, and this must not run on every keystroke's `setTabContent`.
    if (state.tabs === previous.tabs) return;
    releaseClosedTabs();
  });
}

function stopWatchingTabs(): void {
  unwatchTabs?.();
  unwatchTabs = null;
}

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
  watchTabs();
  return created;
}

/** Drops one tab's store and unsubscribes it from the bridge. Idempotent. */
export function releaseChatStore(tabId: string): void {
  const store = stores.get(tabId);
  if (store === undefined) return;
  stores.delete(tabId);
  store.getState().destroy();
  if (stores.size === 0) stopWatchingTabs();
}

/** How many tab stores are live. For tests, and for a leak assertion that means something. */
export function liveChatStoreCount(): number {
  return stores.size;
}

/** Drops every tab store. Tests only — production releases per tab. */
export function releaseAllChatStores(): void {
  for (const tabId of [...stores.keys()]) releaseChatStore(tabId);
}
