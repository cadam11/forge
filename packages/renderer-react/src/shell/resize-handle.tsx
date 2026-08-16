/**
 * A keyboard-operable pane divider — the fix for one of the audit's shell findings verbatim:
 * "`.resize-handle` is a 4px target with `margin: 0 -2px`, no `role="separator"`, no focus style,
 * not keyboard-operable" (§1.9).
 *
 * The ARIA window-splitter pattern, in full: `role="separator"` with `aria-valuenow/min/max`, in the
 * tab order, arrow keys to nudge, ⇧+arrow to move faster, Home/End to jump to the extremes, and
 * Enter to reset to the default. That is also what makes the divider operable at all for anyone who
 * cannot make a 5px drag.
 *
 * ── It also owns the hairline ─────────────────────────────────────────────────────────────
 *
 * The audit's other shell finding is confused border ownership — a rule declared by one neighbour,
 * sometimes both. The shell's rule is: **a divider draws its own hairline, and no pane draws a
 * border on a side where a divider already is.** So this component renders a 5px hit target with a
 * 1px `border-rule` line inside it, and neither adjoining pane has a border on that edge. The whole
 * arrangement is then one place to look, and the 5px target is 1px more generous than the old one
 * while needing no negative margins to overlap its neighbours.
 */

import { useCallback, useEffect, useRef } from 'react';
import { cn } from '../ui';

/**
 * Which side of the divider the pane being resized is on. `leading` = before it (the sidebar), so
 * dragging right grows the pane; `trailing` = after it (the chat panel), so dragging right shrinks
 * it. Getting this from the caller rather than inferring it keeps the sign in one place.
 */
export type ResizeEdge = 'leading' | 'trailing';

export interface ResizeHandleProps {
  readonly label: string;
  readonly testId: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly edge: ResizeEdge;
  readonly onChange: (value: number) => void;
  /** Double-click and Enter both reset. Omit to make the divider drag/nudge-only. */
  readonly onReset?: () => void;
  /** Arrow-key step. ⇧+arrow multiplies it by `COARSE_MULTIPLIER`. */
  readonly step?: number;
}

const DEFAULT_STEP = 8;
const COARSE_MULTIPLIER = 4;

export function ResizeHandle({
  label,
  testId,
  value,
  min,
  max,
  edge,
  onChange,
  onReset,
  step = DEFAULT_STEP,
}: ResizeHandleProps) {
  /** Drag origin. A ref because a drag is not state — nothing renders differently mid-drag. */
  const drag = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null);
  const direction = edge === 'leading' ? 1 : -1;

  /**
   * Text selection has to be suppressed for the duration of a drag, and this is the one DOM write
   * in the component. `restoreSelection` is idempotent and is called from both the pointer-up path
   * and the unmount path — a drag interrupted by a re-render must not leave the document
   * unselectable forever.
   */
  const dragging = useRef(false);
  const restoreSelection = useCallback((): void => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.removeProperty('user-select');
  }, []);

  useEffect(() => restoreSelection, [restoreSelection]);

  const clamp = (next: number): number => Math.min(max, Math.max(min, Math.round(next)));

  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex --
     A FOCUSABLE separator is the ARIA "window splitter" pattern
     (https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/): `role="separator"` with
     `aria-valuenow`/`min`/`max` and `tabindex="0"`, driven by arrow keys. jsx-a11y classifies
     `separator` as non-interactive unconditionally and has no option for the valued form, so these
     two rules cannot distinguish the pattern from the mistake they are for. Scoped to this one
     component, whose entire purpose is to implement the keyboard half the pattern requires — the
     audit §1.9 finding it exists to fix. */
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      data-testid={testId}
      tabIndex={0}
      className={cn(
        // 5px of hit area with the hairline drawn inside it, so the divider IS the border.
        'group relative flex w-[5px] shrink-0 cursor-col-resize touch-none justify-center',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus'
      )}
      onPointerDown={event => {
        // Primary button only: a right-click on a divider should reach the context menu, not begin
        // a drag that no pointer-up will end.
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: value };
        // Pointer capture keeps the move/up events coming to this element even when the pointer
        // leaves it, which is why this component installs no document-level listeners.
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        document.body.style.setProperty('user-select', 'none');
      }}
      onPointerMove={event => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        onChange(clamp(active.startValue + (event.clientX - active.startX) * direction));
      }}
      onPointerUp={event => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        restoreSelection();
      }}
      onPointerCancel={() => {
        drag.current = null;
        restoreSelection();
      }}
      onDoubleClick={onReset}
      onKeyDown={event => {
        const distance = step * (event.shiftKey ? COARSE_MULTIPLIER : 1);
        if (event.key === 'ArrowLeft') onChange(clamp(value - distance * direction));
        else if (event.key === 'ArrowRight') onChange(clamp(value + distance * direction));
        else if (event.key === 'Home') onChange(edge === 'leading' ? min : max);
        else if (event.key === 'End') onChange(edge === 'leading' ? max : min);
        else if (event.key === 'Enter' && onReset) onReset();
        else return;
        // Only reached when a key was handled, so an unhandled key still bubbles to the shell's
        // own shortcuts.
        event.preventDefault();
      }}
    >
      {/* The hairline, plus the hover/drag state. Oxide on interaction is one of the four jobs the
          accent is allowed (HOUSE-RULES §5); at rest this is `border-rule` and nothing else. */}
      <span
        aria-hidden="true"
        className={cn(
          'w-px self-stretch bg-rule transition-colors',
          'group-hover:bg-accent group-focus-visible:bg-accent'
        )}
      />
    </div>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
}
