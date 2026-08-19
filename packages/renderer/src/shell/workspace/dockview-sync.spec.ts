/**
 * The Dockview ↔ tab-store mapping.
 *
 * Two properties matter enough to test directly rather than through the component:
 *
 * 1. **The reserved-panel guard.** The Output panel is a Dockview panel with no `Tab` behind it, so
 *    every reconciliation loop has to skip it. A loop that did not would close it on sight (no tab
 *    ⇒ close the panel) — the panel would open and vanish, which is a bug that reads as "the output
 *    panel is flaky".
 * 2. **Reading tabs back out of a persisted blob.** The input is JSON that came off disk through an
 *    unvalidated main-process merge (PLAN.md §7.5). It must never throw into the startup path and
 *    must never produce a half-built `Tab`, because the startup path is where a throw costs the user
 *    their whole session.
 */

import { describe, expect, it } from 'vitest';
import {
  OUTPUT_PANEL_ID,
  isTabPanelId,
  layoutHasOutputPanel,
  layoutTabStatesFrom,
  panelComponentFor,
  paramsSignature,
  tabPanelParams,
} from './dockview-sync';
import type { Tab } from '../../state/tab';

const QUERY_TAB: Tab = {
  id: 'tab-1',
  type: 'query',
  title: 'payroll',
  icon: 'code',
  connectionId: 'profile-a',
  databaseName: 'HR',
  isPinned: true,
  metadata: { content: 'select 1', autoExecute: false },
};

describe('reserved panel ids', () => {
  it('treats the Output panel as not-a-tab, and everything else as a tab', () => {
    expect(isTabPanelId(OUTPUT_PANEL_ID)).toBe(false);
    expect(isTabPanelId('tab-1')).toBe(true);
    // Not a prefix heuristic: a tab id is a uuid and could be anything.
    expect(isTabPanelId('joinery:something-else')).toBe(true);
  });
});

describe('panel components', () => {
  it('maps every tab type to a registered component', () => {
    // `results` is in the TabType union but was never a tab in the Angular container; it must still
    // resolve to something, because a persisted tab could carry it.
    for (const type of ['welcome', 'query', 'results', 'object', 'erd', 'chat'] as const) {
      expect(panelComponentFor(type)).toBeTypeOf('string');
      expect(panelComponentFor(type).length).toBeGreaterThan(0);
    }
    expect(panelComponentFor('results')).toBe(panelComponentFor('query'));
  });
});

describe('panel params', () => {
  it('carries everything a tab needs to be rebuilt', () => {
    const params = tabPanelParams(QUERY_TAB);

    expect(params).toEqual({
      tabId: 'tab-1',
      tabType: 'query',
      title: 'payroll',
      icon: 'code',
      isPinned: true,
      connectionId: 'profile-a',
      databaseName: 'HR',
      configuration: { content: 'select 1', autoExecute: false },
    });
  });

  it('omits absent optionals rather than writing undefined into persisted JSON', () => {
    const params = tabPanelParams({ id: 'tab-2', type: 'welcome', title: 'Welcome', icon: 'home' });

    expect(Object.hasOwn(params, 'connectionId')).toBe(false);
    expect(Object.hasOwn(params, 'databaseName')).toBe(false);
    expect(params.isPinned).toBe(false);
  });

  it('changes its signature exactly when a persisted field changes', () => {
    const base = paramsSignature(tabPanelParams(QUERY_TAB));

    expect(paramsSignature(tabPanelParams({ ...QUERY_TAB }))).toBe(base);
    expect(paramsSignature(tabPanelParams({ ...QUERY_TAB, title: 'other' }))).not.toBe(base);
    expect(paramsSignature(tabPanelParams({ ...QUERY_TAB, isPinned: false }))).not.toBe(base);
    // `isDirty` is NOT persisted in params — the tab header reads it from the store — so it must not
    // move the signature and trigger a layout save on every keystroke that flips dirtiness.
    expect(paramsSignature(tabPanelParams({ ...QUERY_TAB, isDirty: true }))).toBe(base);
  });

  it('round-trips through the reader', () => {
    const blob = { panels: { 'tab-1': { id: 'tab-1', params: tabPanelParams(QUERY_TAB) } } };

    expect(layoutTabStatesFrom(blob)).toEqual([
      {
        tabId: 'tab-1',
        tabType: 'query',
        title: 'payroll',
        icon: 'code',
        isPinned: true,
        connectionId: 'profile-a',
        databaseName: 'HR',
        configuration: { content: 'select 1', autoExecute: false },
      },
    ]);
  });
});

describe('reading tabs out of a persisted layout', () => {
  it('skips the reserved panels', () => {
    const blob = {
      panels: {
        'tab-1': { id: 'tab-1', params: tabPanelParams(QUERY_TAB) },
        [OUTPUT_PANEL_ID]: { id: OUTPUT_PANEL_ID, title: 'Output' },
      },
    };

    expect(layoutTabStatesFrom(blob).map(state => state.tabId)).toEqual(['tab-1']);
    expect(layoutHasOutputPanel(blob)).toBe(true);
    expect(layoutHasOutputPanel({ panels: {} })).toBe(false);
  });

  it('prefers the panel id over a params tabId that disagrees', () => {
    // Dockview keys its grid on the panel id, so that is the id the arrangement actually refers to.
    const blob = {
      panels: { 'tab-real': { params: { ...tabPanelParams(QUERY_TAB), tabId: 'tab-stale' } } },
    };

    expect(layoutTabStatesFrom(blob)[0]?.tabId).toBe('tab-real');
  });

  it('drops a panel with no usable params instead of building a half-tab', () => {
    const blob = {
      panels: {
        'no-params': { id: 'no-params' },
        'no-type': { id: 'no-type', params: { title: 'Orphan' } },
        'bad-params': { id: 'bad-params', params: 'not an object' },
        good: { id: 'good', params: { tabType: 'erd' } },
      },
    };

    const states = layoutTabStatesFrom(blob);
    expect(states.map(state => state.tabId)).toEqual(['good']);
    // A tab type with nothing else still yields a complete `LayoutTabState`.
    expect(states[0]).toEqual({
      tabId: 'good',
      tabType: 'erd',
      title: 'Untitled',
      icon: '',
      isPinned: false,
    });
  });

  it('returns nothing for a blob that is not a Dockview layout at all', () => {
    for (const junk of [undefined, null, 'string', 42, [], {}, { panels: 'nope' }]) {
      expect(layoutTabStatesFrom(junk)).toEqual([]);
      expect(layoutHasOutputPanel(junk)).toBe(false);
    }
  });
});
