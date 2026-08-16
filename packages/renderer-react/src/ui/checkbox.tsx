/**
 * A native `<input type="checkbox">`, styled entirely in CSS.
 *
 * `form-controls.md` is explicit about this one: native input, `appearance-none`, every
 * state driven by CSS variants, and **never** JavaScript toggling classes. So there is no
 * Radix checkbox here and no React state — `checked`, `indeterminate` and `disabled` are
 * read straight off the input by `group-has-*` variants. PLAN §Decision A agrees:
 * "inputs/textareas/checkboxes are plain elements styled by owned components".
 *
 * Two deviations from the guideline's markup, both forced by rules that outrank it:
 *
 * - No `size-5 sm:size-4` — HOUSE-RULES §1 bans viewport variants and there is no mobile.
 *   The control is `size-4` full stop.
 * - The tick and the dash are lucide glyphs, not hand-written `<path>`s. `icons.md` forbids
 *   generating raw icon SVG, and the guideline's own paths are the only reason it appeared
 *   to require it. The CSS-only mechanism is unchanged: both glyphs are always in the DOM
 *   and `group-not-has-*` hides the one that does not apply.
 *
 * `indeterminate` is a DOM property with no HTML attribute, so it is the single thing React
 * cannot set declaratively. A ref callback sets it — that is the whole reason this component
 * touches a ref, and it is still not "JavaScript toggling classes": the styling reads the
 * property through `indeterminate:` / `group-has-indeterminate:`.
 */

import { useCallback, type ComponentPropsWithRef, type Ref } from 'react';
import { Check, Minus } from 'lucide-react';

import { cn } from './cn';
import { describedBy, InlineField, useFieldIds, type FieldOwnProps } from './field';
import { Icon } from './icon';

export interface CheckboxProps
  extends Omit<ComponentPropsWithRef<'input'>, 'name' | 'type'>, FieldOwnProps {
  readonly name: string;
  /** Renders the dash instead of the tick. Mixed state for a partially-selected group. */
  readonly indeterminate?: boolean;
}

export function Checkbox({
  label,
  hint,
  error,
  fieldClassName,
  className,
  id,
  indeterminate = false,
  ref,
  ...rest
}: CheckboxProps) {
  const ids = useFieldIds(id);

  // Mirrors `indeterminate` onto the DOM node, and still honours a ref the caller passed.
  // Without the forwarding, adding `indeterminate` to a field would silently break whatever
  // the caller was using its ref for.
  const attachRef = useCallback(
    (node: HTMLInputElement | null) => {
      if (node === null) {
        // React 19 detaches by calling the cleanup this returns, so it only reaches here
        // when the caller's own ref shape produced no cleanup. Handled either way.
        assignRef(ref, null);
        return;
      }
      node.indeterminate = indeterminate;
      return assignRef(ref, node);
    },
    [indeterminate, ref]
  );

  return (
    <InlineField ids={ids} label={label} hint={hint} error={error} fieldClassName={fieldClassName}>
      <span className="group inline-grid size-4 shrink-0 grid-cols-1">
        <input
          ref={attachRef}
          id={ids.controlId}
          type="checkbox"
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy(ids, { hint, error })}
          className={cn(
            'col-start-1 row-start-1 appearance-none rounded-xs border border-rule-strong bg-surface',
            'checked:border-accent-strong checked:bg-accent-strong',
            'indeterminate:border-accent-strong indeterminate:bg-accent-strong',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            'disabled:cursor-not-allowed disabled:border-rule disabled:bg-chrome',
            'disabled:checked:bg-chrome disabled:indeterminate:bg-chrome',
            // Windows high-contrast mode: hand the control back to the OS rather than
            // painting an invisible box.
            'forced-colors:appearance-auto',
            className
          )}
          {...rest}
        />
        <Icon
          icon={Check}
          size="sm"
          className={cn(
            'pointer-events-none col-start-1 row-start-1 size-3 self-center justify-self-center',
            'stroke-accent-fill-fg group-has-disabled:stroke-fg-subtle',
            'group-not-has-checked:opacity-0 group-has-indeterminate:opacity-0'
          )}
        />
        <Icon
          icon={Minus}
          size="sm"
          className={cn(
            'pointer-events-none col-start-1 row-start-1 size-3 self-center justify-self-center',
            'stroke-accent-fill-fg group-has-disabled:stroke-fg-subtle',
            'group-not-has-indeterminate:opacity-0'
          )}
        />
      </span>
    </InlineField>
  );
}

/**
 * Forwards to whichever of the two ref shapes the caller passed, and returns the React 19
 * cleanup for it. A callback ref that already returns its own cleanup keeps it; one that
 * does not gets the equivalent detach synthesised, so both shapes behave identically.
 */
function assignRef(
  ref: Ref<HTMLInputElement> | undefined,
  node: HTMLInputElement | null
): (() => void) | undefined {
  if (typeof ref === 'function') {
    const cleanup = ref(node);
    return typeof cleanup === 'function' ? cleanup : () => ref(null);
  }
  if (ref === null || ref === undefined) {
    return undefined;
  }
  ref.current = node;
  return () => {
    ref.current = null;
  };
}
