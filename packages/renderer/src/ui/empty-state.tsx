/**
 * The one empty state, retiring 19 divergent Angular implementations.
 *
 * They diverged because each was written where it was needed, so the union of what they did
 * is the whole API surface: a glyph, a title, one sentence of explanation, and at most one
 * action. Anything past that — a list of suggestions, a form — is a panel, not an empty
 * state, and belongs in its own component.
 *
 * Two sizes, for the same reason `Button` has two: the 19 originals split cleanly into
 * "a 240px dock panel has nothing to show" and "a whole tab has nothing to show", and a
 * third size is how a set of 19 gets started again.
 *
 * - `sm` — inside a panel. `text-lg` title, no display face. A 28px Archivo headline in a
 *   240px rail is comic.
 * - `md` — a whole tab or dialog body. `font-display text-display-sm`, which is exactly what
 *   HOUSE-RULES §2 reserves the display scale for ("Archivo. Empty states.").
 *
 * No decorative container behind the glyph (`icons.md`), and no card around the whole thing:
 * `surfaces.md` puts whitespace first, and an empty state is whitespace by definition.
 *
 * Display sizes carry their own tracking and leading in the token, so there is deliberately
 * no `leading-*`/`tracking-*` here — HOUSE-RULES §2 forbids overriding them.
 */

import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from './cn';
import { Icon, type IconProps } from './icon';

export type EmptyStateSize = 'sm' | 'md';

const DEFAULT_SIZE: EmptyStateSize = 'md';

const DEFAULT_TITLE_CLASS = 'font-display text-display-sm text-fg text-balance';

const TITLE_CLASSES: Record<string, string> = {
  sm: 'text-lg text-fg text-balance',
  md: DEFAULT_TITLE_CLASS,
};

const DESCRIPTION_CLASSES: Record<string, string> = {
  sm: 'max-w-64 text-sm text-fg-muted text-pretty',
  md: 'max-w-80 text-md text-fg-muted text-pretty',
};

const PADDING_CLASSES: Record<string, string> = {
  sm: 'gap-2 p-4',
  md: 'gap-3 p-8',
};

/** The title class a size resolves to. Exported so the spec asserts the mapping. */
export function emptyStateTitleClass(size: EmptyStateSize): string {
  return TITLE_CLASSES[size] ?? DEFAULT_TITLE_CLASS;
}

export interface EmptyStateProps extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'title'> {
  readonly title: string;
  readonly description?: string;
  readonly icon?: IconProps['icon'];
  readonly size?: EmptyStateSize;
  /** At most one affordance — normally a `<Button>`. Rendered under the description. */
  readonly action?: ReactNode;
}

export function EmptyState({
  title,
  description,
  icon,
  size = DEFAULT_SIZE,
  action,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        PADDING_CLASSES[size] ?? PADDING_CLASSES[DEFAULT_SIZE],
        className
      )}
      {...rest}
    >
      {icon === undefined ? null : (
        <Icon icon={icon} size="lg" className="stroke-fg-subtle" data-testid="empty-state-icon" />
      )}
      <p className={emptyStateTitleClass(size)}>{title}</p>
      {description === undefined ? null : (
        <p className={cn(DESCRIPTION_CLASSES[size] ?? DESCRIPTION_CLASSES[DEFAULT_SIZE])}>
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
