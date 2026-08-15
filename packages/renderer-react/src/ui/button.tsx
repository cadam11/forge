/**
 * The app's only button.
 *
 * `buttons.md` constraints and how they are met:
 *
 * - **Exactly two heights, ≥6px apart, inside 28–38px.** `sm` is 28px (`h-7`), `md` is 34px
 *   (`h-8.5`). Exactly 6px apart, both in range. There is no third size and adding one is
 *   the wrong fix for a layout that feels cramped.
 * - **One filled affordance per surface.** `primary` is the filled oxide one. HOUSE-RULES
 *   ("Accent discipline") caps it at one per visible surface and counts a dialog as its own
 *   surface, so a toolbar full of actions uses `outline`/`ghost` and a dialog's action row
 *   uses at most one `primary`.
 * - **Destructive actions are muted by default.** `danger` is therefore an outlined,
 *   danger-foreground button, not a filled red one. The confirm step of a destructive flow
 *   is the one place a filled affordance is correct, and there the dialog's single `primary`
 *   is what carries it (HOUSE-RULES lists destructive confirmation among oxide's jobs).
 * - **Asymmetric padding when an icon leads or trails.** `leadingIcon` / `trailingIcon` set
 *   the icon side's padding equal to the vertical padding rather than keeping `px-*`.
 *
 * Two guideline rules are deliberately not applied, both resolved by HOUSE-RULES §1
 * ("There is no mobile"): the 48×48 coarse-pointer touch-target span, and the mobile
 * font-size bump. This renderer only ever runs in a fixed Electron window with a fine
 * pointer, so both would emit markup that can never render.
 *
 * The filled variant's hover is `hover:opacity-90` rather than a darker fill. Under ink,
 * `--color-accent` and `--color-accent-strong` are the same token (oxide-lift), so a
 * token swap is a no-op there; and every oxide step that IS darker drops
 * `--color-accent-fill-fg` below 4.5:1 (raw oxide measures 4.33:1 against paper,
 * PROPOSAL §2.3). Opacity keeps the measured pair intact. No `transition-*` — per
 * `interactivity.md`, colour changes do not animate.
 */

import type { ComponentPropsWithRef } from 'react';

import { cn } from './cn';
import { Icon, type IconProps } from './icon';

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const DEFAULT_VARIANT: ButtonVariant = 'outline';
const DEFAULT_SIZE: ButtonSize = 'md';

/** Loosely keyed for the same reason as `Icon`'s: an out-of-vocabulary value falls back. */
const VARIANT_CLASSES: Record<string, string> = {
  primary: 'bg-accent-strong text-accent-fill-fg hover:opacity-90',
  outline: 'border border-rule-strong text-fg hover:bg-hover',
  ghost: 'text-fg hover:bg-hover',
  danger: 'border border-danger text-danger hover:bg-hover',
};

/** Height + horizontal padding + gap. Vertical padding is implied by the fixed height. */
const SIZE_CLASSES: Record<string, string> = {
  sm: 'h-7 gap-1 px-2.5',
  md: 'h-8.5 gap-1.5 px-3',
};

/** Square, for the icon-only shape. Same two heights. */
const ICON_ONLY_SIZE_CLASSES: Record<string, string> = {
  sm: 'size-7 p-0',
  md: 'size-8.5 p-0',
};

/**
 * `pl-*`/`pr-*` overrides that set the icon side's padding to the vertical padding.
 * `sm` is 28px tall around a 13px line box, so ~6px vertical; `md` is 34px, so ~10px.
 */
const LEADING_ICON_PADDING: Record<string, string> = { sm: 'pl-1.5', md: 'pl-2.5' };
const TRAILING_ICON_PADDING: Record<string, string> = { sm: 'pr-1.5', md: 'pr-2.5' };

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Rendered before the label, at the size class matching the button. */
  readonly leadingIcon?: IconProps['icon'];
  readonly trailingIcon?: IconProps['icon'];
  /**
   * Square button with no visible label — pass the glyph as `leadingIcon` and the name as
   * `aria-label`. The label is mandatory in practice: there is no text for a screen reader
   * to fall back to.
   */
  readonly iconOnly?: boolean;
}

export function Button({
  variant = DEFAULT_VARIANT,
  size = DEFAULT_SIZE,
  leadingIcon,
  trailingIcon,
  iconOnly = false,
  className,
  children,
  // form-controls.md: an explicit type on every button. `submit` is opt-in.
  type = 'button',
  ...rest
}: ButtonProps) {
  const iconSize = size === 'sm' ? 'sm' : 'md';
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-sm text-base font-medium',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant] ?? VARIANT_CLASSES[DEFAULT_VARIANT],
        iconOnly
          ? (ICON_ONLY_SIZE_CLASSES[size] ?? ICON_ONLY_SIZE_CLASSES[DEFAULT_SIZE])
          : (SIZE_CLASSES[size] ?? SIZE_CLASSES[DEFAULT_SIZE]),
        !iconOnly && leadingIcon !== undefined && LEADING_ICON_PADDING[size],
        !iconOnly && trailingIcon !== undefined && TRAILING_ICON_PADDING[size],
        className
      )}
      {...rest}
    >
      {leadingIcon === undefined ? null : <Icon icon={leadingIcon} size={iconSize} />}
      {children}
      {trailingIcon === undefined ? null : <Icon icon={trailingIcon} size={iconSize} />}
    </button>
  );
}
