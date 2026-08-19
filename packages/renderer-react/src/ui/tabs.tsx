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

/**
 * The strip itself, and it deliberately has **no** focus ring.
 *
 * Radix builds `Tabs.List` on `RovingFocusGroup`, whose root takes `tabIndex: 0` whenever it has
 * focusable items (`@radix-ui/react-roving-focus/dist/index.mjs:92`) — so Tab does route through
 * here. But it cannot HOLD focus: the root's own focus handler forwards immediately to the current
 * item. Measured, not assumed (Task 23): calling `.focus()` on this element leaves
 * `document.activeElement` on the selected `role="tab"`, which carries the ring.
 *
 * A ring here would therefore paint for at most a frame, on an element the user never sees focused.
 * `tests/helpers/react/a11y.ts` carries the matching `ROVING_TABLIST_EXEMPTION`, whose `verify`
 * re-runs that measurement — so this omission is checked rather than merely asserted.
 */
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
 * `min-h-0` so a scrolling panel inside a flex column actually scrolls.
 *
 * ── The panel has a focus ring after all (Task 23) ────────────────────────────────────────
 *
 * This used to be `outline-hidden` alone, on the reasoning that "an outline on the whole panel
 * after a tab change is noise, and the focus ring lives on the trigger". The trigger's ring is
 * still where a tab change is announced — but Radix gives the panel `tabIndex={0}`, so a Tab press
 * from the trigger lands ON the panel, and Task 23's keyboard walk found that stop showing nothing
 * at all: `tests/e2e-react/a11y.spec.ts` recorded the settings dialog's appearance panel as a focus
 * stop with no indicator. "Where am I?" going unanswerable for one Tab press is a worse cost than
 * the noise the suppression was avoiding.
 *
 * The resting state is unchanged, and so is a tab change made with the mouse: `:focus-visible` does
 * not match a pointer-driven focus, so this ring appears only when a keyboard put focus here. The
 * ring is inset (`-outline-offset-2`) because a panel usually fills its dialog and an outer ring
 * would be clipped.
 *
 * `outline-solid` is required, not decorative — see the same note in `tree.tsx`: without it,
 * `outline-hidden`'s `--tw-outline-style: none` is what `outline-2` renders with.
 */
export function TabsContent({
  className,
  ...rest
}: ComponentPropsWithRef<typeof RadixTabs.Content>) {
  return (
    <RadixTabs.Content
      className={cn(
        'min-h-0 outline-hidden',
        'focus-visible:outline-2 focus-visible:outline-solid',
        'focus-visible:-outline-offset-2 focus-visible:outline-focus',
        className
      )}
      {...rest}
    />
  );
}
