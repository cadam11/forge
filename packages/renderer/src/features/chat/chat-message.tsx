/**
 * One message, and the R3 memo boundary.
 *
 * ── What must not happen, stated as the shape of this file ─────────────────────────────────
 *
 * A streamed token must not re-render a message the model finished five minutes ago. Two
 * mechanisms, and they only work together:
 *
 *  1. **`ChatMessageView` is memoised**, and every prop it takes is stable for the lifetime of a
 *     completed message: the `ChatMessage` object itself (the store's `patchLastAssistantMessage`
 *     rebuilds only the LAST element, so earlier ones keep their identity), a `Map` of tool
 *     definitions memoised by the surface, and two `useCallback`s. Nothing is built in a render body
 *     and handed down.
 *  2. **The in-flight text never arrives as a prop.** `<StreamingTail>` subscribes to the store
 *     itself through `useStreamTail`, so a token re-renders that component and nothing above it. Had
 *     the tail been a prop, every chunk would have re-rendered the list — and with it all 50 prior
 *     `<Markdown>` bodies, each one a `marked` + highlight.js + DOMPurify pass.
 *
 * `features/chat/stream-render-isolation.spec.tsx` counts the renders; the browser half is
 * `.superpowers/sdd/PLAN/task-17-perf.mjs`, which counts DOM mutations in the shipped bundle.
 *
 * ── Mermaid and code-copy are off while streaming ──────────────────────────────────────────
 *
 * Ported from Angular (`chat-panel.component.ts:241-259`) and worth keeping for a reason that is not
 * only cost: a fence is UNTERMINATED for as long as it is being typed, so a mermaid pass over the
 * tail would try to render half a diagram twenty times a second, and a copy button would appear on
 * code that is not finished being written. Both switch on when the message completes.
 */

import { memo, useEffect } from 'react';
import type { ChatMessage, ToolDefinition } from '@joinery/shared';

import { Markdown, type MermaidTheme } from '../../markdown';
import type { ChatStore } from '../../state/chat';
import { cn } from '../../ui';
import { ToolCallCard } from './tool-call-card';
import { useStreamTail } from './use-stream-tail';

/**
 * The app's two themes as mermaid names them. `default` rather than `neutral` for ivory: neutral is
 * mermaid's greyscale theme, and the ivory canvas is warm rather than grey.
 */
export function mermaidThemeFor(theme: 'dark' | 'light'): MermaidTheme {
  return theme === 'dark' ? 'dark' : 'default';
}

/** The three-dot "still writing" indicator. Pure CSS; no timers, nothing to clean up. */
function TypingIndicator() {
  return (
    <p data-testid="chat-typing" className="flex items-center gap-1" aria-label="Still writing">
      {[0, 1, 2].map(dot => (
        <span
          key={dot}
          // A staggered pulse: the same animation, offset by a third of its period each. Arbitrary
          // properties rather than inline styles, per `general.md`.
          className={cn(
            'size-1 rounded-full bg-fg-subtle motion-safe:animate-pulse',
            dot === 1 && '[animation-delay:200ms]',
            dot === 2 && '[animation-delay:400ms]'
          )}
        />
      ))}
    </p>
  );
}

/**
 * The in-flight text, re-parsed at most once per flush boundary.
 *
 * Renders nothing until the first token lands, which is what keeps an empty bubble off the screen
 * between "send" and the model's first byte — the typing indicator is the affordance for that gap.
 */
function StreamingTail({
  store,
  onFlush,
}: {
  readonly store: ChatStore;
  readonly onFlush: () => void;
}) {
  const text = useStreamTail(store);

  // The scroll follow-up belongs to whoever owns the viewport, and it has to happen after this
  // component has committed the new text — hence a callback from here rather than a second
  // subscription in the list, which would mean two 50ms boundaries drifting against each other.
  // `onFlush` is a stable useCallback and the trigger is the text; including it would re-scroll
  // whenever the surface re-rendered for an unrelated reason.
  useEffect(() => {
    onFlush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  if (text === '') return null;
  return (
    <Markdown
      data={text}
      data-testid="chat-stream-tail"
      className="text-md text-fg"
      enableMermaid={false}
      enableCodeCopy={false}
    />
  );
}

export interface ChatMessageViewProps {
  readonly message: ChatMessage;
  /** Tool name → its catalogue entry. Memoised by the surface, so this identity is stable. */
  readonly definitions: ReadonlyMap<string, ToolDefinition>;
  /** Only read while `message.streaming` is true. */
  readonly store: ChatStore;
  readonly mermaidTheme: MermaidTheme;
  readonly onConfirmTool: (toolCallId: string, confirmed: boolean) => void;
  readonly onTailFlush: () => void;
}

export const ChatMessageView = memo(function ChatMessageView({
  message,
  definitions,
  store,
  mermaidTheme,
  onConfirmTool,
  onTailFlush,
}: ChatMessageViewProps) {
  const isUser = message.role === 'user';

  return (
    <div
      data-testid="chat-message"
      data-role={message.role}
      className={cn('flex min-w-0 flex-col gap-2', isUser && 'items-end')}
    >
      {isUser ? (
        // A well, not a card: `surfaces.md` prefers a surface step to a container, and the step is
        // what says "you said this". Assistant prose sits directly on the canvas.
        <p className="max-w-[90%] min-w-0 rounded-sm bg-surface px-2 py-1.5 text-md text-fg whitespace-pre-wrap">
          {message.content}
        </p>
      ) : (
        <>
          {(message.toolCalls ?? []).map(toolCall => (
            <ToolCallCard
              key={toolCall.id}
              toolCall={toolCall}
              definition={definitions.get(toolCall.toolName)}
              onConfirm={onConfirmTool}
            />
          ))}

          {message.streaming === true ? (
            <>
              <StreamingTail store={store} onFlush={onTailFlush} />
              <TypingIndicator />
            </>
          ) : message.content === '' ? null : (
            <Markdown
              data={message.content}
              data-testid="chat-message-body"
              className="text-md text-fg"
              enableMermaid
              enableCodeCopy
              mermaidTheme={mermaidTheme}
            />
          )}
        </>
      )}
    </div>
  );
});
