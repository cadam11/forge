/**
 * The primitives. Import from `../ui`, never from a file inside it — that keeps the set
 * discoverable and makes "is there already a component for this?" answerable by reading one
 * file.
 *
 * Rules every primitive here honours, so a caller can assume them without checking:
 * accepts and merges `className` (through `cn`), bakes no margins, passes `data-testid`
 * through, has a `:focus-visible` treatment if it is interactive, and paints from Layer 2
 * tokens only so both themes follow with no `dark:` variants.
 *
 * ONE API wrinkle worth knowing before you reach for a form control: `Input`, `Textarea`,
 * `Select`, `Checkbox` and `Switch` render a label/hint/error wrapper, and their `className`
 * lands on **the control** — the `<input>`, the `<textarea>`, the select trigger — because that
 * is what `<Input className="w-40" />` means. The wrapper takes `fieldClassName`. See the header
 * of `field.tsx` for why the label lives inside the component at all (the Task 20 `getByLabel`
 * contract depends on it).
 *
 * SIX exports take no `className`, and the omission is deliberate rather than an oversight —
 * `contract.spec.tsx` covers the rest of the set, so this is the list it cannot:
 * `SelectGroup` / `SelectLabel` / `SelectSeparator` and `ToolbarSpacer` render fixed internal
 * geometry inside a surface whose look is the surface's business (a group eyebrow that a caller
 * could restyle is how two menus drift apart), `MenuRow` is a layout shape for the inside of a
 * menu item rather than an element in its own right, and `Toaster` is mounted once at the app
 * root and styles its toasts from tokens. If you find yourself wanting `className` on one of
 * these, the thing that needs changing is the shared class string in `overlay.ts`.
 *
 * `Markdown` is deliberately NOT re-exported here: it lives in `src/markdown/` because that is
 * the only path `eslint.config.js` allows `dangerouslySetInnerHTML` in, and re-exporting it
 * through `ui` would blur where that boundary is. Import it from `../markdown`.
 */

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './button';
export { Checkbox, type CheckboxProps } from './checkbox';
export { cn } from './cn';
export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  type ContextMenuItemProps,
} from './context-menu';
export {
  Dialog,
  DialogActions,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogContentProps,
  type DialogSize,
} from './dialog';
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  MenuRow,
  type DropdownMenuItemProps,
  type MenuRowProps,
} from './dropdown-menu';
export {
  EmptyState,
  emptyStateTitleClass,
  type EmptyStateProps,
  type EmptyStateSize,
} from './empty-state';
export {
  describedBy,
  Field,
  FieldMessages,
  InlineField,
  useFieldIds,
  type FieldIds,
  type FieldOwnProps,
} from './field';
export { Icon, type IconProps, type IconSize } from './icon';
export { Input, type InputProps } from './input';
export {
  MENU_CONTENT_CLASSES,
  MENU_ITEM_CLASSES,
  MENU_LABEL_CLASSES,
  MENU_SEPARATOR_CLASSES,
  OVERLAY_SURFACE_CLASSES,
  TOOLTIP_CONTENT_CLASSES,
} from './overlay';
export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger } from './popover';
export {
  Select,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  type SelectItemProps,
  type SelectProps,
} from './select';
export { Spinner, spinnerLabelClass, type SpinnerProps, type SpinnerSize } from './spinner';
export { Switch, type SwitchProps } from './switch';
export { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
export { Textarea, type TextareaProps } from './textarea';
export { installToastNotifier, Toaster, type ToasterProps } from './toaster';
export {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarSpacer,
  type ToolbarButtonProps,
} from './toolbar';
export { Tooltip, TooltipProvider, type TooltipProps } from './tooltip';
export {
  flattenTree,
  Tree,
  type TreeHandle,
  type TreeNode,
  type TreeProps,
  type TreeRow,
} from './tree';
