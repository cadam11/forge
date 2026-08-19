/**
 * The class-merge seam every primitive uses.
 *
 * `componentize`'s rule is that a component must accept a `className` and merge it with
 * its own classes. Plain concatenation does not *merge*: two utilities for the same
 * property both survive and the winner is decided by the order Tailwind emitted them into
 * the stylesheet, not by the order the caller wrote them. So `<Button className="h-8">`
 * would silently do nothing. `tailwind-merge` resolves the conflict by dropping the
 * earlier utility, which makes the caller's class win — the behaviour every call site
 * assumes.
 *
 * ONE override is required, and it was measured rather than assumed. Task 2 closed the
 * `--text-*` namespace and registered three off-ladder rungs under it (`text-display-sm`,
 * `-md`, `-lg`, HOUSE-RULES §2). tailwind-merge classifies `text-*` by trying its
 * t-shirt-size validator first and falling through to *text colour*; `display-sm` is not a
 * t-shirt size, so out of the box:
 *
 *   twMerge('text-base', 'text-display-sm')  -> 'text-base text-display-sm'   (no conflict seen)
 *   twMerge('text-fg', 'text-display-sm')    -> 'text-display-sm'             (ate the colour)
 *
 * Both are wrong and both are silent. Registering the three rungs as literal members of
 * the `font-size` group fixes both — an exact class-map hit beats the validators.
 * `cn.spec.ts` re-derives the list from `styles/theme.css` so a fourth display rung cannot
 * be added to the theme without this file failing.
 */

import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The `--text-*` rungs whose names tailwind-merge cannot recognise as font sizes.
 * Exported for the drift spec, not for call sites.
 */
export const OFF_LADDER_FONT_SIZES = ['display-sm', 'display-md', 'display-lg'] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...OFF_LADDER_FONT_SIZES] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
