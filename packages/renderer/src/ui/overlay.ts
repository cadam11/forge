/**
 * The class sets shared by every floating surface: the dialog, both menus, the popover, the
 * select list and the tooltip.
 *
 * They are class *strings* rather than components because Radix ships a separate `Item` /
 * `Content` / `Separator` component per primitive — `DropdownMenu.Item` and
 * `ContextMenu.Item` are different types that must look identical. Sharing the styling here
 * is the only way to guarantee they cannot drift; sharing a wrapper component is not
 * possible without an `asChild` layer per primitive, which is the "layer of magic" the
 * house style rejects.
 *
 * Radix drives every state through a data attribute, which is why these read as
 * `data-highlighted:` rather than `hover:` — a menu item's keyboard-highlighted state and
 * its pointer-hovered state are the same state to Radix, and styling only `hover:` would
 * leave arrow-key navigation invisible. `focus-visible:` is doubled up on top so the ring
 * survives even if a future Radix version stops setting the attribute (HOUSE-RULES: focus
 * styling is not optional).
 *
 * Radii are concentric per `border-radius.md`: a `rounded-md` (6px) surface with `p-1` (4px)
 * padding puts its children at `rounded-xs` (2px).
 *
 * Deliberately no enter/exit animation. `interactivity.md` allows it (an overlay genuinely
 * moves), but the both-theme gallery screenshots are a gate artifact and an in-flight
 * transition makes them non-deterministic.
 */

import { cn } from './cn';

/** Border + fill + separation for anything that floats over the workbench. */
export const OVERLAY_SURFACE_CLASSES = cn(
  'z-50 rounded-md border border-rule-strong bg-elevated text-fg shadow-overlay'
);

/** A menu or select list: the overlay surface plus the padding the items are inset by. */
export const MENU_CONTENT_CLASSES = cn(OVERLAY_SURFACE_CLASSES, 'min-w-40 overflow-hidden p-1');

/**
 * One row in a menu or select list. 28px tall — the same rung as `Button`'s `sm`, because a
 * menu row and a toolbar button sit next to each other in this app's chrome.
 *
 * `cursor-default`: these are not links, and a pointer cursor on a menu row is a web habit.
 */
export const MENU_ITEM_CLASSES = cn(
  'flex h-7 cursor-default items-center gap-2 rounded-xs px-2 text-base text-fg select-none',
  'outline-hidden data-highlighted:bg-hover focus-visible:bg-hover',
  'data-disabled:pointer-events-none data-disabled:opacity-50'
);

/**
 * A group heading inside a menu. Mono uppercase eyebrow, per HOUSE-RULES §2.
 *
 * `text-fg-muted`, not `text-fg-subtle`: subtle measures 3.57:1 on `bg-elevated` under ink and
 * 4.01:1 under ivory (task-6-gate.json), and HOUSE-RULES §5 reserves it for metadata nobody has
 * to read. A group heading is read. Muted is 6.11:1 / 6.40:1 on the same surface.
 */
export const MENU_LABEL_CLASSES = cn(
  'px-2 py-1 font-mono text-2xs tracking-eyebrow text-fg-muted uppercase'
);

/**
 * A hairline between menu groups. The two margins are internal geometry, not the
 * "no baked margins" case: `my-1` is the gap the rule needs on both sides and `-mx-1`
 * cancels the content's `p-1` so the rule runs the full width of the surface.
 */
export const MENU_SEPARATOR_CLASSES = cn('-mx-1 my-1 h-px bg-rule');

/** Tooltip bubble. `text-sm` is the 12px body floor — a tooltip is prose. */
export const TOOLTIP_CONTENT_CLASSES = cn(
  'z-50 max-w-64 rounded-sm border border-rule-strong bg-elevated px-2 py-1 text-sm text-fg',
  'shadow-overlay text-pretty'
);
