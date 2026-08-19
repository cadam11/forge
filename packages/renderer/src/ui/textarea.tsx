/**
 * `<textarea>`. Same box and same label contract as `Input` — see `field.tsx` for both.
 *
 * No fixed height: a textarea's job is to grow. `rows` sets the initial size and
 * `min-h-16` (64px) is the floor, so a caller can hand it `className="h-40"` and win
 * (that is what `cn` is for).
 */

import type { ComponentPropsWithRef } from 'react';

import { cn } from './cn';
import { CONTROL_BOX_CLASSES, describedBy, Field, useFieldIds, type FieldOwnProps } from './field';

export interface TextareaProps
  extends Omit<ComponentPropsWithRef<'textarea'>, 'name'>, FieldOwnProps {
  readonly name: string;
}

export function Textarea({
  label,
  hint,
  error,
  fieldClassName,
  className,
  id,
  rows = 3,
  ...rest
}: TextareaProps) {
  const ids = useFieldIds(id);
  return (
    <Field ids={ids} label={label} hint={hint} error={error} fieldClassName={fieldClassName}>
      <textarea
        id={ids.controlId}
        rows={rows}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy(ids, { hint, error })}
        className={cn(CONTROL_BOX_CLASSES, 'min-h-16 px-2 py-1.5', className)}
        {...rest}
      />
    </Field>
  );
}
