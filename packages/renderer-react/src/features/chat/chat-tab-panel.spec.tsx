/**
 * The chat TAB: the store's lifetime, and the isolation between two of them.
 *
 * `state/chat.spec.ts` pins per-instance isolation at the store level. This is the same property one
 * layer up, where it can actually break: the surface that renders a tab is unmounted every time
 * Dockview deactivates the panel (PLAN.md R5 finding 4), so a store held as component state would be
 * rebuilt per activation — a fresh transcript, a second bridge subscription, and the first one leaked
 * for the rest of the session because `destroy()` is the only thing that unsubscribes.
 *
 * Four claims:
 *
 *  1. re-activating a tab keeps its store, its transcript and its ONE subscription;
 *  2. closing the tab releases both;
 *  3. two tabs on two conversations do not write each other's transcript — asserted on the rendered
 *     DOM, not on store state;
 *  4. each tab loads the tool catalogue for itself, which is the `loadTools: true` decision.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';

import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { tabStore } from '../../state/tab';
import { aiStore } from '../../state/ai';
import { TooltipProvider } from '../../ui';
import {
  configuredSettings,
  installChatDouble,
  makeConversation,
  type ChatDouble,
} from '../../test/chat-double';
import { ChatTabPanel } from './chat-tab-panel';
import { chatStoreForTab, liveChatStoreCount, releaseAllChatStores } from './chat-store-host';

const teardowns: (() => void)[] = [];
let double: ChatDouble;

function panelProps(tabId: string): IDockviewPanelProps {
  return { params: { tabId }, api: { id: tabId } } as unknown as IDockviewPanelProps;
}

function mountTab(tabId: string) {
  return render(
    <TooltipProvider>
      <ChatTabPanel {...panelProps(tabId)} />
    </TooltipProvider>
  );
}

beforeEach(() => {
  teardowns.push(
    setDiagnosticsSink({ error: () => undefined, warn: () => undefined }),
    setNotifier({
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warning: () => undefined,
    })
  );
  double = installChatDouble({
    settings: configuredSettings(),
    conversations: [
      makeConversation({
        id: 'conv-1',
        title: 'Indexes',
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            content: 'About indexes.',
            timestamp: '2026-08-16T09:00:00.000Z',
          },
        ],
      }),
      makeConversation({
        id: 'conv-2',
        title: 'Vacuum',
        messages: [
          {
            id: 'b1',
            role: 'assistant',
            content: 'About vacuum.',
            timestamp: '2026-08-16T09:00:00.000Z',
          },
        ],
      }),
    ],
    tools: [{ name: 'run_query', description: 'Runs SQL.', parameters: {}, category: 'query' }],
  });
  teardowns.push(double.teardown);
});

afterEach(() => {
  releaseAllChatStores();
  while (teardowns.length > 0) teardowns.pop()?.();
  aiStore.setState(aiStore.getInitialState());
  tabStore.setState({ tabs: [], activeTabId: '' });
});

describe('a chat tab', () => {
  it('keeps its store, its transcript and its one subscription across a re-activation', async () => {
    const tabId = tabStore.getState().openChatTab('conv-1');

    const first = mountTab(tabId);
    await waitFor(() => expect(first.getByTestId('chat-message')).toBeDefined());
    const store = chatStoreForTab(tabId);
    expect(store.getState().messages).toHaveLength(1);
    expect(double.liveSubscriptions()).toBe(1);

    // Dockview deactivating the panel: the component goes, the tab stays.
    first.unmount();
    expect(liveChatStoreCount()).toBe(1);
    expect(double.liveSubscriptions()).toBe(1);

    const second = mountTab(tabId);
    await waitFor(() => expect(second.getByTestId('chat-message')).toBeDefined());
    // The same instance — not a rebuilt one with a second listener on the bridge.
    expect(chatStoreForTab(tabId)).toBe(store);
    expect(double.liveSubscriptions()).toBe(1);
  });

  it('releases the store when the tab is closed', async () => {
    const tabId = tabStore.getState().openChatTab('conv-1');
    const view = mountTab(tabId);
    await waitFor(() => expect(view.getByTestId('chat-message')).toBeDefined());

    // Closing the tab is what ends the store's life; the unmount that follows is what notices.
    tabStore.getState().closeTab(tabId);
    view.unmount();

    expect(liveChatStoreCount()).toBe(0);
    expect(double.liveSubscriptions()).toBe(0);
  });

  it('does not write another tab’s transcript', async () => {
    const firstTab = tabStore.getState().openChatTab('conv-1');
    const secondTab = tabStore.getState().openChatTab('conv-2');

    const view = render(
      <TooltipProvider>
        <div data-testid="first-host">
          <ChatTabPanel {...panelProps(firstTab)} />
        </div>
        <div data-testid="second-host">
          <ChatTabPanel {...panelProps(secondTab)} />
        </div>
      </TooltipProvider>
    );

    await waitFor(() => expect(double.liveSubscriptions()).toBe(2));
    const firstHost = view.getByTestId('first-host');
    const secondHost = view.getByTestId('second-host');
    await waitFor(() =>
      expect(within(firstHost).getByTestId('chat-message').textContent).toContain('About indexes')
    );

    // Both tabs are mid-stream, which is when a leak would show.
    await chatStoreForTab(firstTab).getState().sendMessage('more about indexes');
    await chatStoreForTab(secondTab).getState().sendMessage('more about vacuum');

    double.emit({ conversationId: 'conv-1', delta: 'ONLY FOR THE FIRST', done: false });

    await waitFor(() =>
      expect(within(firstHost).getByTestId('chat-stream-tail').textContent).toContain(
        'ONLY FOR THE FIRST'
      )
    );
    // The second tab received the same chunk on its own subscription and dropped it.
    expect(within(secondHost).queryByTestId('chat-stream-tail')).toBeNull();
    expect(chatStoreForTab(secondTab).getState().streamingContent).toBe('');
  });

  it('loads the tool catalogue per instance, so a confirmation is informative in either tab', async () => {
    const firstTab = tabStore.getState().openChatTab('conv-1');
    const secondTab = tabStore.getState().openChatTab('conv-2');
    mountTab(firstTab);
    mountTab(secondTab);

    // Two instances, two reads of a static in-process list — the cost the `loadTools: true` decision
    // accepted, and the reason a chat tab's confirmations carry a description at all.
    await waitFor(() => expect(double.getToolsCalls()).toBe(2));
    expect(chatStoreForTab(firstTab).getState().tools).toHaveLength(1);
    expect(chatStoreForTab(secondTab).getState().tools).toHaveLength(1);
  });

  it('names the tab after its conversation, so two chat tabs are told apart', async () => {
    const tabId = tabStore.getState().openChatTab('conv-1');
    expect(tabStore.getState().tabs.find(tab => tab.id === tabId)?.title).toBe('AI Chat');

    mountTab(tabId);

    await waitFor(() =>
      expect(tabStore.getState().tabs.find(tab => tab.id === tabId)?.title).toBe('Indexes')
    );
  });
});
