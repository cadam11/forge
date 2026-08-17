/**
 * The overlay: the takeover, the spotlight that MOVES (the Angular defect), the missing-target case, and
 * the two ways out.
 *
 * jsdom gives every element a zero rectangle, so `getBoundingClientRect` is stubbed per target — which is
 * the only way to assert that the spotlight follows the step rather than sitting where it started.
 */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dispatchCommand, handlerCount } from '../../commands';
import { toursStore } from '../../state/tours';
import { TourHost } from './tour-host';
import { AI_TOUR, TOURS, WORKBENCH_TOUR } from './tours';

const teardowns: (() => void)[] = [];

/** A stand-in for the shell: one element per testid a tour step names, each with its own rectangle. */
function installTargets(rects: Readonly<Record<string, DOMRect>>): void {
  const host = document.createElement('div');
  for (const [testId, rect] of Object.entries(rects)) {
    const element = document.createElement('div');
    element.setAttribute('data-testid', testId);
    element.getBoundingClientRect = () => rect;
    host.append(element);
  }
  document.body.append(host);
  teardowns.push(() => host.remove());
}

const rect = (top: number, left: number, width = 100, height = 40): DOMRect =>
  ({
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  }) as DOMRect;

beforeEach(() => {
  toursStore.setState({
    activeTourId: null,
    stepIndex: 0,
    completed: [],
    hydrated: false,
    tours: {},
  });
  // A window big enough that the clamp is not what the assertions measure.
  window.innerWidth = 1400;
  window.innerHeight = 900;
});

afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
  toursStore.setState({
    activeTourId: null,
    stepIndex: 0,
    completed: [],
    hydrated: false,
    tours: {},
  });
});

describe('TourHost', () => {
  it('takes over start-tour and renders nothing until it arrives', async () => {
    installTargets({ sidebar: rect(50, 0, 240, 700) });
    render(<TourHost />);

    expect(handlerCount('start-tour')).toBe(1);
    expect(screen.queryByTestId('tour-overlay')).toBeNull();

    await act(async () => {
      dispatchCommand('start-tour');
    });
    expect(screen.queryByTestId('tour-overlay')).not.toBeNull();
    expect(screen.getByTestId('tour-tooltip').textContent).toContain('The explorer');
  });

  it('installs the app’s tours, and both of them are reachable from the one command', async () => {
    render(<TourHost />);
    expect(Object.keys(toursStore.getState().tours)).toEqual([WORKBENCH_TOUR, AI_TOUR]);
    expect(TOURS[WORKBENCH_TOUR]?.next).toBe(AI_TOUR);
  });
});

describe('TourOverlay — the geometry', () => {
  function startAt(targets: Readonly<Record<string, DOMRect>>) {
    installTargets(targets);
    render(<TourHost />);
    act(() => {
      dispatchCommand('start-tour');
    });
  }

  it('spotlights the step’s own element, padded', async () => {
    startAt({ sidebar: rect(50, 0, 240, 700) });

    const spotlight = screen.getByTestId('tour-spotlight');
    // 8px of padding on every side — the Angular value.
    expect(spotlight.style.top).toBe('42px');
    expect(spotlight.style.left).toBe('-8px');
    expect(spotlight.style.width).toBe('256px');
    expect(spotlight.style.height).toBe('716px');
  });

  it('MOVES the spotlight when the step changes', async () => {
    // The Angular defect: `targetRect` was a plain field read by two `computed()`s, so both evaluated
    // once with the initial zeroes and never again. The spotlight sat at -8/-8/16×16 for the whole tour.
    startAt({ sidebar: rect(50, 0, 240, 700), workspace: rect(50, 240, 900, 700) });

    expect(screen.getByTestId('tour-spotlight').style.left).toBe('-8px');
    await userEvent.click(screen.getByTestId('tour-next'));
    expect(screen.getByTestId('tour-spotlight').style.left).toBe('232px');
    expect(screen.getByTestId('tour-tooltip').textContent).toContain('The workspace');
  });

  it('re-measures on a resize', async () => {
    const moving = { current: rect(50, 0, 240, 700) };
    const host = document.createElement('div');
    const element = document.createElement('div');
    element.setAttribute('data-testid', 'sidebar');
    element.getBoundingClientRect = () => moving.current;
    host.append(element);
    document.body.append(host);
    teardowns.push(() => host.remove());

    render(<TourHost />);
    act(() => {
      dispatchCommand('start-tour');
    });
    expect(screen.getByTestId('tour-spotlight').style.width).toBe('256px');

    moving.current = rect(50, 0, 400, 700);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('tour-spotlight').style.width).toBe('416px');
  });

  it('keeps the tooltip inside the window', async () => {
    // A target hard against the right edge: `right` placement would put the tooltip off-screen.
    window.innerWidth = 900;
    startAt({ sidebar: rect(50, 860, 40, 40) });
    const tooltip = screen.getByTestId('tour-tooltip');
    // 900 − 320 − 16.
    expect(tooltip.style.left).toBe('564px');
  });
});

