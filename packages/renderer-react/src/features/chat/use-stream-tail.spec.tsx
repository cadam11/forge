/**
 * R3, the mechanism: what the coalescer does with a token stream, measured with fake timers.
 *
 * The claims under test are the four the plan's mitigation is made of — a ref until the boundary, one
 * flush per ~50ms whatever the token rate, an immediate flush when the stream ends, and nothing left
 * running after unmount. The *scale* claims (3,000 chunks → ~600 DOM updates, prior messages
 * untouched) are `stream-render-isolation.spec.tsx` and the browser benchmark.
 *
 * `toFake` is spelled out rather than left to the default: this hook is a `setTimeout` **and** a
 * `requestAnimationFrame`, and a default that stopped faking one of them would make every assertion
 * below either flaky or vacuous. Sinon's fake rAF runs on a 16ms tick, which is why a boundary is
 * driven with 70ms rather than exactly 50.
 */

import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installChatDouble, makeChatStore, type ChatDouble } from '../../test/chat-double';
import type { ChatStore } from '../../state/chat';
import { STREAM_FLUSH_MS, useStreamTail } from './use-stream-tail';

/** Enough to cross the 50ms window and let sinon's 16ms animation frame fire inside it. */
const BOUNDARY_MS = STREAM_FLUSH_MS + 20;

const teardowns: (() => void)[] = [];
let double: ChatDouble;

/** Every value the hook has returned, in order. Its length IS the render count. */
const rendered: string[] = [];

function Probe({ store }: { readonly store: ChatStore }) {
  const text = useStreamTail(store);
  rendered.push(text);
  return <span data-testid="tail">{text}</span>;
}

/** One token, exactly as `applyChunk` would append it. */
function token(store: ChatStore, text: string): void {
  store.setState(state => ({ streamingContent: state.streamingContent + text }));
}

beforeEach(() => {
  rendered.length = 0;
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  double = installChatDouble();
  teardowns.push(double.teardown);
});

afterEach(() => {
  vi.useRealTimers();
  while (teardowns.length > 0) teardowns.pop()?.();
});

describe('useStreamTail', () => {
  it('holds a hundred tokens in a ref and renders once at the boundary', () => {
    const store = makeChatStore();
    teardowns.push(() => store.getState().destroy());
    const { getByTestId } = render(<Probe store={store} />);
    const before = rendered.length;

    act(() => {
      for (let index = 0; index < 100; index += 1) token(store, 'x');
    });

    // The store has all hundred; React has none of them. This is the assertion the whole hook exists
    // for — the alternative implementation (a store subscription with a selector) fails here with 100.
    expect(store.getState().streamingContent).toHaveLength(100);
    expect(rendered).toHaveLength(before);
    expect(getByTestId('tail').textContent).toBe('');

    act(() => vi.advanceTimersByTime(BOUNDARY_MS));

    expect(rendered).toHaveLength(before + 1);
    expect(getByTestId('tail').textContent).toBe('x'.repeat(100));
  });

  it('does not flush before the window has elapsed', () => {
    const store = makeChatStore();
    teardowns.push(() => store.getState().destroy());
    render(<Probe store={store} />);
    const before = rendered.length;

    act(() => token(store, 'early'));
    act(() => vi.advanceTimersByTime(STREAM_FLUSH_MS - 1));

    expect(rendered).toHaveLength(before);
  });

  it('renders once per window at a hundred tokens a second, not once per token', () => {
    const store = makeChatStore();
    teardowns.push(() => store.getState().destroy());
    render(<Probe store={store} />);
    const before = rendered.length;

    // Ten windows' worth: a token every 10ms for 500ms. 50 tokens.
    //
    // One `act` per token, not one around the loop: React coalesces every update made inside a single
    // synchronous block, so wrapping the whole loop would report ONE render no matter what the hook
    // did — a green test that proved nothing. Each token is its own task here, as it is in the app.
    for (let index = 0; index < 50; index += 1) {
      act(() => {
        token(store, 'y');
        vi.advanceTimersByTime(10);
      });
    }

    const flushes = rendered.length - before;
    // 500ms of stream at one flush per 50ms — the animation-frame tick can put a flush either side of
    // a window edge, so the bound is a range rather than an equality. The point is 50 → ~10, not ~50.
    expect(flushes).toBeGreaterThanOrEqual(6);
    expect(flushes).toBeLessThanOrEqual(12);
  });

  it('flushes immediately when the stream ends, without waiting out the window', () => {
    const store = makeChatStore();
    teardowns.push(() => store.getState().destroy());
    render(<Probe store={store} />);

    act(() => token(store, 'done text'));
    act(() => vi.advanceTimersByTime(BOUNDARY_MS));
    const before = rendered.length;

    // What the store does on a `done` chunk: the finished text moves into `messages` and the buffer is
    // cleared. A 50ms-late flush of the old tail would paint the same text twice.
    act(() => store.setState({ streamingContent: '', streaming: false }));

    expect(rendered).toHaveLength(before + 1);
    expect(rendered.at(-1)).toBe('');
  });

  it('a pending flush cannot land after the clear', () => {
    const store = makeChatStore();
    teardowns.push(() => store.getState().destroy());
    render(<Probe store={store} />);

    act(() => token(store, 'mid'));
    // Cleared while a boundary is still pending — the pending one must be cancelled, not queued.
    act(() => store.setState({ streamingContent: '' }));
    const after = rendered.length;
    act(() => vi.advanceTimersByTime(BOUNDARY_MS * 2));

    expect(rendered).toHaveLength(after);
    expect(rendered.at(-1)).toBe('');
  });

  it('stops on unmount: a chunk after teardown reaches nothing', () => {
    const store = makeChatStore();
    teardowns.push(() => store.getState().destroy());
    const { unmount } = render(<Probe store={store} />);

    act(() => token(store, 'before'));
    unmount();
    const after = rendered.length;

    act(() => {
      token(store, 'after');
      vi.advanceTimersByTime(BOUNDARY_MS * 2);
    });

    // No render, and — the reason the cleanup cancels the timer as well as unsubscribing — no
    // setState-after-unmount from the boundary that was already scheduled.
    expect(rendered).toHaveLength(after);
  });

  it('adopts text that arrived before it mounted', () => {
    // A surface mounted mid-stream: the panel re-opened, or a chat tab re-activated by Dockview.
    const store = makeChatStore();
    teardowns.push(() => store.getState().destroy());
    store.setState({ streamingContent: 'already streaming', streaming: true });

    render(<Probe store={store} />);
    expect(rendered.at(-1)).toBe('');

    act(() => vi.advanceTimersByTime(BOUNDARY_MS));
    expect(rendered.at(-1)).toBe('already streaming');
  });

  it('follows a store swapped under it, and stops following the old one', () => {
    const first = makeChatStore();
    const second = makeChatStore();
    teardowns.push(() => first.getState().destroy());
    teardowns.push(() => second.getState().destroy());

    const { rerender } = render(<Probe store={first} />);
    act(() => token(first, 'from first'));
    act(() => vi.advanceTimersByTime(BOUNDARY_MS));
    expect(rendered.at(-1)).toBe('from first');

    rerender(<Probe store={second} />);
    act(() => token(second, 'from second'));
    act(() => vi.advanceTimersByTime(BOUNDARY_MS));
    expect(rendered.at(-1)).toBe('from second');

    const after = rendered.length;
    act(() => {
      token(first, ' more');
      vi.advanceTimersByTime(BOUNDARY_MS);
    });
    expect(rendered).toHaveLength(after);
  });
});
