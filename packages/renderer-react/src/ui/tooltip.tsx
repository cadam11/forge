/**
 * Radix `Tooltip`, replacing 129 `matTooltip` attributes. The API is deliberately one line
 * at the call site, because that is what 129 of them need:
 *
 *   <Tooltip content="Refresh"><Button iconOnly leadingIcon={RefreshCw} aria-label="Refresh" /></Tooltip>
 *
 * `TooltipProvider` must wrap the app once (Task 7 mounts it in the shell). Radix uses it to
 * share the open-delay timer, which is what stops a toolbar from flashing a tooltip under
 * every button the pointer crosses.
 *
 * A tooltip is never the only place a name lives. An icon-only button carries its own
 * `aria-label`; the tooltip repeats it for sighted users. That matters here because a
 * disabled `<button>` receives no pointer events in any browser, so its tooltip never opens
 * — if the text explains *why* the control is disabled, it belongs somewhere else (a hint
 * under the field, or the empty state).
 */

import type { ComponentPropsWithRef, ReactNode } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';

import { cn } from './cn';
import { TOOLTIP_CONTENT_CLASSES } from './overlay';

/** 400ms: long enough that crossing a toolbar does not trigger anything. */
const DEFAULT_DELAY_MS = 400;

export function TooltipProvider({
  delayDuration = DEFAULT_DELAY_MS,
  children,
}: {
  readonly delayDuration?: number;
  readonly children: ReactNode;
}) {
  return <RadixTooltip.Provider delayDuration={delayDuration}>{children}</RadixTooltip.Provider>;
}

export interface TooltipProps extends Omit<
  ComponentPropsWithRef<typeof RadixTooltip.Content>,
  'content'
> {
  /** The tip itself. Text, not markup — a tooltip is not a popover. */
  readonly content: ReactNode;
  /** The element the tip describes. Must forward props and a ref (every primitive here does). */
  readonly children: ReactNode;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

export function Tooltip({
  content,
  children,
  open,
  onOpenChange,
  className,
  side = 'top',
  sideOffset = 6,
  ...rest
}: TooltipProps) {
  return (
    <RadixTooltip.Root open={open} onOpenChange={onOpenChange}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={sideOffset}
          className={cn(TOOLTIP_CONTENT_CLASSES, className)}
          {...rest}
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
