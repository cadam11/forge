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
  teardowns.push(installJoineryMock({ chat: { onStreamChunk: streamChunks.subscribe } }));

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

  it('destroying one instance leaves the other listening', () => {
    const { first, second, emit } = makeTwoInstances();

    first.getState().destroy();
    emit({ conversationId: 'conv-2', delta: 'still here', done: false });

    expect(second.getState().streamingContent).toBe('still here');
    expect(first.getState().streamingContent).toBe('');
  });
});
