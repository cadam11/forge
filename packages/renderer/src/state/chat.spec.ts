/**
 * Instance isolation for the merged chat store.
 *
 * `chat.state.ts` and `chat-instance.state.ts` collapsed into one factory (see the header of
 * `chat.ts`), which makes "two chat tabs do not write each other's transcript" a property of one
 * shared code path rather than of two copies that happen to agree. One bridge subscription per
 * instance receives EVERY conversation's chunks, so the per-instance `conversationId` filter is the
 * only thing keeping them apart — that filter is what this asserts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatStreamChunk } from '@joinery/shared';
import { installJoineryMock, recordSubscription, removeJoineryMock } from '../test/joinery-mock';
import { createCapabilitiesStore } from './capabilities';
import { createChatStore, type ChatStore } from './chat';
import { createConnectionStore } from './connection';
import { createExplorerStore } from './explorer';
import { createTabStore } from './tab';

const teardowns: (() => void)[] = [];

/** Two instances sharing one recorded `chat.onStreamChunk`, as the real bridge does. */
function makeTwoInstances(): {
  first: ChatStore;
  second: ChatStore;
  emit: (chunk: ChatStreamChunk) => void;
} {
  const streamChunks = recordSubscription<ChatStreamChunk>();
  teardowns.push(
    installJoineryMock({
      chat: {
        onStreamChunk: streamChunks.subscribe,
        // `cancelStream` is a fire-and-forget call the store makes before it finalizes the partial
        // answer locally; without it here the cancel path cannot be driven at all.
        cancelStream: () => Promise.resolve(),
      },
    })
  );

  const capabilities = createCapabilitiesStore();
  const tab = createTabStore();
  const explorer = createExplorerStore({ capabilities });
  const connection = createConnectionStore({ tab, explorer, capabilities });
  teardowns.push(() => connection.getState().destroy());

  const deps = { connection, tab, capabilities };
  const first = createChatStore(deps, { initialConversationId: 'conv-1' });
  const second = createChatStore(deps, { initialConversationId: 'conv-2' });
  teardowns.push(() => first.getState().destroy());
  teardowns.push(() => second.getState().destroy());

  // Both instances subscribed, and each subscription is its own listener identity.
  expect(streamChunks.liveCount()).toBe(2);

  return { first, second, emit: streamChunks.emit };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
});

describe('chat store — per-instance isolation', () => {
  it('a chunk for one conversation leaves the other instance untouched', () => {
    const { first, second, emit } = makeTwoInstances();

    // The placeholder assistant message a send would have created, so the tool/done paths have
    // something to patch.
    const placeholder = {
      id: 'msg-1',
      role: 'assistant' as const,
      content: '',
      timestamp: '2026-08-15T00:00:00.000Z',
      streaming: true,
      toolCalls: [],
    };
    first.setState({ messages: [placeholder], streaming: true });
    second.setState({ messages: [{ ...placeholder, id: 'msg-2' }], streaming: true });

    emit({ conversationId: 'conv-1', delta: 'hello ', done: false });
    emit({
      conversationId: 'conv-1',
      toolCall: { id: 'tool-1', toolName: 'run_query', args: {} },
      done: false,
    });
    emit({ conversationId: 'conv-1', delta: 'world', done: true });

    // First instance took all of it.
    expect(first.getState().messages[0]?.content).toBe('hello world');
    expect(first.getState().messages[0]?.toolCalls).toHaveLength(1);
    expect(first.getState().streaming).toBe(false);
    expect(first.getState().streamingContent).toBe('');

    // Second instance saw the same three chunks on its own subscription and ignored every one.
    expect(second.getState().messages[0]?.content).toBe('');
    expect(second.getState().messages[0]?.toolCalls).toHaveLength(0);
    expect(second.getState().streaming).toBe(true);
    expect(second.getState().streamingContent).toBe('');
  });

  it('finalizes the half-answer when the stream is cancelled, and marks the truncation', () => {
    const { first } = makeTwoInstances();
    first.setState({
      messages: [
        {
          id: 'msg-1',
          role: 'assistant',
          content: '',
          timestamp: '2026-08-15T00:00:00.000Z',
          streaming: true,
          toolCalls: [],
        },
      ],
      streaming: true,
      streamingContent: 'The plan says a sequential scan, which',
    });

    first.getState().cancelStream();

    // The main process emits nothing when a stream is aborted, so this is the only place the partial
    // answer can reach the transcript. A message left `streaming: true` is an eternal typing indicator.
    const message = first.getState().messages[0];
    expect(message?.streaming).toBe(false);
    expect(message?.content).toContain('sequential scan');
    expect(message?.content).toContain('stopped');
    expect(first.getState().streaming).toBe(false);
    expect(first.getState().streamingContent).toBe('');

    // Idempotent: a second Stop (or a late `done`) cannot add a second marker.
    const finalized = message?.content;
    first.getState().cancelStream();
    expect(first.getState().messages[0]?.content).toBe(finalized);
  });

  it('patches a tool result into the message that holds the call, not the last one', () => {
    const { first, emit } = makeTwoInstances();
    first.setState({
      messages: [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Working on it.',
          timestamp: '2026-08-15T00:00:00.000Z',
          toolCalls: [
            {
              id: 'tool-1',
              toolName: 'execute_ddl',
              args: {},
              success: false,
              pendingConfirmation: true,
            },
          ],
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Something later.',
          timestamp: '2026-08-15T00:01:00.000Z',
          toolCalls: [],
        },
      ],
    });

    // A confirmed tool's result arrives AFTER `done: true`, so the card it belongs to is no longer in
    // the trailing message whenever anything else has been said since.
    emit({
      conversationId: 'conv-1',
      toolResult: { id: 'tool-1', toolName: 'execute_ddl', args: {}, success: true, durationMs: 4 },
      done: false,
    });

    expect(first.getState().messages[0]?.toolCalls?.[0]?.success).toBe(true);
    expect(first.getState().messages[0]?.toolCalls?.[0]?.pendingConfirmation).toBeUndefined();
    expect(first.getState().messages[1]?.toolCalls).toHaveLength(0);
  });

  it('destroying one instance leaves the other listening', () => {
    const { first, second, emit } = makeTwoInstances();

    first.getState().destroy();
    emit({ conversationId: 'conv-2', delta: 'still here', done: false });

    expect(second.getState().streamingContent).toBe('still here');
    expect(first.getState().streamingContent).toBe('');
  });
});
