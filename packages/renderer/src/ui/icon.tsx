/**
 * The one way an icon reaches the screen.
 *
 * Set: **lucide**. Scale: **HOUSE-RULES §6** — `--icon-sm` 14 / `--icon-md` 16 / `--icon-lg`
 * 20px, i.e. `size-3.5` / `size-4` / `size-5`, with 16px for app chrome and 20px reserved
 * for nav lists. `icons.md`'s "match the size class to the viewBox" rule is deliberately
 * NOT applied to the raw 24px viewBox lucide draws on: HOUSE-RULES §6 fixes this app's icon
 * scale explicitly, and lucide is a stroke-scaled outline set designed to be rendered at a
 * chosen size (its `strokeWidth` is in viewBox units, so 2 at 16px paints 1.33px). The
 * guideline's target — bitmap-ish icon sets that blur when scaled — does not apply.
 *
 * `stroke-current fill-none` rather than leaning on lucide's `stroke="currentColor"`
 * attribute: `icons.md` requires the colour to be controlled by `stroke-*` / `fill-*`
 * utilities, and a class beats a presentation attribute, so `stroke-accent` at a call site
 * actually wins. `current` keeps ordinary inheritance working inside menu items and rows,
 * where the icon has to follow the row's own hover/selected foreground.
 *
 * `shrink-0` is unconditional (`icons.md`) — every icon in this app lives in a flex row.
 */

import type { ComponentPropsWithRef } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from './cn';

export type IconSize = 'sm' | 'md' | 'lg';

const DEFAULT_SIZE: IconSize = 'md';

/** Keyed loosely so a value that slipped past the compiler falls back instead of yielding `undefined`. */
const SIZE_CLASSES: Record<string, string> = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
};

export interface IconProps extends Omit<ComponentPropsWithRef<'svg'>, 'children'> {
  /** The lucide component, e.g. `ChevronRight`. Passed as a value, never as a string name. */
  readonly icon: LucideIcon;
  readonly size?: IconSize;
  /**
   * Set only when the icon is the sole carrier of meaning — an icon-only button's glyph,
   * a status pip. Omitted (the default) marks the icon decorative, which is correct
   * whenever adjacent text already says the same thing.
   */
  readonly label?: string;
}

export function Icon({ icon: Glyph, size = DEFAULT_SIZE, label, className, ...rest }: IconProps) {
  const decorative = label === undefined;
  return (
    <Glyph
      aria-hidden={decorative ? true : undefined}
      aria-label={label}
      role={decorative ? undefined : 'img'}
      className={cn(
        'shrink-0 fill-none stroke-current',
        SIZE_CLASSES[size] ?? SIZE_CLASSES[DEFAULT_SIZE],
        className
      )}
      {...rest}
    />
  );
}
