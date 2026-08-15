/**
 * Decision C's persistence contract. Three things to prove:
 *
 * 1. A React layout round-trips through the existing `LayoutConfig` type.
 * 2. A Golden Layout config is IGNORED on read — the "migrate by reset" half of the decision — and
 *    is never destroyed, only archived.
 * 3. The Angular renderer's own loader guard rejects what we write, so the two renderers can share
 *    one `goldenLayoutConfig` field during coexistence without either mounting the other's tree.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LayoutConfig } from '@joinery/shared';
import { installJoineryMock, removeJoineryMock } from '../test/joinery-mock';
import { createAppStateDouble, type AppStateDouble } from '../test/app-state-double';
import { setDiagnosticsSink } from '../state/diagnostics';
import {
  createLayoutPersistence,
  decodeReactLayout,
  encodeReactLayout,
  isLegacyGoldenLayout,
  REACT_LAYOUT_COMPONENT_TYPE,
  REACT_LAYOUT_VERSION,
  type ReactLayoutPayload,
} from './layout';
import { createRendererStatePersistence } from './renderer-state';

/** A Golden Layout tree of the shape `golden-layout-manager.service.ts` serializes. */
const GOLDEN_LAYOUT: LayoutConfig = {
  root: {
    type: 'row',
    content: [
      {
        type: 'stack',
        content: [
          {
            type: 'component',
            componentType: 'tab-component',
            componentState: { tabId: 'tab-1', tabType: 'query', title: 'Query 1' },
          },
        ],
      },
    ],
  },
  dimensions: { headerHeight: 32, borderWidth: 2 },
};

const PAYLOAD: ReactLayoutPayload = {
  version: REACT_LAYOUT_VERSION,
  dockview: { grid: { root: { type: 'branch' } }, panels: { 'tab-1': { id: 'tab-1' } } },
  activeTabId: 'tab-1',
};

/**
 * The Angular loader's guard, copied verbatim from
 * `golden-layout-container.component.ts:404`. If this predicate ever passes for a React-written
 * config, the Angular renderer will try to mount a panel type it has never heard of.
 */
function angularWouldLoad(config: LayoutConfig | undefined): boolean {
  return Boolean(config && config.root && config.root.content?.length);
}

let bridge: AppStateDouble;
const teardowns: (() => void)[] = [];

beforeEach(() => {
  bridge = createAppStateDouble();
  teardowns.push(installJoineryMock({ app: bridge.app }));
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
});

describe('React layout payload', () => {
  it('round-trips through the LayoutConfig type', () => {
    expect(decodeReactLayout(encodeReactLayout(PAYLOAD))).toEqual(PAYLOAD);
  });

  it('decodes a Golden Layout tree as "nothing to honour"', () => {
    expect(decodeReactLayout(GOLDEN_LAYOUT)).toBeUndefined();
    expect(isLegacyGoldenLayout(GOLDEN_LAYOUT)).toBe(true);
    expect(isLegacyGoldenLayout(encodeReactLayout(PAYLOAD))).toBe(false);
    expect(isLegacyGoldenLayout(undefined)).toBe(false);
  });

  it('decodes an unknown version, an empty state and a junk blob as undefined', () => {
    const encoded = encodeReactLayout(PAYLOAD);
    const withVersion = (version: unknown): LayoutConfig => ({
      root: { ...encoded.root, componentState: { ...encoded.root.componentState, version } },
    });

    expect(decodeReactLayout(withVersion(REACT_LAYOUT_VERSION + 1))).toBeUndefined();
    expect(decodeReactLayout(withVersion(undefined))).toBeUndefined();
    expect(
      decodeReactLayout({
        root: {
          type: 'component',
          componentType: REACT_LAYOUT_COMPONENT_TYPE,
          componentState: { version: REACT_LAYOUT_VERSION, dockview: 'not an object' },
        },
      })
    ).toBeUndefined();
  });

  it('is a config the Angular renderer will not try to load', () => {
    // The coexistence proof: Angular's guard needs `root.content.length`, and a React root is a
    // childless component node, so Angular falls through to rebuilding from its tab list.
    expect(angularWouldLoad(GOLDEN_LAYOUT)).toBe(true);
    expect(angularWouldLoad(encodeReactLayout(PAYLOAD))).toBe(false);
  });
});

