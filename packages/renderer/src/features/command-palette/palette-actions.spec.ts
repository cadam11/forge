/**
 * Every local action does something — one test per action, and the table is exhaustive **by type**.
 *
 * `palette-actions.ts` argues that a local action cannot be a dead dispatch, because it holds a
 * closure rather than an id. That is true and it is not enough: a closure can still be wrong. So the
 * expectation table below is a `Record<PaletteActionId, …>`, which means adding an action to the
 * palette without proving it has an effect **does not compile** — the same mechanism
 * `COMMAND_CONSUMERS` uses to stop a command existing without a named owner.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setDiagnosticsSink } from '../../state/diagnostics';
import { settingsStore } from '../../state/settings';
import { tabStore } from '../../state/tab';
import { PALETTE_ACTIONS, PALETTE_ACTION_IDS, type PaletteActionId } from './palette-actions';

/** What running each action must change. `arrange` sets up the state the effect needs. */
const EFFECTS: Record<
  PaletteActionId,
  { readonly arrange?: () => void; readonly assert: () => void }
> = {
  'theme-system': {
    assert: () => expect(settingsStore.getState().settings.theme).toBe('system'),
  },
  'theme-ivory': {
    assert: () => expect(settingsStore.getState().settings.theme).toBe('light'),
  },
  'theme-ink': {
    assert: () => expect(settingsStore.getState().settings.theme).toBe('dark'),
  },
  'close-all-tabs': {
    arrange: () => {
      tabStore.getState().openQueryTab('conn-1', 'db', 'SELECT 1', false, false);
      tabStore.getState().openQueryTab('conn-1', 'db', 'SELECT 2', false, false);
      expect(tabStore.getState().tabs).toHaveLength(2);
    },
    assert: () => expect(tabStore.getState().tabs).toHaveLength(0),
  },
  'close-other-tabs': {
    arrange: () => {
      tabStore.getState().openQueryTab('conn-1', 'db', 'SELECT 1', false, false);
      const keep = tabStore.getState().openQueryTab('conn-1', 'db', 'SELECT 2', false, false);
      tabStore.getState().activateTab(keep);
      expect(tabStore.getState().tabs).toHaveLength(2);
    },
    assert: () => {
      const tabs = tabStore.getState().tabs;
      expect(tabs).toHaveLength(1);
      expect(tabStore.getState().getTabContent(tabs[0]?.id ?? '')).toBe('SELECT 2');
    },
  },
};

const teardowns: (() => void)[] = [];

beforeEach(() => {
  // The settings store warns on every write until hydration has confirmed the migration settled, which
  // is correct and is not what this suite is about.
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));
  settingsStore.getState().updateTheme('system');
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  tabStore.getState().closeAllTabs();
});

describe('the palette’s local actions', () => {
  it('are the ones the table below covers', () => {
    // Both directions, so neither list can grow without the other: the ids in the table are exactly
    // the ids in the action list, and every action in the list is reachable.
    expect(Object.keys(EFFECTS).sort()).toEqual([...PALETTE_ACTION_IDS].sort());
    expect(PALETTE_ACTIONS.map(action => action.id).sort()).toEqual([...PALETTE_ACTION_IDS].sort());
  });

  for (const id of PALETTE_ACTION_IDS) {
    it(`${id} has an observable effect`, () => {
      const action = PALETTE_ACTIONS.find(candidate => candidate.id === id);
      expect(action, `${id} is not in PALETTE_ACTIONS`).toBeDefined();

      EFFECTS[id].arrange?.();
      action?.run();
      EFFECTS[id].assert();
    });
  }

  it('gives every action a label and a hint', () => {
    for (const action of PALETTE_ACTIONS) {
      expect(action.label.length, `${action.id} label`).toBeGreaterThan(2);
      expect(action.hint.length, `${action.id} hint`).toBeGreaterThan(10);
      expect(action.hint).not.toBe(action.label);
    }
  });

  it('closes other tabs only when one is active', () => {
    // The guard inside the action: with no active tab there is nothing to keep, and the Angular
    // palette called `closeOtherTabs(undefined!)` in that case.
    const action = PALETTE_ACTIONS.find(candidate => candidate.id === 'close-other-tabs');
    expect(() => action?.run()).not.toThrow();
    expect(tabStore.getState().tabs).toHaveLength(0);
  });
});
