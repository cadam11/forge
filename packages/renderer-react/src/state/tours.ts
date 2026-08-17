/**
 * The guided tour's step machine, and the owner Task 5 named for `completedTours`.
 *
 * `persistence/hydrate.ts` has been handing that array back as a `HydratedRendererState` field with a
 * `// Task 19 (onboarding tours)` comment on it since Task 5, because the surface that owns it did not
 * exist. This is that surface's store, shaped like `state/snippets.ts` for the same reasons: it reads
 * through hydrated state, writes through `rendererStatePersistence`, and touches `localStorage` nowhere —
 * the Angular `OnboardingService` read and wrote `joinery:completed-tours` directly
 * (`onboarding.service.ts:193-208`), and `persistence/no-local-storage-writes.spec.ts` permits exactly one
 * `setItem` in this package, which belongs to the theme mirror.
 *
 * ── Why the machine is here and not in the overlay ───────────────────────────────────────────
 *
 * The overlay is a portalled component that measures a DOM rectangle. The machine is "which tour, which
 * step, is it finished, has it been finished before" — four questions with rules (a step index that
 * cannot leave its tour, a completion that persists, a chained tour that starts where the last one ended)
 * and no DOM in any of them. Keeping them apart is what lets the machine be tested without a jsdom
 * layout, which is the one thing jsdom cannot give.
 *
 * ── The Angular defect this replaces ────────────────────────────────────────────────────────
 *
 * `TourOverlayComponent` held its target rectangle in a **plain field** (`private targetRect = {…}`) and
 * read it from two `computed()`s. Angular signals do not track plain fields, so both computeds evaluated
 * once — with the initial zeroes — and never again. The spotlight sat at `top: -8px; left: -8px; width:
 * 16px; height: 16px` for the whole tour, and the tooltip with it. Nothing in the code says the tour was
 * ever run. The React overlay holds the rectangle in state and re-measures on step change, on resize and
 * on scroll (`features/onboarding/tour-overlay.tsx`).
 */

import { create } from 'zustand';
// The leaf persistence module, never the `persistence/` barrel — see the note in that barrel.
import {
  rendererStatePersistence,
  type RendererStatePersistence,
} from '../persistence/renderer-state';

export interface TourStep {
  /** A `data-testid` value. NOT a CSS selector — see `features/onboarding/tours.ts`. */
  readonly target: string;
  readonly title: string;
  readonly description: string;
  /** Where the tooltip sits relative to the target, when there is room. */
  readonly placement: 'top' | 'bottom' | 'left' | 'right';
}

export interface Tour {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly TourStep[];
  /**
   * A tour to offer at the end of this one, by id. The chain is how both tours are reachable from one
   * payload-free `start-tour` command: the workbench tour ends by offering the AI one.
   */
  readonly next?: string;
}

export interface ToursState {
  /** Every tour the app knows, by id. Injected at hydration so the store holds no copy of the content. */
  readonly tours: Readonly<Record<string, Tour>>;
  readonly activeTourId: string | null;
  readonly stepIndex: number;
  /** Tour ids the user has finished or dismissed. Persisted. */
  readonly completed: readonly string[];
  /** Whether `hydrate` has run. Until it has, nothing may be persisted. */
  readonly hydrated: boolean;

  /**
   * Adopts the persisted completion list, and opens the write gate. Called once, from the shell's startup
   * path — the same arrangement `snippets` and `editor-prefs` have, and for the same reason: hydrating
   * the store is also what makes it safe to persist, so a default-valued write before this line could not
   * overwrite the migrated data.
   */
  readonly hydrate: (completed: readonly string[]) => void;
  /**
   * Supplies the tour CONTENT. A second method rather than a field of `hydrate`, because the two halves
   * have different owners: the completion list belongs to `persistence/hydrate.ts` (it is a migrated
   * `AppState` field), and the tours belong to `features/onboarding/tours.ts` (they know the shell's
   * testids, which persistence must not). Neither call depends on the other having run.
   */
  readonly installTours: (tours: Readonly<Record<string, Tour>>) => void;

