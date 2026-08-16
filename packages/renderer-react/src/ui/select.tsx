/**
 * Radix `Select` in the shared control box, replacing 44 `mat-select` uses.
 *
 * Radix rather than a native `<select>` with `form-controls.md`'s custom-chevron pattern,
 * because the list has to be a styled overlay that matches the two menus — a native
 * dropdown paints in the OS's colours and ignores the theme entirely, which in a dark-first
 * desktop app is the exact defect PROPOSAL was written against. The `form-controls.md`
 * chevron rule is honoured in spirit: one chevron, inside the box, `pointer-events-none`.
 *
 * The label is a real `<label for>` pointing at the trigger. That is valid HTML, not an ARIA
 * patch: `<button>` is a labelable element, so `getByLabel` works and clicking the label
 * activates the trigger. See `field.tsx` for why that matters.
 *
 * Radix's Root renders a hidden native `<select name>` of its own for form participation, so
 * `name`, `required` and `form` are passed there and the visible trigger stays a button.
 *
 * ## Why the props are split rather than hand-listed
 *
 * Everything the trigger is — a `<button>` — passes through by extending
 * `ComponentPropsWithRef`, the same discipline as the other seventeen primitives, so `ref`,
 * `onBlur`, `onFocus` and the `aria-*` attributes need no per-prop plumbing. The handful the
 * Root owns instead (`value`, `open`, `name`, `form`, `disabled`, …) are listed explicitly and
 * subtracted from the trigger's set, because the two disagree about what they mean: a
 * `<button form>` submits a form, a Radix `Root form` associates the hidden `<select>` with
 * one, and `disabled` has to reach the Root or the list would still open from the keyboard.
 */

import type { ComponentPropsWithRef, ReactNode } from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

import { cn } from './cn';
import {
  CONTROL_BOX_CLASSES,
  CONTROL_HEIGHT_CLASS,
  describedBy,
  Field,
  useFieldIds,
  type FieldOwnProps,
} from './field';
import { Icon } from './icon';
import {
  MENU_CONTENT_CLASSES,
  MENU_ITEM_CLASSES,
  MENU_LABEL_CLASSES,
  MENU_SEPARATOR_CLASSES,
} from './overlay';

/**
 * The trigger's own props, minus the ones the Root owns or this component computes. Listed as
 * an `Omit` rather than a re-declaration so a Radix upgrade that adds a button prop adds it
 * here too.
 */
type SelectTriggerPassthrough = Omit<
  ComponentPropsWithRef<typeof RadixSelect.Trigger>,
  | 'asChild'
  | 'children'
  | 'name'
  | 'value'
  | 'form'
  | 'disabled'
  | 'required'
  | 'id'
  | 'aria-invalid'
  | 'aria-describedby'
>;

export interface SelectProps extends FieldOwnProps, SelectTriggerPassthrough {
  readonly name: string;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  /** Associates the hidden native `<select>` with a form it is not nested inside. */
  readonly form?: string;
  /** Controlled open state. Pair with `onOpenChange`, or use `defaultOpen` and neither. */
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly id?: string;
  /** Classes for the trigger — the control element. The wrapper takes `fieldClassName`. */
  readonly className?: string;
  readonly 'data-testid'?: string;
  /** `SelectItem` / `SelectGroup` / `SelectSeparator`. */
  readonly children: ReactNode;
}

export function Select({
  label,
  hint,
  error,
  fieldClassName,
  className,
  id,
  name,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  disabled,
  required,
  form,
  open,
  defaultOpen,
  onOpenChange,
  children,
  'data-testid': testId,
  ...trigger
}: SelectProps) {
  const ids = useFieldIds(id);
  return (
    <Field ids={ids} label={label} hint={hint} error={error} fieldClassName={fieldClassName}>
      <RadixSelect.Root
        name={name}
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
        required={required}
        form={form}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
      >
        <RadixSelect.Trigger
          // The caller's props first, so nothing below can be clobbered by a passthrough —
          // the id in particular is what the `<label for>` points at.
          {...trigger}
          id={ids.controlId}
          data-testid={testId}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy(ids, { hint, error })}
          className={cn(
            CONTROL_BOX_CLASSES,
            CONTROL_HEIGHT_CLASS,
            'flex items-center justify-between gap-2 px-2 text-left',
            'data-placeholder:text-fg-subtle',
            className
          )}
        >
          {/* min-w-0 + truncate: a long database name must not push the chevron out of the box. */}
          <span className="min-w-0 truncate">
            <RadixSelect.Value placeholder={placeholder} />
          </span>
          <RadixSelect.Icon asChild>
            <Icon icon={ChevronDown} size="sm" className="stroke-fg-muted" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            // Matches the trigger's width instead of sizing to the longest option. Radix
            // publishes it as a custom property on the content element; a 200px "Engine" field
            // whose list is 160px wide reads as a bug.
            className={cn(MENU_CONTENT_CLASSES, 'max-h-64 min-w-(--radix-select-trigger-width)')}
          >
            <RadixSelect.Viewport>{children}</RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </Field>
  );
}

export interface SelectItemProps extends ComponentPropsWithRef<typeof RadixSelect.Item> {
  readonly value: string;
}

export function SelectItem({ className, children, ...rest }: SelectItemProps) {
  return (
    <RadixSelect.Item className={cn(MENU_ITEM_CLASSES, 'pl-1.5', className)} {...rest}>
      {/* Fixed slot so labels stay aligned whether or not the row is the selected one. */}
      <span className="flex size-4 shrink-0 items-center justify-center">
        <RadixSelect.ItemIndicator asChild>
          {/* A tick is a graphic, so accent's 3.91:1 on `bg-elevated` clears the 3:1 bar
              that HOUSE-RULES §5 says accent *text* on elevated does not. */}
          <Icon icon={Check} size="sm" className="stroke-accent" />
        </RadixSelect.ItemIndicator>
      </span>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}

export function SelectGroup({ children }: { readonly children: ReactNode }) {
  return <RadixSelect.Group>{children}</RadixSelect.Group>;
}

export function SelectLabel({ children }: { readonly children: ReactNode }) {
  return <RadixSelect.Label className={MENU_LABEL_CLASSES}>{children}</RadixSelect.Label>;
}

export function SelectSeparator() {
  return <RadixSelect.Separator className={MENU_SEPARATOR_CLASSES} />;
}
