/**
 * The shape a form dialog takes in this app: ruled sections with mono eyebrows, explanatory notes
 * under controls, and one "answer band" between the scrolling body and the action row.
 *
 * ── Why here and not in `src/ui/` ───────────────────────────────────────────────────────────
 *
 * `src/ui/` is the design-primitive layer, and two of its rules make it the wrong home:
 *
 *  1. **`contract.spec.tsx` holds every export there to an element contract** — takes and merges
 *     `className`, bakes no margins, passes `data-testid` through, has a `:focus-visible`
 *     treatment if interactive. `FormAnswerBand` is a *composition* with fixed internal geometry
 *     (a rule, padding, a gap) whose whole job is that two dialogs cannot drift apart, which is the
 *     same reasoning `ui/index.ts` already records for `SelectLabel` and `MenuRow`.
 *  2. **`useFormValues` needs `react-hook-form`**, and the primitive layer deliberately does not
 *     depend on a form library — Task 6's `Input`/`Select`/`Checkbox` take plain HTML props, which
 *     is exactly what lets `register()` spread onto them. Pulling the library into `ui/` to house
 *     one hook would invert that.
 *
 * So this is a feature-layer module that composes primitives, and the layering stays: `features/*`
 * may import from `ui/`, never the reverse.
 *
 * ── What it exists to stop ──────────────────────────────────────────────────────────────────
 *
 * These four pieces were local to `connection-editor.tsx`. Tasks 12 and 13 build two more dialogs
 * with the same anatomy — a sectioned scrolling form, notes, and a band above the actions carrying
 * a validation summary or a progress stream — and the way that goes wrong is copy-paste followed by
 * divergence. The Angular renderer is the evidence: PLAN.md §1.5 counted **19 divergent empty-state
 * implementations** and the audit found 24 overlays across 3 mechanisms.
 */

import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../ui';

export interface FormSectionProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  /** The eyebrow. Sentence case in the source; the utility uppercases it. */
  readonly title: string;
  readonly children: ReactNode;
}

/**
 * A ruled group inside a dialog body, with a mono uppercase eyebrow per HOUSE-RULES §2.
 *
 * The rule is on the section's own top edge, so a body is a stack of these with no separators of
 * its own and the first section's rule doubles as the boundary under the header.
 */
export function FormSection({ title, className, children, ...rest }: FormSectionProps) {
  return (
    <section className={cn('flex flex-col gap-3 border-t border-rule pt-3', className)} {...rest}>
      <h3 className="font-mono text-2xs tracking-eyebrow text-fg-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

/**
 * An explanatory line under, or in place of, a control — "TLS is always on for Aurora DSQL".
 *
 * `text-fg-muted`, never `text-fg-subtle`: HOUSE-RULES §5 puts subtle at 3.11:1 on light chrome and
 * reserves it for metadata, and this is prose a user has to read.
 */
export function FormNote({ className, ...rest }: ComponentPropsWithRef<'p'>) {
  return <p className={cn('text-sm text-fg-muted text-pretty', className)} {...rest} />;
}

/**
 * The caution well: a one-line summary of what is still wrong, or any other non-destructive
 * "attention" line. Amber per HOUSE-RULES §5, which names form caution as amber's job.
 *
 * `role="status"` rather than `alert`: the user asked for this by pressing a button, and it sits
 * directly above the button they pressed.
 */
export function FormHint({ className, ...rest }: ComponentPropsWithRef<'p'>) {
  return (
    <p
      role="status"
      className={cn(
        'rounded-sm border-l-2 border-warning bg-surface p-2 text-sm text-fg text-pretty',
        className
      )}
      {...rest}
    />
  );
}

export interface FormAnswerBandProps extends ComponentPropsWithRef<'div'> {
  /** The caution line, rendered as a `FormHint`. Omit when there is nothing to summarise. */
  readonly hint?: string;
  readonly hintTestId?: string;
  /**
   * Anything else the last action produced — a result panel, a progress stream.
   *
   * **Pass `null` when there is nothing to say.** The band renders nothing when it has neither a
   * hint nor a child, and it cannot see through a component that returns `null` from its own render,
   * so `{result === null ? null : <Panel result={result} />}` is the shape rather than
   * `<Panel result={result} />`.
   */
  readonly children?: ReactNode;
}

/**
 * One ruled band between the scrolling body and the action row, holding whatever the last action had
 * to say.
 *
 * A band with `gap-*` rather than per-child margins, per `general.md`, and `shrink-0` so it is never
 * the thing that gets squeezed when the body is tall — the action row's reachability at the 800×600
 * window floor depends on the body being the only flexible row.
 */
export function FormAnswerBand({
  hint,
  hintTestId,
  className,
  children,
  ...rest
}: FormAnswerBandProps) {
  const hasChildren = children !== null && children !== undefined && children !== false;
  if (hint === undefined && !hasChildren) return null;

  return (
    <div
      className={cn('flex shrink-0 flex-col gap-2 border-t border-rule px-4 py-3', className)}
      {...rest}
    >
      {hint === undefined ? null : <FormHint data-testid={hintTestId}>{hint}</FormHint>}
      {children}
    </div>
  );
}
