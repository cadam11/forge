/**
 * The tab workspace: what is open, what is focused, what is dirty, and the persistence of all
 * three. Tabs are the navigation model — PLAN.md 0.1 established that the Angular router never
 * had an outlet, so this store is the whole of "where am I" in the app.
 *
 * Ported from `packages/renderer/src/app/core/state/tab.state.ts`. Conventions: `capabilities.ts`.
 *
 * Two pieces of state are deliberately NOT in the store, carried over from the Angular original
 * (`tab.state.ts:60-73`), and they are the reason this file has closure variables at all:
 *
 * - **`contentMap`** — live editor text per tab. Monaco fires per keystroke, and putting the text
 *   in the store would rebuild the tabs array per character and re-render every `tabs` subscriber
 *   with it. The store's `content` field holds the initial/persisted value only; live text goes
 *   through `getTabContent` / `setTabContent`, which no component subscribes to.
 * - **`cleanContentMap`** — the per-tab baseline that `isDirty` is measured against. Only the
 *   resulting boolean reaches the store, so a keystroke that does not flip dirtiness costs zero
 *   re-renders.
 *
 * `saveTimeout` is the third: a debounce handle is a resource, not state, and nothing renders it.
 */

import { create } from 'zustand';
import type { TabState as PersistedTab } from '@joinery/shared';
import { ipc, isIpcAvailable } from '../ipc';
import { diagnostics } from './diagnostics';

export type TabType = 'query' | 'results' | 'object' | 'welcome' | 'erd' | 'chat';

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  icon: string;
  connectionId?: string;
  databaseName?: string;
  content?: string; // For query tabs, the SQL content
  isDirty?: boolean;
  isPinned?: boolean;
  autoExecute?: boolean; // For query tabs, execute immediately when opened
  metadata?: Record<string, unknown>;
}

/** One of the six localStorage keys PLAN.md 0.5 inventories. Task 5 owns migrating it. */
const WELCOME_DISMISSED_KEY = 'joinery:welcomeDismissed';

const MAX_QUERY_TABS = 20;
const SAVE_DEBOUNCE_MS = 500;

const WELCOME_TAB: Tab = { id: 'welcome', type: 'welcome', title: 'Welcome', icon: 'home' };

/** Tab types that hold a database "in use" and therefore block drop/restore until closed. */
const DATABASE_BOUND_TYPES: readonly TabType[] = ['query', 'object', 'erd'];

const OBJECT_TYPE_ICONS: Record<string, string> = {
  table: 'table_chart',
  view: 'view_list',
  procedure: 'functions',
  function: 'calculate',
  index: 'format_list_numbered',
  trigger: 'bolt',
  constraint: 'link',
};

function iconForObjectType(objectType: string): string {
  return OBJECT_TYPE_ICONS[objectType.toLowerCase()] ?? 'description';
}

/**
 * Generate a smart tab title from SQL content: a preview of the statement (e.g. the table a
 * SELECT reads) or "Query N". Pure; lifted out of the store because it needs no state.
 */
export function generateQueryTitle(sql: string | undefined, index: number): string {
  if (!sql || !sql.trim()) {
    return `Query ${index}`;
  }

  const cleaned = sql.replace(/\s+/g, ' ').trim();

  const selectMatch = cleaned.match(/^SELECT\b.*?\bFROM\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?/i);
  const selectTable = selectMatch?.[2];
  if (selectTable) {
    return selectTable.length > 20 ? `${selectTable.substring(0, 18)}…` : selectTable;
  }

  const execMatch = cleaned.match(/^EXEC(?:UTE)?\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?/i);
  const execProc = execMatch?.[2];
  if (execProc) {
    return `Exec ${execProc.length > 16 ? `${execProc.substring(0, 14)}…` : execProc}`;
  }

  const preview = cleaned.substring(0, 22);
  return preview.length < cleaned.length ? `${preview}…` : preview;
}

/** The subset of a saved GoldenLayout/Dockview component state a tab can be rebuilt from. */
export interface LayoutTabState {
  tabId: string;
  tabType: string;
  title: string;
  icon: string;
  isPinned: boolean;
  connectionId?: string;
  databaseName?: string;
  /**
   * Optional, because this arrives from rehydrated layout JSON. The Angular source guarded it with
   * `state.configuration?.['content']` even though its own type said otherwise
   * (`tab.state.ts:686-688`); the type now says what the guard already knew, so a panel persisted
   * without a configuration block yields `undefined` rather than throwing.
   */
  configuration?: Record<string, unknown>;
}

