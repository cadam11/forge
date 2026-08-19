/**
 * The performance tier's shared apparatus: the same React-only guard the functional tier has, plus
 * the two instruments every spec here uses and the one rule about thresholds.
 *
 * ── The rule about thresholds (Task 23, and it is the whole design) ───────────────────────────
 *
 * A wall-clock number measured on a laptop is a fact about that laptop. Gating on one produces a
 * suite that goes red when somebody opens a browser, which trains people to ignore it — the worst
 * outcome available. So every assertion in this tier is one of two kinds, and each spec says which
 * it is using and why:
 *
 *  1. **Structural.** A count that does not vary with host speed: rendered DOM rows against total
 *     rows, DOM mutations on a subtree that should not have changed, nodes drawn against nodes
 *     asked for. These are the real gates. Task 17's chat benchmark is the model — it caught the
 *     R3 hazard with mutation counts, not milliseconds.
 *  2. **A generous outer bound.** A duration threshold set at several times the measured median, so
 *     it fails on a change of ALGORITHM (a quadratic layout, a lost memo, virtualization switched
 *     off) and not on a change of weather. Each one records the median it was sized from, so the
 *     next person can see how much headroom they are inside.
 *
 * Bounded waits and no sleeps, per the house rule: every WAIT in this tier is an `expect(…).toPass`
 * or a Playwright assertion with an explicit timeout.
 *
 * **One `setTimeout` exists and it is not a wait.** `chat-stream.spec.ts`'s `injectChunks` sleeps
 * `CHUNK_INTERVAL_MS` between sends — that is the STIMULUS, the thing that makes the load 100
 * chunks a second instead of 3,000 chunks instantly, and removing it would change what is being
 * measured rather than make the test faster. The rule the house has is about waiting for a
 * condition by guessing how long it takes; pacing a generator is the opposite of that. The
 * condition that follows the stream is still a bounded assertion.
 */

import { writeFile } from 'node:fs/promises';
import { test as base, expect, type Page } from '@playwright/test';

import { launchedRenderers, resetLaunchedRenderers } from '../helpers/joinery-actions-react';

/**
 * The same auto fixture `tests/e2e-react/fixtures.ts` installs, and for the same reason: a spec here
 * that reached for the plain `withJoinery` would run green against the ANGULAR renderer and measure
 * the package this task is not about. Duplicated rather than imported across projects because the
 * two directories are independent Playwright projects and importing a `test` object between them
 * would tie their fixture graphs together.
 */
export const test = base.extend<{ reactRendererOnly: void }>({
  reactRendererOnly: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      resetLaunchedRenderers();
      await use();

      const launched = launchedRenderers();
      expect(
        launched.length,
        'this spec launched no Joinery app through withJoineryReact — a stray withJoinery() would ' +
          'have silently measured the Angular renderer'
      ).toBeGreaterThan(0);
      expect(launched, 'every launch in tests/e2e-react-perf must show the React renderer').toEqual(
        launched.map(() => 'react')
      );
    },
    { auto: true },
  ],
});

export { expect };

/** What `withMainThreadWatch` reports about the main thread while a block of work ran. */
export interface MainThreadReport {
  /** `longtask` entries — anything that blocked the main thread for 50ms or more. */
  readonly longTasks: number;
  /** The longest of them, in ms. `0` when there were none. */
  readonly longestTaskMs: number;
  /** Total blocking time: the sum of (duration - 50) over every long task. */
  readonly totalBlockingMs: number;
  /** Whether the browser gave us a `longtask` observer at all. */
  readonly available: boolean;
}

/**
 * Installs a `longtask` PerformanceObserver, runs `work`, and reports what it saw.
 *
 * A `PerformanceObserver` rather than anything in the product: the numbers have to describe the app
 * a user runs, so nothing here instruments the bundle. Same approach as Task 17's benchmark.
 *
 * `available` is reported rather than assumed, and every caller asserts it — a browser without the
 * entry type would otherwise report zero long tasks forever, which is a green suite that measures
 * nothing.
 */
export async function withMainThreadWatch<T>(
  window: Page,
  work: () => Promise<T>
): Promise<{ result: T; main: MainThreadReport }> {
  await window.evaluate(() => {
    const store: { entries: PerformanceEntry[]; observer: PerformanceObserver | null } = {
      entries: [],
      observer: null,
    };
    (window as unknown as Record<string, unknown>).__joineryLongTasks = store;
    if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return;

    store.observer = new PerformanceObserver(list => store.entries.push(...list.getEntries()));
    store.observer.observe({ entryTypes: ['longtask'] });
  });

  const result = await work();

  const main = await window.evaluate<MainThreadReport>(() => {
    const store = (window as unknown as Record<string, unknown>).__joineryLongTasks as {
      entries: PerformanceEntry[];
      observer: PerformanceObserver | null;
    };
    store.observer?.disconnect();
    delete (window as unknown as Record<string, unknown>).__joineryLongTasks;

    const durations = store.entries.map(entry => entry.duration);
    return {
      longTasks: durations.length,
      longestTaskMs: Math.round(Math.max(0, ...durations)),
      totalBlockingMs: Math.round(durations.reduce((sum, ms) => sum + Math.max(0, ms - 50), 0)),
      available: store.observer !== null,
    };
  });

  return { result, main };
}

/**
 * Counts DOM mutations under `selector` while `work` runs.
 *
 * The structural instrument. "This subtree changed N times" is a fact about the render graph, not
 * about the machine, so it is the kind of number this tier is allowed to gate on tightly.
 *
 * Throws if the selector matches nothing — an observer watching nothing reports zero mutations,
 * which would read as a pass.
 */
export async function countMutations(
  window: Page,
  selector: string,
  work: () => Promise<void>
): Promise<number> {
  await window.evaluate(target => {
    const node = document.querySelector(target);
    if (node === null)
      throw new Error(`[perf] nothing matches ${target}, so a count would be a lie`);

    const store = { count: 0, observer: null as MutationObserver | null };
    (window as unknown as Record<string, unknown>).__joineryMutations = store;
    store.observer = new MutationObserver(records => {
      store.count += records.length;
    });
    store.observer.observe(node, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  }, selector);

  await work();

  return window.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__joineryMutations as {
      count: number;
      observer: MutationObserver | null;
    };
    store.observer?.disconnect();
    delete (window as unknown as Record<string, unknown>).__joineryMutations;
    return store.count;
  });
}

/**
 * Writes a measurement block into the test's output directory and attaches it.
 *
 * To a FILE, not an inline body: an attachment given a body lives in the reporter's memory, and the
 * `list` reporter this suite runs by default prints two lines of it. These numbers exist to be read
 * after the run — that is the whole reason a passing perf test produces output at all — so they go
 * to disk where `tests/reports/` keeps them.
 */
export async function attachMeasurements(
  name: string,
  measurements: Readonly<Record<string, unknown>>
): Promise<void> {
  const file = test.info().outputPath(name);
  await writeFile(file, `${JSON.stringify(measurements, null, 2)}\n`, 'utf8');
  await test.info().attach(name, { path: file, contentType: 'application/json' });
}