  /** Starts a tour by id. A no-op for an id the store does not know. */
  readonly start: (tourId: string) => void;
  readonly next: () => void;
  readonly previous: () => void;
  /** Ends the tour and records it as completed — the same thing finishing does. See below. */
  readonly dismiss: () => void;
  /** Forgets one tour's completion, so it can be offered again. */
  readonly reset: (tourId: string) => void;
}

export type ToursStore = ReturnType<typeof createToursStore>;

export function createToursStore(persistence: RendererStatePersistence = rendererStatePersistence) {
  return create<ToursState>()((set, get) => {
    const persist = (completed: readonly string[]): void => {
      if (!get().hydrated) return;
      void persistence.update(current => ({ ...current, completedTours: [...completed] }));
    };

    /**
     * Ends the tour, recording it as done.
     *
     * Dismissing and finishing are the same write, which is the Angular behaviour
     * (`dismissTour` and `completeTour` are byte-identical there) and the right one: a user who closed
     * the tour on step 2 has said "not this", and re-raising it on the next launch would be the app
     * arguing. The palette entry is how it comes back, and `reset` is how a test brings it back.
     */
    const finish = (): void => {
      const tourId = get().activeTourId;
      const completed =
        tourId === null || get().completed.includes(tourId)
          ? get().completed
          : [...get().completed, tourId];
      set({ activeTourId: null, stepIndex: 0, completed });
      persist(completed);
    };

    return {
      tours: {},
      activeTourId: null,
      stepIndex: 0,
      completed: [],
      hydrated: false,

      hydrate: completed => set({ completed: [...completed], hydrated: true }),

      installTours: tours => set({ tours }),

      start: tourId => {
        const tour = get().tours[tourId];
        // A tour with no steps would show an overlay with nothing in it, so it is refused with the
        // unknown-id case rather than being a second state to render.
        if (tour === undefined || tour.steps.length === 0) return;
        set({ activeTourId: tourId, stepIndex: 0 });
      },

      next: () => {
        const tour =
          get().activeTourId === null ? undefined : get().tours[get().activeTourId ?? ''];
        if (tour === undefined) return;
        const nextIndex = get().stepIndex + 1;
        if (nextIndex >= tour.steps.length) {
          finish();
          return;
        }
        set({ stepIndex: nextIndex });
      },

      previous: () => set(state => ({ stepIndex: Math.max(0, state.stepIndex - 1) })),

      dismiss: finish,

      reset: tourId => {
        const completed = get().completed.filter(id => id !== tourId);
        set({ completed });
        persist(completed);
      },
    };
  });
}

export const toursStore = createToursStore();
export const useToursStore = toursStore;

type ToursSlice = Pick<ToursState, 'tours' | 'activeTourId' | 'stepIndex' | 'completed'>;

export function selectActiveTour(state: ToursSlice): Tour | null {
  if (state.activeTourId === null) return null;
  return state.tours[state.activeTourId] ?? null;
}

export function selectCurrentStep(state: ToursSlice): TourStep | null {
  return selectActiveTour(state)?.steps[state.stepIndex] ?? null;
}

export function selectStepCount(state: ToursSlice): number {
  return selectActiveTour(state)?.steps.length ?? 0;
}

export function selectIsLastStep(state: ToursSlice): boolean {
  const count = selectStepCount(state);
  return count > 0 && state.stepIndex >= count - 1;
}

/** The tour to offer when this one finishes, if it has not already been done. */
export function selectNextTour(state: ToursSlice): Tour | null {
  const nextId = selectActiveTour(state)?.next;
  if (nextId === undefined || state.completed.includes(nextId)) return null;
  return state.tours[nextId] ?? null;
}

export function selectIsCompleted(tourId: string) {
  return (state: Pick<ToursState, 'completed'>): boolean => state.completed.includes(tourId);
}
