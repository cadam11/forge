/**
 * Radix `Tabs`, replacing 76 `mat-tab` uses.
 *
 * This is **not** the workspace tab bar. Tabs are the app's navigation model (PLAN §0.1: the
 * React app ships no router at all) and that bar is Dockview's, arriving in Task 7. This
 * primitive is for tabs *inside* a surface: the settings panel's four groups, the query tab's
 * result/messages/plan strip, a dialog with two modes.
 *
 * The active indicator is a 2px oxide underline, which HOUSE-RULES §5 lists among oxide's
 * jobs — so a tab strip does not spend the surface's one filled-oxide budget.
 *
 * It is drawn as an `::after` pseudo-element rather than a `border-b-2` plus `-mb-px`,
 * because the latter needs a negative margin on the trigger and `general.md` bans margins
 * between flex children. `after:-bottom-px` puts the indicator over the list's hairline so
 * the two do not stack into a 3px stripe.
 */

import type { ComponentPropsWithRef } from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';

import { cn } from './cn';

export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...rest }: ComponentPropsWithRef<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn('flex shrink-0 items-center gap-1 border-b border-rule', className)}
      {...rest}
    />
  );
}

export function TabsTrigger({
  className,
  ...rest
}: ComponentPropsWithRef<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'relative flex h-8.5 min-w-0 items-center gap-1.5 px-3 text-base text-fg-muted',
        'hover:text-fg data-[state=active]:text-fg',
        "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:content-['']",
        'data-[state=active]:after:bg-accent',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...rest}
    />
  );
}

/**
 * `min-h-0` so a scrolling panel inside a flex column actually scrolls, and `outline-hidden`
 * because Radix makes the panel focusable for the arrow-key model — an outline on the whole
 * panel after a tab change is noise, and the focus ring lives on the trigger.
 */
export function TabsContent({
  className,
  ...rest
}: ComponentPropsWithRef<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cn('min-h-0 outline-hidden', className)} {...rest} />;
}
