/**
 * The composer: the model picker, the box, and the one button that is Send or Stop.
 *
 * ── The input's text does not live in the surface ──────────────────────────────────────────
 *
 * It is state in THIS component, which is the second half of the R3 arrangement: the surface
 * subscribes to the store's message list, so a keystroke held one level up would re-render the whole
 * transcript per character — the chat equivalent of R2's "10k rows per keystroke". Nothing above the
 * composer needs to know what has been typed; `onSend` is called with it once.
 *
 * ── Send or Stop, never both ───────────────────────────────────────────────────────────────
 *
 * While a stream is open the button cancels it, and the box is disabled — the Angular behaviour
 * (`:321-329`), and it is what makes the tool-confirmation flow legible: a confirmation card is only
 * ever on screen while the stream is still open, so the composer is showing **Stop** (outline) then
 * and "Run it" is the surface's one filled affordance (HOUSE-RULES §5).
 *
 * One deliberate difference from Angular: focus returns to the box when a stream **ends**, not on
 * every `streaming` read. The Angular effect fired on mount too and re-fired on any false read
 * (`:1202-1208`), so a background stream finishing could pull focus out of the SQL editor a user was
 * typing in. Here the transition is what triggers it — plus a focus on mount, which is correct
 * because this surface only mounts when the user opens the panel or the tab.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Square, SendHorizontal } from 'lucide-react';
import type { AIVendor } from '@joinery/shared';

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Icon,
  Textarea,
  Tooltip,
  cn,
} from '../../ui';

/** An explicit model override. `null` means "let the main process choose" (`Auto`). */
export interface SelectedModel {
  readonly vendorId: string;
  readonly modelApiName: string;
  /** The label the picker shows. Held with the selection so the trigger needs no lookup. */
  readonly label: string;
}

export interface ChatComposerProps {
  readonly streaming: boolean;
  /** No provider configured: the box states why instead of sending into a refusal. */
  readonly providerConfigured: boolean;
  readonly vendors: readonly AIVendor[];
  readonly model: SelectedModel | null;
  readonly onModelChange: (model: SelectedModel | null) => void;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
}

function ModelPicker({
  vendors,
  model,
  onModelChange,
}: Pick<ChatComposerProps, 'vendors' | 'model' | 'onModelChange'>) {
  // Nothing to pick from — and the transcript is already saying why. A trigger that opens an empty
  // menu is worse than no trigger.
  if (vendors.length === 0) return null;

  return (
    <DropdownMenu>
      <Tooltip content="The model this message goes to">
        <DropdownMenuTrigger
          data-testid="chat-model-trigger"
          className={cn(
            'flex h-5 shrink-0 items-center gap-1 rounded-xs px-1',
            'font-mono text-2xs tracking-eyebrow text-fg-muted uppercase',
            'hover:bg-hover hover:text-fg',
            'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus'
          )}
        >
          <span data-testid="chat-model-label">{model?.label ?? 'Auto'}</span>
          <Icon icon={ChevronDown} size="sm" className="stroke-fg-muted" />
        </DropdownMenuTrigger>
      </Tooltip>
      {/* Checkbox items, like the status bar's theme menu: the states are mutually exclusive AND the
          current one has to be visible. The cost tier each model carries is deliberately not shown —
          it is a settings-surface fact (Task 19), and a `<kbd>` reading "economy" is not a keystroke. */}
      <DropdownMenuContent align="start" side="top" data-testid="chat-model-menu">
        <DropdownMenuCheckboxItem
          checked={model === null}
          data-testid="chat-model-auto"
          onSelect={() => onModelChange(null)}
        >
          Auto
        </DropdownMenuCheckboxItem>
        {vendors.map(vendor => (
          <DropdownMenuGroup key={vendor.id}>
            <DropdownMenuLabel>{vendor.name}</DropdownMenuLabel>
            {vendor.models.map(candidate => {
              const selected =
                model?.vendorId === vendor.id && model.modelApiName === candidate.apiName;
              return (
                <DropdownMenuCheckboxItem
                  key={candidate.id}
                  checked={selected}
                  data-testid="chat-model-option"
                  onSelect={() =>
                    // Re-selecting the current model goes back to Auto, as the Angular picker did
                    // (`:1484-1495`) — it is the only way back without a separate "clear" row.
                    onModelChange(
                      selected
                        ? null
                        : {
                            vendorId: vendor.id,
                            modelApiName: candidate.apiName,
                            label: candidate.name,
                          }
                    )
                  }
                >
                  {candidate.name}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChatComposer({
  streaming,
  providerConfigured,
  vendors,
  model,
  onModelChange,
  onSend,
  onStop,
}: ChatComposerProps) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement | null>(null);
  const wasStreaming = useRef(false);

  // Mount, and every stream ending. See the header for why the transition — not the value — is the
  // trigger. `focus()` on a detached node (an inactive Dockview panel) is a no-op, not an error.
  useEffect(() => {
    if (streaming) {
      wasStreaming.current = true;
      return;
    }
    if (!wasStreaming.current) {
      box.current?.focus();
      return;
    }
    wasStreaming.current = false;
    box.current?.focus();
  }, [streaming]);

  const send = (): void => {
    const message = text.trim();
    if (message === '') return;
    setText('');
    onSend(message);
  };

  const canSend = providerConfigured && text.trim() !== '';

  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-rule p-2">
      <div className="flex min-w-0 items-center gap-1">
        <ModelPicker vendors={vendors} model={model} onModelChange={onModelChange} />
      </div>

      <div className="flex min-w-0 items-end gap-1.5">
        <Textarea
          ref={box}
          name="chat-message"
          aria-label="Message the assistant"
          data-testid="chat-input"
          rows={1}
          value={text}
          disabled={streaming}
          placeholder={
            providerConfigured ? 'Ask about your database…' : 'Configure an AI provider to chat'
          }
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            // Enter sends; ⇧↩ is a newline. Ported from `onEnter` (`:1414`).
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            send();
          }}
          // `field-sizing-content` grows the box with its content; `max-h-32` caps it at ~8 lines so
          // a pasted query cannot push the transcript off the panel.
          className="min-h-8.5 field-sizing-content max-h-32 resize-none"
        />

        {streaming ? (
          <Tooltip content="Stop the response">
            <Button
              size="sm"
              variant="outline"
              iconOnly
              leadingIcon={Square}
              aria-label="Stop the response"
              data-testid="chat-stop"
              onClick={onStop}
            />
          </Tooltip>
        ) : (
          <Tooltip content="Send (↩)">
            <Button
              size="sm"
              iconOnly
              leadingIcon={SendHorizontal}
              aria-label="Send"
              data-testid="chat-send"
              disabled={!canSend}
              onClick={send}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
}
