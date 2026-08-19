/**
 * `start-tour`'s consumer, and the one place the tour content is handed to the store.
 *
 * The command has been registered since Task 7 with Task 19b named as its owner and nothing subscribed —
 * the state `commands/bus.spec.tsx`'s ownership rule allows, and the one the Task 19a welcome tab was
 * built for: its "See how it joins" button dispatches this, checks `handlerCount` first, and said "The
 * guided tour is not in this build yet — Task 19b." while nobody answered. Mounting this component is
 * what makes that button live, with no edit to the welcome tab.
 *
 * ── Why the tours are injected rather than imported by the store ─────────────────────────────
 *
 * `state/tours.ts` holds `tours` as data it is given at hydration. So the store is the machine and this
 * file is the content, and a test can drive the machine with two-step tours of its own without the app's
 * copy in the way. It also keeps the store's module graph free of anything that knows about the shell's
 * testids.
 *
 * ── Restarting a completed tour, deliberately ───────────────────────────────────────────────
 *
 * `start` does not check `completed`. A user who reaches for "Start the guided tour" in the palette has
 * asked for it, and refusing because they have seen it before would be the app arguing. `completed` is
 * what stops the tour being OFFERED unprompted — which today nothing does, because Joinery has never
 * auto-raised it; the welcome tab offers it as a button.
 */

import { useEffect } from 'react';

import { useCommand } from '../../commands';
import { toursStore } from '../../state/tours';
import { TourOverlay } from './tour-overlay';
import { TOURS, WORKBENCH_TOUR } from './tours';

export function TourHost() {
  /**
   * Hand the store its content once. The completion list is the shell's startup path's half
   * (`persistence/hydrate.ts` → `toursStore.hydrate`); this is the other one, and neither waits on the
   * other. Idempotent, so StrictMode's double mount is not a hazard.
   */
  useEffect(() => {
    toursStore.getState().installTours(TOURS);
  }, []);

  useCommand('start-tour', () => toursStore.getState().start(WORKBENCH_TOUR));

  return <TourOverlay />;
}