describe('TourOverlay — a target that is not there', () => {
  it('still shows the step, says so, and draws no spotlight', async () => {
    // The Angular version centred a 200×100 box and pointed a spotlight at nothing.
    render(<TourHost />);
    act(() => {
      dispatchCommand('start-tour');
    });

    expect(screen.getByTestId('tour-overlay').getAttribute('data-target-found')).toBe('false');
    expect(screen.queryByTestId('tour-spotlight')).toBeNull();
    expect(screen.queryByTestId('tour-target-missing')).not.toBeNull();
    // The prose is still worth having.
    expect(screen.getByTestId('tour-tooltip').textContent).toContain('Your servers, databases');
  });
});

describe('TourOverlay — getting out', () => {
  function start() {
    installTargets({ sidebar: rect(50, 0, 240, 700) });
    render(<TourHost />);
    act(() => {
      dispatchCommand('start-tour');
    });
  }

  it('the close button ends it and records the tour', async () => {
    start();
    await userEvent.click(screen.getByTestId('tour-dismiss'));
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
    expect(toursStore.getState().completed).toEqual([WORKBENCH_TOUR]);
  });

  it('Escape ends it', async () => {
    start();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('a click on the backdrop does NOT end it', async () => {
    // The Angular backdrop swallowed every click and dismissed on any that missed the tooltip, so a user
    // who clicked the very thing being pointed at lost the tour.
    start();
    await userEvent.click(screen.getByTestId('tour-overlay'));
    expect(screen.queryByTestId('tour-overlay')).not.toBeNull();
  });

  it('offers the chained tour on the last step, and starts it', async () => {
    installTargets({
      sidebar: rect(50, 0, 240, 700),
      workspace: rect(50, 240, 900, 700),
      'status-docker-toggle': rect(870, 1200, 24, 20),
      'status-output-toggle': rect(870, 1100, 24, 20),
      'status-chat-toggle': rect(870, 1150, 24, 20),
    });
    render(<TourHost />);
    act(() => {
      dispatchCommand('start-tour');
    });

    const steps = TOURS[WORKBENCH_TOUR]?.steps.length ?? 0;
    for (let index = 0; index < steps - 1; index += 1) {
      await userEvent.click(screen.getByTestId('tour-next'));
    }
    expect(screen.getByTestId('tour-next').textContent).toBe('Done');

    await userEvent.click(screen.getByTestId('tour-next-tour'));
    expect(toursStore.getState().activeTourId).toBe(AI_TOUR);
    expect(screen.getByTestId('tour-tooltip').textContent).toContain('The assistant');
    // And the tour just LEFT is recorded. `start` alone only swaps the active id, so taking the chain used
    // to lose the completion — `start-tour` would offer the workbench tour again on the next launch, and
    // the chained tour would go on offering itself from the end of it forever.
    expect(toursStore.getState().completed).toContain(WORKBENCH_TOUR);
    expect(toursStore.getState().stepIndex).toBe(0);
  });

  it('does not offer the chained tour once it has been done', async () => {
    toursStore.setState({ completed: [AI_TOUR] });
    installTargets({
      sidebar: rect(50, 0, 240, 700),
      workspace: rect(50, 240, 900, 700),
      'status-docker-toggle': rect(870, 1200, 24, 20),
      'status-output-toggle': rect(870, 1100, 24, 20),
    });
    render(<TourHost />);
    act(() => {
      dispatchCommand('start-tour');
    });

    const steps = TOURS[WORKBENCH_TOUR]?.steps.length ?? 0;
    for (let index = 0; index < steps - 1; index += 1) {
      await userEvent.click(screen.getByTestId('tour-next'));
    }
    expect(screen.queryByTestId('tour-next-tour')).toBeNull();
  });
});

describe('the tours themselves', () => {
  it('names only testids the shell really renders', async () => {
    // The Angular steps pointed at `.sidebar`, `.content-area`, `.status-bar` and `.ai-toggle`, two of
    // which do not exist in this renderer at all. Reading the shell's source is what keeps a renamed
    // testid a failing test instead of a tour that highlights nothing.
    const sources = await Promise.all([
      import('../../shell/sidebar/sidebar.tsx?raw'),
      import('../../shell/workspace/workspace.tsx?raw'),
      import('../../shell/status-bar.tsx?raw'),
      import('../docker/docker-pip.tsx?raw'),
    ]);
    const combined = sources.map(module => module.default as string).join('\n');

    const targets = Object.values(TOURS).flatMap(tour => tour.steps.map(step => step.target));
    expect(targets.length).toBeGreaterThan(0);
    for (const target of new Set(targets)) {
      expect(combined, `no element renders data-testid="${target}"`).toContain(
        `data-testid="${target}"`
      );
    }
  });

  it('carries no CSS selectors, so nothing keys on a structural class', () => {
    for (const tour of Object.values(TOURS)) {
      for (const step of tour.steps) {
        expect(step.target).not.toMatch(/[.#[\]]/);
      }
    }
  });
});
