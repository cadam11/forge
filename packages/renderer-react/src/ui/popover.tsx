/**
 * Radix `Popover` — a non-modal panel anchored to a trigger, for things a menu cannot hold:
 * a filter form, a connection chip's detail, a colour/limit control.
 *
 * The line between this and `Dialog` is whether the workbench underneath must stay usable.
 * A popover is non-modal (no scrim, click-outside dismisses, the app keeps working); a
 * dialog blocks. If the flow is transactional, it is a dialog — PLAN §2.9.
 *
 * The line between this and `Tooltip` is whether the content is focusable. A popover can
 * contain controls; a tooltip is a sentence.
 */

import type { ComponentPropsWithRef } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';

import { cn } from './cn';
import { OVERLAY_SURFACE_CLASSES } from './overlay';

export const Popover = RadixPopover.Root;

/** `<PopoverTrigger asChild><Button …/></PopoverTrigger>`. */
export const PopoverTrigger = RadixPopover.Trigger;

/** Anchors the panel to something other than the trigger — a text cursor, a grid cell. */
export const PopoverAnchor = RadixPopover.Anchor;

export const PopoverClose = RadixPopover.Close;

export function PopoverContent({
  className,
  sideOffset = 6,
  align = 'start',
  ...rest
}: ComponentPropsWithRef<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(OVERLAY_SURFACE_CLASSES, 'w-72 p-3 text-base outline-hidden', className)}
        {...rest}
      />
    </RadixPopover.Portal>
  );
}
