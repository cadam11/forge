/**
 * R3, the mitigation: **the in-flight assistant text never reaches React state per token.**
 *
 * PLAN.md's risk register (R3) is about this exact hook's absence: `chat.onStreamChunk` fires per
 * token, the store appends to `streamingContent`, and a component subscribed to that field re-renders
 * — markdown → highlight.js → DOMPurify — once per token. Angular's `OnPush` masked part of it
 * because a `ChangeDetectorRef.markForCheck()` coalesced into one change-detection pass per
 * microtask; React has no such thing, so the port has to coalesce deliberately.
 *
 * The plan fixes the mechanism, not just the goal, and this is it:
 *
 *  1. **A ref, not state.** The subscription is `store.subscribe` — the imperative one, which does
 *     not re-render — and every chunk lands in `pending`. Nothing renders between chunks.
 *  2. **A ~50ms boundary, aligned to a frame.** The first chunk after a flush starts a 50ms timer;
 *     when it fires, the actual `setState` happens inside a `requestAnimationFrame` callback. The
 *     timer bounds the *rate* (≤20 flushes/second no matter the token rate) and the frame bounds
 *     *when* in the frame the DOM is touched, so a flush cannot land mid-frame and force a second
 *     layout. While a flush is pending, further chunks only overwrite the ref.
 *  3. **The end of the stream is not delayed.** `streamingContent` going empty means the store has
 *     just written the finished text into `messages` — the completed message is rendering from that
 *     on the same commit, so a 50ms-late flush of the old tail would paint the text twice, then snap.
 *     An empty buffer therefore flushes synchronously and cancels the pending boundary.
 *
 * What this hook deliberately does NOT do is decide how the tail is rendered. `<StreamingTail>` owns
 * that (mermaid and code-copy off while streaming, on once complete), and the measured cost of
 * re-parsing the tail per flush is in `.superpowers/sdd/PLAN/task-17-perf.mjs` and
 * `plans/perf-baselines.md`.
 */

import { useEffect, useRef, useState } from 'react';

import type { ChatStore } from '../../state/chat';

/**
 * The coalescing window. PLAN.md R3 says "~50ms"; at 20 flushes/second a streamed answer still reads
 * as typing, and the main process is already batching deltas on a 40ms interval of its own
 * (`packages/main/src/services/ai/stream-coalescer.ts`), so this is the second of two stages rather
 * than the only defence. It is exported because the benchmark asserts the flush count against it.
 */
export const STREAM_FLUSH_MS = 50;

/**
 * The in-flight assistant text, at most one update per {@link STREAM_FLUSH_MS}.
 *
 * Returns `''` when nothing is streaming, which is also what the caller renders nothing for.
 */
export function useStreamTail(store: ChatStore): string {
  /** The newest text the store has. Written per chunk; read only at a flush boundary. */
  const pending = useRef('');
  /** What the last flush handed to React. A ref, so the effect below depends on the store alone. */
  const shown = useRef('');
  const [text, setText] = useState('');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let frame: number | null = null;

    const cancel = (): void => {
      if (timer !== null) clearTimeout(timer);
      if (frame !== null) cancelAnimationFrame(frame);
      timer = null;
      frame = null;
    };

    const flush = (): void => {
      timer = null;
      frame = null;
      shown.current = pending.current;
      setText(pending.current);
    };

    const schedule = (): void => {
      if (timer !== null || frame !== null) return;
      timer = setTimeout(() => {
        timer = null;
        frame = requestAnimationFrame(flush);
      }, STREAM_FLUSH_MS);
    };

    // Adopt whatever arrived before this effect ran — a component mounted mid-stream, StrictMode's
    // double mount, or a store swapped under the hook. Scheduled rather than flushed inline: a
    // `setState` in an effect body is a second render pass, and the boundary is what this hook is for.
    pending.current = store.getState().streamingContent;
    if (pending.current !== shown.current) schedule();

    const unsubscribe = store.subscribe(state => {
      if (state.streamingContent === pending.current) return;
      pending.current = state.streamingContent;
      // Point 3 of the header: a cleared buffer means the finished message is already rendering.
      if (pending.current === '') {
        cancel();
        flush();
        return;
      }
      schedule();
    });

    return () => {
      unsubscribe();
      cancel();
    };
  }, [store]);

  return text;
}
