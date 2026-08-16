/**
 * The scrolling transcript: the messages, the two empty states, and the scroll behaviour.
 *
 * ── Scroll follow, and why it is not `scrollIntoView` on every chunk ───────────────────────
 *
 * Angular did this in `ngAfterViewChecked` — every change-detection pass, while streaming, wrote
 * `scrollTop = scrollHeight` (`:1383-1389`). Here the write happens on exactly two triggers: a new
 * or changed message, and a tail flush (≤20/second, from `<StreamingTail>`'s own commit). Both are
 * conditional on the viewport being **pinned**, which is what stops the app from yanking a user who
 * has scrolled up to re-read something back to the bottom mid-sentence.
 *
 * `pinned` is a ref rather than state: it changes on every scroll event and nothing renders it. The
 * "Jump to latest" button IS rendered, so that one is state — it changes when the user scrolls away
 * and back, not per chunk.
 *
 * ── The two empty states are different claims ──────────────────────────────────────────────
 *
 * "No provider configured" is a statement about this build (there is no AI settings surface in the
 * React renderer yet — J-55, Task 19), and it is the honest one: the same gate the main process uses
 * before it looks for an API key (`chat-service.ts:selectVendorAndModel` — enabled vendors with a
 * configured key, which is why it does NOT consult the global `settings.enabled` flag that gates the
 * three one-shot AI features). "Ask about your database" is the ordinary empty conversation.
 *
 * Neither is a spinner: nothing is loading, and a spinner in front of an unconfigurable feature is
 * how a user waits forever.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, Sparkles } from 'lucide-react';
import type { ChatMessage, ToolDefinition } from '@joinery/shared';

import type { MermaidTheme } from '../../markdown';
import type { ChatStore } from '../../state/chat';
import { Button, EmptyState, Icon, Tooltip, cn } from '../../ui';
import { ChatMessageView } from './chat-message';

/** How close to the bottom still counts as "pinned". The Angular threshold (`:1394`). */
const PINNED_SLACK_PX = 40;

/**
 * The four openers, ported unchanged (`:1223-1228`). Deliberately not database-specific: they have
 * to be sendable before the model has seen anything, and every one of them is a read.
 */
export const CHAT_SUGGESTIONS: readonly string[] = [
  'Show me all tables',
  'Describe the schema',
  'List stored procedures',
  'Count rows in each table',
];

export interface ChatTranscriptProps {
  readonly store: ChatStore;
  readonly messages: readonly ChatMessage[];
  /** Tool name → catalogue entry. Memoised by the surface; see `chat-message.tsx`. */
  readonly definitions: ReadonlyMap<string, ToolDefinition>;
  readonly mermaidTheme: MermaidTheme;
  /** False when no vendor has an API key, which is the no-provider empty state. */
  readonly providerConfigured: boolean;
  readonly onSend: (text: string) => void;
}

function NoProviderState() {
  return (
    <div data-testid="chat-no-provider" className="flex flex-col items-center gap-2">
      <EmptyState
        size="sm"
        icon={Sparkles}
        title="No AI provider configured"
        description="Chat needs a vendor with an API key. This build has no AI settings surface yet (J-55), so it cannot add one — a key configured in an earlier Joinery build still works, because the main process is what holds it."
      />
    </div>
  );
}

function OpeningState({ onSend }: { readonly onSend: (text: string) => void }) {
  return (
    <div data-testid="chat-empty" className="flex flex-col items-center gap-3">
      <EmptyState
        size="sm"
        icon={Sparkles}
        title="Ask about your database"
        description="The assistant reads schema, runs queries and explains results. Anything that writes is confirmed with you first."
      />
      {/* Beside the empty state rather than inside it: `EmptyState` takes at most one action, and its
          own header says a list of suggestions is a panel rather than an empty state. */}
      <div className="flex flex-wrap justify-center gap-1.5">
        {CHAT_SUGGESTIONS.map(suggestion => (
          <Button
            key={suggestion}
            size="sm"
            variant="outline"
            data-testid="chat-suggestion"
            onClick={() => onSend(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function ChatTranscript({
  store,
  messages,
  definitions,
  mermaidTheme,
  providerConfigured,
  onSend,
}: ChatTranscriptProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  /** Whether the viewport is at the bottom. See the header for why this is not state. */
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToEnd = useCallback((): void => {
    const element = scroller.current;
    if (element === null) return;
    element.scrollTop = element.scrollHeight;
    pinned.current = true;
    setShowJump(false);
  }, []);

  /** Called by `<StreamingTail>` after each flush, and by the effect below for a new message. */
  const followIfPinned = useCallback((): void => {
    if (!pinned.current) return;
    const element = scroller.current;
    if (element === null) return;
    element.scrollTop = element.scrollHeight;
  }, []);

  const onScroll = useCallback((): void => {
    const element = scroller.current;
    if (element === null) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    pinned.current = distance < PINNED_SLACK_PX;
    setShowJump(!pinned.current);
  }, []);

  // A new message — or a tool card appearing inside one — grows the document; follow it.
  useEffect(followIfPinned, [messages, followIfPinned]);

  const confirmTool = useCallback(
    (toolCallId: string, confirmed: boolean): void => {
      void store.getState().confirmToolCall(toolCallId, confirmed);
    },
    [store]
  );

  let body: ReactNode;
  if (!providerConfigured) body = <NoProviderState />;
  else if (messages.length === 0) body = <OpeningState onSend={onSend} />;
  else {
    body = messages.map(message => (
      <ChatMessageView
        key={message.id}
        message={message}
        definitions={definitions}
        store={store}
        mermaidTheme={mermaidTheme}
        onConfirmTool={confirmTool}
        onTailFlush={followIfPinned}
      />
    ));
  }

  return (
    <div className="relative flex min-h-0 min-w-0 grow flex-col">
      <div
        ref={scroller}
        onScroll={onScroll}
        data-testid="chat-transcript"
        aria-label="Conversation"
        className={cn(
          'flex min-h-0 min-w-0 grow flex-col gap-3 overflow-y-auto p-3',
          // An empty state is centred in the pane; a transcript starts at the top.
          messages.length === 0 || !providerConfigured ? 'justify-center' : null
        )}
      >
        {body}
      </div>

      {showJump ? (
        <Tooltip content="Jump to the latest message">
          <button
            type="button"
            aria-label="Jump to the latest message"
            data-testid="chat-jump-latest"
            onClick={scrollToEnd}
            className={cn(
              'absolute right-3 bottom-2 flex size-6 items-center justify-center',
              'rounded-full border border-rule-strong bg-elevated text-fg-muted',
              'hover:bg-hover hover:text-fg',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus'
            )}
          >
            <Icon icon={ArrowDown} size="sm" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}