describe('layout persistence', () => {
  it('reads back what it saved', async () => {
    const layout = createLayoutPersistence(createRendererStatePersistence());

    expect(await layout.save(PAYLOAD)).toBe('saved');
    expect(await layout.read()).toEqual(PAYLOAD);
  });

  it('ignores a stored Golden Layout config on the first React launch', async () => {
    const seeded = createAppStateDouble({ goldenLayoutConfig: GOLDEN_LAYOUT });
    removeJoineryMock();
    installJoineryMock({ app: seeded.app });

    const payload = await createLayoutPersistence(createRendererStatePersistence()).read();

    expect(payload).toBeUndefined();
    // Read means read: the stored config is exactly where it was.
    expect(seeded.snapshot().goldenLayoutConfig).toEqual(GOLDEN_LAYOUT);
    expect(seeded.calls.setState).toBe(0);
  });

  it('archives the Golden Layout config before overwriting it, once', async () => {
    const seeded = createAppStateDouble({ goldenLayoutConfig: GOLDEN_LAYOUT });
    removeJoineryMock();
    installJoineryMock({ app: seeded.app });
    const layout = createLayoutPersistence(createRendererStatePersistence());

    await layout.save(PAYLOAD);

    expect(seeded.snapshot().reactRendererState?.legacyGoldenLayoutConfig).toEqual(GOLDEN_LAYOUT);
    expect(decodeReactLayout(seeded.snapshot().goldenLayoutConfig)).toEqual(PAYLOAD);

    const writesAfterFirstSave = seeded.calls.setState;
    await layout.save({ ...PAYLOAD, activeTabId: 'tab-2' });
    expect(seeded.calls.setState).toBe(writesAfterFirstSave);
    expect(seeded.snapshot().reactRendererState?.legacyGoldenLayoutConfig).toEqual(GOLDEN_LAYOUT);
  });

  it('refuses to overwrite the Golden Layout config when archiving it fails', async () => {
    // Otherwise the one authorised destructive act in this task happens with no copy kept — the
    // report's "nothing a user had is destroyed" claim would be false exactly when it matters.
    const seeded = createAppStateDouble({ goldenLayoutConfig: GOLDEN_LAYOUT });
    removeJoineryMock();
    installJoineryMock({
      app: {
        getState: seeded.app.getState,
        setState: () => Promise.reject(new Error('main process went away')),
        getLayout: seeded.app.getLayout,
        saveLayout: seeded.app.saveLayout,
      },
    });
    const layout = createLayoutPersistence(createRendererStatePersistence());

    expect(await layout.save(PAYLOAD)).toBe('failed');
    expect(seeded.snapshot().goldenLayoutConfig).toEqual(GOLDEN_LAYOUT);
    expect(seeded.calls.saveLayout).toBe(0);
  });

  it('retries the archive on the next save rather than giving up on it', async () => {
    const seeded = createAppStateDouble({ goldenLayoutConfig: GOLDEN_LAYOUT });
    let failing = true;
    removeJoineryMock();
    installJoineryMock({
      app: {
        getState: seeded.app.getState,
        setState: (partial: Parameters<typeof seeded.app.setState>[0]) =>
          failing ? Promise.reject(new Error('transient')) : seeded.app.setState(partial),
        getLayout: seeded.app.getLayout,
        saveLayout: seeded.app.saveLayout,
      },
    });
    const layout = createLayoutPersistence(createRendererStatePersistence());

    expect(await layout.save(PAYLOAD)).toBe('failed');
    failing = false;
    expect(await layout.save(PAYLOAD)).toBe('saved');
    expect(seeded.snapshot().reactRendererState?.legacyGoldenLayoutConfig).toEqual(GOLDEN_LAYOUT);
  });

  it('archives nothing on a fresh install', async () => {
    const layout = createLayoutPersistence(createRendererStatePersistence());

    await layout.save(PAYLOAD);

    expect(bridge.snapshot().reactRendererState).toBeUndefined();
    expect(bridge.calls.setState).toBe(0);
  });

  it('reports an unavailable bridge rather than throwing', async () => {
    removeJoineryMock();
    const layout = createLayoutPersistence(createRendererStatePersistence());

    expect(await layout.read()).toBeUndefined();
    expect(await layout.save(PAYLOAD)).toBe('unavailable');
  });

  it('reports a rejected save', async () => {
    removeJoineryMock();
    installJoineryMock({
      app: {
        getState: bridge.app.getState,
        setState: bridge.app.setState,
        getLayout: bridge.app.getLayout,
        saveLayout: () => Promise.reject(new Error('nope')),
      },
    });

    expect(await createLayoutPersistence(createRendererStatePersistence()).save(PAYLOAD)).toBe(
      'failed'
    );
  });
});
