/**
 * The tour spotlight: a hole cut over one element, and a tooltip beside it.
 *
 * Replaces `shared/components/tour-overlay/tour-overlay.component.ts` (312). The step machine is
 * `state/tours.ts`; this file is the geometry, and the geometry is where the original was broken — see
 * that store's header for the plain-field-read-by-a-computed defect that pinned the spotlight at
 * `top: -8px; left: -8px; 16×16` for the whole tour.
 *
 * ── The measurement, and where it happens ───────────────────────────────────────────────────
 *
 * Three things move the target: the step changing, a window resize, and a scroll anywhere in the document
 * (capturing, because the sidebar tree and the workspace both scroll inside themselves and a bubbling
 * listener on `window` would never see it). The last two are external systems, so they measure in their
 * own listeners. The FIRST is React state, and measuring it in an effect is what
 * `react-hooks/set-state-in-effect` rejects — so it is done the way React documents for reacting to a
 * changed value: adjusted during render, with the branch storing the target it reacted to, so it runs
 * once per step and cannot loop. That is the same shape `features/query/confirm-execute-dialog.tsx`
 * already uses, and it has the side benefit of being measured on the frame the step appears rather than
 * one frame later (the Angular version used `requestAnimationFrame`, which is one visible jump).
 *
 * ── What happens when the target is not there ───────────────────────────────────────────────
 *
 * The Angular version centred a 200×100 box on the screen and carried on, so a step whose selector had
 * gone stale showed a spotlight over nothing with confident prose beside it. Here a missing target
 * renders the tooltip **centred, with no spotlight at all** and the step still readable — the copy is
 * worth having even when the thing it points at is not on screen (a collapsed sidebar, a docked panel
 * the user closed) — and `data-target-found="false"` says which case it is, so a test can tell them
 * apart and a renamed testid shows up as a failure rather than as a shrug.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';

import {
  selectCurrentStep,
  selectIsLastStep,
  selectNextTour,
  selectStepCount,
  toursStore,
  useToursStore,
} from '../../state/tours';
import { Button, Icon, cn } from '../../ui';

/** Breathing room around the spotlit element, in px. The Angular value. */
const SPOTLIGHT_PADDING = 8;
/** The tooltip's fixed width, and the gap it keeps from the target. Both Angular values. */
const TOOLTIP_WIDTH = 320;
const TOOLTIP_GAP = 16;
/** Enough for a title, three lines of prose and the footer — the clamp only needs a bound, not a fit. */
const TOOLTIP_HEIGHT_ESTIMATE = 190;
/** How far the tooltip stays from the window edge. */
const VIEWPORT_MARGIN = 16;

interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export function TourOverlay() {
  const step = useToursStore(selectCurrentStep);
  const stepIndex = useToursStore(state => state.stepIndex);
  const stepCount = useToursStore(selectStepCount);
  const isLastStep = useToursStore(selectIsLastStep);
  const nextTour = useToursStore(selectNextTour);

  const target = step?.target;

  /**
   * The measured rectangle, and the target it was measured for. `rect: null` means the target is not in
   * the document — see the header for what that renders.
   */
  const [measured, setMeasured] = useState<{
    readonly target: string | undefined;
    readonly rect: Rect | null;
  }>(() => ({ target, rect: measureTarget(target) }));

  // Re-measure when the STEP changes, during render rather than in an effect. Bounded: the branch stores
  // the target it reacted to, so it runs once per step.
  if (measured.target !== target) {
    setMeasured({ target, rect: measureTarget(target) });
  }
  const rect = measured.target === target ? measured.rect : measureTarget(target);

  const remeasure = useCallback((): void => {
    setMeasured(current => ({ target: current.target, rect: measureTarget(current.target) }));
  }, []);

  useEffect(() => {
    if (target === undefined) return;
    window.addEventListener('resize', remeasure);
    // Capturing: the sidebar tree and the dock both scroll inside themselves, and a scroll event from a
    // nested element does not bubble to `window`.
    document.addEventListener('scroll', remeasure, true);
    return () => {
      window.removeEventListener('resize', remeasure);
      document.removeEventListener('scroll', remeasure, true);
    };
  }, [remeasure, target]);

  // Escape ends the tour. On `document`, because the overlay's own tooltip may not have focus — the user
  // may have tabbed into the app behind it, which is allowed: this overlay is not a modal.
  useEffect(() => {
    if (step === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      toursStore.getState().dismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [step]);

  if (step === null) return null;

  const placement = rect === null ? 'center' : step.placement;
  const tooltipStyle = tooltipPosition(rect, step.placement);

  return (
    <div
      data-testid="tour-overlay"
      data-target-found={rect !== null}
      data-placement={placement}
      // `fixed inset-0`, and NOT `pointer-events-auto` on the backdrop: the Angular backdrop swallowed
      // every click and dismissed the tour on any of them that missed the tooltip, so a user who clicked
      // the very thing being pointed at lost the tour. Here the backdrop is inert and the two buttons in
      // the tooltip are the only way out (plus Escape).
      className="pointer-events-none fixed inset-0 z-50"
    >
      {rect === null ? null : (
        <div
          aria-hidden
          data-testid="tour-spotlight"
          // The scrim IS the spotlight: one enormous spread shadow paints everything except this box.
          // A four-rectangle backdrop was the alternative and is four things that can disagree.
          className="absolute rounded-sm shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] outline-2 outline-accent"
          style={
            {
              top: `${rect.top - SPOTLIGHT_PADDING}px`,
              left: `${rect.left - SPOTLIGHT_PADDING}px`,
              width: `${rect.width + SPOTLIGHT_PADDING * 2}px`,
              height: `${rect.height + SPOTLIGHT_PADDING * 2}px`,
            } as CSSProperties
          }
        />
      )}

      <div
        role="dialog"
        aria-label={step.title}
        data-testid="tour-tooltip"
        className={cn(
          'pointer-events-auto absolute flex w-80 flex-col gap-2 rounded-md border border-rule',
          'bg-elevated p-3 shadow-overlay'
        )}
        style={tooltipStyle}
      >
        <div className="flex items-start gap-2">
          <h2 className="grow text-lg text-fg text-balance">{step.title}</h2>
          <Button
            variant="ghost"
            size="sm"
            aria-label="End the tour"
            data-testid="tour-dismiss"
            onClick={() => toursStore.getState().dismiss()}
          >
            <Icon icon={X} size="sm" />
          </Button>
        </div>

        <p className="text-md text-fg-muted text-pretty">{step.description}</p>

        {rect === null ? (
          // Said out loud rather than silently skipped: the user is being told about something they
          // cannot currently see, and why.
          <p data-testid="tour-target-missing" className="text-sm text-fg-subtle text-pretty">
            That part of the window is not on screen right now.
          </p>
        ) : null}

        <div className="flex items-center gap-2 border-t border-rule pt-2">
          <span className="grow font-mono text-2xs tracking-eyebrow uppercase text-fg-subtle tabular-nums">
            {stepIndex + 1} of {stepCount}
          </span>
          {stepIndex === 0 ? null : (
            <Button
              variant="ghost"
              size="sm"
              data-testid="tour-previous"
              onClick={() => toursStore.getState().previous()}
            >
              Back
            </Button>
          )}
          {/* The one filled oxide affordance on this surface — HOUSE-RULES §5. */}
          <Button
            variant="primary"
            size="sm"
            data-testid="tour-next"
            onClick={() => toursStore.getState().next()}
          >
            {isLastStep ? 'Done' : 'Next'}
          </Button>
        </div>

        {isLastStep && nextTour !== null ? (
          <Button
            variant="outline"
            size="sm"
            data-testid="tour-next-tour"
            onClick={() => toursStore.getState().start(nextTour.id)}
          >
            Next: {nextTour.name}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Where the tooltip goes. Clamped inside the window on both axes, which is what keeps it reachable in the
 * 800×600 floor `packages/main/src/window.ts` enforces.
 *
 * A missing target centres it, rather than the Angular fallback of inventing a 200×100 rectangle in the
 * middle of the screen and pointing a spotlight at it.
 */
function tooltipPosition(rect: Rect | null, placement: string): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (rect === null) {
    return {
      top: `${Math.max(VIEWPORT_MARGIN, viewportHeight / 2 - TOOLTIP_HEIGHT_ESTIMATE / 2)}px`,
      left: `${Math.max(VIEWPORT_MARGIN, viewportWidth / 2 - TOOLTIP_WIDTH / 2)}px`,
    };
  }

  let top: number;
  let left: number;
  switch (placement) {
    case 'top':
      top = rect.top - TOOLTIP_GAP - TOOLTIP_HEIGHT_ESTIMATE;
      left = rect.left;
      break;
    case 'right':
      top = rect.top;
      left = rect.left + rect.width + TOOLTIP_GAP;
      break;
    case 'left':
      top = rect.top;
      left = rect.left - TOOLTIP_WIDTH - TOOLTIP_GAP;
      break;
    default:
      top = rect.top + rect.height + TOOLTIP_GAP;
      left = rect.left;
      break;
  }

  return {
    top: `${clamp(top, VIEWPORT_MARGIN, viewportHeight - TOOLTIP_HEIGHT_ESTIMATE - VIEWPORT_MARGIN)}px`,
    left: `${clamp(left, VIEWPORT_MARGIN, viewportWidth - TOOLTIP_WIDTH - VIEWPORT_MARGIN)}px`,
  };
}

/** One element's rectangle, or `null` when nothing renders that testid. */
function measureTarget(target: string | undefined): Rect | null {
  if (target === undefined) return null;
  const element = document.querySelector(`[data-testid="${target}"]`);
  if (element === null) return null;
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

function clamp(value: number, min: number, max: number): number {
  // `max` can be below `min` in a window narrower than the tooltip, and then `min` wins — a tooltip
  // hanging off the right edge is recoverable; one hanging off the left is not.
  return Math.max(min, Math.min(value, Math.max(min, max)));
}
