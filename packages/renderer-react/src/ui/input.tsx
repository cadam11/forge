/**
 * One `Input` for every `<input>` type — `componentize`'s one-component-per-HTML-element
 * rule, which is also what stops the app growing a `PasswordInput` and a `SearchInput` that
 * drift apart. Pass `type` instead.
 *
 * `name` is required rather than optional: `form-controls.md` makes it a coding rule, and a
 * required prop is the only version of that rule the compiler enforces.
 *
 * Either `label` or an `aria-label` is mandatory (`form-controls.md`). `label` is strongly
 * preferred — it is what makes the Task 20 `getByLabel` helper work.
 */

import type { ComponentPropsWithRef } from 'react';

import { cn } from './cn';
import {
  CONTROL_BOX_CLASSES,
  CONTROL_HEIGHT_CLASS,
  describedBy,
  Field,
  useFieldIds,
  type FieldOwnProps,
} from './field';

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'name'>, FieldOwnProps {
  readonly name: string;
}

export function Input({
  label,
  hint,
  error,
  fieldClassName,
  className,
  id,
  type = 'text',
  ...rest
}: InputProps) {
  const ids = useFieldIds(id);
  return (
    <Field ids={ids} label={label} hint={hint} error={error} fieldClassName={fieldClassName}>
      <input
        id={ids.controlId}
        type={type}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy(ids, { hint, error })}
        className={cn(CONTROL_BOX_CLASSES, CONTROL_HEIGHT_CLASS, 'px-2', className)}
        {...rest}
      />
    </Field>
  );
}
