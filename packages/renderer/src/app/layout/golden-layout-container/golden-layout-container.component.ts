import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  ApplicationRef,
  EnvironmentInjector,
  createComponent,
  ComponentRef,
  inject,
  ChangeDetectorRef,
  HostListener,
  Output,
  EventEmitter,
  Type,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, firstValueFrom } from 'rxjs';
import {
  GoldenLayoutManager,
  TabComponentState,
  TabShownEvent,
} from '../../core/services/golden-layout-manager.service';
import { TabStateService, Tab } from '../../core/state/tab.state';
import { ConnectionStateService } from '../../core/state/connection.state';
import { IpcService } from '../../core/services/ipc.service';
import { WelcomeComponent } from '../../features/welcome/welcome.component';
import { QueryComponent } from '../../features/query/query.component';
import { ExplorerComponent } from '../../features/explorer/explorer.component';
import { ErdComponent } from '../../features/erd/erd.component';
import { ChatPanelComponent } from '../../features/chat/chat-panel.component';
import type { LayoutConfig } from '@mj-forge/shared';

/**
 * Container for Golden Layout tabs with dockable panel support.
 *
 * Handles:
 * - Golden Layout initialization
 * - Tab creation and content rendering
 * - Lazy loading of tab content
 * - Context menu for pin/close
 * - Layout persistence
 */