export interface TabStoreState {
  readonly tabs: readonly Tab[];
  readonly activeTabId: string;

  readonly openTab: (tab: Omit<Tab, 'id'>) => string;
  readonly closeTab: (tabId: string) => void;
  readonly activateTab: (tabId: string) => void;
  readonly updateTab: (tabId: string, updates: Partial<Tab>) => void;

  readonly markDirty: (tabId: string) => void;
  readonly markClean: (tabId: string) => void;
  readonly setTabDirty: (tabId: string, isDirty: boolean) => void;
  readonly setCleanBaseline: (tabId: string, content: string) => void;
  readonly getCleanBaseline: (tabId: string) => string;

  /** Records live editor text. Returns true only when the dirty flag actually flipped. */
  readonly setTabContent: (tabId: string, content: string) => boolean;
  readonly getTabContent: (tabId: string) => string;

  readonly togglePin: (tabId: string) => void;
  readonly pinTab: (tabId: string) => void;
  readonly unpinTab: (tabId: string) => void;
  readonly renameTab: (tabId: string, newTitle: string) => void;

  readonly openQueryTab: (
    connectionId: string,
    databaseName: string,
    initialSql?: string,
    autoExecute?: boolean,
    reuseEmpty?: boolean
  ) => string;
  readonly clearAutoExecute: (tabId: string) => void;
  readonly openObjectTab: (
    connectionId: string,
    databaseName: string,
    objectName: string,
    objectType: string,
    schema?: string
  ) => string;
  readonly openErdTab: (
    connectionId: string,
    databaseName: string,
    tableName?: string,
    schema?: string
  ) => string;
  readonly openChatTab: (conversationId?: string) => string;
  readonly showWelcome: () => void;

  readonly closeTabsForDatabase: (connectionId: string, databaseName: string) => void;
  readonly closeAllTabs: () => void;
  readonly closeOtherTabs: (tabId: string) => void;
  readonly closeTabsToRight: (tabId: string) => void;
  readonly duplicateTab: (tabId: string) => string | null;
  readonly nextTab: () => void;
  readonly previousTab: () => void;

  readonly saveTabs: () => Promise<void>;
  readonly restoreTabs: (connectionId: string) => Promise<void>;
  readonly syncTabsFromLayout: (layoutTabStates: readonly LayoutTabState[]) => void;
}

export type TabStore = ReturnType<typeof createTabStore>;

function readWelcomeDismissed(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_DISMISSED_KEY) === 'true';
  } catch (error) {
    // Storage can be blocked. "Not dismissed" is the safe answer — the user sees Welcome.
    diagnostics.warn('could not read the welcome-dismissed flag', error);
    return false;
  }
}

function writeWelcomeDismissed(dismissed: boolean): void {
  try {
    if (dismissed) {
      window.localStorage.setItem(WELCOME_DISMISSED_KEY, 'true');
    } else {
      window.localStorage.removeItem(WELCOME_DISMISSED_KEY);
    }
  } catch (error) {
    diagnostics.warn('could not persist the welcome-dismissed flag', error);
  }
}

