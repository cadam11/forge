/**
 * The search-overlay shape: a top-anchored modal with one input and a filtered, keyboard-driven
 * list. Three surfaces are exactly this — the command palette, the object search and the snippet
 * library — and in the Angular renderer they were three components with three hand-rolled
 * `position: fixed` overlays, three copies of an `onKeyDown` switch over ArrowUp/ArrowDown/Enter/
 * Escape, and three `selectedIndex` signals (`command-palette.component.ts:669`,
 * `object-search.component.ts:442`, `snippet-library.component.ts:569`). One of the three also
 * `pointer-events: none`'d its disabled rows and then checked `isEnabled` again inside the click
 * handler, which is what three copies of a keyboard model look like after a year.
 *
 * ── What comes from where ───────────────────────────────────────────────────────────────────
 *
 *  - **Radix Dialog** (through this app's own `Dialog`) supplies the scrim, the focus trap, the
 *    return of focus to whatever had it, Escape-to-close, the scroll lock and modality. None of
 *    that is re-implemented here; `dialog.spec.tsx` already pins it.
 *  - **cmdk** supplies the list semantics: `role="listbox"`/`option`, `aria-selected` tracking as
 *    the arrows move, wrap-around, and Enter activating the selected row. It is in the planned
 *    stack for exactly this (PLAN.md §4's primitives row).
 *  - **`utils/fuzzy.ts`** supplies the matching, and cmdk's own filter is switched OFF
 *    (`shouldFilter={false}`). That file's header explains why in full; the short version is that
 *    cmdk filters by mounting every row and hiding the misses, which the object search cannot
 *    afford, and that its scorer is not an importable export so it could not be tested on fixtures.
 *
 * ── The one rule callers must keep ──────────────────────────────────────────────────────────
 *
 * A disabled row is **rendered, not hidden**, and it says why it is disabled. That is a house rule
 * arrived at in J-44: an affordance that quietly disappears teaches the user nothing, and an
 * affordance that looks live and does nothing is worse. `CommandOverlayRow` therefore takes
 * `disabled` plus a `hint`, and cmdk's `data-disabled` styling is what greys it.
 */

import { Command } from 'cmdk';
import type { ComponentPropsWithRef, KeyboardEventHandler, ReactNode } from 'react';
import { Search } from 'lucide-react';
import * as RadixDialog from '@radix-ui/react-dialog';

import { cn } from './cn';
import { Dialog, DialogContent } from './dialog';
import { Icon } from './icon';
import { Spinner } from './spinner';

export interface CommandOverlayProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * The accessible name. Rendered into a visually-hidden `DialogTitle`, because Radix requires a
   * title and this surface's own title is its placeholder text (`dialog.tsx`'s header says so).
   */
  readonly label: string;
  readonly placeholder: string;
  /** The search text. Controlled, because every caller derives its rows from it. */
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /**
   * The highlighted row's `value`. Controlled for a reason specific to `shouldFilter={false}`: cmdk
   * keeps its own selection, and when the row list is replaced by a new query cmdk's remembered
   * value can name a row that no longer exists — Enter then does nothing. Callers pass the top
   * result and re-derive it as they re-rank.
   */
  readonly selected?: string;
  readonly onSelectedChange?: (value: string) => void;
  /** Prefix for this surface's testids: `palette` yields `palette-overlay`, `palette-input`, … */
  readonly testIdPrefix: string;
  /** A control in the input row — the snippet library's "New snippet" button. */
  readonly toolbar?: ReactNode;
  /** Shows a spinner in the input row. For a list that is still loading, not for an empty one. */
  readonly loading?: boolean;
  /** The status line under the list. Counts, key hints. */
  readonly footer?: ReactNode;
  /**
   * A capture-phase key handler on the surface, for a **modifier chord that must beat cmdk**.
   *
   * cmdk's own Enter handling does not inspect modifiers, so ⌘⏎ would activate the selected row as
   * well as doing whatever the caller intends. Capture on this ancestor runs before the input's own
   * handler, so `preventDefault()` + `stopPropagation()` there is the only way to claim the chord.
   * The object search's "reveal instead of open" is the one caller.
   */
  readonly onKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>;
  /** A block between the input row and the list — a banner, a tag filter, a warning. */
  readonly beforeList?: ReactNode;
  /** `Command.Group`s and `Command.Item`s — use `CommandOverlayGroup` / `CommandOverlayRow`. */
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * cmdk's root, input and list, inside a top-anchored dialog.
 *
 * `size="lg"` is not used: 36rem (576px) is the palette width the Angular original had (600px) minus
 * its border, and it fits the 800px minimum window with room either side.
 */
