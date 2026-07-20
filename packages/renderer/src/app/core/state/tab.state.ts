import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { v4 as uuidv4 } from 'uuid';
import { IpcService } from '../services/ipc.service';
import type { TabState } from '@mj-forge/shared';
import { firstValueFrom } from 'rxjs';

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
  isPinned?: boolean; // For GoldenLayout, whether tab is pinned
  autoExecute?: boolean; // For query tabs, execute immediately when opened
  metadata?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class TabStateService {
  private readonly ipc = inject(IpcService);

  /**
   * Whether the user has explicitly dismissed the welcome tab.
   * Persisted in localStorage so we don't re-add it on every launch.
   */
  private welcomeDismissed = localStorage.getItem('forge:welcomeDismissed') === 'true';

  private readonly _tabs = signal<Tab[]>(
    this.welcomeDismissed
      ? []
      : [{ id: 'welcome', type: 'welcome', title: 'Welcome', icon: 'home' }]
  );
  private readonly _activeTabId = signal<string>(this.welcomeDismissed ? '' : 'welcome');

  // Public readonly signals
  readonly tabs = this._tabs.asReadonly();
  readonly activeTabId = this._activeTabId.asReadonly();

  // Computed
  readonly activeTab = computed(() => {
    const id = this._activeTabId();
    return this._tabs().find(t => t.id === id) ?? null;
  });

  readonly hasTabs = computed(() => this._tabs().length > 0);
  readonly tabCount = computed(() => this._tabs().length);

  // Observables
  readonly tabs$ = toObservable(this.tabs);
  readonly activeTab$ = toObservable(this.activeTab);

  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Tracks the "clean" content baseline per tab.
   * When editor content matches this value, the tab is not dirty.
   */
  private readonly cleanContentMap = new Map<string, string>();

  /**
   * Generate a unique tab ID using UUID v4
   */
  private generateTabId(): string {
    return `tab-${uuidv4()}`;
  }

  /**
   * Schedule a debounced save of tabs
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveTabs();
      this.saveTimeout = null;
    }, 500);
  }

  openTab(tab: Omit<Tab, 'id'>): string {
    const id = this.generateTabId();
    const newTab: Tab = { ...tab, id };
    this._tabs.update(tabs => [...tabs, newTab]);
    this._activeTabId.set(id);
    // Auto-save tabs
    this.saveTabs();
    return id;
  }

  closeTab(tabId: string): void {
    const tabs = this._tabs();
    const index = tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    // Track when user explicitly closes the welcome tab
    const closingTab = tabs[index];
    if (closingTab.type === 'welcome') {
      this.welcomeDismissed = true;
      localStorage.setItem('forge:welcomeDismissed', 'true');
    }

    this._tabs.update(currentTabs => currentTabs.filter(t => t.id !== tabId));
    this.cleanContentMap.delete(tabId);

    // If closing active tab, activate another tab
    if (this._activeTabId() === tabId) {
      const newTabs = this._tabs();
      if (newTabs.length > 0) {
        // Prefer the tab to the left, or the first tab
        const newIndex = Math.min(index, newTabs.length - 1);
        this._activeTabId.set(newTabs[newIndex].id);
      } else {
        this._activeTabId.set('');
      }
    }
    // Auto-save tabs
    this.saveTabs();
  }

  activateTab(tabId: string): void {
    const tab = this._tabs().find(t => t.id === tabId);
    if (tab) {
      this._activeTabId.set(tabId);
    }
  }

  updateTab(tabId: string, updates: Partial<Tab>): void {
    this._tabs.update(tabs => tabs.map(t => (t.id === tabId ? { ...t, ...updates } : t)));
    // Debounced save for content updates
    if (updates.content !== undefined) {
      this.scheduleSave();
    }
  }

  /**
   * Mark a tab as dirty (has unsaved changes).
   */
  markDirty(tabId: string): void {
    this.updateTab(tabId, { isDirty: true });
  }

  /**
   * Mark a tab as clean (no unsaved changes).
   * Optionally updates the clean baseline to the current content.
   */
  markClean(tabId: string): void {
    const tab = this._tabs().find(t => t.id === tabId);
    if (tab) {
      this.cleanContentMap.set(tabId, tab.content ?? '');
    }
    this.updateTab(tabId, { isDirty: false });
  }

  /**
   * Set the clean content baseline for a tab.
   * Used to determine if content has changed from its initial/saved state.
   */
  setCleanBaseline(tabId: string, content: string): void {
    this.cleanContentMap.set(tabId, content);
  }

  /**
   * Get the clean content baseline for a tab.
   */
  getCleanBaseline(tabId: string): string {
    return this.cleanContentMap.get(tabId) ?? '';
  }

  setTabDirty(tabId: string, isDirty: boolean): void {
    this.updateTab(tabId, { isDirty });
  }

  setTabContent(tabId: string, content: string): void {
    const baseline = this.cleanContentMap.get(tabId) ?? '';
    const isDirty = content !== baseline;
    this.updateTab(tabId, { content, isDirty });
  }

  /**
   * Toggle pin state for a tab
   */
  togglePin(tabId: string): void {
    const tab = this._tabs().find(t => t.id === tabId);
    if (tab) {
      this.updateTab(tabId, { isPinned: !tab.isPinned });
      this.saveTabs();
    }
  }

  /**
   * Pin a specific tab
   */
  pinTab(tabId: string): void {
    this.updateTab(tabId, { isPinned: true });
    this.saveTabs();
  }

  /**
   * Unpin a specific tab
   */
  unpinTab(tabId: string): void {
    this.updateTab(tabId, { isPinned: false });
    this.saveTabs();
  }

  /**
   * Rename a tab
   */
  renameTab(tabId: string, newTitle: string): void {
    const tab = this._tabs().find(t => t.id === tabId);
    if (tab && newTitle.trim()) {
      this.updateTab(tabId, { title: newTitle.trim() });
      this.saveTabs();
    }
  }

  private readonly MAX_QUERY_TABS = 20;

  openQueryTab(
    connectionId: string,
    databaseName: string,
    initialSql?: string,
    autoExecute = false,
    reuseEmpty = true
  ): string {
    const queryTabs = this._tabs().filter(t => t.type === 'query');

    // Reuse the active tab if it's an empty, clean query tab — useful for
    // explorer double-click flows that want to "land in" the active tab
    // rather than spawn a new one. Cmd+N / menu New Query opt out via
    // reuseEmpty=false so the user always sees a fresh tab.
    if (!initialSql && reuseEmpty) {
      const activeTab = this.activeTab();
      if (
        activeTab &&
        activeTab.type === 'query' &&
        !activeTab.isDirty &&
        (!activeTab.content || activeTab.content.trim() === '')
      ) {
        this.updateTab(activeTab.id, { connectionId, databaseName });
        return activeTab.id;
      }
    }

    // Enforce max query tab limit — close oldest non-dirty, non-pinned query tabs
    if (queryTabs.length >= this.MAX_QUERY_TABS) {
      const closeable = queryTabs.filter(t => !t.isDirty && !t.isPinned);
      if (closeable.length > 0) {
        this.closeTab(closeable[0].id);
      }
    }

    const title = this.generateQueryTitle(initialSql, queryTabs.length + 1);
    const content = initialSql || '';

    const tabId = this.openTab({
      type: 'query',
      title,
      icon: 'code',
      connectionId,
      databaseName,
      content,
      isDirty: false,
      autoExecute,
    });

    // Set the clean baseline so dirty state is tracked relative to initial content
    this.cleanContentMap.set(tabId, content);

    return tabId;
  }

  /**
   * Generate a smart tab title from SQL content.
   * Shows a preview of the SQL (e.g., "SELECT...Entity") or falls back to "Query N".
   */
  private generateQueryTitle(sql: string | undefined, index: number): string {
    if (!sql || !sql.trim()) {
      return `Query ${index}`;
    }

    // Clean up the SQL: collapse whitespace, trim
    const cleaned = sql.replace(/\s+/g, ' ').trim();

    // Try to extract a meaningful short title from the SQL
    // Match SELECT ... FROM [schema].[table]
    const selectMatch = cleaned.match(/^SELECT\b.*?\bFROM\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?/i);
    if (selectMatch) {
      const table = selectMatch[2];
      return table.length > 20 ? `${table.substring(0, 18)}…` : table;
    }

    // Match EXEC [schema].[proc]
    const execMatch = cleaned.match(/^EXEC(?:UTE)?\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?/i);
    if (execMatch) {
      const proc = execMatch[2];
      return `Exec ${proc.length > 16 ? proc.substring(0, 14) + '…' : proc}`;
    }

    // For other SQL, take first 20 chars
    const preview = cleaned.substring(0, 22);
    return preview.length < cleaned.length ? `${preview}…` : preview;
  }

  clearAutoExecute(tabId: string): void {
    this.updateTab(tabId, { autoExecute: false });
  }

  openObjectTab(
    connectionId: string,
    databaseName: string,
    objectName: string,
    objectType: string,
    schema = 'dbo'
  ): string {
    // Check if tab already exists
    const existing = this._tabs().find(
      t =>
        t.type === 'object' &&
        t.connectionId === connectionId &&
        t.databaseName === databaseName &&
        t.metadata?.['objectName'] === objectName
    );

    if (existing) {
      this._activeTabId.set(existing.id);
      return existing.id;
    }

    return this.openTab({
      type: 'object',
      title: objectName,
      icon: this.getIconForObjectType(objectType),
      connectionId,
      databaseName,
      metadata: { objectName, objectType, schema },
    });
  }

  /**
   * Open an ERD (Entity Relationship Diagram) tab
   * @param connectionId The connection ID
   * @param databaseName The database name
   * @param tableName Optional table name to focus on
   * @param schema Optional schema name (defaults to 'dbo')
   */
  openErdTab(
    connectionId: string,
    databaseName: string,
    tableName?: string,
    schema?: string
  ): string {
    // Check if ERD tab already exists for this database/table
    const existing = this._tabs().find(
      t =>
        t.type === 'erd' &&
        t.connectionId === connectionId &&
        t.databaseName === databaseName &&
        t.metadata?.['tableName'] === tableName
    );

    if (existing) {
      this._activeTabId.set(existing.id);
      return existing.id;
    }

    const title = tableName ? `ERD: ${tableName}` : `ERD: ${databaseName}`;

    return this.openTab({
      type: 'erd',
      title,
      icon: 'account_tree',
      connectionId,
      databaseName,
      metadata: {
        tableName,
        schema: schema || 'dbo',
        focusDepth: tableName ? 2 : undefined, // Show 2 levels of relationships when focused on a table
      },
    });
  }

  getDirtyTabs(): Tab[] {
    return this._tabs().filter(t => t.isDirty);
  }

  /**
   * Tabs that are actively bound to a specific database (query / object / ERD
   * windows). These hold the database "in use" from the user's perspective and
   * block drop/restore until closed.
   */
  tabsUsingDatabase(connectionId: string, databaseName: string): Tab[] {
    return this._tabs().filter(
      t =>
        (t.type === 'query' || t.type === 'object' || t.type === 'erd') &&
        t.connectionId === connectionId &&
        t.databaseName === databaseName
    );
  }

  /**
   * Close every tab bound to a database. Used when the user opts to delete a
   * database that still has windows open against it.
   */
  closeTabsForDatabase(connectionId: string, databaseName: string): void {
    for (const tab of this.tabsUsingDatabase(connectionId, databaseName)) {
      this.closeTab(tab.id);
    }
  }

  /**
   * Show the Welcome tab. Re-adds it if user previously dismissed it.
   */
  showWelcome(): void {
    // If welcome tab already exists, just activate it
    const existing = this._tabs().find(t => t.type === 'welcome');
    if (existing) {
      this._activeTabId.set(existing.id);
      return;
    }

    // Re-add welcome tab and clear dismissed flag
    this.welcomeDismissed = false;
    localStorage.removeItem('forge:welcomeDismissed');

    const welcomeTab: Tab = { id: 'welcome', type: 'welcome', title: 'Welcome', icon: 'home' };
    this._tabs.update(tabs => [welcomeTab, ...tabs]);
    this._activeTabId.set('welcome');
  }

  /**
   * Open (or focus) an AI chat tab in the main content area.
   */
  openChatTab(conversationId?: string): string {
    // Each chat tab is an independent instance — allow multiple
    return this.openTab({
      type: 'chat',
      title: 'AI Chat',
      icon: 'smart_toy',
      metadata: conversationId ? { conversationId } : undefined,
    });
  }

  closeAllTabs(): void {
    // Clean up content tracking for all tabs
    for (const tab of this._tabs()) {
      this.cleanContentMap.delete(tab.id);
    }
    this._tabs.set([]);
    this._activeTabId.set('');
    this.saveTabs();
  }

  closeOtherTabs(tabId: string): void {
    const tab = this._tabs().find(t => t.id === tabId);
    if (tab) {
      // Clean up content tracking for removed tabs
      for (const t of this._tabs()) {
        if (t.id !== tabId) this.cleanContentMap.delete(t.id);
      }
      this._tabs.set([tab]);
      this._activeTabId.set(tabId);
      this.saveTabs();
    }
  }

  closeTabsToRight(tabId: string): void {
    const tabs = this._tabs();
    const index = tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;
    // Clean up content tracking for removed tabs
    for (let i = index + 1; i < tabs.length; i++) {
      this.cleanContentMap.delete(tabs[i].id);
    }
    this._tabs.set(tabs.slice(0, index + 1));
    // If active tab was to the right, activate this tab
    if (!this._tabs().find(t => t.id === this._activeTabId())) {
      this._activeTabId.set(tabId);
    }
    this.saveTabs();
  }

  duplicateTab(tabId: string): string | null {
    const tab = this._tabs().find(t => t.id === tabId);
    if (!tab || tab.type !== 'query') return null;
    return this.openTab({
      type: tab.type,
      title: `${tab.title} (copy)`,
      icon: tab.icon,
      connectionId: tab.connectionId,
      databaseName: tab.databaseName,
      content: tab.content,
      isDirty: tab.isDirty,
      metadata: tab.metadata ? { ...tab.metadata } : undefined,
    });
  }

  nextTab(): void {
    const tabs = this._tabs();
    if (tabs.length <= 1) return;

    const currentIndex = tabs.findIndex(t => t.id === this._activeTabId());
    const nextIndex = (currentIndex + 1) % tabs.length;
    this._activeTabId.set(tabs[nextIndex].id);
  }

  previousTab(): void {
    const tabs = this._tabs();
    if (tabs.length <= 1) return;

    const currentIndex = tabs.findIndex(t => t.id === this._activeTabId());
    const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    this._activeTabId.set(tabs[prevIndex].id);
  }

  private getIconForObjectType(objectType: string): string {
    const iconMap: Record<string, string> = {
      table: 'table_chart',
      view: 'view_list',
      procedure: 'functions',
      function: 'calculate',
      index: 'format_list_numbered',
      trigger: 'bolt',
      constraint: 'link',
    };
    return iconMap[objectType.toLowerCase()] || 'description';
  }

  /**
   * Save tabs to persistent storage
   */
  async saveTabs(): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      const tabs = this._tabs();
      // Only save query tabs (not results, objects, or welcome)
      const persistableTabs: TabState[] = tabs
        .filter(t => t.type === 'query')
        .map(t => ({
          id: t.id,
          type: t.type,
          title: t.title,
          content: t.content,
          connectionId: t.connectionId,
          databaseName: t.databaseName,
          isDirty: t.isDirty,
          isPinned: t.isPinned,
        }));

      await firstValueFrom(this.ipc.saveTabs(persistableTabs, this._activeTabId()));
    } catch (error) {
      console.error('Failed to save tabs:', error);
    }
  }

  /**
   * Restore tabs from persistent storage
   */
  async restoreTabs(connectionId: string): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      const { tabs: savedTabs, activeTabId } = await firstValueFrom(this.ipc.getTabs());

      if (savedTabs.length === 0) return;

      // Convert saved tabs to full Tab objects
      // Use existing IDs if valid, otherwise generate new UUIDs
      const restoredTabs: Tab[] = savedTabs.map(t => {
        const id = t.id || this.generateTabId();
        // Set clean baseline for restored query tabs so dirty tracking works
        if (t.type === 'query') {
          this.cleanContentMap.set(id, t.content ?? '');
        }
        return {
          id,
          type: t.type as TabType,
          title: t.title,
          icon: t.type === 'query' ? 'code' : 'description',
          connectionId: t.connectionId ?? connectionId,
          databaseName: t.databaseName,
          content: t.content,
          isDirty: false, // Restored tabs start clean (baseline matches content)
          isPinned: t.isPinned,
        };
      });

      // Preserve welcome tab if it exists and hasn't been dismissed
      const existingWelcome = this._tabs().find(t => t.type === 'welcome');
      if (existingWelcome) {
        this._tabs.set([existingWelcome, ...restoredTabs]);
      } else {
        this._tabs.set(restoredTabs);
      }

      // Restore active tab if it exists
      if (activeTabId && this._tabs().some(t => t.id === activeTabId)) {
        this._activeTabId.set(activeTabId);
      }
    } catch (error) {
      console.error('Failed to restore tabs:', error);
    }
  }

  /**
   * Sync tabs from GoldenLayout component states.
   * This ensures TabStateService has all tabs that the layout references.
   * @param layoutTabStates Tab states extracted from saved GoldenLayout config
   */
  syncTabsFromLayout(
    layoutTabStates: Array<{
      tabId: string;
      tabType: string;
      title: string;
      icon: string;
      isPinned: boolean;
      connectionId?: string;
      databaseName?: string;
      configuration: Record<string, unknown>;
    }>
  ): void {
    const currentTabs = this._tabs();
    const tabsToAdd: Tab[] = [];

    for (const state of layoutTabStates) {
      // Check if tab already exists
      const existing = currentTabs.find(t => t.id === state.tabId);
      if (!existing) {
        // Create tab from layout state
        const newTab: Tab = {
          id: state.tabId,
          type: state.tabType as TabType,
          title: state.title,
          icon: state.icon,
          connectionId: state.connectionId,
          databaseName: state.databaseName,
          isPinned: state.isPinned,
          content: state.configuration?.['content'] as string | undefined,
          autoExecute: state.configuration?.['autoExecute'] as boolean | undefined,
          metadata: { ...state.configuration },
        };
        tabsToAdd.push(newTab);
      } else {
        // Update existing tab with layout state (especially isPinned)
        this.updateTab(state.tabId, {
          isPinned: state.isPinned,
          title: state.title,
        });
      }
    }

    if (tabsToAdd.length > 0) {
      this._tabs.update(tabs => [...tabs, ...tabsToAdd]);
    }
  }
}
