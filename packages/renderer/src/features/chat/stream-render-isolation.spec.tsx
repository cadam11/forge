/**
 * R3, asserted: **a streamed token cannot re-render a finished message, and cannot reach the query
 * surface at all.**
 *
 * This is the unit half of the Task 17 gate; the browser half is
 * `.superpowers/sdd/PLAN/task-17-perf.mjs`, which counts DOM mutations in the shipped bundle against a
 * real 100-token/second stream with 50 prior messages on screen. The two measure the same three things,
 * and this one measures them at the memo boundary where the hazard lives.
 *
 * ── Why the hazard is real, and why it is not obvious ──────────────────────────────────────
 *
 * The chat store writes `streamingContent` on **every chunk**. Any component subscribed to that field
 * re-renders per token, and in this surface a re-render is not cheap: each completed assistant message
 * runs `marked` → highlight.js → DOMPurify to produce its HTML. Fifty of those, twenty times a second,
 * is the R3 failure. Nothing in the type system stops a future `useStore(store, s => s.streamingContent)`
 * from reappearing in the surface, so the assertion is on RENDER COUNTS.
 *
 * Both directions are checked, because a test that only counted zero would pass against a transcript
 * that never updates at all: the tail is proven to advance, and the finished message is proven to render
 * exactly once when the stream completes.
 *
 * ── The instruments ───────────────────────────────────────────────────────────────────────
 *
 *  - `<Markdown>` is doubled by a render counter keyed on its `data-testid`, so "a completed message
 *    re-rendered" and "the tail re-rendered" are separate numbers. The double also means highlight.js
 *    and DOMPurify are not what this file is timing.
 *  - a `MutationObserver` over each PRIOR message element, which catches a user message re-rendering
 *    too (a user bubble contains no markdown, so the counter above cannot see it).
 *  - a probe subscribed to the stores the query panel subscribes to, which fails if a chunk writes the
 *    tab or execution store — the jsdom shadow of the browser gate's "zero mutations in the grid".
 *  - a `<Profiler>` around the surface, counting COMMITS. This is the one that catches the mutation the
 *    other three survive: a `useStore(store, s => s.streamingContent)` reappearing in `ChatSurface`
 *    would re-render the surface and the transcript per token while `memo` still spared every message,
 *    so the counters above would all stay clean — and the app would be reconciling 52 children 20 times
 *    a second for nothing. Verified by making exactly that change and watching this number go from ~60
 *    to ~300 in the 300-chunk test.
 */

import { Profiler, useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Conversation } from '@joinery/shared';

import { setDiagnosticsSink } from '../../state/diagnostics';
import { queryExecutionStore, selectIsExecuting } from '../../state/query-execution';
import { aiStore } from '../../state/ai';
import { tabStore, useTabStore } from '../../state/tab';
import { useQueryExecutionStore } from '../../state/query-execution';
import { TooltipProvider } from '../../ui';
import {
  anthropicVendor,
  configuredSettings,
  installChatDouble,
  makeChatStore,
  makeConversation,
  type ChatDouble,
} from '../../test/chat-double';
import { STREAM_FLUSH_MS } from './use-stream-tail';

/** Renders of the doubled `<Markdown>`, per `data-testid`. */
const markdownRenders = new Map<string, number>();

vi.mock('../../markdown', () => ({
  Markdown: ({ data, 'data-testid': testId }: { data: string; 'data-testid'?: string }) => {
    const key = testId ?? 'markdown';
    markdownRenders.set(key, (markdownRenders.get(key) ?? 0) + 1);
    return <div data-testid={key}>{data}</div>;
  },
}));

const { ChatSurface } = await import('./chat-surface');

const BOUNDARY_MS = STREAM_FLUSH_MS + 20;
const CONVERSATION_ID = 'conv-1';

/** Fifty finished messages, alternating, each with markdown in it. */
function priorMessages(): ChatMessage[] {
  return Array.from({ length: 50 }, (_, index) => ({
    id: `msg-${index}`,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content:
      index % 2 === 0
        ? `question ${index}`
        : `Answer ${index} with \`code\` and a list:\n\n- one\n- two`,
    timestamp: '2026-08-16T09:00:00.000Z',
  }));
}

function seededConversation(): Conversation {
  return makeConversation({ id: CONVERSATION_ID, title: 'Perf', messages: priorMessages() });
}

/** Commits of the chat subtree. See the header: the mutation the other instruments cannot see. */
const commits = { count: 0 };

/** Subscribed to exactly what the query panel subscribes to. Its render count must not move. */
const queryProbeRenders = { count: 0 };

function QueryProbe() {
  useTabStore(state => state.tabs);
  useQueryExecutionStore(selectIsExecuting('tab-1'));
  // Counted in an effect with no dependency array — it runs once per render, and
  // `react-hooks/immutability` (correctly) refuses a write to module state from a render body.
  useEffect(() => {
    queryProbeRenders.count += 1;
  });
  return <div data-testid="query-probe" />;
}

const teardowns: (() => void)[] = [];
let double: ChatDouble;

beforeEach(() => {
  markdownRenders.clear();
  queryProbeRenders.count = 0;
  commits.count = 0;
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));
  double = installChatDouble({
    conversations: [seededConversation()],
    settings: configuredSettings(),
    vendors: [anthropicVendor()],
  });
  teardowns.push(double.teardown);
});

