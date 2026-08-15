/**
 * Radix `Toolbar` — a horizontal control strip with a roving tabstop, so a panel header full
 * of icon buttons costs one Tab press instead of eight.
 *
 * The height is `--panel-header-height` (36px), which is the token Task 2 minted to retire
 * "the four magic 38s and the 36/38 mismatch" the audit found in the shell (PROPOSAL §1.9).
 * Read through the token rather than restated as `h-9`, so the shell and its toolbars cannot
 * disagree. Override it with `className` where a toolbar is not a panel header.
 *
 * `ToolbarButton` wraps `Button` through Radix's `asChild`, so the two cannot diverge: a
 * toolbar button is a `Button` that also participates in the roving tabstop. `ghost` is the
 * default variant — dense chrome, and HOUSE-RULES §5 caps filled oxide at one per surface,
 * which a toolbar is very unlikely to be the right place to spend.
 */

import type { ComponentPropsWithRef } from 'react';
import * as RadixToolbar from '@radix-ui/react-toolbar';

import { Button, type ButtonProps } from './button';
import { cn } from './cn';

export function Toolbar({ className, ...rest }: ComponentPropsWithRef<typeof RadixToolbar.Root>) {
  return (
    <RadixToolbar.Root
      className={cn(
        'flex h-(--panel-header-height) shrink-0 items-center gap-1 bg-chrome px-2',
        className
      )}
      {...rest}
    />
  );
}

export interface ToolbarButtonProps extends ButtonProps {
  readonly disabled?: boolean;
}

export function ToolbarButton({ variant = 'ghost', size = 'sm', ...rest }: ToolbarButtonProps) {
  return (
    <RadixToolbar.Button asChild>
      <Button variant={variant} size={size} {...rest} />
    </RadixToolbar.Button>
  );
}

export function ToolbarSeparator({
  className,
  ...rest
}: ComponentPropsWithRef<typeof RadixToolbar.Separator>) {
  return (
    <RadixToolbar.Separator
      className={cn('h-4 w-px shrink-0 bg-rule-strong', className)}
      {...rest}
    />
  );
}

/**
 * Pushes everything after it to the right end of the strip. A `grow` spacer rather than an
 * `ml-auto` on the trailing group, per `general.md`'s no-margins-between-flex-children rule.
 */
export function ToolbarSpacer() {
  return <div className="grow" />;
}
