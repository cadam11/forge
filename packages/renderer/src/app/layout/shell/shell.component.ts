import { Component, OnInit, OnDestroy, HostListener, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, firstValueFrom } from 'rxjs';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { GoldenLayoutContainerComponent } from '../golden-layout-container/golden-layout-container.component';
import { StatusBarComponent } from '../status-bar/status-bar.component';
import { OutputPanelComponent } from '../output-panel/output-panel.component';
import { ChatPanelComponent } from '../../features/chat/chat-panel.component';
import { TourOverlayComponent } from '../../shared/components/tour-overlay/tour-overlay.component';
import { ConnectionStateService } from '../../core/state/connection.state';
import { TabStateService } from '../../core/state/tab.state';
import { ChatStateService } from '../../core/state/chat.state';
import { MenuService } from '../../core/services/menu.service';
import { QueryHistoryService } from '../../core/services/query-history.service';
import { IpcService } from '../../core/services/ipc.service';
import { NotificationService } from '../../core/services/notification.service';
import { LogService } from '../../core/services/log.service';

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 500;
const SIDEBAR_DEFAULT_WIDTH = 280;

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatIconModule,
    MatTooltipModule,
    SidebarComponent,
    GoldenLayoutContainerComponent,
    StatusBarComponent,
    OutputPanelComponent,
    ChatPanelComponent,
    TourOverlayComponent,
  ],
  template: `
    <div class="shell" [class.resizing]="resizing">
      @if (!sidebarHidden()) {
        <app-sidebar class="sidebar" [style.width.px]="sidebarWidth()" />
        <div
          class="resize-handle"
          (mousedown)="onResizeStart($event)"
          (dblclick)="onResizeReset()"
          matTooltip="Drag to resize, double-click to reset"
          matTooltipShowDelay="600"
        ></div>
      }
      <div class="main-area">
        <div class="window-drag-bar" [class.sidebar-hidden]="sidebarHidden()">
          @if (sidebarHidden()) {
            <button
              class="sidebar-show-btn"
              (click)="toggleSidebar()"
              matTooltip="Show sidebar (⌘B)"
            >
              <mat-icon>chevron_right</mat-icon>
            </button>
          }
        </div>
        <app-golden-layout-container class="content-area" />
        @if (logService.isOpen()) {
          <app-output-panel class="output-panel" />
        }
        <app-status-bar class="status-bar" />
      </div>
      <app-chat-panel />
      <app-tour-overlay />
    </div>
  `,
  styles: [
    `
      .shell {
        display: flex;
        height: 100vh;
        width: 100vw;
        overflow: hidden;
        background-color: var(--bg-primary);
      }

      .shell.resizing {
        cursor: col-resize;
        user-select: none;
      }

      .sidebar {
        flex-shrink: 0;
        height: 100%;
        border-right: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);
        transition: width 0.15s ease;
      }

      .shell.resizing .sidebar {
        transition: none;
      }

      .resize-handle {
        flex-shrink: 0;
        width: 4px;
        height: 100%;
        cursor: col-resize;
        background: transparent;
        position: relative;
        z-index: 10;
        margin-left: -2px;
        margin-right: -2px;
      }

      .resize-handle:hover,
      .resize-handle:active {
        background-color: var(--accent-primary, #007acc);
      }

      .window-drag-bar {
        height: 38px;
        flex-shrink: 0;
        -webkit-app-region: drag;
        display: flex;
        align-items: center;
      }

      .window-drag-bar.sidebar-hidden {
        padding-left: 80px; /* Clear macOS traffic lights */
      }

      .sidebar-show-btn {
        width: 24px;
        height: 24px;
        padding: 0;
        border: 1px solid var(--border-primary);
        border-radius: 4px;
        background: var(--bg-secondary);
        color: var(--text-secondary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.6;
        transition: opacity 0.15s ease;
        -webkit-app-region: no-drag;
      }

      .sidebar-show-btn:hover {
        opacity: 1;
        background: var(--bg-tertiary);
      }

      .sidebar-show-btn mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      .main-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        height: 100%;
      }

      .content-area {
        flex: 1;
        overflow: hidden;
        background-color: var(--bg-primary);
      }

      .status-bar {
        flex-shrink: 0;
        height: var(--status-bar-height);
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);
      }

      .output-panel {
        flex-shrink: 0;
        height: 220px;
        border-top: 1px solid var(--border-primary);
        overflow: hidden;
      }
    `,
  ],
})
export class ShellComponent implements OnInit, OnDestroy {
  private readonly connectionState = inject(ConnectionStateService);
  private readonly tabState = inject(TabStateService);
  private readonly chatState = inject(ChatStateService);
  private readonly menuService = inject(MenuService);
  private readonly queryHistory = inject(QueryHistoryService);
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  readonly logService = inject(LogService);

