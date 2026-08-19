/**
 * The label / hint / error scaffolding every form control shares.
 *
 * Why the controls own their label instead of the call site wiring one up: the Task 20 e2e
 * helper contract is that `fillField` collapses to `getByLabel` (PLAN §Task 20). The Angular
 * app could not do that — `tests/helpers/joinery-actions.ts:78-88` carries a comment
 * explaining that Material's label association defeats `getByLabel`, so it located
 * `mat-form-field` filtered by `mat-label:text-is(…)` instead. A real `<label for>` emitted
 * by the control itself is what makes the simple locator work, and making it the caller's
 * job is how it silently stops working.
 *
 * `<label for>` reaches the Radix `Select` too, and legitimately: `<button>` is a labelable
 * element in HTML, so the association is real rather than an ARIA patch.
 *
 * ## The two className props
 *
 * Every control takes `className`, which lands on **the control element** — the `<input>`,
 * the `<textarea>`, the select trigger. That is what a call site means by
 * `<Input className="w-40" />`. The wrapper this module renders takes `fieldClassName`.
 * `componentize` asks for the merge to reach the top-level element, and it does — the
 * wrapper is reachable, just under its own name, because a component called `Input` whose
 * `className` styled a `<div>` would be a trap.
 *
 * No margins anywhere: the wrapper is a `gap-*` flex column, and vertical rhythm between
 * fields is the caller's `gap-*`.
 */

import { useId, type ReactNode } from 'react';

import { cn } from './cn';

export interface FieldIds {
  readonly controlId: string;
  readonly labelId: string;
  readonly hintId: string;
  readonly errorId: string;
}

/**
 * Stable ids for one control. `id` overrides the generated one so a caller that already
 * owns the id (a form library, a menu that has to reference it) keeps control.
 */
export function useFieldIds(id?: string): FieldIds {
  const generated = useId();
  const controlId = id ?? `${generated}control`;
  return {
    controlId,
    labelId: `${controlId}-label`,
    hintId: `${controlId}-hint`,
    errorId: `${controlId}-error`,
  };
}

/**
 * The `aria-describedby` value for a control, or `undefined` when it has nothing to
 * describe it. Both messages are referenced when both are shown, so an error never hides
 * the hint from a screen reader.
 */
export function describedBy(
  ids: FieldIds,
  { hint, error }: { hint?: string; error?: string }
): string | undefined {
  const parts = [
    hint === undefined ? null : ids.hintId,
    error === undefined ? null : ids.errorId,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? undefined : parts.join(' ');
}

export interface FieldMessagesProps {
  readonly ids: FieldIds;
  readonly hint?: string;
  readonly error?: string;
}

/**
 * Hint and error text. `text-sm` (12px, the body floor) rather than `text-xs`: these are
 * prose a user has to read. `text-fg-muted`, never `text-fg-subtle` — HOUSE-RULES §5 puts
 * subtle at 3.11:1 on light chrome and reserves it for metadata.
 */
export function FieldMessages({ ids, hint, error }: FieldMessagesProps) {
  return (
    <>
      {hint === undefined ? null : (
        <p id={ids.hintId} className="text-sm text-fg-muted text-pretty">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={ids.errorId} role="alert" className="text-sm text-danger text-pretty">
          {error}
        </p>
      )}
    </>
  );
}

/** Props every control re-exports so its own signature stays one line. */
export interface FieldOwnProps {
  /** Visible label. Omit only when the control carries its own `aria-label`. */
  readonly label?: string;
  readonly hint?: string;
  /** Non-empty error text switches the control to its invalid styling and announces it. */
  readonly error?: string;
  /** Classes for the wrapper. `className` goes to the control itself — see the file header. */
  readonly fieldClassName?: string;
}

export interface FieldProps extends FieldOwnProps {
  readonly ids: FieldIds;
  readonly children: ReactNode;
}

/** Label above, control, then messages. The shape for text-like controls. */
export function Field({ ids, label, hint, error, fieldClassName, children }: FieldProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', fieldClassName)}>
      {label === undefined ? null : (
        <label id={ids.labelId} htmlFor={ids.controlId} className="text-sm text-fg">
          {label}
        </label>
      )}
      {children}
      <FieldMessages ids={ids} hint={hint} error={error} />
    </div>
  );
}

/** Control first, label beside it, messages under both. The shape for checkbox and switch. */
export function InlineField({ ids, label, hint, error, fieldClassName, children }: FieldProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', fieldClassName)}>
      <div className="flex items-center gap-2 text-base">
        {children}
        {label === undefined ? null : (
          <label id={ids.labelId} htmlFor={ids.controlId} className="min-w-0 text-fg">
            {label}
          </label>
        )}
      </div>
      <FieldMessages ids={ids} hint={hint} error={error} />
    </div>
  );
}

/**
 * The box shared by `<input>`, `<textarea>` and the select trigger, so the three cannot
 * drift. Focus is a 2px ring inset by 1px, which is exactly what `form-controls.md`
 * prescribes for inputs — an outset ring on a control that already has a border reads as a
 * double border.
 */
export const CONTROL_BOX_CLASSES = cn(
  'w-full min-w-0 rounded-sm border border-rule-strong bg-surface text-base text-fg',
  'placeholder:text-fg-subtle',
  'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-invalid:border-danger'
);

/** 34px, the same as `Button`'s `md`. A form row and its actions line up. */
export const CONTROL_HEIGHT_CLASS = 'h-8.5';