export function createTabStore() {
  // See the module comment: these three are per-store resources, not rendered state.
  const contentMap = new Map<string, string>();
  const cleanContentMap = new Map<string, string>();
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  const welcomeDismissed = readWelcomeDismissed();

  return create<TabStoreState>()((set, get) => {
    const scheduleSave = (): void => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        saveTimeout = null;
        void get().saveTabs();
      }, SAVE_DEBOUNCE_MS);
    };

    const findTab = (tabId: string): Tab | undefined => get().tabs.find(t => t.id === tabId);

    const forgetTabContent = (tabId: string): void => {
      cleanContentMap.delete(tabId);
      contentMap.delete(tabId);
    };

    return {
      tabs: welcomeDismissed ? [] : [WELCOME_TAB],
      activeTabId: welcomeDismissed ? '' : WELCOME_TAB.id,

      openTab: tab => {
        const id = `tab-${crypto.randomUUID()}`;
        const newTab: Tab = { ...tab, id };
        if (typeof tab.content === 'string') {
          contentMap.set(id, tab.content);
        }
        set(state => ({ tabs: [...state.tabs, newTab], activeTabId: id }));
        void get().saveTabs();
        return id;
      },

      closeTab: tabId => {
        const tabs = get().tabs;
        const index = tabs.findIndex(t => t.id === tabId);
        if (index === -1) return;

        if (tabs[index]?.type === 'welcome') {
          writeWelcomeDismissed(true);
        }
        forgetTabContent(tabId);

        const remaining = tabs.filter(t => t.id !== tabId);
        // Prefer the tab that slid into the closed tab's slot, else the last one.
        const nextActiveId =
          get().activeTabId === tabId
            ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? '')
            : get().activeTabId;

        set({ tabs: remaining, activeTabId: nextActiveId });
        void get().saveTabs();
      },

      activateTab: tabId => {
        if (findTab(tabId)) set({ activeTabId: tabId });
      },

      updateTab: (tabId, updates) => {
        set(state => ({
          tabs: state.tabs.map(t => (t.id === tabId ? { ...t, ...updates } : t)),
        }));
        if (updates.content !== undefined) scheduleSave();
      },

      markDirty: tabId => get().updateTab(tabId, { isDirty: true }),

      markClean: tabId => {
        if (findTab(tabId)) {
          cleanContentMap.set(tabId, get().getTabContent(tabId));
        }
        get().updateTab(tabId, { isDirty: false });
      },

      setTabDirty: (tabId, isDirty) => get().updateTab(tabId, { isDirty }),

      setCleanBaseline: (tabId, content) => {
        cleanContentMap.set(tabId, content);
      },

      getCleanBaseline: tabId => cleanContentMap.get(tabId) ?? '',

      setTabContent: (tabId, content) => {
        contentMap.set(tabId, content);
        scheduleSave();

        const isDirty = content !== (cleanContentMap.get(tabId) ?? '');
        const tab = findTab(tabId);
        if (!tab || tab.isDirty === isDirty) return false;
        get().updateTab(tabId, { isDirty });
        return true;
      },

      getTabContent: tabId => {
        const live = contentMap.get(tabId);
        if (live !== undefined) return live;
        return findTab(tabId)?.content ?? '';
      },

      togglePin: tabId => {
        const tab = findTab(tabId);
        if (!tab) return;
        get().updateTab(tabId, { isPinned: !tab.isPinned });
        void get().saveTabs();
      },

      pinTab: tabId => {
        get().updateTab(tabId, { isPinned: true });
        void get().saveTabs();
      },

      unpinTab: tabId => {
        get().updateTab(tabId, { isPinned: false });
        void get().saveTabs();
      },

      renameTab: (tabId, newTitle) => {
        if (!findTab(tabId) || !newTitle.trim()) return;
        get().updateTab(tabId, { title: newTitle.trim() });
        void get().saveTabs();
      },

      openQueryTab: (
        connectionId,
        databaseName,
        initialSql,
        autoExecute = false,
        reuseEmpty = true
      ) => {
        const queryTabs = get().tabs.filter(t => t.type === 'query');

        // Reuse the active tab when it is an empty, clean query tab — the explorer
        // double-click flow wants to "land in" the active tab. ⌘N opts out with
        // reuseEmpty=false so the user always gets a fresh one.
        if (!initialSql && reuseEmpty) {
          const activeTab = selectActiveTab(get());
          if (
            activeTab &&
            activeTab.type === 'query' &&
            !activeTab.isDirty &&
            get().getTabContent(activeTab.id).trim() === ''
          ) {
            get().updateTab(activeTab.id, { connectionId, databaseName });
            return activeTab.id;
          }
        }

        // Enforce the cap by closing the oldest closeable query tab.
        if (queryTabs.length >= MAX_QUERY_TABS) {
          const closeable = queryTabs.find(t => !t.isDirty && !t.isPinned);
          if (closeable) get().closeTab(closeable.id);
        }

        const content = initialSql ?? '';
        const tabId = get().openTab({
          type: 'query',
          title: generateQueryTitle(initialSql, queryTabs.length + 1),
          icon: 'code',
          connectionId,
          databaseName,
          content,
          isDirty: false,
          autoExecute,
        });

        // Baseline so dirty state is measured against the initial content.
        cleanContentMap.set(tabId, content);
        return tabId;
      },

      clearAutoExecute: tabId => get().updateTab(tabId, { autoExecute: false }),

      openObjectTab: (connectionId, databaseName, objectName, objectType, schema = 'dbo') => {
        const existing = get().tabs.find(
          t =>
            t.type === 'object' &&
            t.connectionId === connectionId &&
            t.databaseName === databaseName &&
            t.metadata?.['objectName'] === objectName
        );
        if (existing) {
          set({ activeTabId: existing.id });
          return existing.id;
        }

        return get().openTab({
          type: 'object',
          title: objectName,
          icon: iconForObjectType(objectType),
          connectionId,
          databaseName,
          metadata: { objectName, objectType, schema },
        });
      },

      openErdTab: (connectionId, databaseName, tableName, schema) => {
        const existing = get().tabs.find(
          t =>
            t.type === 'erd' &&
            t.connectionId === connectionId &&
            t.databaseName === databaseName &&
            t.metadata?.['tableName'] === tableName
        );
        if (existing) {
          set({ activeTabId: existing.id });
          return existing.id;
        }

        return get().openTab({
          type: 'erd',
          title: tableName ? `ERD: ${tableName}` : `ERD: ${databaseName}`,
          icon: 'account_tree',
          connectionId,
          databaseName,
          metadata: {
            tableName,
            schema: schema ?? 'dbo',
            // Two levels of relationships when focused on one table.
            focusDepth: tableName ? 2 : undefined,
          },
        });
      },

      // Each chat tab is an independent instance, so this never focuses an existing one.
      openChatTab: conversationId =>
        get().openTab({
          type: 'chat',
          title: 'AI Chat',
          icon: 'smart_toy',
          metadata: conversationId ? { conversationId } : undefined,
        }),

      showWelcome: () => {
        const existing = get().tabs.find(t => t.type === 'welcome');
        if (existing) {
          set({ activeTabId: existing.id });
          return;
        }
        writeWelcomeDismissed(false);
        set(state => ({ tabs: [WELCOME_TAB, ...state.tabs], activeTabId: WELCOME_TAB.id }));
      },

      closeTabsForDatabase: (connectionId, databaseName) => {
        for (const tab of selectTabsUsingDatabase(connectionId, databaseName)(get())) {
          get().closeTab(tab.id);
        }
      },

      closeAllTabs: () => {
        for (const tab of get().tabs) forgetTabContent(tab.id);
        set({ tabs: [], activeTabId: '' });
        void get().saveTabs();
      },

      closeOtherTabs: tabId => {
        const tab = findTab(tabId);
        if (!tab) return;
        for (const other of get().tabs) {
          if (other.id !== tabId) forgetTabContent(other.id);
        }
        set({ tabs: [tab], activeTabId: tabId });
        void get().saveTabs();
      },

      closeTabsToRight: tabId => {
        const tabs = get().tabs;
        const index = tabs.findIndex(t => t.id === tabId);
        if (index === -1) return;
        for (const removed of tabs.slice(index + 1)) forgetTabContent(removed.id);

        const kept = tabs.slice(0, index + 1);
        const activeSurvived = kept.some(t => t.id === get().activeTabId);
        set({ tabs: kept, activeTabId: activeSurvived ? get().activeTabId : tabId });
        void get().saveTabs();
      },

      duplicateTab: tabId => {
        const tab = findTab(tabId);
        if (!tab || tab.type !== 'query') return null;
        return get().openTab({
          type: tab.type,
          title: `${tab.title} (copy)`,
          icon: tab.icon,
          connectionId: tab.connectionId,
          databaseName: tab.databaseName,
          content: get().getTabContent(tabId),
          isDirty: tab.isDirty,
          metadata: tab.metadata ? { ...tab.metadata } : undefined,
        });
      },

      nextTab: () => {
        const tabs = get().tabs;
        if (tabs.length <= 1) return;
        const current = tabs.findIndex(t => t.id === get().activeTabId);
        const next = tabs[(current + 1) % tabs.length];
        if (next) set({ activeTabId: next.id });
      },

      previousTab: () => {
        const tabs = get().tabs;
        if (tabs.length <= 1) return;
        const current = tabs.findIndex(t => t.id === get().activeTabId);
        const previous = tabs[(current - 1 + tabs.length) % tabs.length];
        if (previous) set({ activeTabId: previous.id });
      },

      saveTabs: async () => {
        if (!isIpcAvailable()) return;
        try {
          // Query tabs only — results / object / welcome tabs are not worth restoring.
          const persistable: PersistedTab[] = get()
            .tabs.filter(t => t.type === 'query')
            .map(t => ({
              id: t.id,
              type: t.type,
              title: t.title,
              content: get().getTabContent(t.id),
              connectionId: t.connectionId,
              databaseName: t.databaseName,
              isDirty: t.isDirty,
              isPinned: t.isPinned,
            }));
          await ipc().app.saveTabs(persistable, get().activeTabId);
        } catch (error) {
          diagnostics.error('failed to save tabs', error);
        }
      },

      restoreTabs: async connectionId => {
        if (!isIpcAvailable()) return;
        try {
          const { tabs: savedTabs, activeTabId } = await ipc().app.getTabs();
          if (savedTabs.length === 0) return;

          const restored: Tab[] = savedTabs.map(t => {
            const id = t.id || `tab-${crypto.randomUUID()}`;
            if (t.type === 'query') {
              // Baseline AND live content, so a restored tab starts clean.
              cleanContentMap.set(id, t.content ?? '');
              contentMap.set(id, t.content ?? '');
            }
            return {
              id,
              type: t.type as TabType,
              title: t.title,
              icon: t.type === 'query' ? 'code' : 'description',
              connectionId: t.connectionId ?? connectionId,
              databaseName: t.databaseName,
              content: t.content,
              isDirty: false,
              isPinned: t.isPinned,
            };
          });

          const existingWelcome = get().tabs.find(t => t.type === 'welcome');
          const tabs = existingWelcome ? [existingWelcome, ...restored] : restored;
          const nextActive =
            activeTabId && tabs.some(t => t.id === activeTabId) ? activeTabId : get().activeTabId;
          set({ tabs, activeTabId: nextActive });
        } catch (error) {
          diagnostics.error('failed to restore tabs', error);
        }
      },

      /**
       * Reconcile the store with the tabs a persisted layout references, so the workspace never
       * mounts a panel this store has never heard of. Task 7 owns the `LayoutConfig` round-trip
       * (PLAN.md Decision C) and is this function's only consumer.
       */
      syncTabsFromLayout: layoutTabStates => {
        const current = get().tabs;
        const toAdd: Tab[] = [];

        for (const state of layoutTabStates) {
          if (current.some(t => t.id === state.tabId)) {
            // Take isPinned and title from the layout; it owns tab-header state.
            get().updateTab(state.tabId, { isPinned: state.isPinned, title: state.title });
            continue;
          }
          const content = state.configuration?.['content'];
          const autoExecute = state.configuration?.['autoExecute'];
          const newTab: Tab = {
            id: state.tabId,
            type: state.tabType as TabType,
            title: state.title,
            icon: state.icon,
            connectionId: state.connectionId,
            databaseName: state.databaseName,
            isPinned: state.isPinned,
            content: typeof content === 'string' ? content : undefined,
            autoExecute: typeof autoExecute === 'boolean' ? autoExecute : undefined,
            metadata: { ...state.configuration },
          };
          if (typeof newTab.content === 'string') {
            contentMap.set(newTab.id, newTab.content);
          }
          toAdd.push(newTab);
        }

        if (toAdd.length > 0) {
          set(prev => ({ tabs: [...prev.tabs, ...toAdd] }));
        }
      },
    };
  });
}

