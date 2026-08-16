/**
 * Radix `DropdownMenu` — the click-a-trigger menu, replacing 70 `mat-menu` uses.
 *
 * `ContextMenu` is its right-click twin and is a separate file on purpose. Radix ships two
 * unrelated component sets whose `Item` types are not interchangeable, so the only thing the
 * two can safely share is the styling, which lives in `overlay.ts`. A factory that stamped
 * both out of one generic would save ~60 lines and cost the ability to read either one
 * top-to-bottom.
 *
 * Radix owns the keyboard model: Arrow keys move between items and wrap, typing jumps to a
 * matching label, Escape closes, arrow-into-submenu opens. `dropdown-menu.spec.tsx` asserts
 * it rather than trusting it.
 *
 * Items take `icon` and `shortcut` props instead of leaving them to the call site, because a
 * menu whose rows have differently-sized icon slots is the exact drift the 19 divergent empty
 * states came from.
 */

import type { ComponentPropsWithRef, ReactNode } from 'react';
import * as RadixDropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';

import { cn } from './cn';
import { Icon } from './icon';
import type { IconProps } from './icon';
import {
  MENU_CONTENT_CLASSES,
  MENU_ITEM_CLASSES,
  MENU_LABEL_CLASSES,
  MENU_SEPARATOR_CLASSES,
} from './overlay';

export const DropdownMenu = RadixDropdownMenu.Root;

/** `<DropdownMenuTrigger asChild><Button …/></DropdownMenuTrigger>`. */
export const DropdownMenuTrigger = RadixDropdownMenu.Trigger;

export const DropdownMenuGroup = RadixDropdownMenu.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  align = 'start',
  // Radix does not wrap by default. A desktop menu does — ArrowDown off the last item goes
  // back to the first, which is what Material's menus did and what the 70 call sites this
  // replaces were built against.
  loop = true,
  ...rest
}: ComponentPropsWithRef<typeof RadixDropdownMenu.Content>) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.Content
        sideOffset={sideOffset}
        align={align}
        loop={loop}
        className={cn(MENU_CONTENT_CLASSES, className)}
        {...rest}
      />
    </RadixDropdownMenu.Portal>
  );
}

/**
 * The row shape every menu in the app shares: optional leading icon, growing label, optional
 * trailing shortcut.
 *
 * The label grows rather than the shortcut carrying `ml-auto`, which keeps `general.md`'s
 * "no margins between flex children" intact.
 */
export interface MenuRowProps {
  readonly icon?: IconProps['icon'];
  readonly shortcut?: string;
  /** Optional so the interface composes with Radix's own item props, which also declare it. */
  readonly children?: ReactNode;
}

export function MenuRow({ icon, shortcut, children }: MenuRowProps) {
  return (
    <>
      {icon === undefined ? null : <Icon icon={icon} size="sm" className="stroke-fg-muted" />}
      <span className="min-w-0 grow truncate">{children}</span>
      {shortcut === undefined ? null : (
        // A <kbd> is the right element for a shortcut. It is a flex child here, so it is
        // blockified and the inline-element hazard `general.md`'s text-* rule guards
        // against does not apply.
        //
        // `text-fg-muted` rather than subtle for the contrast reason recorded in
        // MENU_LABEL_CLASSES: a shortcut hint is read, not decoration.
        <kbd className="font-mono text-xs text-fg-muted tabular-nums">{shortcut}</kbd>
      )}
    </>
  );
}

// An intersection, not `interface … extends`: `MenuRowProps` declares `children` as
// `readonly`, and two interfaces may only be extended together when every shared member is
// *identical* — the modifier alone is enough to make them differ.
export type DropdownMenuItemProps = ComponentPropsWithRef<typeof RadixDropdownMenu.Item> &
  MenuRowProps;

export function DropdownMenuItem({
  icon,
  shortcut,
  className,
  children,
  ...rest
}: DropdownMenuItemProps) {
  return (
    <RadixDropdownMenu.Item className={cn(MENU_ITEM_CLASSES, className)} {...rest}>
      <MenuRow icon={icon} shortcut={shortcut}>
        {children}
      </MenuRow>
    </RadixDropdownMenu.Item>
  );
}

/** A toggle row. The tick occupies a fixed slot so labels stay aligned when unchecked. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  shortcut,
  ...rest
}: ComponentPropsWithRef<typeof RadixDropdownMenu.CheckboxItem> & { readonly shortcut?: string }) {
  return (
    <RadixDropdownMenu.CheckboxItem className={cn(MENU_ITEM_CLASSES, className)} {...rest}>
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        <RadixDropdownMenu.ItemIndicator asChild>
          <Icon icon={Check} size="sm" className="stroke-accent" />
        </RadixDropdownMenu.ItemIndicator>
      </span>
      <MenuRow shortcut={shortcut}>{children}</MenuRow>
    </RadixDropdownMenu.CheckboxItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...rest
}: ComponentPropsWithRef<typeof RadixDropdownMenu.Label>) {
  return <RadixDropdownMenu.Label className={cn(MENU_LABEL_CLASSES, className)} {...rest} />;
}

export function DropdownMenuSeparator({
  className,
  ...rest
}: ComponentPropsWithRef<typeof RadixDropdownMenu.Separator>) {
  return (
    <RadixDropdownMenu.Separator className={cn(MENU_SEPARATOR_CLASSES, className)} {...rest} />
  );
}

export const DropdownMenuSub = RadixDropdownMenu.Sub;

export function DropdownMenuSubTrigger({
  icon,
  className,
  children,
  ...rest
}: ComponentPropsWithRef<typeof RadixDropdownMenu.SubTrigger> & Pick<MenuRowProps, 'icon'>) {
  return (
    <RadixDropdownMenu.SubTrigger
      className={cn(MENU_ITEM_CLASSES, 'data-[state=open]:bg-hover', className)}
      {...rest}
    >
      {icon === undefined ? null : <Icon icon={icon} size="sm" className="stroke-fg-muted" />}
      <span className="min-w-0 grow truncate">{children}</span>
      <Icon icon={ChevronRight} size="sm" className="stroke-fg-subtle" />
    </RadixDropdownMenu.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  sideOffset = 2,
  loop = true,
  ...rest
}: ComponentPropsWithRef<typeof RadixDropdownMenu.SubContent>) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.SubContent
        sideOffset={sideOffset}
        loop={loop}
        className={cn(MENU_CONTENT_CLASSES, className)}
        {...rest}
      />
    </RadixDropdownMenu.Portal>
  );
}
