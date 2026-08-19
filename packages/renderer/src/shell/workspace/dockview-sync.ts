/**
 * The pure half of the Dockview ↔ `tabStore` reconciliation: which component renders which tab
 * type, what a panel carries in its `params`, and how a persisted Dockview blob is read back as
 * tabs. No React and no Dockview imports, so all of it is testable directly.
 *
 * `workspace.tsx` owns the imperative half — the effects that call `addPanel` / `close` /
 * `setActive` — and nothing else in the app talks to Dockview at all.
 */

import type { LayoutTabState, Tab, TabType } from '../../state/tab';

/**
 * The Output / Console panel's id. It is a real Dockview panel (PLAN.md §1.1: the Angular version
 * was a hardcoded, non-resizable 220px strip) but it is NOT a tab, so it has no entry in
 * `tabStore` and every reconciliation loop has to skip it. One reserved id, checked in one
 * predicate, rather than a "does this look like a tab id?" heuristic.
 */
export const OUTPUT_PANEL_ID = 'joinery:output';

/** Every panel id the workspace owns that is not a tab. */
export const RESERVED_PANEL_IDS: readonly string[] = [OUTPUT_PANEL_ID];

/** False for the reserved panels. The guard on both directions of the sync. */
export function isTabPanelId(id: string): boolean {
  return !RESERVED_PANEL_IDS.includes(id);
}

/**
 * The Dockview `component` name per tab type — the direct replacement for the Angular
 * `componentMap` at `golden-layout-container.component.ts:544-549`, which mounted one of five
 * components imperatively. `results` is in the `TabType` union but was never mounted by the
 * Angular container (results are a pane inside the query tab, not a tab); it maps to the query
 * placeholder so an unexpected persisted tab renders something rather than crashing the dock.
 */
export const PANEL_COMPONENT_BY_TAB_TYPE: Record<TabType, string> = {
  welcome: 'welcome',
  query: 'query',
  results: 'query',
  object: 'object',
  erd: 'erd',
  chat: 'chat',
};

export function panelComponentFor(type: TabType): string {
  return PANEL_COMPONENT_BY_TAB_TYPE[type] ?? 'query';
}

/**
 * What a tab panel carries in Dockview's `params`, which is the field `toJSON` serializes and
 * therefore this app's equivalent of Golden Layout's `componentState`.
 *
 * Deliberately a `LayoutTabState`: `tabStore.syncTabsFromLayout` already takes an array of them
 * (Task 4 wrote it for this task and named this task its only consumer), so a restored layout can
 * rebuild the tabs it references. That matters because `saveTabs` persists **query tabs only** —
 * an open ERD, object or chat tab exists nowhere else, and without this it would vanish on every
 * restart while its panel came back empty. Decision C keeps the tab LIST authoritative; this keeps
 * the arrangement from referring to tabs nobody remembers.
 */
export type TabPanelParams = LayoutTabState & Record<string, unknown>;

export function tabPanelParams(tab: Tab): TabPanelParams {
  return {
    tabId: tab.id,
    tabType: tab.type,
    title: tab.title,
    icon: tab.icon,
    isPinned: tab.isPinned ?? false,
    ...(tab.connectionId === undefined ? {} : { connectionId: tab.connectionId }),
    ...(tab.databaseName === undefined ? {} : { databaseName: tab.databaseName }),
    // The tab's own metadata is what `LayoutTabState.configuration` means; `syncTabsFromLayout`
    // reads `content` and `autoExecute` out of it and keeps the rest as metadata.
    configuration: { ...tab.metadata },
  };
}

/**
 * A cheap change key for the params above. The reconciliation effect compares this instead of
 * calling `panel.update()` unconditionally: params are a serialization vehicle that nothing
 * renders (the tab header subscribes to the store directly), so rewriting them on every tab
 * change would be pure churn — and each write fires `onDidLayoutChange`, i.e. a debounced IPC
 * save. JSON of a small flat object, because the alternative — a hand-written field-by-field
 * comparison — silently stops covering a field somebody adds later.
 */
export function paramsSignature(params: TabPanelParams): string {
  return JSON.stringify(params);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads the tab states out of a persisted Dockview blob.
 *
 * The input is a JSON object that came off the user's disk through an unvalidated main-process
 * merge (PLAN.md §7.5), so every field is untrusted: a panel without usable params is skipped
 * rather than allowed to produce a `Tab` with `undefined` where a string belongs. Never throws —
 * this runs inside the startup path, and a corrupt layout must degrade to "rebuild from the tab
 * list", which is Decision C's first-launch behaviour anyway.
 */
export function layoutTabStatesFrom(dockview: unknown): readonly LayoutTabState[] {
  if (!isRecord(dockview) || !isRecord(dockview['panels'])) return [];

  const states: LayoutTabState[] = [];
  for (const [panelId, panel] of Object.entries(dockview['panels'])) {
    if (!isTabPanelId(panelId) || !isRecord(panel)) continue;
    const params = isRecord(panel['params']) ? panel['params'] : undefined;

    const tabType = optionalString(params?.['tabType']);
    if (tabType === undefined) continue;

    states.push({
      // The panel's own id wins over `params.tabId`: the panel id is what Dockview keys its
      // grid on, so a blob where the two disagree must resolve to the one the arrangement uses.
      tabId: panelId,
      tabType,
      title: optionalString(params?.['title']) ?? optionalString(panel['title']) ?? 'Untitled',
      icon: optionalString(params?.['icon']) ?? '',
      isPinned: params?.['isPinned'] === true,
      ...(optionalString(params?.['connectionId']) === undefined
        ? {}
        : { connectionId: optionalString(params?.['connectionId']) }),
      ...(optionalString(params?.['databaseName']) === undefined
        ? {}
        : { databaseName: optionalString(params?.['databaseName']) }),
      ...(isRecord(params?.['configuration']) ? { configuration: params['configuration'] } : {}),
    });
  }
  return states;
}

/** True when the persisted blob places the Output panel, so the log store can adopt that. */
export function layoutHasOutputPanel(dockview: unknown): boolean {
  if (!isRecord(dockview) || !isRecord(dockview['panels'])) return false;
  return Object.hasOwn(dockview['panels'], OUTPUT_PANEL_ID);
}
