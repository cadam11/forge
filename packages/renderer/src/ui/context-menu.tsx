/**
 * Radix `ContextMenu` — the right-click twin of `DropdownMenu`, and the reason `Tree` can be
 * "context-menu-friendly" without inventing its own overlay.
 *
 * Separate file, same styling: see the header of `dropdown-menu.tsx` for why the two are not
 * one generic. `MenuRow` is imported from there rather than re-implemented, so a change to
 * the row shape lands in both.
 *
 * The trigger wraps the element the user right-clicks. In a tree that is the row, so
 * `ContextMenuTrigger` takes `asChild` and the row keeps its own markup.
 */

import type { ComponentPropsWithRef } from 'react';
import * as RadixContextMenu from '@radix-ui/react-context-menu';
import { Check, ChevronRight } from 'lucide-react';

import { cn } from './cn';
import { MenuRow, type MenuRowProps } from './dropdown-menu';
import { Icon } from './icon';
import {
  MENU_CONTENT_CLASSES,
  MENU_ITEM_CLASSES,
  MENU_LABEL_CLASSES,
  MENU_SEPARATOR_CLASSES,
} from './overlay';

export const ContextMenu = RadixContextMenu.Root;

export const ContextMenuTrigger = RadixContextMenu.Trigger;

export const ContextMenuGroup = RadixContextMenu.Group;

export function ContextMenuContent({
  className,
  // Wraps, for the same reason `DropdownMenuContent` does — see that declaration.
  loop = true,
  ...rest
}: ComponentPropsWithRef<typeof RadixContextMenu.Content>) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.Content
        loop={loop}
        className={cn(MENU_CONTENT_CLASSES, className)}
        {...rest}
      />
    </RadixContextMenu.Portal>
  );
}

/** An intersection for the same reason as `DropdownMenuItemProps` — see that declaration. */
export type ContextMenuItemProps = ComponentPropsWithRef<typeof RadixContextMenu.Item> &
  MenuRowProps;

export function ContextMenuItem({
  icon,
  shortcut,
  className,
  children,
  ...rest
}: ContextMenuItemProps) {
  return (
    <RadixContextMenu.Item className={cn(MENU_ITEM_CLASSES, className)} {...rest}>
      <MenuRow icon={icon} shortcut={shortcut}>
        {children}
      </MenuRow>
    </RadixContextMenu.Item>
  );
}

export function ContextMenuCheckboxItem({
  className,
  children,
  shortcut,
  ...rest
}: ComponentPropsWithRef<typeof RadixContextMenu.CheckboxItem> & { readonly shortcut?: string }) {
  return (
    <RadixContextMenu.CheckboxItem className={cn(MENU_ITEM_CLASSES, className)} {...rest}>
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        <RadixContextMenu.ItemIndicator asChild>
          <Icon icon={Check} size="sm" className="stroke-accent" />
        </RadixContextMenu.ItemIndicator>
      </span>
      <MenuRow shortcut={shortcut}>{children}</MenuRow>
    </RadixContextMenu.CheckboxItem>
  );
}

export function ContextMenuLabel({
  className,
  ...rest
}: ComponentPropsWithRef<typeof RadixContextMenu.Label>) {
  return <RadixContextMenu.Label className={cn(MENU_LABEL_CLASSES, className)} {...rest} />;
}

export function ContextMenuSeparator({
  className,
  ...rest
}: ComponentPropsWithRef<typeof RadixContextMenu.Separator>) {
  return <RadixContextMenu.Separator className={cn(MENU_SEPARATOR_CLASSES, className)} {...rest} />;
}

export const ContextMenuSub = RadixContextMenu.Sub;

export function ContextMenuSubTrigger({
  icon,
  className,
  children,
  ...rest
}: ComponentPropsWithRef<typeof RadixContextMenu.SubTrigger> & Pick<MenuRowProps, 'icon'>) {
  return (
    <RadixContextMenu.SubTrigger
      className={cn(MENU_ITEM_CLASSES, 'data-[state=open]:bg-hover', className)}
      {...rest}
    >
      {icon === undefined ? null : <Icon icon={icon} size="sm" className="stroke-fg-muted" />}
      <span className="min-w-0 grow truncate">{children}</span>
      <Icon icon={ChevronRight} size="sm" className="stroke-fg-subtle" />
    </RadixContextMenu.SubTrigger>
  );
}

export function ContextMenuSubContent({
  className,
  loop = true,
  ...rest
}: ComponentPropsWithRef<typeof RadixContextMenu.SubContent>) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.SubContent
        loop={loop}
        className={cn(MENU_CONTENT_CLASSES, className)}
        {...rest}
      />
    </RadixContextMenu.Portal>
  );
}
