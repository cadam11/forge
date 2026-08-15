import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, firstValueFrom } from 'rxjs';
import { ConnectionStateService } from '../state/connection.state';
import { TabStateService } from '../state/tab.state';
import { ExplorerStateService } from '../state/explorer.state';
import { IpcService } from './ipc.service';
import { SettingsService } from './settings.service';

@Injectable({ providedIn: 'root' })
export class MenuService implements OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly router = inject(Router);
  private readonly connectionState = inject(ConnectionStateService);
  private readonly tabState = inject(TabStateService);
  private readonly explorerState = inject(ExplorerStateService);
  private readonly ipc = inject(IpcService);
  private readonly settingsService = inject(SettingsService);

  // File menu events
  readonly openQuery$ = new Subject<void>();
  readonly closeTab$ = new Subject<void>();
  readonly saveQuery$ = new Subject<void>();
  readonly saveQueryAs$ = new Subject<void>();
  readonly exportResults$ = new Subject<void>();

  // Edit menu events
  readonly find$ = new Subject<void>();
  readonly replace$ = new Subject<void>();
  readonly formatSql$ = new Subject<void>();
  readonly toggleComment$ = new Subject<void>();

  // Query menu events
  readonly executeQuery$ = new Subject<void>();
  readonly executeSelection$ = new Subject<void>();
  readonly cancelQuery$ = new Subject<void>();
  readonly queryHistory$ = new Subject<void>();

  // Server menu events
  readonly serverProperties$ = new Subject<void>();

  // Database menu events
  readonly newDatabase$ = new Subject<void>();
  readonly databaseProperties$ = new Subject<void>();

  // View menu events
  readonly toggleSidebar$ = new Subject<void>();
  readonly toggleChat$ = new Subject<void>();
  readonly toggleResults$ = new Subject<void>();

  // Window menu events
  readonly nextTab$ = new Subject<void>();
  readonly previousTab$ = new Subject<void>();

  // Settings/Help events
  readonly openSettings$ = new Subject<void>();
  readonly showShortcuts$ = new Subject<void>();

  private unsubscribers: (() => void)[] = [];

  constructor() {
    this.setupMenuListeners();
  }

  private setupMenuListeners(): void {
    const menu = window.joinery?.menu;
    if (!menu) {
      console.warn('MenuService: Menu API not available');
      return;
    }

    // File menu items
    this.unsubscribers.push(
      menu.onNewConnection(() => {
        this.zone.run(() => this.router.navigate(['/connections']));
      })
    );

    this.unsubscribers.push(
      menu.onNewQuery(() => {
        this.zone.run(() => this.newQuery());
      })
    );

    this.unsubscribers.push(
      menu.onOpenQuery(() => {
        this.zone.run(() => {
          // If a query tab is active, let it handle the open
          const activeTab = this.tabState.activeTab();
          if (activeTab?.type === 'query') {
            this.openQuery$.next();
          } else {
            // No active query tab — handle directly
            this.openQueryFromFile();
          }
        });
      })
    );

    this.unsubscribers.push(
      menu.onCloseTab(() => {
        this.zone.run(() => this.closeTab$.next());
      })
    );

    this.unsubscribers.push(
      menu.onSaveQuery(() => {
        this.zone.run(() => this.saveQuery$.next());
      })
    );

    this.unsubscribers.push(
      menu.onSaveQueryAs(() => {
        this.zone.run(() => this.saveQueryAs$.next());
      })
    );

    this.unsubscribers.push(
      menu.onExportResults(() => {
        this.zone.run(() => this.exportResults$.next());
      })
    );

    // Edit menu items
    this.unsubscribers.push(
      menu.onCopy(() => {
        this.zone.run(() => this.handleMenuCopy());
      })
    );

    this.unsubscribers.push(
      menu.onFind(() => {
        this.zone.run(() => this.find$.next());
      })
    );

    this.unsubscribers.push(
      menu.onReplace(() => {
        this.zone.run(() => this.replace$.next());
      })
    );

    this.unsubscribers.push(
      menu.onFormatSql(() => {
        this.zone.run(() => this.formatSql$.next());
      })
    );

    this.unsubscribers.push(
      menu.onToggleComment(() => {
        this.zone.run(() => this.toggleComment$.next());
      })
    );

    // Query menu items
    this.unsubscribers.push(
      menu.onExecuteQuery(() => {
        this.zone.run(() => this.executeQuery$.next());
      })
    );

    this.unsubscribers.push(
      menu.onExecuteSelection(() => {
        this.zone.run(() => this.executeSelection$.next());
      })
    );

    this.unsubscribers.push(
      menu.onCancelQuery(() => {
        this.zone.run(() => this.cancelQuery$.next());
      })
    );

    this.unsubscribers.push(
      menu.onQueryHistory(() => {
        this.zone.run(() => this.queryHistory$.next());
      })
    );

    // Server menu items
    this.unsubscribers.push(
      menu.onDisconnect(() => {
        this.zone.run(() => {
          const id = this.connectionState.focusedConnectionId();
          if (id) this.connectionState.disconnect(id);
        });
      })
    );

    this.unsubscribers.push(
      menu.onRefresh(() => {
        this.zone.run(() => this.refresh());
      })
    );

    this.unsubscribers.push(
      menu.onServerProperties(() => {
        this.zone.run(() => this.serverProperties$.next());
      })
    );

    // Database menu items
    this.unsubscribers.push(
      menu.onNewDatabase(() => {
        this.zone.run(() => this.newDatabase$.next());
      })
    );

    this.unsubscribers.push(
      menu.onBackup(() => {
        this.zone.run(() => this.router.navigate(['/backup']));
      })
    );

    this.unsubscribers.push(
      menu.onRestore(() => {
        this.zone.run(() => this.router.navigate(['/restore']));
      })
    );

    this.unsubscribers.push(
      menu.onDatabaseProperties(() => {
        this.zone.run(() => this.databaseProperties$.next());
      })
    );

    // View menu items
    this.unsubscribers.push(
      menu.onShowWelcome(() => {
        this.zone.run(() => {
          this.tabState.showWelcome();
          this.router.navigate(['/']);
        });
      })
    );

    this.unsubscribers.push(
      menu.onToggleSidebar(() => {
        this.zone.run(() => this.toggleSidebar$.next());
      })
    );

    this.unsubscribers.push(
      menu.onToggleChat(() => {
        this.zone.run(() => this.toggleChat$.next());
      })
    );

    this.unsubscribers.push(
      menu.onToggleResults(() => {
        this.zone.run(() => this.toggleResults$.next());
      })
    );

    // Window menu items
    this.unsubscribers.push(
      menu.onNextTab(() => {
        this.zone.run(() => {
          this.nextTab$.next();
          this.tabState.nextTab();
        });
      })
    );

    this.unsubscribers.push(
      menu.onPreviousTab(() => {
        this.zone.run(() => {
          this.previousTab$.next();
          this.tabState.previousTab();
        });
      })
    );

    // Settings/Help
    this.unsubscribers.push(
      menu.onOpenSettings(() => {
        this.zone.run(() => {
          this.settingsService.open();
          this.openSettings$.next();
        });
      })
    );

    this.unsubscribers.push(
      menu.onShowShortcuts(() => {
        this.zone.run(() => this.showShortcuts$.next());
      })
    );
  }

  // Edit > Copy (⌘C / Ctrl+C). The main process menu used to do
  // role:'copy' which short-circuits to webContents.copy() — fine for
  // plain text selection but blind to context-aware surfaces like the
  // results grid (which honors a per-user TSV/CSV/JSON Copy Format
  // setting). We now forward the event to the renderer and let any
  // component that wants the keystroke claim it via the
  // `joinery:menu-copy` CustomEvent (call event.preventDefault()). If
  // nothing claims it, we fall back to document.execCommand('copy'),
  // which mirrors the original role:'copy' behavior for native text
  // selections.
  private handleMenuCopy(): void {
    const event = new CustomEvent('joinery:menu-copy', { cancelable: true });
    window.dispatchEvent(event);
    if (event.defaultPrevented) return;
    document.execCommand('copy');
  }

  private newQuery(): void {
    // Cmd+N / menu New Query: target the most-recently-used connection
    // (last queried, falling back to most-recently-added) and always open
    // a fresh tab — even when the active tab is an empty query, the user
    // pressed Cmd+N to get a new one.
    const connectionId = this.connectionState.mostRecentConnectionId();
    if (!connectionId) {
      this.router.navigate(['/connections']);
      return;
    }

    const databaseName = this.connectionState.defaultDatabaseFor(connectionId);
    if (!databaseName) {
      this.router.navigate(['/connections']);
      return;
    }

    this.tabState.openQueryTab(connectionId, databaseName, undefined, false, false);
    this.router.navigate(['/query']);
  }

  private async openQueryFromFile(): Promise<void> {
    if (!this.ipc.isAvailable) return;

    const connectionId = this.connectionState.focusedConnectionId();
    const databaseName = this.connectionState.selectedDatabaseFor(connectionId);
    if (!connectionId || !databaseName) return;

    try {
      const result = await firstValueFrom(
        this.ipc.showOpenDialog({
          title: 'Open Query',
          filters: [
            { name: 'SQL Files', extensions: ['sql'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        })
      );
      if (result?.filePaths?.length) {
        const content = await firstValueFrom(this.ipc.readWorkspaceFile(result.filePaths[0]));
        this.tabState.openQueryTab(connectionId, databaseName, content, false);
      }
    } catch {
      console.error('Failed to open query file');
    }
  }

  private async refresh(): Promise<void> {
    // Cmd+R / Edit > Refresh anchors on the most-recently-used connection
    // so the menu works even when there's no focused query tab (welcome
    // tab active, no tabs at all, etc.) — same anchor the sidebar's
    // own Refresh button uses.
    //
    // Refreshes three things, in order, since each can be stale
    // independently:
    //   1. The per-connection database list (drives the database picker
    //      and is the source of truth for "what databases exist").
    //   2. The server node's children in the explorer tree (the visible
    //      database list under the server). Without this, a stale local
    //      mutation can persist in the tree even after the picker has
    //      already corrected itself.
    //   3. The currently-selected node, if any (refreshes whatever sub-
    //      tree the user was looking at — table list, schema, etc.).
    const connectionId = this.connectionState.mostRecentConnectionId();
    if (connectionId) {
      await this.connectionState.loadDatabases(connectionId);
      const serverNode = this.explorerState
        .rootNodes()
        .find(n => n.type === 'server' && n.connectionId === connectionId);
      if (serverNode) {
        await this.explorerState.refreshNode(serverNode.id);
      }
    }
    const selectedNode = this.explorerState.selectedNodeId();
    if (selectedNode) {
      await this.explorerState.refreshNode(selectedNode);
    }
  }

  ngOnDestroy(): void {
    this.unsubscribers.forEach(unsub => unsub());
  }
}
