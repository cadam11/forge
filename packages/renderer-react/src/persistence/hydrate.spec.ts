/**
 * The startup path, end to end in jsdom: seed the Angular localStorage keys, hydrate, and check that
 * the stores hold what the user had — then do it again against a wiped browser profile, which is the
 * "second boot" the gate asks for.
 *
 * The stores here are fresh instances rather than the app singletons, so a failure names one store
 * and the specs do not leak state into each other.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@joinery/shared';
import type { LayoutConfig, TabState } from '@joinery/shared';
import { installJoineryMock, removeJoineryMock } from '../test/joinery-mock';
import { createAppStateDouble, type AppStateDouble } from '../test/app-state-double';
import { setDiagnosticsSink } from '../state/diagnostics';
import { createSettingsStore } from '../state/settings';
import { createTabStore } from '../state/tab';
import { hydrateRendererState, hydrateWorkspace } from './hydrate';
import { encodeReactLayout, createLayoutPersistence, REACT_LAYOUT_VERSION } from './layout';
import { LEGACY_KEYS } from './legacy-local-storage';
import { createRendererStatePersistence } from './renderer-state';
import { THEME_MIRROR_KEY } from './theme-mirror';

function seedAngularLocalStorage(): void {
  window.localStorage.setItem(
    LEGACY_KEYS.settings,
    JSON.stringify({ theme: 'light', editor: { fontSize: 18 } })
  );
  window.localStorage.setItem(LEGACY_KEYS.completedTours, JSON.stringify(['welcome']));
  window.localStorage.setItem(LEGACY_KEYS.welcomeDismissed, 'true');
  window.localStorage.setItem(
    LEGACY_KEYS.snippets,
    JSON.stringify([
      { id: 'snip-1', name: 'Orders', sql: 'SELECT 1', tags: ['a'], createdAt: 'then' },
      { id: 'snip-2', name: 'Counts', sql: 'SELECT 2', tags: [], createdAt: 'then' },
    ])
  );
  window.localStorage.setItem(LEGACY_KEYS.ctrlEConfirmed, 'true');
  window.localStorage.setItem(
    LEGACY_KEYS.flywayPlaceholderValues,
    JSON.stringify({ schema: 'dbo' })
  );
}

/** One "process": a persistence writer plus the two stores that hydrate from it. */
function makeRenderer() {
  const persistence = createRendererStatePersistence();
  return {
    persistence,
    settings: createSettingsStore(persistence),
    tabs: createTabStore(persistence),
  };
}

let bridge: AppStateDouble;
const teardowns: (() => void)[] = [];

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  bridge = createAppStateDouble();
  teardowns.push(installJoineryMock({ app: bridge.app }));
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  window.localStorage.clear();
});