export const tabStore = createTabStore();
export const useTabStore = tabStore;

/**
 * The two fields every tab selector actually reads. Narrower than `TabStoreState` on purpose:
 * the connection store derives focus from a projection of this store, and a selector that
 * demanded the full state (actions included) could not be handed one.
 */
export interface TabsSlice {
  readonly tabs: readonly Tab[];
  readonly activeTabId: string;
}

export function selectActiveTab(state: TabsSlice): Tab | null {
  return state.tabs.find(t => t.id === state.activeTabId) ?? null;
}

export function selectHasTabs(state: Pick<TabsSlice, 'tabs'>): boolean {
  return state.tabs.length > 0;
}

export function selectTabCount(state: Pick<TabsSlice, 'tabs'>): number {
  return state.tabs.length;
}

/** Fresh array — subscribe with `useShallow`. */
export function selectDirtyTabs(state: Pick<TabsSlice, 'tabs'>): readonly Tab[] {
  return state.tabs.filter(t => t.isDirty);
}

/** Fresh array — subscribe with `useShallow`. */
export function selectTabsUsingDatabase(connectionId: string, databaseName: string) {
  return (state: Pick<TabsSlice, 'tabs'>): readonly Tab[] =>
    state.tabs.filter(
      t =>
        DATABASE_BOUND_TYPES.includes(t.type) &&
        t.connectionId === connectionId &&
        t.databaseName === databaseName
    );
}