  readonly sidebarHidden = signal(false);
  readonly sidebarWidth = signal(SIDEBAR_DEFAULT_WIDTH);
  resizing = false;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private subscriptions: Subscription[] = [];

  ngOnInit(): void {
    // Start mirroring the main-process log stream into the Output panel.
    void this.logService.init();

    // Load saved sidebar preferences
    this.loadSidebarPreferences();

    // Load saved connection profiles on startup
    this.connectionState.loadProfiles();

    // Listen for sidebar toggle from menu
    this.subscriptions.push(
      this.menuService.toggleSidebar$.subscribe(() => {
        this.toggleSidebar();
      })
    );

    // Listen for query history from menu (Cmd+Shift+H)
    this.subscriptions.push(
      this.menuService.queryHistory$.subscribe(() => {
        this.queryHistory.openHistoryDialog();
      })
    );

    // Listen for close tab from menu (Cmd+W)
    this.subscriptions.push(
      this.menuService.closeTab$.subscribe(() => {
        const activeTab = this.tabState.activeTab();
        if (activeTab) {
          this.tabState.closeTab(activeTab.id);
        }
      })
    );

    // Listen for show keyboard shortcuts from menu
    this.subscriptions.push(
      this.menuService.showShortcuts$.subscribe(() => {
        window.dispatchEvent(new CustomEvent('forge:show-shortcuts'));
      })
    );

    // Listen for server properties from menu
    this.subscriptions.push(
      this.menuService.serverProperties$.subscribe(() => {
        this.showServerProperties();
      })
    );

    // Listen for database properties from menu
    this.subscriptions.push(
      this.menuService.databaseProperties$.subscribe(() => {
        this.showDatabaseProperties();
      })
    );

    // Listen for new database from menu
    this.subscriptions.push(
      this.menuService.newDatabase$.subscribe(() => {
        this.showNewDatabaseDialog();
      })
    );

    // Listen for AI chat toggle from menu (Cmd+Shift+I)
    this.subscriptions.push(
      this.menuService.toggleChat$.subscribe(() => {
        this.chatState.togglePanel();
      })
    );
  }

  private async showServerProperties(): Promise<void> {
    const connectionId = this.connectionState.focusedConnectionId();
    if (!connectionId) {
      this.notification.warning('No active connection');
      return;
    }

    try {
      const result = await firstValueFrom(
        this.ipc.executeQuery({
          connectionId,
          sql: `SELECT @@VERSION AS [Version], @@SERVERNAME AS [Server Name],
                SERVERPROPERTY('ProductVersion') AS [Product Version],
                SERVERPROPERTY('Edition') AS [Edition],
                SERVERPROPERTY('ProductLevel') AS [Product Level],
                SERVERPROPERTY('EngineEdition') AS [Engine Edition],
                SERVERPROPERTY('Collation') AS [Collation],
                SERVERPROPERTY('IsClustered') AS [Is Clustered],
                SERVERPROPERTY('IsFullTextInstalled') AS [Full-Text Installed]`,
          queryId: `server-props-${Date.now()}`,
        })
      );

      if (result?.success && result.resultSets?.length) {
        const row = result.resultSets[0].rows[0];
        const props = Object.entries(row || {})
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n');
        this.notification.info(`Server Properties:\n${props}`);
      }
    } catch {
      this.notification.error('Failed to retrieve server properties');
    }
  }

