import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import type { LayoutConfig, LayoutNode } from '@joinery/shared';
import {
  VirtualLayout,
  ComponentContainer,
  LayoutConfig as GLLayoutConfig,
  ResolvedLayoutConfig,
  ContentItem,
  ComponentItemConfig,
  ResolvedComponentItemConfig,
  JsonValue,
  Stack,
} from 'golden-layout';

/**
 * State stored in each Golden Layout component
 */
export interface TabComponentState {
  tabId: string;
  tabType: string;
  connectionId?: string;
  databaseName?: string;
  title: string;
  icon: string;
  isPinned: boolean;
  isDirty?: boolean;
  isLoaded: boolean;
  connectionColor?: string;
  configuration: Record<string, unknown>;
}

/**
 * Event emitted when a tab is shown
 */
export interface TabShownEvent {
  tabId: string;
  container: ComponentContainer;
  isFirstShow: boolean;
}

/**
 * Event emitted when layout changes
 */
export interface LayoutChangedEvent {
  layout: ResolvedLayoutConfig;
}

/**
 * Manages Golden Layout instance and provides Angular integration.
 *
 * Handles:
 * - Layout initialization and destruction
 * - Tab creation with app-specific styling
 * - Lazy loading of tab content
 * - Layout serialization/deserialization
 * - Tab events (show, hide, close)
 */
@Injectable({
  providedIn: 'root',
})
export class GoldenLayoutManager {
  private layout: VirtualLayout | null = null;
  private containerElement: HTMLElement | null = null;

  // Event subjects
  private tabShown$ = new Subject<TabShownEvent>();
  private tabClosed$ = new Subject<string>();
  private layoutChanged$ = new Subject<LayoutChangedEvent>();
  private activeTab$ = new BehaviorSubject<string | null>(null);
  private tabDoubleClicked$ = new Subject<string>();
  private tabRightClicked$ = new Subject<{ tabId: string; x: number; y: number }>();

  // Track loaded tabs for lazy loading
  private loadedTabs = new Set<string>();

  // Track component containers by tab ID
  private containerMap = new Map<string, ComponentContainer>();

  /**
   * Observable for tab shown events (for lazy loading)
   */
  get TabShown(): Observable<TabShownEvent> {
    return this.tabShown$.asObservable();
  }

  /**
   * Observable for tab closed events
   */
  get TabClosed(): Observable<string> {
    return this.tabClosed$.asObservable();
  }

  /**
   * Observable for layout changed events
   */
  get LayoutChanged(): Observable<LayoutChangedEvent> {
    return this.layoutChanged$.asObservable();
  }

  /**
   * Observable for active tab changes
   */
  get ActiveTab(): Observable<string | null> {
    return this.activeTab$.asObservable();
  }

  /**
   * Observable for tab double-click events (to toggle pin status)
   */
  get TabDoubleClicked(): Observable<string> {
    return this.tabDoubleClicked$.asObservable();
  }

  /**
   * Observable for tab right-click events (to show context menu)
   */
  get TabRightClicked(): Observable<{ tabId: string; x: number; y: number }> {
    return this.tabRightClicked$.asObservable();
  }

  /**
   * Initialize Golden Layout in the specified container element
   */
  Initialize(element: HTMLElement): void {
    this.containerElement = element;

    // Create layout with empty config
    const config: GLLayoutConfig = {
      root: {
        type: 'row',
        content: [],
      },
      header: {
        show: 'top',
        popout: false,
        maximise: false,
        close: 'tab',
      },
    };

    this.layout = new VirtualLayout(
      this.containerElement,
      this.bindComponentEventListener.bind(this),
      this.unbindComponentEventListener.bind(this)
    );

    // Enable automatic resize when container size changes
    (
      this.layout as unknown as { resizeWithContainerAutomatically: boolean }
    ).resizeWithContainerAutomatically = true;

    // Subscribe to state changes
    this.layout.on('stateChanged', () => {
      if (this.layout) {
        this.layoutChanged$.next({
          layout: this.layout.saveLayout(),
        });
        this.refreshAllTabStyles();
      }
    });

    this.layout.on('activeContentItemChanged', (item: unknown) => {
      const typedItem = item as { container?: { state?: JsonValue } };
      const state = typedItem?.container?.state as TabComponentState | undefined;
      if (state?.tabId) {
        this.activeTab$.next(state.tabId);
      }
    });

    // Load the empty config to establish root structure
    this.layout.loadLayout(config);

    // Configure debounce settings for faster resize response
    (this.layout as unknown as { resizeDebounceInterval: number }).resizeDebounceInterval = 50;
    (
      this.layout as unknown as { resizeDebounceExtendedWhenPossible: boolean }
    ).resizeDebounceExtendedWhenPossible = false;

    // Set the size of Golden Layout to match the container
    const rect = this.containerElement.getBoundingClientRect();
    this.layout.setSize(rect.width, rect.height);

    // Retry setSize after delays to handle timing issues with flexbox layout
    setTimeout(() => this.updateSize(), 50);
    setTimeout(() => this.updateSize(), 150);
    setTimeout(() => this.updateSize(), 300);
  }

