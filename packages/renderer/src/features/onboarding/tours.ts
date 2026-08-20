/**
 * The tours themselves. Ported from `core/services/onboarding.service.ts:59-114`, with every step's
 * target changed and one step deleted.
 *
 * ── Targets are testids, not CSS selectors ───────────────────────────────────────────────────
 *
 * The Angular steps pointed at `.sidebar`, `.content-area`, `.status-bar` and `.ai-toggle`. Two of those
 * four class names do not exist in this renderer at all (`.content-area`, `.ai-toggle`), and the other
 * two are Tailwind-era coincidences — HOUSE-RULES' second addition is that no test and no lookup may key
 * on a structural class, and a tour that highlights nothing is exactly that rule's reason. Every target
 * here is a `data-testid` that something in `src/shell/` renders, and `tours.spec.ts` asserts each one
 * appears in the shell's source, so a renamed testid breaks a test rather than the tour.
 *
 * ── The step that is gone ───────────────────────────────────────────────────────────────────
 *
 * The AI tour's "Result Analysis" step said "click the sparkle icon on results to get AI-powered
 * insights" while pointing at `.status-bar`, which is not where that is. The analysis surface is a tab in
 * the results pane and only exists once a query has returned rows, so there is no element to spotlight
 * during a tour that has not run one. The step is dropped rather than pointed somewhere plausible: a tour
 * that highlights the wrong thing while describing the right one is worse than a shorter tour.
 *
 * ── Two tours, one command ──────────────────────────────────────────────────────────────────
 *
 * `start-tour` carries no payload, so it starts the workbench tour, and the workbench tour's `next`
 * chains to the AI one — offered on the last step, skipped when it is already done. That keeps both
 * tours reachable without inventing a second payload-free command per tour, which is how a palette ends
 * up with one row per piece of content.
 */

import type { Tour } from '../../state/tours';

export const WORKBENCH_TOUR = 'workbench';
export const AI_TOUR = 'ai';

export const TOURS: Readonly<Record<string, Tour>> = {
  [WORKBENCH_TOUR]: {
    id: WORKBENCH_TOUR,
    name: 'Around the workbench',
    next: AI_TOUR,
    steps: [
      {
        target: 'sidebar',
        title: 'The explorer',
        description:
          'Your servers, databases, tables, views and routines. Double-click an object to open it; ' +
          'right-click for everything else.',
        placement: 'right',
      },
      {
        target: 'workspace',
        title: 'The workspace',
        description:
          'Query editors, diagrams and object tabs live here, and they dock: drag a tab to split the ' +
          'pane. ⌘↩ runs the whole editor by default — change the scope in Settings ▸ Query.',
        placement: 'bottom',
      },
      {
        target: 'status-docker-toggle',
        title: 'Local containers',
        description:
          'Joinery finds SQL Server, PostgreSQL and MySQL containers on your machine. Start one, stop ' +
          'one, or connect to it without typing a host.',
        placement: 'top',
      },
      {
        target: 'status-output-toggle',
        title: 'What the app actually did',
        description:
          'Every statement Joinery runs on your behalf is logged here, with its SQL. ⌘J opens it.',
        placement: 'top',
      },
    ],
  },

  [AI_TOUR]: {
    id: AI_TOUR,
    name: 'The assistant',
    steps: [
      {
        target: 'status-chat-toggle',
        title: 'The assistant',
        description:
          'Ask for a query in words, or ask what a table is for. It reads your schema, and every write ' +
          'it proposes is confirmed by you first. ⇧⌘I.',
        placement: 'top',
      },
      {
        target: 'workspace',
        title: 'Completions while you type',
        description:
          'The editor completes tables, columns and joins from the live schema. Tab accepts, Escape ' +
          'dismisses.',
        placement: 'bottom',
      },
    ],
  },
};