@Component({
  selector: 'app-golden-layout-container',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="golden-layout-wrapper">
      <div #glContainer class="gl-container"></div>
    </div>

    <!-- Context Menu -->
    @if (contextMenuVisible) {
      <div class="context-menu" [style.left.px]="contextMenuX" [style.top.px]="contextMenuY">
        <div class="context-menu-item" (click)="onContextRename()">
          <span class="material-icons">edit</span>
          <span>Rename Tab</span>
        </div>
        <div class="context-menu-item" (click)="onContextPin()">
          <span class="material-icons">{{ isContextTabPinned ? 'push_pin' : 'push_pin' }}</span>
          <span>{{ isContextTabPinned ? 'Unpin Tab' : 'Pin Tab' }}</span>
        </div>
        @if (isContextTabDuplicable) {
          <div class="context-menu-item" (click)="onContextDuplicate()">
            <span class="material-icons">content_copy</span>
            <span>Duplicate Tab</span>
          </div>
        }
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" (click)="onContextClose()">
          <span class="material-icons">close</span>
          <span>Close Tab</span>
        </div>
        <div class="context-menu-item" (click)="onContextCloseOthers()">
          <span class="material-icons">close_fullscreen</span>
          <span>Close Other Tabs</span>
        </div>
        <div class="context-menu-item" (click)="onContextCloseToRight()">
          <span class="material-icons">tab_close_right</span>
          <span>Close Tabs to Right</span>
        </div>
      </div>
    }

    <!-- Rename Dialog -->
    @if (renameDialogVisible) {
      <div class="rename-dialog-overlay" (click)="cancelRename()">
        <div class="rename-dialog" (click)="$event.stopPropagation()">
          <div class="rename-dialog-header">Rename Tab</div>
          <input
            #renameInput
            type="text"
            class="rename-input"
            [value]="renameValue"
            (input)="renameValue = $any($event.target).value"
            (keydown.enter)="confirmRename()"
            (keydown.escape)="cancelRename()"
          />
          <div class="rename-dialog-actions">
            <button class="btn btn-secondary" (click)="cancelRename()">Cancel</button>
            <button class="btn btn-primary" (click)="confirmRename()">Rename</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex: 1;
        height: 100%;
        width: 100%;
        overflow: hidden;
      }

      .golden-layout-wrapper {
        display: flex;
        flex-direction: column;
        flex: 1;
        width: 100%;
        overflow: hidden;
      }

      .gl-container {
        flex: 1;
        width: 100%;
        height: 100%;
        position: relative;
        background: var(--bg-primary);
      }

      /* Context Menu */
      .context-menu {
        position: fixed;
        background: var(--bg-elevated);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        min-width: 150px;
        z-index: 10001;
        overflow: hidden;
      }

      .context-menu .context-menu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        cursor: pointer;
        font-size: 13px;
        color: var(--text-primary);
        transition: background var(--transition-fast);
      }

      .context-menu .context-menu-item .material-icons {
        font-size: 16px;
        color: var(--text-secondary);
      }

      .context-menu .context-menu-item:hover {
        background: var(--bg-hover);
      }

      .context-menu .context-menu-divider {
        height: 1px;
        background: var(--border-primary);
        margin: 4px 0;
      }

      /* Rename Dialog */
      .rename-dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10002;
      }

      .rename-dialog {
        background: var(--bg-elevated);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        padding: 20px;
        min-width: 300px;
      }

      .rename-dialog-header {
        font-size: 16px;
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 16px;
      }

      .rename-input {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-primary);
        font-size: 14px;
        outline: none;
        box-sizing: border-box;
      }

      .rename-input:focus {
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
      }

      .rename-dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 16px;
      }

      .btn {
        padding: 8px 16px;
        border-radius: var(--radius-md);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        border: none;
        transition: background var(--transition-fast);
      }

      .btn-secondary {
        background: var(--bg-secondary);
        color: var(--text-primary);
      }

      .btn-secondary:hover {
        background: var(--bg-hover);
      }

      .btn-primary {
        background: var(--accent-primary);
        color: white;
      }

      .btn-primary:hover {
        background: var(--accent-hover);
      }
    `,
  ],
})
export class GoldenLayoutContainerComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('glContainer', { static: false }) glContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('renameInput') renameInputRef?: ElementRef<HTMLInputElement>;

  @Output() layoutInitError = new EventEmitter<void>();

  private readonly layoutManager = inject(GoldenLayoutManager);
  private readonly tabState = inject(TabStateService);
  private readonly connectionState = inject(ConnectionStateService);
  private readonly appRef = inject(ApplicationRef);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly ipc = inject(IpcService);

  private subscriptions: Subscription[] = [];
  private layoutInitRetryCount = 0;
  private readonly MAX_LAYOUT_INIT_RETRIES = 5;
  private layoutInitialized = false;
  private layoutRestorationComplete = false;
  private layoutSaveTimeout: ReturnType<typeof setTimeout> | null = null;

  // Track component references for cleanup
  private componentRefs = new Map<string, ComponentRef<unknown>>();

  // Context menu state
  contextMenuVisible = false;
  contextMenuX = 0;
  contextMenuY = 0;
  contextMenuTabId: string | null = null;

  // Rename dialog state
  renameDialogVisible = false;
  renameValue = '';
  private renameTabId: string | null = null;

  // Guard to prevent circular GL→tabState→GL sync during GL-initiated close
  private glInitiatedClose = false;

  // Cleanup for context menu document listeners
  private contextMenuCleanup: (() => void) | null = null;

  ngOnInit(): void {
    // Subscribe to tab events from Golden Layout
    this.subscriptions.push(
      this.layoutManager.TabShown.subscribe(event => {
        this.onTabShown(event);
      }),
      this.layoutManager.TabClosed.subscribe(tabId => {
        this.cleanupTabComponent(tabId);
        // Guard: GL already removed this tab, skip the sync back to GL
        this.glInitiatedClose = true;
        this.tabState.closeTab(tabId);
        this.glInitiatedClose = false;
      }),
      this.layoutManager.LayoutChanged.subscribe(() => {
        const layout = this.layoutManager.SaveLayout();
        this.saveLayoutState(layout);
      }),
      this.layoutManager.ActiveTab.subscribe(tabId => {
        if (tabId) {
          this.tabState.activateTab(tabId);
        }
      }),
      this.layoutManager.TabDoubleClicked.subscribe(tabId => {
        this.tabState.togglePin(tabId);
      }),
      this.layoutManager.TabRightClicked.subscribe(event => {
        this.showContextMenu(event.x, event.y, event.tabId);
      })
    );

    // Subscribe to tab state changes to sync with Golden Layout
    this.subscriptions.push(
      this.tabState.tabs$.subscribe(tabs => {
        if (this.layoutRestorationComplete && !this.glInitiatedClose) {
          this.syncTabsWithGoldenLayout(tabs);
        }
      })
    );
  }

  ngAfterViewInit(): void {
    this.initializeGoldenLayout();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());

    // Cleanup all component refs
    this.componentRefs.forEach((ref, _tabId) => {
      this.appRef.detachView(ref.hostView);
      ref.destroy();
    });
    this.componentRefs.clear();

    this.contextMenuCleanup?.();
    this.layoutManager.Destroy();
  }

  /**
   * Handle window resize events
   */
  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.layoutInitialized) {
      this.layoutManager.updateSize();
    }
  }

  /**
   * Initialize Golden Layout and load tabs
   */
  private async initializeGoldenLayout(): Promise<void> {
    if (!this.glContainer?.nativeElement) {
      this.layoutInitRetryCount++;

      if (this.layoutInitRetryCount > this.MAX_LAYOUT_INIT_RETRIES) {
        console.error(
          `Golden Layout container not available after ${this.MAX_LAYOUT_INIT_RETRIES} retries`
        );
        this.layoutInitError.emit();
        return;
      }

      console.warn(
        `Golden Layout container not available, retry ${this.layoutInitRetryCount}/${this.MAX_LAYOUT_INIT_RETRIES}...`
      );
      setTimeout(() => this.initializeGoldenLayout(), 50);
      return;
    }

    this.layoutInitRetryCount = 0;

    if (this.layoutInitialized) {
      return;
    }

    // Initialize Golden Layout
    this.layoutManager.Initialize(this.glContainer.nativeElement);
    this.layoutInitialized = true;

    // Try to load saved layout first
    let layoutLoaded = false;
    if (this.ipc.isAvailable) {
      try {
        const savedLayout = await firstValueFrom(this.ipc.getLayout());
        if (savedLayout && savedLayout.root && savedLayout.root.content?.length) {
          // Extract tab states from saved layout and sync with TabStateService
          // This ensures all tabs the layout references exist before loading
          const layoutTabStates = this.layoutManager.ExtractTabStatesFromLayout(savedLayout);
          if (layoutTabStates.length > 0) {
            this.tabState.syncTabsFromLayout(layoutTabStates);
          }

          // Now load the layout
          layoutLoaded = this.layoutManager.LoadLayout(savedLayout);
        }
      } catch (error) {
        console.warn('Failed to load saved layout:', error);
      }
    }

    // If no saved layout or loading failed, create tabs from current state
    if (!layoutLoaded) {
      const tabs = this.tabState.tabs();
      if (tabs.length > 0) {
        // Convert all tabs to TabComponentState at once
        const tabStates = tabs.map(tab => this.createTabState(tab));

        // Add all tabs at once for reliable initialization
        this.layoutManager.AddMultipleTabs(tabStates);

        // Focus active tab
        const activeTabId = this.tabState.activeTabId();
        if (activeTabId) {
          setTimeout(() => {
            this.layoutManager.FocusTab(activeTabId);
          }, 100);
        }
      }
    }

    this.layoutRestorationComplete = true;
  }

  /**
   * Create TabComponentState from Tab
   */
  private createTabState(tab: Tab): TabComponentState {
    const profile = tab.connectionId
      ? this.connectionState.getProfile(tab.connectionId)
      : undefined;
    return {
      tabId: tab.id,
      tabType: tab.type,
      connectionId: tab.connectionId,
      databaseName: tab.databaseName,
      title: tab.title,
      icon: tab.icon,
      isPinned: tab.isPinned ?? false,
      isDirty: tab.isDirty ?? false,
      isLoaded: false,
      connectionColor: profile?.color,
      configuration: {
        content: this.tabState.getTabContent(tab.id),
        autoExecute: tab.autoExecute,
        ...tab.metadata,
      },
    };
  }

  /**
   * Create a tab in Golden Layout from Tab state
   */
  private createTabInLayout(tab: Tab): void {
    const state = this.createTabState(tab);
    this.layoutManager.AddTab(state);
  }

  /**
   * Handle tab shown event for lazy loading
   */
  private async onTabShown(event: TabShownEvent): Promise<void> {
    if (event.isFirstShow) {
      await this.loadTabContent(event.tabId, event.container);
      this.layoutManager.MarkTabLoaded(event.tabId);
    }
  }

  /**
   * Load content into a tab container
   */
  private async loadTabContent(tabId: string, container: { element: HTMLElement }): Promise<void> {
    try {
      const tab = this.tabState.tabs().find(t => t.id === tabId);
      if (!tab) {
        console.error(`Tab not found: ${tabId}`);
        return;
      }

      // Get the component type for this tab
      const componentType = this.getComponentTypeForTab(tab);
      if (!componentType) {
        console.error(`Unknown tab type: ${tab.type}`);
        return;
      }

      // Clear loading placeholder
      container.element.innerHTML = '';

      // Create the component dynamically
      const componentRef = createComponent(componentType, {
        environmentInjector: this.environmentInjector,
      });

      // Attach to Angular's change detection
      this.appRef.attachView(componentRef.hostView);

      // Set inputs on the component based on tab type
      this.setComponentInputs(componentRef.instance, tab);

      // Create a container div for the component
      const componentElement = document.createElement('div');
      componentElement.className = 'tab-content-wrapper';
      componentElement.style.cssText =
        'width: 100%; height: 100%; display: flex; flex-direction: column;';

      // Append the component's native element
      const nativeElement = (componentRef.hostView as unknown as { rootNodes: HTMLElement[] })
        .rootNodes[0];
      componentElement.appendChild(nativeElement);

      // Add to Golden Layout container
      container.element.appendChild(componentElement);

      // Store reference for cleanup
      this.componentRefs.set(tabId, componentRef);
    } catch (e) {
      console.error('Failed to load tab content:', e);
    }
  }

  /**
   * Get the component type for a tab
   */
  private getComponentTypeForTab(tab: Tab): Type<unknown> | null {
    const componentMap: Record<string, Type<unknown>> = {
      welcome: WelcomeComponent,
      query: QueryComponent,
      object: ExplorerComponent,
      erd: ErdComponent,
      chat: ChatPanelComponent,
    };

    return componentMap[tab.type] || null;
  }

  /**
   * Set inputs on a component instance based on tab data
   */
  private setComponentInputs(instance: unknown, tab: Tab): void {
    // For query component, pass tab reference for content sync
    if (tab.type === 'query' && instance) {
      const queryInstance = instance as { tabId?: string };
      if ('tabId' in queryInstance) {
        queryInstance.tabId = tab.id;
      }
    }

    // For chat component in tab mode
    if (tab.type === 'chat' && instance) {
      const chatInstance = instance as { isTabMode?: boolean; conversationId?: string };
      if ('isTabMode' in chatInstance) {
        chatInstance.isTabMode = true;
      }
      if ('conversationId' in chatInstance && tab.metadata?.['conversationId']) {
        chatInstance.conversationId = tab.metadata['conversationId'] as string;
      }
    }

    // For ERD component, pass metadata
    if (tab.type === 'erd' && instance && tab.metadata) {
      const erdInstance = instance as { tableName?: string; schema?: string };
      if ('tableName' in erdInstance && tab.metadata['tableName']) {
        erdInstance.tableName = tab.metadata['tableName'] as string;
      }
      if ('schema' in erdInstance && tab.metadata['schema']) {
        erdInstance.schema = tab.metadata['schema'] as string;
      }
    }
  }

  /**
   * Cleanup a tab's component
   */
  private cleanupTabComponent(tabId: string): void {
    const componentRef = this.componentRefs.get(tabId);
    if (componentRef) {
      this.appRef.detachView(componentRef.hostView);
      componentRef.destroy();
      this.componentRefs.delete(tabId);
    }
  }

  /**
   * Sync tabs with Golden Layout
   */
  private syncTabsWithGoldenLayout(tabs: Tab[]): void {
    // Get existing tab IDs from Golden Layout
    const existingTabIds = this.layoutManager.GetAllTabIds();
    const configTabIds = tabs.map(tab => tab.id);

    // Remove tabs that are no longer in state
    existingTabIds.forEach(tabId => {
      if (!configTabIds.includes(tabId)) {
        this.layoutManager.RemoveTab(tabId);
      }
    });

    // Add tabs that don't exist yet
    tabs.forEach(tab => {
      if (!existingTabIds.includes(tab.id)) {
        this.createTabInLayout(tab);
      } else {
        // Update styling for existing tabs (including dirty state and connection color)
        const profile = tab.connectionId
          ? this.connectionState.getProfile(tab.connectionId)
          : undefined;
        this.layoutManager.UpdateTabStyle(tab.id, {
          isPinned: tab.isPinned ?? false,
          isDirty: tab.isDirty ?? false,
          title: tab.title,
          connectionColor: profile?.color,
        });
      }
    });
  }

  /**
   * Save layout state with debouncing
   */
  private saveLayoutState(layout: LayoutConfig): void {
    // Don't save during initial loading
    if (!this.layoutRestorationComplete) return;

    // Debounce saves to avoid excessive writes
    if (this.layoutSaveTimeout) {
      clearTimeout(this.layoutSaveTimeout);
    }

    this.layoutSaveTimeout = setTimeout(async () => {
      if (this.ipc.isAvailable) {
        try {
          await firstValueFrom(this.ipc.saveLayout(layout));
        } catch (error) {
          console.error('Failed to save layout:', error);
        }
      }
      this.layoutSaveTimeout = null;
    }, 500);
  }

  /**
   * Show context menu
   */
  showContextMenu(x: number, y: number, tabId: string): void {
    // Clean up any previous context menu listeners
    this.contextMenuCleanup?.();

    // Clamp to viewport so menu doesn't go off-screen
    this.contextMenuX = Math.min(x, window.innerWidth - 200);
    this.contextMenuY = Math.min(y, window.innerHeight - 300);
    this.contextMenuTabId = tabId;
    this.contextMenuVisible = true;
    this.cdr.detectChanges();

    // Close menu when clicking outside
    setTimeout(() => {
      const cleanup = () => {
        document.removeEventListener('click', clickHandler);
        document.removeEventListener('keydown', keyHandler);
        this.contextMenuCleanup = null;
      };

      const clickHandler = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!target.closest('.context-menu')) {
          this.hideContextMenu();
          cleanup();
        }
      };

      const keyHandler = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          this.hideContextMenu();
          cleanup();
        }
      };

      this.contextMenuCleanup = cleanup;
      document.addEventListener('click', clickHandler);
      document.addEventListener('keydown', keyHandler);
    }, 0);
  }

  /**
   * Hide context menu
   */
  hideContextMenu(): void {
    this.contextMenuVisible = false;
    this.contextMenuTabId = null;
    this.cdr.detectChanges();
  }

  /**
   * Check if context menu tab is pinned
   */
  get isContextTabPinned(): boolean {
    if (!this.contextMenuTabId) return false;
    const tab = this.tabState.tabs().find(t => t.id === this.contextMenuTabId);
    return tab?.isPinned ?? false;
  }

  /**
   * Toggle pin from context menu
   */
  onContextPin(): void {
    if (this.contextMenuTabId) {
      this.tabState.togglePin(this.contextMenuTabId);
    }
    this.hideContextMenu();
  }

  /**
   * Close tab from context menu
   */
  onContextClose(): void {
    if (this.contextMenuTabId) {
      this.layoutManager.RemoveTab(this.contextMenuTabId);
    }
    this.hideContextMenu();
  }

  /**
   * Close all other tabs from context menu
   */
  onContextCloseOthers(): void {
    if (this.contextMenuTabId) {
      this.tabState.closeOtherTabs(this.contextMenuTabId);
    }
    this.hideContextMenu();
  }

  /**
   * Check if context menu tab can be duplicated (only query tabs)
   */
  get isContextTabDuplicable(): boolean {
    if (!this.contextMenuTabId) return false;
    const tab = this.tabState.tabs().find(t => t.id === this.contextMenuTabId);
    return tab?.type === 'query';
  }

  /**
   * Duplicate tab from context menu
   */
  onContextDuplicate(): void {
    if (this.contextMenuTabId) {
      this.tabState.duplicateTab(this.contextMenuTabId);
    }
    this.hideContextMenu();
  }

  /**
   * Close tabs to the right from context menu
   */
  onContextCloseToRight(): void {
    if (this.contextMenuTabId) {
      this.tabState.closeTabsToRight(this.contextMenuTabId);
    }
    this.hideContextMenu();
  }

  /**
   * Show rename dialog from context menu
   */
  onContextRename(): void {
    if (this.contextMenuTabId) {
      const tab = this.tabState.tabs().find(t => t.id === this.contextMenuTabId);
      if (tab) {
        this.renameTabId = this.contextMenuTabId;
        this.renameValue = tab.title;
        this.renameDialogVisible = true;
        this.hideContextMenu();

        // Focus the input after it renders
        setTimeout(() => {
          const input = this.renameInputRef?.nativeElement;
          if (input) {
            input.focus();
            input.select();
          }
        }, 50);
      }
    }
  }

  /**
   * Confirm rename and apply changes
   */
  confirmRename(): void {
    if (this.renameTabId && this.renameValue.trim()) {
      this.tabState.renameTab(this.renameTabId, this.renameValue.trim());
      // Update the tab title in Golden Layout
      this.layoutManager.UpdateTabStyle(this.renameTabId, {
        title: this.renameValue.trim(),
      });
    }
    this.cancelRename();
  }

  /**
   * Cancel rename dialog
   */
  cancelRename(): void {
    this.renameDialogVisible = false;
    this.renameValue = '';
    this.renameTabId = null;
    this.cdr.detectChanges();
  }
}