  /**
   * Update layout size to match container.
   */
  updateSize(): void {
    if (this.layout && this.containerElement) {
      const rect = this.containerElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this.layout.setSize(rect.width, rect.height);
      }
    }
  }

  /**
   * Destroy the Golden Layout instance
   */
  Destroy(): void {
    if (this.layout) {
      this.layout.destroy();
      this.layout = null;
    }
    this.containerMap.clear();
    this.loadedTabs.clear();
  }

  /**
   * Add a new tab to the layout
   */
  AddTab(state: TabComponentState): void {
    if (!this.layout) {
      console.error('GoldenLayoutManager: Layout not initialized');
      return;
    }

    try {
      // First, check if there's an existing stack to add to
      const existingStack = this.findFirstStack();

      if (existingStack) {
        // Add to existing stack (creates tabbed interface)
        const componentConfig: ComponentItemConfig = {
          type: 'component',
          componentType: 'tab-content',
          componentState: state as unknown as JsonValue,
          title: state.title,
        };
        existingStack.addItem(componentConfig);
      } else {
        // No existing stack - use addComponent which will create one
        this.layout.addComponent('tab-content', state as unknown as JsonValue, state.title);
      }
    } catch (error) {
      console.error('GoldenLayoutManager: Failed to add tab -', (error as Error).message);
    }
  }

  /**
   * Add multiple tabs at once by building a complete layout config.
   * This is more reliable than adding tabs one by one.
   */
  AddMultipleTabs(states: TabComponentState[]): void {
    if (!this.layout) {
      console.error('GoldenLayoutManager: Layout not initialized');
      return;
    }

    if (states.length === 0) {
      return;
    }

    try {
      // Build component configs for all tabs
      const componentConfigs: ComponentItemConfig[] = states.map(state => ({
        type: 'component' as const,
        componentType: 'tab-content',
        componentState: state as unknown as JsonValue,
        title: state.title,
      }));

      // Create a layout config with a single stack containing all tabs
      const config: GLLayoutConfig = {
        root: {
          type: 'stack',
          content: componentConfigs,
        },
        header: {
          show: 'top',
          popout: false,
          maximise: false,
          close: 'tab',
        },
      };

      // Load the complete layout
      this.layout.loadLayout(config);

      // Update size after loading
      setTimeout(() => this.updateSize(), 50);
    } catch (error) {
      console.error('GoldenLayoutManager: Failed to add multiple tabs -', (error as Error).message);
    }
  }

  /**
   * Remove a tab from the layout
   */
  RemoveTab(tabId: string): void {
    const container = this.containerMap.get(tabId);
    if (container) {
      container.close();
    }
  }

  /**
   * Focus a tab by ID
   */
  FocusTab(tabId: string): void {
    const container = this.containerMap.get(tabId);
    if (container) {
      container.focus();
    }
  }

  /**
   * Update tab style (pin state, title, etc.)
   */
  UpdateTabStyle(tabId: string, state: Partial<TabComponentState>): void {
    const container = this.containerMap.get(tabId);
    if (!container) return;

    // Update state
    const currentState = container.state as unknown as TabComponentState;
    Object.assign(currentState, state);

    // Update title if changed
    if (state.title) {
      container.setTitle(state.title);
    }

    // Apply visual styles
    this.applyTabStyles(container, currentState);
  }

  /**
   * Load layout from configuration
   * @returns true if layout was loaded successfully, false if it failed
   */
  LoadLayout(config: LayoutConfig): boolean {
    if (!this.layout) {
      console.error('GoldenLayoutManager: Layout not initialized');
      return false;
    }

    // Don't load empty or invalid layouts
    if (!config || !config.root || !config.root.content || config.root.content.length === 0) {
      return false;
    }

    try {
      const glConfig = this.convertToGoldenLayoutConfig(config);
      this.layout.loadLayout(glConfig);
      return true;
    } catch (error) {
      console.error('GoldenLayoutManager: Failed to load layout -', (error as Error).message);
      return false;
    }
  }

  /**
   * Save current layout to configuration format
   */
  SaveLayout(): LayoutConfig {
    if (!this.layout) {
      return { root: { type: 'row', content: [] } };
    }

    const resolved = this.layout.saveLayout();
    return this.convertFromGoldenLayoutConfig(resolved);
  }

  /**
   * Get container for a tab
   */
  GetContainer(tabId: string): ComponentContainer | undefined {
    return this.containerMap.get(tabId);
  }

  /**
   * Check if tab content has been loaded
   */
  IsTabLoaded(tabId: string): boolean {
    return this.loadedTabs.has(tabId);
  }

  /**
   * Mark tab as loaded
   */
  MarkTabLoaded(tabId: string): void {
    this.loadedTabs.add(tabId);
  }

  /**
   * Mark tab as not loaded (forces reload on next show)
   */
  MarkTabNotLoaded(tabId: string): void {
    this.loadedTabs.delete(tabId);
  }

  /**
   * Get all tab IDs currently in the layout
   */
  GetAllTabIds(): string[] {
    return Array.from(this.containerMap.keys());
  }

  /**
   * Extract all tab states from a saved layout configuration
   * This allows syncing TabStateService before loading the layout
   */
  ExtractTabStatesFromLayout(config: LayoutConfig): TabComponentState[] {
    const tabStates: TabComponentState[] = [];
    this.extractTabStatesRecursive(config.root, tabStates);
    return tabStates;
  }

  /**
   * Recursively extract tab states from layout nodes
   */
  private extractTabStatesRecursive(node: LayoutNode, tabStates: TabComponentState[]): void {
    if (node.type === 'component' && node.componentState) {
      const state = node.componentState as unknown as TabComponentState;
      if (state.tabId) {
        tabStates.push(state);
      }
    }

    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        this.extractTabStatesRecursive(child, tabStates);
      }
    }
  }

  /**
   * Bind component event listener (called by Golden Layout)
   */
  private bindComponentEventListener(
    container: ComponentContainer,
    _itemConfig: ResolvedComponentItemConfig
  ): { component: HTMLElement; virtual: boolean } {
    const state = container.state as unknown as TabComponentState;

    // Create a simple div element for tab content
    const element = document.createElement('div');
    element.className = 'tab-content-container';
    element.style.width = '100%';
    element.style.height = '100%';
    element.style.overflow = 'hidden';
    element.style.padding = '0';
    element.style.backgroundColor = 'var(--bg-primary)';

    // Loading placeholder
    element.innerHTML = `
      <div class="tab-loading-placeholder" style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);">
        <span>Loading...</span>
      </div>
    `;

    if (state?.tabId) {
      this.containerMap.set(state.tabId, container);

      // Apply initial styles
      this.applyTabStyles(container, state);

      // Listen for show events
      container.on('show', () => {
        const isFirstShow = !this.loadedTabs.has(state.tabId);
        this.tabShown$.next({
          tabId: state.tabId,
          container,
          isFirstShow,
        });
      });

      // Listen for close events
      container.on('beforeComponentRelease', () => {
        this.containerMap.delete(state.tabId);
        this.loadedTabs.delete(state.tabId);
        this.tabClosed$.next(state.tabId);
      });
    }

    // Return the bindable component object
    return {
      component: element,
      virtual: false, // false means actual DOM content
    };
  }

  /**
   * Unbind component event listener (called by Golden Layout)
   */
  private unbindComponentEventListener(_container: ComponentContainer): void {
    // Cleanup handled in beforeComponentRelease
  }

  /**
   * Map tab types to Material icon names
   */
  private readonly tabTypeIcons: Record<string, string> = {
    welcome: 'home',
    query: 'code',
    object: 'table_chart',
    results: 'view_list',
    erd: 'account_tree',
  };

  /**
   * Apply visual styles to a tab
   */
  private applyTabStyles(container: ComponentContainer, state: TabComponentState): void {
    const tabElement = container.tab?.element;
    if (!tabElement) return;

    // Add/remove pinned class
    if (state.isPinned) {
      tabElement.classList.add('pinned');
    } else {
      tabElement.classList.remove('pinned');
    }

    // Inject icon before the title if not already present
    if (!tabElement.querySelector('.tab-icon')) {
      const titleElement = tabElement.querySelector('.lm_title') as HTMLElement;
      if (titleElement) {
        const iconName = state.icon || this.tabTypeIcons[state.tabType] || 'description';
        const iconEl = document.createElement('span');
        iconEl.className = 'tab-icon material-icons';
        iconEl.textContent = iconName;
        titleElement.parentElement?.insertBefore(iconEl, titleElement);
      }
    }

    // Add event listeners if not already added
    if (!tabElement.hasAttribute('data-events-attached')) {
      tabElement.setAttribute('data-events-attached', 'true');

      // Double-click to toggle pin
      tabElement.addEventListener('dblclick', (e: Event) => {
        e.stopPropagation();
        this.tabDoubleClicked$.next(state.tabId);
      });

      // Right-click for context menu
      tabElement.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.tabRightClicked$.next({ tabId: state.tabId, x: e.clientX, y: e.clientY });
      });
    }

    // Handle dirty indicator dot
    if (state.isDirty) {
      tabElement.classList.add('dirty');
      if (!tabElement.querySelector('.dirty-indicator')) {
        const titleElement = tabElement.querySelector('.lm_title') as HTMLElement;
        if (titleElement) {
          const dot = document.createElement('span');
          dot.className = 'dirty-indicator';
          titleElement.parentElement?.insertBefore(dot, titleElement);
        }
      }
    } else {
      tabElement.classList.remove('dirty');
      const dot = tabElement.querySelector('.dirty-indicator');
      if (dot) {
        dot.remove();
      }
    }

    // Handle pin icon
    if (state.isPinned) {
      if (!tabElement.querySelector('.pin-icon')) {
        const pinIcon = document.createElement('span');
        pinIcon.className = 'pin-icon material-icons';
        pinIcon.textContent = 'push_pin';
        pinIcon.style.cssText = `
          position: absolute;
          right: 4px;
          top: 50%;
          transform: translateY(-50%) rotate(45deg);
          font-size: 11px;
          color: var(--text-secondary);
          width: 14px;
          height: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        `;
        pinIcon.addEventListener('click', e => {
          e.stopPropagation();
          this.tabDoubleClicked$.next(state.tabId);
        });
        tabElement.appendChild(pinIcon);
      }
    } else {
      const pinIcon = tabElement.querySelector('.pin-icon');
      if (pinIcon) {
        pinIcon.remove();
      }
    }

    // Apply connection color as a subtle left border
    if (state.connectionColor) {
      tabElement.style.borderLeft = `2px solid ${state.connectionColor}`;
    } else {
      tabElement.style.borderLeft = '';
    }
  }

  /**
   * Refresh styles for all tabs (after drag/drop)
   */
  private refreshAllTabStyles(): void {
    setTimeout(() => {
      this.containerMap.forEach((container, _tabId) => {
        const state = container.state as unknown as TabComponentState;
        if (state) {
          this.applyTabStyles(container, state);
        }
      });
    }, 50);
  }

  /**
   * Find first stack in layout
   */
  private findFirstStack(): Stack | null {
    if (!this.layout || !this.layout.rootItem) return null;

    const findStack = (item: ContentItem): Stack | null => {
      if (item.isStack) {
        return item as Stack;
      }
      if (item.contentItems) {
        for (const child of item.contentItems) {
          const found = findStack(child);
          if (found) return found;
        }
      }
      return null;
    };

    return findStack(this.layout.rootItem);
  }

  /**
   * Convert workspace layout config to Golden Layout config
   */
  private convertToGoldenLayoutConfig(config: LayoutConfig): GLLayoutConfig {
    const sanitizedRoot = this.sanitizeLayoutNode(config.root);

    return {
      root: sanitizedRoot as unknown as GLLayoutConfig['root'],
      header: {
        show: 'top',
        popout: false,
        maximise: false,
        close: 'tab',
      },
    };
  }

  /**
   * Sanitize a layout node to ensure all values are Golden Layout compatible
   */
  private sanitizeLayoutNode(node: LayoutNode): LayoutNode {
    const sanitized: LayoutNode = {
      ...node,
    };

    // Cast to allow dynamic property access/deletion
    const sanitizedAny = sanitized as unknown as Record<string, unknown>;

    // Convert size from number + sizeUnit to Golden Layout format
    if (sanitizedAny['size'] !== undefined && sanitizedAny['sizeUnit'] !== undefined) {
      if (typeof sanitizedAny['size'] === 'number') {
        sanitizedAny['size'] = `${sanitizedAny['size']}${sanitizedAny['sizeUnit']}`;
        delete sanitizedAny['sizeUnit'];
      }
    }

    // Remove width/height if they exist and are not valid
    if (sanitized.width !== undefined) {
      if (typeof sanitized.width !== 'number' && typeof sanitized.width !== 'string') {
        delete sanitized.width;
      }
    }
    if (sanitized.height !== undefined) {
      if (typeof sanitized.height !== 'number' && typeof sanitized.height !== 'string') {
        delete sanitized.height;
      }
    }

    // Remove other Golden Layout internal fields
    delete sanitizedAny['minSizeUnit'];

    // Recursively sanitize child nodes
    if (sanitized.content) {
      sanitized.content = sanitized.content.map(child => this.sanitizeLayoutNode(child));
    }

    return sanitized;
  }

  /**
   * Convert Golden Layout config to workspace layout config
   */
  private convertFromGoldenLayoutConfig(resolved: ResolvedLayoutConfig): LayoutConfig {
    return {
      root: resolved.root as unknown as LayoutNode,
    };
  }
}