describe('hydrateRendererState — first launch after Angular', () => {
  it('migrates, then hydrates the settings store from the migrated data', async () => {
    seedAngularLocalStorage();
    const renderer = makeRenderer();

    const hydrated = await hydrateRendererState(renderer);

    expect(hydrated.migration.outcome).toBe('migrated');
    const settings = renderer.settings.getState().settings;
    expect(settings.theme).toBe('light');
    expect(settings.editor.fontSize).toBe(18);
    // Merged group by group, so a field the stored object never mentioned still exists.
    expect(settings.editor.tabSize).toBe(DEFAULT_SETTINGS.editor.tabSize);
    expect(settings.grid).toEqual(DEFAULT_SETTINGS.grid);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('hydrates the welcome flag into the tab store', async () => {
    seedAngularLocalStorage();
    const renderer = makeRenderer();

    await hydrateRendererState(renderer);

    expect(renderer.tabs.getState().tabs).toEqual([]);
    expect(renderer.tabs.getState().activeTabId).toBe('');
  });

  it('shows the Welcome tab when the user never dismissed it', async () => {
    const renderer = makeRenderer();

    await hydrateRendererState(renderer);

    expect(renderer.tabs.getState().tabs.map(t => t.type)).toEqual(['welcome']);
    expect(renderer.tabs.getState().activeTabId).toBe('welcome');
  });

  it('hands back the three domains whose surfaces do not exist yet', async () => {
    seedAngularLocalStorage();

    const hydrated = await hydrateRendererState(makeRenderer());

    expect(hydrated.snippets.map(s => s.id)).toEqual(['snip-1', 'snip-2']);
    expect(hydrated.completedTours).toEqual(['welcome']);
    expect(hydrated.confirmedCtrlEExecute).toBe(true);
    expect(hydrated.flywayPlaceholderValues).toEqual({ schema: 'dbo' });
  });

  it('primes the FOUC mirror, so the next boot paints the right canvas', async () => {
    seedAngularLocalStorage();

    await hydrateRendererState(makeRenderer());

    expect(window.localStorage.getItem(THEME_MIRROR_KEY)).toBe('light');
  });

  it('never writes an Angular key', async () => {
    seedAngularLocalStorage();
    const before = window.localStorage.getItem(LEGACY_KEYS.settings);

    const renderer = await (async () => {
      const r = makeRenderer();
      await hydrateRendererState(r);
      return r;
    })();
    // A settings change after hydration is the dangerous case: it must reach AppState and the
    // mirror, and leave the Angular object alone.
    renderer.settings.getState().updateEditorSetting('fontSize', 21);
    await renderer.persistence.read();

    expect(window.localStorage.getItem(LEGACY_KEYS.settings)).toBe(before);
    expect(window.localStorage.getItem(THEME_MIRROR_KEY)).toBe('light');
    expect(bridge.snapshot().reactRendererState?.settings?.editor?.fontSize).toBe(21);
  });
});

describe('hydrateRendererState — the second boot', () => {
  it('reads the same values back with localStorage wiped, and does not migrate again', async () => {
    seedAngularLocalStorage();
    await hydrateRendererState(makeRenderer());

    // Quit, wipe the browser profile, boot again. Only AppState survives.
    const rebooted = bridge.reboot();
    removeJoineryMock();
    teardowns.push(installJoineryMock({ app: rebooted.app }));
    window.localStorage.clear();

    const renderer = makeRenderer();
    const hydrated = await hydrateRendererState(renderer);

    expect(hydrated.migration.outcome).toBe('already-migrated');
    expect(renderer.settings.getState().settings.editor.fontSize).toBe(18);
    expect(hydrated.snippets).toHaveLength(2);
    expect(hydrated.welcomeDismissed).toBe(true);
    expect(rebooted.calls.setState).toBe(0);
  });

  it('is safe to run twice in one process', async () => {
    // What a StrictMode double-effect does. Both the migration and the two store hydrations are
    // idempotent, and the Welcome tab must not be added twice.
    const renderer = makeRenderer();

    await hydrateRendererState(renderer);
    await hydrateRendererState(renderer);

    expect(renderer.tabs.getState().tabs).toHaveLength(1);
    expect(bridge.calls.setState).toBe(0);
  });
});

/*
 * The regression the review found, end to end. It was silent, permanent, and cost the user their
 * whole settings object: boot 1's migration fails, so no marker is written; the user nudges a
 * setting; a DEFAULT-derived settings object lands in `AppState`; boot 2's migration runs, treats
 * that object as newer than the localStorage copy, sets the marker — and the real Angular settings
 * can never be lifted, because a one-shot migration does not get a second turn.
 *
 * Two independent defences, asserted separately below: the settings store's write path is locked
 * until the migration settles, and — if a write got in anyway — the migration prefers the
 * localStorage settings while the marker is absent.
 */
describe('hydrateRendererState — a failed first migration cannot poison the second', () => {
  /** A bridge whose `setState` fails until `allowWrites()` is called. */
  function flakyBridge() {
    const backing = createAppStateDouble();
    let failing = true;
    removeJoineryMock();
    teardowns.push(
      installJoineryMock({
        app: {
          getState: backing.app.getState,
          setState: (partial: Parameters<typeof backing.app.setState>[0]) =>
            failing
              ? Promise.reject(new Error('main process went away'))
              : backing.app.setState(partial),
        },
      })
    );
    return {
      backing,
      allowWrites: () => {
        failing = false;
      },
    };
  }

  it('withholds the settings write, then lifts the real Angular settings on the next boot', async () => {
    seedAngularLocalStorage();
    const { backing, allowWrites } = flakyBridge();

    const boot1 = makeRenderer();
    expect((await hydrateRendererState(boot1)).migration.outcome).toBe('failed');

    // The failure was transient — writes work again — and the user changes a setting.
    allowWrites();
    boot1.settings.getState().updateEditorSetting('fontSize', 9);
    await boot1.persistence.read();

    // The gate held: nothing of ours is in AppState, so boot 2 has a clean slate to migrate into.
    expect(backing.snapshot().reactRendererState).toBeUndefined();

    const boot2 = makeRenderer();
    expect((await hydrateRendererState(boot2)).migration.outcome).toBe('migrated');
    expect(boot2.settings.getState().settings.editor.fontSize).toBe(18);
    expect(boot2.settings.getState().settings.theme).toBe('light');
  });

  it('recovers even if a settings object did reach AppState before the migration ran', async () => {
    // The second defence, driven directly: something other than the gated store (a future task, a
    // hand-edited file) put DEFAULT-derived settings in `AppState` with no marker present.
    seedAngularLocalStorage();
    const renderer = makeRenderer();
    await renderer.persistence.update(current => ({
      ...current,
      settings: { theme: 'system', editor: { fontSize: 13 } },
    }));

    const hydrated = await hydrateRendererState(renderer);

    expect(hydrated.migration.outcome).toBe('migrated');
    expect(renderer.settings.getState().settings.editor.fontSize).toBe(18);
    expect(renderer.settings.getState().settings.theme).toBe('light');
  });
});

describe('hydrateRendererState — fresh install', () => {
  it('hydrates defaults and writes nothing', async () => {
    const renderer = makeRenderer();

    const hydrated = await hydrateRendererState(renderer);

    expect(hydrated.migration.outcome).toBe('no-data');
    expect(renderer.settings.getState().settings).toEqual(DEFAULT_SETTINGS);
    expect(hydrated.snippets).toEqual([]);
    expect(bridge.calls.setState).toBe(0);
  });

  it('hydrates defaults when there is no bridge at all', async () => {
    // `pnpm --filter @joinery/renderer-react start` in a browser tab. Nothing to hydrate from, and
    // a boot must not fail over it.
    removeJoineryMock();
    const renderer = makeRenderer();

    const hydrated = await hydrateRendererState(renderer);

    expect(hydrated.migration.outcome).toBe('unavailable');
    expect(renderer.settings.getState().settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('hydrateWorkspace', () => {
  const SAVED_TABS: TabState[] = [
    {
      id: 'tab-1',
      type: 'query',
      title: 'Orders',
      content: 'SELECT * FROM orders',
      databaseName: 'sales',
      isPinned: true,
    },
    { id: 'tab-2', type: 'query', title: 'Query 2', content: '' },
  ];

  it('restores the saved tabs and the saved React layout', async () => {
    const layoutConfig: LayoutConfig = encodeReactLayout({
      version: REACT_LAYOUT_VERSION,
      dockview: { grid: {} },
      activeTabId: 'tab-1',
    });
    const seeded = createAppStateDouble({
      openTabs: SAVED_TABS,
      activeTabId: 'tab-2',
      goldenLayoutConfig: layoutConfig,
    });
    removeJoineryMock();
    teardowns.push(installJoineryMock({ app: seeded.app }));
    const renderer = makeRenderer();

    const payload = await hydrateWorkspace('profile-a', {
      tabs: renderer.tabs,
      layout: createLayoutPersistence(renderer.persistence),
    });

    const tabs = renderer.tabs.getState();
    expect(tabs.tabs.map(t => t.id)).toEqual(['tab-1', 'tab-2']);
    expect(tabs.activeTabId).toBe('tab-2');
    expect(tabs.getTabContent('tab-1')).toBe('SELECT * FROM orders');
    // A tab that never had a connection of its own adopts the restored one.
    expect(tabs.tabs[1]?.connectionId).toBe('profile-a');
    expect(payload?.activeTabId).toBe('tab-1');
  });

  it('returns undefined for a Golden Layout config, leaving it in place', async () => {
    const golden: LayoutConfig = { root: { type: 'row', content: [{ type: 'stack' }] } };
    const seeded = createAppStateDouble({ openTabs: SAVED_TABS, goldenLayoutConfig: golden });
    removeJoineryMock();
    teardowns.push(installJoineryMock({ app: seeded.app }));
    const renderer = makeRenderer();

    const payload = await hydrateWorkspace('profile-a', {
      tabs: renderer.tabs,
      layout: createLayoutPersistence(renderer.persistence),
    });

    // Decision C: rebuild from the tab list, which is still fully intact.
    expect(payload).toBeUndefined();
    expect(renderer.tabs.getState().tabs).toHaveLength(2);
    expect(seeded.snapshot().goldenLayoutConfig).toEqual(golden);
  });
});