afterEach(() => {
  vi.useRealTimers();
  while (teardowns.length > 0) teardowns.pop()?.();
  aiStore.setState(aiStore.getInitialState());
  queryExecutionStore.getState().forgetTab('tab-1');
  tabStore.setState({ tabs: [], activeTabId: '' });
});

async function mountWithTranscript() {
  const store = makeChatStore({ initialConversationId: CONVERSATION_ID, loadTools: true });
  teardowns.push(() => store.getState().destroy());

  const view = render(
    <TooltipProvider>
      <QueryProbe />
      <Profiler
        id="chat"
        onRender={() => {
          commits.count += 1;
        }}
      >
        <ChatSurface store={store} mode="panel" />
      </Profiler>
    </TooltipProvider>
  );
  // `initialize()` and `aiStore.initialize()` are promises, not timers; this lets both settle.
  await act(async () => undefined);

  expect(store.getState().messages).toHaveLength(50);
  return { store, view };
}

/** Observes every message element except the last, which is the streaming one. */
function watchPriorMessages(container: HTMLElement): { mutations: () => number; stop: () => void } {
  const messages = [...container.querySelectorAll('[data-testid="chat-message"]')];
  const prior = messages.slice(0, -1);
  expect(prior.length).toBeGreaterThan(50); // 50 seeded + the user message just sent

  let count = 0;
  const observer = new MutationObserver(records => {
    count += records.length;
  });
  for (const element of prior) {
    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
  }
  return {
    mutations: () => {
      // Pending records are delivered as a microtask; take them synchronously instead.
      count += observer.takeRecords().length;
      return count;
    },
    stop: () => observer.disconnect(),
  };
}

describe('a streamed token', () => {
  it('re-renders neither a finished message nor the query surface, over 300 chunks', async () => {
    const { store, view } = await mountWithTranscript();

    await act(async () => {
      await store.getState().sendMessage('and one more thing');
    });
    expect(store.getState().streaming).toBe(true);

    const watcher = watchPriorMessages(view.container);
    teardowns.push(watcher.stop);
    const bodiesBefore = markdownRenders.get('chat-message-body') ?? 0;
    const probeBefore = queryProbeRenders.count;
    const commitsBefore = commits.count;
    expect(bodiesBefore).toBe(25); // the 25 assistant messages, rendered once each

    // 300 chunks at one every 10ms — a 100-token/second stream for three seconds. Each in its own
    // `act`, because React coalesces everything inside one synchronous block and a single wrapping
    // `act` would report one render however the code behaved.
    for (let index = 0; index < 300; index += 1) {
      act(() => {
        double.emit({ conversationId: CONVERSATION_ID, delta: `token${index} `, done: false });
        vi.advanceTimersByTime(10);
      });
    }

    const tailRenders = markdownRenders.get('chat-stream-tail') ?? 0;

    // 1. The tail advanced — otherwise everything below is vacuous.
    expect(tailRenders).toBeGreaterThan(10);
    // 2. …but once per ~50ms boundary, not once per chunk. 3,000ms / 50ms ≈ 60, with a frame's slack.
    expect(tailRenders).toBeLessThanOrEqual(75);
    // 3. Zero: no finished message re-rendered its markdown.
    expect(markdownRenders.get('chat-message-body')).toBe(bodiesBefore);
    // 4. Zero: nothing under a prior message's element changed at all — including the user bubbles,
    //    which hold no markdown and so are invisible to (3).
    expect(watcher.mutations()).toBe(0);
    // 5. Zero: no chunk reached the tab or execution stores.
    expect(queryProbeRenders.count).toBe(probeBefore);
    // 6. The surface itself committed once per boundary, not once per chunk — 300 chunks in, ~60
    //    commits out. This is the assertion that fails if the coalescer is bypassed.
    const surfaceCommits = commits.count - commitsBefore;
    expect(surfaceCommits).toBeGreaterThan(10);
    expect(surfaceCommits).toBeLessThanOrEqual(75);
  });

  it('renders the finished message exactly once when the stream completes — the memo is not a freeze', async () => {
    const { store, view } = await mountWithTranscript();
    await act(async () => {
      await store.getState().sendMessage('summarise it');
    });

    act(() => {
      double.emit({ conversationId: CONVERSATION_ID, delta: 'All **done**.', done: false });
      vi.advanceTimersByTime(BOUNDARY_MS);
    });
    const bodiesMidStream = markdownRenders.get('chat-message-body') ?? 0;

    act(() => {
      double.emit({ conversationId: CONVERSATION_ID, done: true });
      vi.advanceTimersByTime(BOUNDARY_MS);
    });

    // The 26th assistant body: the message that was streaming has become a completed one.
    expect(markdownRenders.get('chat-message-body')).toBe(bodiesMidStream + 1);
    expect(store.getState().messages.at(-1)?.content).toBe('All **done**.');
    expect(store.getState().streaming).toBe(false);
    // And the tail is gone rather than showing the same text a second time.
    expect(view.queryByTestId('chat-stream-tail')).toBeNull();
  });
});
