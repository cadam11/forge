/**
 * Busy indicator. Replaces the Angular `app-loading` (`loading.component.ts`), whose three
 * sizes were 22/45/67px tall pulsing rings sized off the type scale — exactly the leak
 * HOUSE-RULES §6 gave icons their own scale to stop.
 *
 * Same shape of API as the component it replaces (a `size` vocabulary with a loose lookup
 * that falls back rather than yielding `undefined`, and an optional caption), so
 * `loading.component.spec`'s contract ports across; the vocabulary itself is now the icon
 * ladder instead of `small|medium|large`, and the mark is lucide's ring rather than a
 * hand-drawn SVG (`icons.md`: never generate raw icon SVG).
 *
 * `animate-spin` rather than the old opacity pulse: `interactivity.md` reserves animation
 * for things that move, and a spinner is the one control that genuinely does.
 *
 * The root is a `<div class="inline-flex">` rather than a `<span>` because the type rung
 * lives on it, and `general.md` forbids `text-*` on inline elements. `inline-flex` keeps it
 * inline-level in layout, which is what a spinner beside a label needs.
 */

import type { ComponentPropsWithRef } from 'react';
import { LoaderCircle } from 'lucide-react';

import { cn } from './cn';
import { Icon, type IconSize } from './icon';

export type SpinnerSize = IconSize;

const DEFAULT_SIZE: SpinnerSize = 'md';

/** The caption's type rung per size. `text-sm` (12px) is the body floor — HOUSE-RULES §2. */
const DEFAULT_LABEL_CLASS = 'text-base';

const LABEL_CLASSES: Record<string, string> = {
  sm: 'text-sm',
  md: DEFAULT_LABEL_CLASS,
  lg: DEFAULT_LABEL_CLASS,
};

/** The caption class a given size resolves to. Exported so the spec asserts the mapping. */
export function spinnerLabelClass(size: SpinnerSize): string {
  return LABEL_CLASSES[size] ?? DEFAULT_LABEL_CLASS;
}

export interface SpinnerProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  readonly size?: SpinnerSize;
  /**
   * Visible caption. When omitted the spinner still announces itself through
   * `aria-label`, so a bare `<Spinner />` is never silent to a screen reader.
   */
  readonly label?: string;
}

export function Spinner({ size = DEFAULT_SIZE, label, className, ...rest }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label={label === undefined ? 'Loading' : undefined}
      className={cn(
        'inline-flex items-center gap-2 text-fg-muted',
        spinnerLabelClass(size),
        className
      )}
      {...rest}
    >
      <Icon icon={LoaderCircle} size={size} className="animate-spin stroke-accent" />
      {label === undefined ? null : <span>{label}</span>}
    </div>
  );
}
