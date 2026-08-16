/**
 * The boot sequence, and the restore-before-save contract.
 *
 * Two claims are asserted here and both are load-bearing enough that a comment would not do:
 *
 * 1. **The ORDER.** Migration and settings first, geometry next, then interactive, then the session
 *    restore, then the workspace restore. Anything reordered is a real regression: a shell that
 *    paints before hydration shows default settings and re-themes; geometry after paint makes the
 *    sidebar jump.
 * 2. **Neither tab nor layout persistence may be writable before the workspace restore has
 *    finished.** This is the Angular-parity hazard the brief calls binding — `saveTabs` serializes
 *    every query tab's SQL, so one early write over an unrestored store destroys the user's work
 *    with no second copy. The test drives the real stores and the real persistence, and checks the
 *    gates at each step rather than trusting the sequence.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installJoineryMock, removeJoineryMock } from '../test/joinery-mock';
import { createAppStateDouble, type AppStateDouble } from '../test/app-state-double';
import { setDiagnosticsSink } from '../state/diagnostics';
import { createLayoutPersistence } from '../persistence/layout';
import { createRendererStatePersistence } from '../persistence/renderer-state';
import { hydrateWorkspace } from '../persistence/hydrate';
import { createTabStore } from '../state/tab';
import { createWorkbenchStore } from '../state/workbench';
import { BOOT_STEPS, createBootStore, resetBootLatch, runBoot, type BootStep } from './boot';

let bridge: AppStateDouble;
const teardowns: (() => void)[] = [];

/** A connection store stand-in: the boot sequence only ever calls these three members. */
function stubConnection(
  options: { connected?: string[]; failProfiles?: boolean; failRestore?: boolean } = {}
) {
  const calls: string[] = [];
  const state = {
    connectedProfileIds: new Set(options.connected ?? []),
    loadProfiles: async () => {
      calls.push('loadProfiles');
      if (options.failProfiles === true) throw new Error('profiles unreadable');
    },
    restoreState: async () => {
      calls.push('restoreState');
      if (options.failRestore === true) throw new Error('reconnect failed');
    },
  };
  return { calls, store: { getState: () => state } as never };
}

beforeEach(() => {
  bridge = createAppStateDouble();
  teardowns.push(installJoineryMock({ app: bridge.app }));
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));
  resetBootLatch();
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  resetBootLatch();
});

describe('the boot sequence', () => {
  it('runs its steps in the declared order', async () => {
    const steps: BootStep[] = [];
    const connection = stubConnection({ connected: ['profile-a'] });

    await runBoot({
      boot: createBootStore(),
      connection: connection.store,
      workbench: createWorkbenchStore(),
      onStep: step => steps.push(step),
    });

    // Not a subset and not a set: the sequence itself is the contract.
    expect(steps).toEqual([...BOOT_STEPS]);
  });

  it('becomes interactive before the session restore, and ready only after the workspace restore', async () => {
    const boot = createBootStore();
    const connection = stubConnection({ connected: ['profile-a'] });
    const phaseAtStep = new Map<BootStep, string>();

    await runBoot({
      boot,
      connection: connection.store,
      workbench: createWorkbenchStore(),
      onStep: step => phaseAtStep.set(step, boot.getState().phase),
    });

    expect(phaseAtStep.get('hydrate-renderer-state')).toBe('starting');
    expect(phaseAtStep.get('hydrate-geometry')).toBe('starting');
    expect(phaseAtStep.get('interactive')).toBe('interactive');
    expect(phaseAtStep.get('restore-session')).toBe('interactive');
    expect(phaseAtStep.get('restore-workspace')).toBe('interactive');
    expect(phaseAtStep.get('ready')).toBe('ready');
  });

  it('restores the workspace even when loading profiles fails', async () => {
    const steps: BootStep[] = [];
    const connection = stubConnection({ failProfiles: true });

    await runBoot({
      boot: createBootStore(),
      connection: connection.store,
      workbench: createWorkbenchStore(),
      onStep: step => steps.push(step),
    });

    // `load-profiles` never fires — that step is inside the try — but everything after it does,
    // because the workspace restore is what opens the persistence gates and a failed startup must
    // not leave the app unable to save for the session.
    expect(steps).not.toContain('load-profiles');
    expect(steps).toContain('restore-workspace');
    expect(steps).toContain('ready');
  });

  it('restores the workspace even when the session reconnect throws', async () => {
    const steps: BootStep[] = [];
    const connection = stubConnection({ failRestore: true });

    await runBoot({
      boot: createBootStore(),
      connection: connection.store,
      workbench: createWorkbenchStore(),
      onStep: step => steps.push(step),
    });

    expect(steps).not.toContain('restore-session');
    expect(steps).toContain('restore-workspace');
  });

  it('runs once, however many times it is called', async () => {
    const connection = stubConnection();
    const deps = {
      boot: createBootStore(),
      connection: connection.store,
      workbench: createWorkbenchStore(),
    };

    // StrictMode mounts every effect twice; `loadProfiles` is a network-bound IPC call.
    await Promise.all([runBoot(deps), runBoot(deps)]);
    await runBoot(deps);

    expect(connection.calls.filter(call => call === 'loadProfiles')).toHaveLength(1);
  });
});

