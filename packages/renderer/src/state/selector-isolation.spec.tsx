/**
 * The executable version of store convention 3 (`capabilities.ts`), and of the reason PLAN.md §2
 * chose Zustand at all: "selector-subscribed so a chat token doesn't re-render the grid."
 *
 * Three proofs, in the order the risk actually shows up:
 *
 *   1. across stores — a streaming chat token must not re-render a component subscribed to result
 *      snapshots. This is the literal case from the plan, driven through the real
 *      `chat.onStreamChunk` bridge subscription rather than a synthetic setter;
 *   2. within one store — a tab title change must not re-render a component subscribed to the tab
 *      count;
 *   3. the `useShallow` foot-gun — a selector returning a fresh array re-renders on every write
 *      until it is wrapped, which is why the convention says so and why every such selector in
 *      `src/state/` is commented.
 */

import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShallow } from 'zustand/react/shallow';
import type { ChatStreamChunk, QueryResultSnapshot } from '@joinery/shared';
import { installJoineryMock, recordSubscription, removeJoineryMock } from '../test/joinery-mock';
import { createCapabilitiesStore } from './capabilities';
import { createChatStore, type ChatStore } from './chat';
import { createConnectionStore } from './connection';
import { createExplorerStore } from './explorer';
import { createQueryResultsStore, type QueryResultsStore } from './query-results';
import { createTabStore, selectDirtyTabs, selectTabCount, type TabStore } from './tab';

/** A render counter that is honest under React's batching: incremented in the render body. */
function makeCounter(): { count: () => number; tick: () => void } {
  let renders = 0;
  return { count: () => renders, tick: () => void (renders += 1) };
}

const snapshot = (id: string): QueryResultSnapshot =>
  ({ id, tabId: 't1', sql: 'select 1', isPinned: false }) as unknown as QueryResultSnapshot;

const teardowns: (() => void)[] = [];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  vi.clearAllMocks();
});

describe('selector isolation — across stores', () => {
  it('a streaming chat token does not re-render a component subscribed to result snapshots', async () => {
    const streamChunks = recordSubscription<ChatStreamChunk>();
    teardowns.push(installJoineryMock({ chat: { onStreamChunk: streamChunks.subscribe } }));

    const capabilities = createCapabilitiesStore();
    const tab = createTabStore();
    const explorer = createExplorerStore({ capabilities });
    const connection = createConnectionStore({ tab, explorer, capabilities });
    teardowns.push(() => connection.getState().destroy());

    // An instance pointed at an existing conversation, so chunks are accepted without any of the
    // conversation-creation round-trip.
    const chat: ChatStore = createChatStore(
      { connection, tab, capabilities },
      { initialConversationId: 'conv-1' }
    );
    teardowns.push(() => chat.getState().destroy());

    const results: QueryResultsStore = createQueryResultsStore();
    results.setState({ snapshots: [snapshot('s1')] });

    const chatRenders = makeCounter();
    const gridRenders = makeCounter();

    function ChatTranscript() {
      chatRenders.tick();
      const streamingContent = chat(state => state.streamingContent);
      return <pre data-testid="chat">{streamingContent}</pre>;
    }

    function ResultsGrid() {
      gridRenders.tick();
      const snapshots = results(state => state.snapshots);
      return <p data-testid="grid">{snapshots.length}</p>;
    }

    render(
      <>
        <ChatTranscript />
        <ResultsGrid />
      </>
    );

    const chatBaseline = chatRenders.count();
    const gridBaseline = gridRenders.count();

    // Twenty tokens, the way a real stream arrives.
    for (let i = 0; i < 20; i++) {
      act(() => streamChunks.emit({ conversationId: 'conv-1', delta: `tok${i} `, done: false }));
    }

    expect(chatRenders.count()).toBeGreaterThan(chatBaseline);
    expect(gridRenders.count()).toBe(gridBaseline);
  });
});

describe('selector isolation — within one store', () => {
  it('a tab title change does not re-render a component subscribed to the tab count', () => {
    const tab: TabStore = createTabStore();
    const countRenders = makeCounter();
    const titleRenders = makeCounter();

    const tabId = tab.getState().openTab({ type: 'query', title: 'Query 1', icon: 'code' });

    function TabCount() {
      countRenders.tick();
      return <p data-testid="count">{tab(selectTabCount)}</p>;
    }

    function TabTitle() {
      titleRenders.tick();
      const title = tab(state => state.tabs.find(t => t.id === tabId)?.title ?? '');
      return <p data-testid="title">{title}</p>;
    }

    render(
      <>
        <TabCount />
        <TabTitle />
      </>
    );

    const countBaseline = countRenders.count();
    const titleBaseline = titleRenders.count();

    act(() => tab.getState().renameTab(tabId, 'Customers'));

    expect(titleRenders.count()).toBeGreaterThan(titleBaseline);
    expect(countRenders.count()).toBe(countBaseline);
  });

  it('a fresh-array selector is a new identity every call — hence useShallow', () => {
    const tab: TabStore = createTabStore();
    tab.getState().openTab({ type: 'query', title: 'Query 1', icon: 'code' });

    // The hazard itself, asserted directly rather than by rendering it: an unwrapped
    // `selectDirtyTabs` fails `Object.is` against its own previous result, so every store write
    // looks like a change. Rendering that on purpose is not a test but a hang — React's
    // `useSyncExternalStore` treats an uncacheable snapshot as an infinite loop.
    const state = tab.getState();
    expect(selectDirtyTabs(state)).not.toBe(selectDirtyTabs(state));
    expect(selectDirtyTabs(state)).toEqual(selectDirtyTabs(state));
  });

  it('useShallow holds a fresh-array selector still until its contents change', () => {
    const tab: TabStore = createTabStore();
    const renders = makeCounter();

    const tabId = tab.getState().openTab({ type: 'query', title: 'Query 1', icon: 'code' });

    function DirtyTabs() {
      renders.tick();
      return <p data-testid="dirty">{tab(useShallow(selectDirtyTabs)).length}</p>;
    }

    render(<DirtyTabs />);
    const baseline = renders.count();

    // A write that does not change the dirty set at all.
    act(() => tab.getState().renameTab(tabId, 'Customers'));
    expect(renders.count()).toBe(baseline);

    // A write that does.
    act(() => tab.getState().markDirty(tabId));
    expect(renders.count()).toBeGreaterThan(baseline);
  });
});
