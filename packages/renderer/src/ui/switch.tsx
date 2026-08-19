/**
 * A toggle. Native `<input type="checkbox">` under a styled track, exactly the shape
 * `form-controls.md` prescribes: `w-9` track, `inset-ring`, knob at `w-1/2` translated by
 * `group-has-checked:translate-x-full`, and no JavaScript anywhere in the state handling.
 *
 * Three deviations, each forced by a rule that outranks the guideline:
 *
 * - No `w-11 sm:w-9` — HOUSE-RULES §1, no viewport variants, no mobile.
 * - No `dark:` classes — HOUSE-RULES §3, the tokens carry both themes. A `dark:` here would
 *   be a signal that a token is missing.
 * - No `shadow-xs` on the knob — Task 2 cleared the `--shadow-*` namespace (HOUSE-RULES §3),
 *   so it would not compile. The knob's `ring-1 ring-rule-strong` is the hairline that
 *   replaces it, which is the whole substitution PROPOSAL §2.1 asks for.
 *
 * The knob is `bg-j-paper` — Layer 1, deliberately. HOUSE-RULES §5 reserves Layer 1 for
 * "surfaces that must stay the same colour in both themes", and this is one: it has to read
 * against `bg-chrome` when off and against the oxide fill when on, in both themes. Against
 * the oxide fill it is the certified 5.42:1 pair (paper on oxide-deep).
 *
 * `transition-colors` / `transition-transform` are kept from the guideline markup. This is
 * not the case `interactivity.md` forbids: the knob genuinely moves.
 *
 * Switch vs Checkbox is a semantics choice, not a style one: a switch applies immediately, a
 * checkbox applies on save. Settings toggles are switches; a dialog's "remember this" is a
 * checkbox.
 */

import type { ComponentPropsWithRef } from 'react';

import { cn } from './cn';
import { describedBy, InlineField, useFieldIds, type FieldOwnProps } from './field';

export interface SwitchProps
  extends Omit<ComponentPropsWithRef<'input'>, 'name' | 'type'>, FieldOwnProps {
  readonly name: string;
}

export function Switch({
  label,
  hint,
  error,
  fieldClassName,
  className,
  id,
  ...rest
}: SwitchProps) {
  const ids = useFieldIds(id);
  return (
    <InlineField ids={ids} label={label} hint={hint} error={error} fieldClassName={fieldClassName}>
      <div
        className={cn(
          'group relative inline-flex w-9 shrink-0 rounded-full bg-chrome p-0.5',
          'inset-ring inset-ring-rule-strong transition-colors duration-200 ease-in-out',
          'has-checked:bg-accent-strong',
          'outline-offset-2 outline-focus has-focus-visible:outline-2',
          'has-disabled:cursor-not-allowed has-disabled:opacity-50'
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'aspect-square w-1/2 rounded-full bg-j-paper ring-1 ring-rule-strong',
            'transition-transform duration-200 ease-in-out group-has-checked:translate-x-full'
          )}
        />
        <input
          id={ids.controlId}
          type="checkbox"
          role="switch"
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy(ids, { hint, error })}
          // `focus:outline-hidden` on the input and the ring on the track: the input is a
          // transparent overlay, so its own focus ring would paint under the knob.
          className={cn(
            'absolute inset-0 size-full appearance-none focus:outline-hidden',
            className
          )}
          {...rest}
        />
      </div>
    </InlineField>
  );
}