  private async showDatabaseProperties(): Promise<void> {
    const connectionId = this.connectionState.focusedConnectionId();
    const database = this.connectionState.selectedDatabaseFor(connectionId);
    if (!connectionId || !database) {
      this.notification.warning('No active connection or database selected');
      return;
    }

    try {
      const safeDb = database.replace(/\]/g, ']]');
      const result = await firstValueFrom(
        this.ipc.executeQuery({
          connectionId,
          database,
          sql: `SELECT
                  DB_NAME() AS [Database],
                  DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS [Collation],
                  DATABASEPROPERTYEX(DB_NAME(), 'Recovery') AS [Recovery Model],
                  DATABASEPROPERTYEX(DB_NAME(), 'Status') AS [Status],
                  (SELECT SUM(size * 8.0 / 1024) FROM sys.database_files WHERE type = 0) AS [Data Size MB],
                  (SELECT SUM(size * 8.0 / 1024) FROM sys.database_files WHERE type = 1) AS [Log Size MB],
                  SUSER_SNAME(owner_sid) AS [Owner]
                FROM sys.databases WHERE name = '${safeDb}'`,
          queryId: `db-props-${Date.now()}`,
        })
      );

      if (result?.success && result.resultSets?.length) {
        const row = result.resultSets[0].rows[0];
        const props = Object.entries(row || {})
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n');
        this.notification.info(`Database Properties:\n${props}`);
      }
    } catch {
      this.notification.error('Failed to retrieve database properties');
    }
  }

  private showNewDatabaseDialog(): void {
    const connectionId = this.connectionState.focusedConnectionId();
    if (!connectionId) {
      this.notification.warning('No active connection');
      return;
    }
    // Import and open the create database dialog dynamically
    import('../../shared/components/create-database-dialog/create-database-dialog.component').then(
      mod => {
        this.dialog.open(mod.CreateDatabaseDialogComponent, {
          width: '480px',
          data: { connectionId },
        });
      }
    );
  }

  // -- Sidebar resize & toggle --

  toggleSidebar(): void {
    const hidden = !this.sidebarHidden();
    this.sidebarHidden.set(hidden);
    this.saveSidebarPreferences();
  }

  onResizeStart(event: MouseEvent): void {
    event.preventDefault();
    this.resizing = true;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.sidebarWidth();
  }

  @HostListener('document:mousemove', ['$event'])
  onResizeMove(event: MouseEvent): void {
    if (!this.resizing) return;
    const delta = event.clientX - this.resizeStartX;
    const newWidth = Math.max(
      SIDEBAR_MIN_WIDTH,
      Math.min(SIDEBAR_MAX_WIDTH, this.resizeStartWidth + delta)
    );
    this.sidebarWidth.set(newWidth);
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // ⌘J / Ctrl+J toggles the Output panel, matching common editor conventions.
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
      if (event.key === 'j' || event.key === 'J') {
        event.preventDefault();
        this.logService.toggle();
      }
    }
  }

  @HostListener('document:mouseup')
  onResizeEnd(): void {
    if (!this.resizing) return;
    this.resizing = false;
    this.saveSidebarPreferences();
  }

  onResizeReset(): void {
    this.sidebarWidth.set(SIDEBAR_DEFAULT_WIDTH);
    this.saveSidebarPreferences();
  }

  private async loadSidebarPreferences(): Promise<void> {
    if (!this.ipc.isAvailable) return;
    try {
      const state = await firstValueFrom(this.ipc.getAppState());
      if (state?.sidebarWidth && state.sidebarWidth >= SIDEBAR_MIN_WIDTH) {
        this.sidebarWidth.set(Math.min(state.sidebarWidth, SIDEBAR_MAX_WIDTH));
      }
      if (state?.sidebarCollapsed) {
        this.sidebarHidden.set(true);
      }
    } catch {
      /* use defaults */
    }
  }

  private saveSidebarPreferences(): void {
    if (!this.ipc.isAvailable) return;
    firstValueFrom(
      this.ipc.setAppState({
        sidebarWidth: this.sidebarWidth(),
        sidebarCollapsed: this.sidebarHidden(),
      })
    ).catch(() => {});
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }
}