export function CommandOverlay({
  open,
  onOpenChange,
  label,
  placeholder,
  value,
  onValueChange,
  selected,
  onSelectedChange,
  testIdPrefix,
  toolbar,
  loading = false,
  footer,
  onKeyDownCapture,
  beforeList,
  children,
  className,
}: CommandOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        align="top"
        size="md"
        data-testid={`${testIdPrefix}-overlay`}
        className={cn('max-w-[36rem]', className)}
        onKeyDownCapture={onKeyDownCapture}
        // The list is the whole surface, so nothing else should take the caret: Radix would focus
        // the first tabbable node, which is a toolbar button when a caller supplies one.
        onOpenAutoFocus={event => {
          event.preventDefault();
          const input = document.querySelector<HTMLInputElement>(
            `[data-testid="${testIdPrefix}-input"]`
          );
          input?.focus();
        }}
      >
        <RadixDialog.Title className="sr-only">{label}</RadixDialog.Title>

        <Command
          // OFF. See the header, and `utils/fuzzy.ts`.
          shouldFilter={false}
          loop
          value={selected}
          onValueChange={onSelectedChange}
          label={label}
          className="flex min-h-0 flex-col"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-rule px-3 py-2.5">
            <Icon icon={Search} className="stroke-fg-muted" />
            {/* No focus ring, and that is deliberate rather than an omission of HOUSE-RULES' rule:
                this input is focused from the moment the overlay opens until it closes (Radix traps
                focus, and `onOpenAutoFocus` above puts it here), so a permanent ring would be
                decoration rather than information. The caret is the indicator, and the row's own
                hairline is its boundary. Every other focusable thing in here — a toolbar button, a
                row's delete button — is a `Button` and brings its own `focus-visible` ring. */}
            <Command.Input
              value={value}
              onValueChange={onValueChange}
              placeholder={placeholder}
              data-testid={`${testIdPrefix}-input`}
              className="min-w-0 grow bg-transparent text-md text-fg outline-hidden placeholder:text-fg-muted"
            />
            {loading ? <Spinner size="sm" /> : null}
            {toolbar}
          </div>

          {beforeList}

          {/* `max-h` in vh so the list is scrollable rather than pushing the footer off a short
              window; `overscroll-contain` so scrolling past the end does not scroll the workbench
              behind the scrim. */}
          <Command.List
            data-testid={`${testIdPrefix}-list`}
            className="max-h-[52vh] min-h-0 overflow-y-auto overscroll-contain p-1"
          >
            {children}
          </Command.List>

          {footer === undefined ? null : (
            <div
              data-testid={`${testIdPrefix}-footer`}
              className="flex shrink-0 items-center justify-between gap-3 border-t border-rule px-3 py-2 text-xs text-fg-muted"
            >
              {footer}
            </div>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** A group of rows with a mono eyebrow heading, matching the app's menus. */
export function CommandOverlayGroup({
  heading,
  children,
  ...rest
}: {
  readonly heading: string;
  readonly children: ReactNode;
} & ComponentPropsWithRef<'div'>) {
  return (
    <Command.Group
      heading={heading}
      className={cn(
        // cmdk renders the heading in a `[cmdk-group-heading]` div, which is the only way to reach
        // it — it is not a component this file can style directly.
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1',
        '[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-2xs',
        '[&_[cmdk-group-heading]]:tracking-eyebrow [&_[cmdk-group-heading]]:text-fg-muted',
        '[&_[cmdk-group-heading]]:uppercase'
      )}
      {...rest}
    >
      {children}
    </Command.Group>
  );
}

export interface CommandOverlayRowProps {
  /** cmdk's identity for the row. Must be unique within the overlay. */
  readonly value: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly testId?: string;
  /** Right-aligned: a keystroke hint, a badge, a delete button. */
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * One row. Two rungs taller than a menu item (`h-9` vs `h-7`) because these rows carry a label and a
 * hint on two lines, and taller still when a caller's children need it — `min-h` rather than `h`.
 *
 * `data-selected` is cmdk's, and it covers both pointer hover and keyboard movement, which is why
 * there is no `hover:` here (the same reasoning as `overlay.ts`).
 */
export function CommandOverlayRow({
  value,
  onSelect,
  disabled = false,
  testId,
  trailing,
  children,
  className,
}: CommandOverlayRowProps) {
  return (
    <Command.Item
      value={value}
      disabled={disabled}
      onSelect={onSelect}
      data-testid={testId}
      className={cn(
        'flex min-h-9 cursor-default items-center gap-2.5 rounded-xs px-2 py-1.5 select-none',
        'text-base text-fg outline-hidden',
        'data-[selected=true]:bg-hover',
        // Disabled rows stay visible and stay legible — a greyed row that says why beats a row that
        // vanished. `pointer-events-none` so the whole row is inert, cmdk's `onSelect` included.
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-60',
        className
      )}
    >
      {children}
      {trailing === undefined ? null : (
        <span className="ml-auto flex shrink-0 items-center gap-1.5">{trailing}</span>
      )}
    </Command.Item>
  );
}

/**
 * The two-line label a row usually carries. `min-w-0` and `truncate` on both lines, because an
 * object name or a SQL preview will overflow a 576px overlay (`flexbox-layout.md`).
 */
export function CommandOverlayRowText({
  label,
  hint,
}: {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
}) {
  return (
    <span className="flex min-w-0 grow flex-col">
      <span className="truncate">{label}</span>
      {hint === undefined ? null : <span className="truncate text-sm text-fg-muted">{hint}</span>}
    </span>
  );
}

/** The "nothing matched" row. cmdk renders it only when no item is visible. */
export function CommandOverlayEmpty({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <Command.Empty
      data-testid={testId}
      className="flex flex-col items-center gap-1 px-4 py-8 text-center text-base text-fg-muted"
    >
      {children}
    </Command.Empty>
  );
}