describe('the restore-before-save contract', () => {
  it('keeps both write paths shut until the workspace restore has run', async () => {
    const tabs = createTabStore(createRendererStatePersistence());
    const layout = createLayoutPersistence(createRendererStatePersistence());

    expect(tabs.getState().isPersistenceUnlocked()).toBe(false);
    expect(layout.isUnlocked()).toBe(false);

    // Everything a startup path could plausibly do before the restore.
    tabs.getState().hydrateWelcome(false);
    const tabId = tabs.getState().openTab({ type: 'query', title: 'Query 1', icon: 'code' });
    tabs.getState().setTabContent(tabId, 'select 1');
    tabs.getState().closeTab(tabId);
    await tabs.getState().saveTabs();

    expect(bridge.calls.saveTabs).toBe(0);
    expect(bridge.calls.saveLayout).toBe(0);
  });

  it('does not clobber saved tabs when an early write races the restore', async () => {
    // The exact shape of the loss. A user quits with one query tab holding real SQL; on the next
    // boot something writes before the restore lands. Without the gate, `saveTabs` serializes the
    // tabs it can see — none — and the SQL is gone from the only place it lived.
    const seeded = createAppStateDouble();
    await seeded.app.saveTabs(
      [{ id: 'tab-1', type: 'query', title: 'Important', content: 'select * from payroll' }],
      'tab-1'
    );
    removeJoineryMock();
    teardowns.push(installJoineryMock({ app: seeded.app }));

    const tabs = createTabStore(createRendererStatePersistence());

    // The premature write.
    await tabs.getState().saveTabs();
    expect((await seeded.app.getTabs()).tabs).toHaveLength(1);

    // Now the real sequence, which restores and only then unlocks.
    const layout = createLayoutPersistence(createRendererStatePersistence());
    await hydrateWorkspace('profile-a', { tabs, layout });

    expect(tabs.getState().tabs.map(tab => tab.title)).toEqual(['Important']);
    expect(tabs.getState().getTabContent(tabs.getState().tabs[0]?.id ?? '')).toBe(
      'select * from payroll'
    );
    expect(tabs.getState().isPersistenceUnlocked()).toBe(true);
    expect(layout.isUnlocked()).toBe(true);

    // And a write after the restore keeps the content rather than dropping it.
    await tabs.getState().saveTabs();
    expect((await seeded.app.getTabs()).tabs[0]?.content).toBe('select * from payroll');
  });

  it('opens the gates even when there is no connection to restore tabs against', async () => {
    // The Angular renderer skipped the restore entirely in this case, which under a gate would mean
    // tabs silently stop persisting for the whole session.
    const tabs = createTabStore(createRendererStatePersistence());
    const layout = createLayoutPersistence(createRendererStatePersistence());

    await hydrateWorkspace(null, { tabs, layout });

    expect(tabs.getState().isPersistenceUnlocked()).toBe(true);
    expect(layout.isUnlocked()).toBe(true);
  });

  it('leaves the gates open for the rest of the session', async () => {
    const tabs = createTabStore(createRendererStatePersistence());
    const layout = createLayoutPersistence(createRendererStatePersistence());
    await hydrateWorkspace(null, { tabs, layout });

    tabs.getState().openTab({ type: 'query', title: 'Query 1', icon: 'code' });
    await tabs.getState().saveTabs();

    expect(bridge.calls.saveTabs).toBeGreaterThan(0);
  });
});
