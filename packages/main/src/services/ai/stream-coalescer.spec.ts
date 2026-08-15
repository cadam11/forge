import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatStreamChunk } from '@forgedb/shared';
import { createStreamCoalescer } from './stream-coalescer';

describe('createStreamCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const delta = (conversationId: string, text: string): ChatStreamChunk => ({
    conversationId,
    delta: text,
    done: false,
  });

  it('coalesces rapid deltas into one message per interval, losslessly', () => {
    const sent: ChatStreamChunk[] = [];
    const c = createStreamCoalescer(chunk => sent.push(chunk), 40);

    for (const piece of ['Hel', 'lo', ' ', 'wor', 'ld']) {
      c.push(delta('conv-1', piece));
    }
    expect(sent).toHaveLength(0);

    vi.advanceTimersByTime(40);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ conversationId: 'conv-1', delta: 'Hello world', done: false });
  });

  it('emits one message per interval across a long stream', () => {
    const sent: ChatStreamChunk[] = [];
    const c = createStreamCoalescer(chunk => sent.push(chunk), 40);

    for (let tick = 0; tick < 4; tick++) {
      for (let i = 0; i < 25; i++) {
        c.push(delta('conv-1', 'x'));
      }
      vi.advanceTimersByTime(40);
    }

    expect(sent).toHaveLength(4);
    expect(sent.map(s => s.delta).join('')).toBe('x'.repeat(100));
  });

  it('flushes pending deltas before a control chunk, preserving order', () => {
    const sent: ChatStreamChunk[] = [];
    const c = createStreamCoalescer(chunk => sent.push(chunk), 40);

    c.push(delta('conv-1', 'partial'));
    const control: ChatStreamChunk = {
      conversationId: 'conv-1',
      toolCall: { id: 't1', toolName: 'run_query', args: {} },
      done: false,
    };
    c.push(control);

    expect(sent).toHaveLength(2);
    expect(sent[0].delta).toBe('partial');
    expect(sent[1]).toBe(control);
  });

  it('flushes immediately on done', () => {
    const sent: ChatStreamChunk[] = [];
    const c = createStreamCoalescer(chunk => sent.push(chunk), 40);

    c.push(delta('conv-1', 'tail'));
    c.push({ conversationId: 'conv-1', done: true });

    expect(sent).toHaveLength(2);
    expect(sent[0].delta).toBe('tail');
    expect(sent[1].done).toBe(true);
  });

  it('keeps conversations separate', () => {
    const sent: ChatStreamChunk[] = [];
    const c = createStreamCoalescer(chunk => sent.push(chunk), 40);

    c.push(delta('conv-1', 'aaa'));
    c.push(delta('conv-2', 'bbb'));
    vi.advanceTimersByTime(40);

    expect(sent).toHaveLength(2);
    const byConv = Object.fromEntries(sent.map(s => [s.conversationId, s.delta]));
    expect(byConv).toEqual({ 'conv-1': 'aaa', 'conv-2': 'bbb' });
  });

  it('force-flushes when a buffer exceeds the size bound', () => {
    const sent: ChatStreamChunk[] = [];
    const c = createStreamCoalescer(chunk => sent.push(chunk), 40);

    c.push(delta('conv-1', 'y'.repeat(70_000)));
    expect(sent).toHaveLength(1);
    expect(sent[0].delta).toHaveLength(70_000);
  });

  it('dispose() flushes whatever is pending and stops timers', () => {
    const sent: ChatStreamChunk[] = [];
    const c = createStreamCoalescer(chunk => sent.push(chunk), 40);

    c.push(delta('conv-1', 'end'));
    c.dispose();

    expect(sent).toHaveLength(1);
    expect(sent[0].delta).toBe('end');

    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(1);
  });
});
