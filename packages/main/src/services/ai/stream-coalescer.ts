/**
 * Coalesces per-token chat stream deltas into interval-batched IPC messages.
 *
 * A fast model emits hundreds of SSE deltas per second; forwarding each one
 * as its own webContents.send wakes the renderer (and triggers change
 * detection) per token. Buffering pure text deltas and flushing on a short
 * interval collapses that to ~25 messages/second, losslessly. Control chunks
 * (done, toolCall, toolResult, uiAction, error) are never delayed: any
 * pending text for that conversation is flushed first so ordering holds.
 */

import type { ChatStreamChunk } from '@mj-forge/shared';

/** Force a flush once a buffer grows past this, interval notwithstanding. */
const MAX_BUFFERED_CHARS = 64 * 1024;

export interface StreamCoalescer {
  push(chunk: ChatStreamChunk): void;
  /** Flush all pending buffers and stop all timers. */
  dispose(): void;
}

interface PendingBuffer {
  text: string;
  timer: NodeJS.Timeout;
}

function isPureDelta(chunk: ChatStreamChunk): boolean {
  return (
    typeof chunk.delta === 'string' &&
    !chunk.done &&
    chunk.toolCall === undefined &&
    chunk.toolResult === undefined &&
    chunk.uiAction === undefined &&
    chunk.messageId === undefined
  );
}

export function createStreamCoalescer(
  send: (chunk: ChatStreamChunk) => void,
  intervalMs = 40
): StreamCoalescer {
  if (intervalMs <= 0) {
    throw new Error(`createStreamCoalescer: intervalMs must be > 0, got ${intervalMs}`);
  }

  const pending = new Map<string, PendingBuffer>();

  const flush = (conversationId: string) => {
    const buffer = pending.get(conversationId);
    if (!buffer) {
      return;
    }
    clearTimeout(buffer.timer);
    pending.delete(conversationId);
    send({ conversationId, delta: buffer.text, done: false });
  };

  return {
    push(chunk: ChatStreamChunk): void {
      if (!isPureDelta(chunk)) {
        flush(chunk.conversationId);
        send(chunk);
        return;
      }

      const existing = pending.get(chunk.conversationId);
      if (existing) {
        existing.text += chunk.delta as string;
      } else {
        pending.set(chunk.conversationId, {
          text: chunk.delta as string,
          timer: setTimeout(() => flush(chunk.conversationId), intervalMs),
        });
      }

      if ((pending.get(chunk.conversationId)?.text.length ?? 0) >= MAX_BUFFERED_CHARS) {
        flush(chunk.conversationId);
      }
    },

    dispose(): void {
      for (const conversationId of [...pending.keys()]) {
        flush(conversationId);
      }
    },
  };
}
