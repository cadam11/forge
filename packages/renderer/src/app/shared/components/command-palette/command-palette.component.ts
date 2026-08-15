import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import Fuse from 'fuse.js';
import { ConnectionStateService } from '../../../core/state/connection.state';
import { TabStateService } from '../../../core/state/tab.state';
import { SettingsService } from '../../../core/services/settings.service';
import { QueryHistoryService } from '../../../core/services/query-history.service';
import { SchemaDiffDialogComponent } from '../schema-diff-dialog/schema-diff-dialog.component';

export interface Command {
  id: string;
  label: string;
  description?: string;
  icon: string;
  category: 'file' | 'edit' | 'view' | 'query' | 'connection' | 'settings' | 'help';
  shortcut?: string;
  action: () => void;
  isEnabled?: () => boolean;
}

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    @if (isOpen()) {
      <div class="command-palette-overlay" (click)="close()">
        <div class="command-palette" (click)="$event.stopPropagation()">
          <div class="search-container">
            <mat-icon>search</mat-icon>
            <input
              #searchInput
              type="text"
              placeholder="Type a command..."
              [(ngModel)]="searchQuery"
              (ngModelChange)="onSearch($event)"
              (keydown)="onKeyDown($event)"
            />
            <span class="shortcut-hint">ESC to close</span>
          </div>

          <div class="results-container">
            @if (filteredCommands().length === 0) {
              <div class="no-results">
                <mat-icon>search_off</mat-icon>
                <span>No commands found</span>
              </div>
            } @else {
              @for (command of filteredCommands(); track command.id; let i = $index) {
                <div
                  class="command-item"
                  [class.selected]="selectedIndex() === i"
                  [class.disabled]="command.isEnabled && !command.isEnabled()"
                  (click)="executeCommand(command)"
                  (mouseenter)="selectedIndex.set(i)"
                >
                  <mat-icon>{{ command.icon }}</mat-icon>
                  <div class="command-content">
                    <span class="command-label">{{ command.label }}</span>
                    @if (command.description) {
                      <span class="command-description">{{ command.description }}</span>
                    }
                  </div>
                  @if (command.shortcut) {
                    <span class="command-shortcut">{{ command.shortcut }}</span>
                  }
                </div>
              }
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .command-palette-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        padding-top: 100px;
        z-index: 10000;
      }

      .command-palette {
        width: 600px;
        max-height: 500px;
        background-color: var(--bg-primary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .search-container {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);

        mat-icon {
          color: var(--text-secondary);
        }

        input {
          flex: 1;
          border: none;
          background: transparent;
          font-size: var(--font-size-md);
          color: var(--text-primary);
          outline: none;

          &::placeholder {
            color: var(--text-muted);
          }
        }

        .shortcut-hint {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          padding: 2px 6px;
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-sm);
        }
      }

      .results-container {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-xs);
      }

      .no-results {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--text-muted);

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          margin-bottom: var(--spacing-sm);
        }
      }

      .command-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background-color var(--transition-fast);

        &:hover,
        &.selected {
          background-color: var(--bg-hover);
        }

        &.disabled {
          opacity: 0.5;
          pointer-events: none;
        }

        mat-icon {
          color: var(--text-secondary);
          font-size: 18px;
          width: 18px;
          height: 18px;
        }

        .command-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;

          .command-label {
            font-weight: 500;
            color: var(--text-primary);
          }

          .command-description {
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
          }
        }

        .command-shortcut {
          font-size: var(--font-size-xs);
          font-family: monospace;
          padding: 2px 6px;
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
        }
      }
    `,
  ],
})
export class CommandPaletteComponent implements OnInit, OnDestroy {
  private readonly connectionState = inject(ConnectionStateService);
  private readonly tabState = inject(TabStateService);
  private readonly settings = inject(SettingsService);
  private readonly queryHistory = inject(QueryHistoryService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  readonly isOpen = signal(false);
  readonly searchQuery = signal('');
  readonly selectedIndex = signal(0);

  private commands: Command[] = [];
  private fuse!: Fuse<Command>;

  readonly filteredCommands = computed(() => {
    const query = this.searchQuery();
    if (!query.trim()) {
      return this.commands.filter(cmd => !cmd.isEnabled || cmd.isEnabled());
    }
    return this.fuse.search(query).map(result => result.item);
  });

  private keydownHandler = (event: KeyboardEvent) => {
    // Cmd+Shift+P or Ctrl+Shift+P to open
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'p') {
      event.preventDefault();
      this.toggle();
    }
    // Cmd+K for quick command palette
    if ((event.metaKey || event.ctrlKey) && event.key === 'k' && !event.shiftKey) {
      event.preventDefault();
      this.toggle();
    }
    // Cmd+H / Ctrl+H for Query History dialog
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      this.queryHistory.openHistoryDialog();
    }
  };

  ngOnInit(): void {
    this.initializeCommands();
    this.initializeFuse();
    document.addEventListener('keydown', this.keydownHandler);
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.keydownHandler);
  }

  private initializeCommands(): void {
    this.commands = [
      // File commands
      {
        id: 'new-connection',
        label: 'New Connection',
        description: 'Create a new database connection',
        icon: 'add_circle',
        category: 'connection',
        action: () => this.router.navigate(['/connections']),
      },
      {
        id: 'new-query',
        label: 'New Query Tab',
        description: 'Open a new query editor tab',
        icon: 'add',
        category: 'file',
        shortcut: '⌘N',
        action: () => {
          const connId = this.connectionState.mostRecentConnectionId();
          if (!connId) return;
          const db = this.connectionState.defaultDatabaseFor(connId);
          if (!db) return;
          this.tabState.openQueryTab(connId, db, undefined, false, false);
        },
        isEnabled: () => this.connectionState.hasAnyConnection(),
      },
      {
        id: 'close-tab',
        label: 'Close Tab',
        description: 'Close the current tab',
        icon: 'close',
        category: 'file',
        shortcut: '⌘W',
        action: () => {
          const activeTab = this.tabState.activeTabId();
          if (activeTab) {
            this.tabState.closeTab(activeTab);
          }
        },
      },

      // View commands
      {
        id: 'toggle-sidebar',
        label: 'Toggle Sidebar',
        description: 'Show or hide the sidebar',
        icon: 'view_sidebar',
        category: 'view',
        shortcut: '⌘B',
        action: () => {
          // Emit event to toggle sidebar
          window.dispatchEvent(new CustomEvent('joinery:toggle-sidebar'));
        },
      },
      {
        id: 'toggle-results',
        label: 'Toggle Results Panel',
        description: 'Show or hide the query results panel',
        icon: 'view_stream',
        category: 'view',
        action: () => {
          window.dispatchEvent(new CustomEvent('joinery:toggle-results'));
        },
      },

      // Query commands
      {
        id: 'execute-query',
        label: 'Execute Query',
        description: 'Run the current SQL query',
        icon: 'play_arrow',
        category: 'query',
        shortcut: '⌘E',
        action: () => {
          window.dispatchEvent(new CustomEvent('joinery:execute-query'));
        },
        isEnabled: () => this.connectionState.hasAnyConnection(),
      },
      {
        id: 'format-sql',
        label: 'Format SQL',
        description: 'Format the current SQL query',
        icon: 'auto_fix_high',
        category: 'edit',
        shortcut: '⇧⌘F',
        action: () => {
          window.dispatchEvent(new CustomEvent('joinery:format-sql'));
        },
      },
      {
        id: 'cancel-query',
        label: 'Cancel Query',
        description: 'Stop the currently running query',
        icon: 'stop',
        category: 'query',
        action: () => {
          window.dispatchEvent(new CustomEvent('joinery:cancel-query'));
        },
      },
      {
        id: 'query-history',
        label: 'Query History',
        description: 'Search and reuse previously executed queries',
        icon: 'history',
        category: 'query',
        shortcut: '⌘H',
        action: () => {
          this.queryHistory.openHistoryDialog();
        },
      },

      // Connection commands
      {
        id: 'disconnect',
        label: 'Disconnect',
        description: 'Disconnect from the current server',
        icon: 'cloud_off',
        category: 'connection',
        action: () => {
          const id = this.connectionState.mostRecentConnectionId();
          if (id) this.connectionState.disconnect(id);
        },
        isEnabled: () => this.connectionState.hasAnyConnection(),
      },
      {
        id: 'refresh',
        label: 'Refresh Object Explorer',
        description: 'Reload the database objects',
        icon: 'refresh',
        category: 'connection',
        action: () => {
          window.dispatchEvent(new CustomEvent('joinery:refresh-explorer'));
        },
        isEnabled: () => this.connectionState.hasAnyConnection(),
      },

      // Settings commands
      {
        id: 'open-settings',
        label: 'Open Settings',
        description: 'Configure application preferences',
        icon: 'settings',
        category: 'settings',
        shortcut: '⌘,',
        action: () => {
          window.dispatchEvent(new CustomEvent('joinery:open-settings'));
        },
      },
      {
        id: 'theme-light',
        label: 'Switch to Light Theme',
        icon: 'light_mode',
        category: 'settings',
        action: () => this.settings.updateTheme('light'),
      },
      {
        id: 'theme-dark',
        label: 'Switch to Dark Theme',
        icon: 'dark_mode',
        category: 'settings',
        action: () => this.settings.updateTheme('dark'),
      },
      {
        id: 'theme-system',
        label: 'Use System Theme',
        icon: 'computer',
        category: 'settings',
        action: () => this.settings.updateTheme('system'),
      },

      // Tab navigation
      {
        id: 'next-tab',
        label: 'Next Tab',
        description: 'Switch to the next tab',
        icon: 'chevron_right',
        category: 'view',
        shortcut: '⌃⇥',
        action: () => this.tabState.nextTab(),
      },
      {
        id: 'prev-tab',
        label: 'Previous Tab',
        description: 'Switch to the previous tab',
        icon: 'chevron_left',
        category: 'view',
        shortcut: '⌃⇧⇥',
        action: () => this.tabState.previousTab(),
      },

      // View
      {
        id: 'show-welcome',
        label: 'Show Welcome Tab',
        description: 'Open the Welcome tab',
        icon: 'home',
        category: 'view',
        action: () => this.tabState.showWelcome(),
      },

      // Tab management
      {
        id: 'close-all-tabs',
        label: 'Close All Tabs',
        description: 'Close all open tabs',
        icon: 'tab_close',
        category: 'file',
        action: () => this.tabState.closeAllTabs(),
      },
      {
        id: 'close-other-tabs',
        label: 'Close Other Tabs',
        description: 'Close all tabs except the active one',
        icon: 'tab_unselected',
        category: 'file',
        action: () => {
          const activeId = this.tabState.activeTabId();
          if (activeId) this.tabState.closeOtherTabs(activeId);
        },
      },

      // Search
      {
        id: 'find-object',
        label: 'Find Database Object',
        description: 'Search for tables, views, procedures',
        icon: 'search',
        category: 'file',
        shortcut: '⌘P',
        action: () => {
          window.dispatchEvent(new CustomEvent('joinery:open-object-search'));
        },
      },

      // Snippets
      {
        id: 'snippet-library',
        label: 'Snippet Library',
        description: 'Save, search, and insert SQL snippets',
        icon: 'data_object',
        category: 'query',
        shortcut: '⇧⌘S',
        action: () => {
          window.dispatchEvent(new CustomEvent('joinery:open-snippets'));
        },
      },

      // Database
      {
        id: 'backup-database',
        label: 'Backup Database',
        description: 'Back up the current database',
        icon: 'backup',
        category: 'connection',
        action: () => {
          window.dispatchEvent(new CustomEvent('joinery:open-backup'));
        },
        isEnabled: () => this.connectionState.hasAnyConnection(),
      },
      {
        id: 'restore-database',
        label: 'Restore Database',
        description: 'Restore a database from backup',
        icon: 'restore',
        category: 'connection',
        action: () => {
          window.dispatchEvent(new CustomEvent('joinery:open-restore'));
        },
        isEnabled: () => this.connectionState.hasAnyConnection(),
      },

      // Schema Diff
      {
        id: 'schema-diff',
        label: 'Compare Database Schemas',
        description: 'Diff tables, columns, and objects between two databases',
        icon: 'compare_arrows',
        category: 'query',
        action: () => {
          this.dialog.open(SchemaDiffDialogComponent, { width: '520px' });
        },
        isEnabled: () => this.connectionState.hasAnyConnection(),
      },

      // ERD
      {
        id: 'open-erd',
        label: 'Open ERD Diagram',
        description: 'Show entity relationship diagram for current database',
        icon: 'account_tree',
        category: 'view',
        action: () => {
          const connId = this.connectionState.mostRecentConnectionId();
          if (!connId) return;
          const db = this.connectionState.defaultDatabaseFor(connId);
          if (!db) return;
          this.tabState.openErdTab(connId, db);
        },
        isEnabled: () => this.connectionState.hasAnyConnection(),
      },

      // Snippets
      {
        id: 'open-snippets',
        label: 'Open Snippet Library',
        description: 'Browse and insert saved SQL snippets',
        icon: 'content_paste',
        category: 'edit',
        action: () => {
          window.dispatchEvent(new CustomEvent('joinery:open-snippets'));
        },
      },
      {
        id: 'save-snippet',
        label: 'Save as Snippet',
        description: 'Save current query as a reusable snippet',
        icon: 'bookmark_add',
        category: 'edit',
        action: () => {
          window.dispatchEvent(new CustomEvent('joinery:save-snippet'));
        },
        isEnabled: () => this.connectionState.hasAnyConnection(),
      },

      // Theme toggle
      {
        id: 'toggle-theme',
        label: 'Toggle Theme',
        description: 'Cycle between dark, light, and system theme',
        icon: 'contrast',
        category: 'settings',
        action: () => {
          const current = this.settings.theme();
          const next = current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark';
          this.settings.updateTheme(next);
        },
      },

      // Help
      {
        id: 'show-shortcuts',
        label: 'Keyboard Shortcuts',
        description: 'View all keyboard shortcuts',
        icon: 'keyboard',
        category: 'help',
        shortcut: '⌘K ⌘S',
        action: () => {
          window.dispatchEvent(new CustomEvent('joinery:show-shortcuts'));
        },
      },
    ];
  }

  private initializeFuse(): void {
    this.fuse = new Fuse(this.commands, {
      keys: ['label', 'description', 'category'],
      threshold: 0.4,
      includeScore: true,
    });
  }

  toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  open(): void {
    this.isOpen.set(true);
    this.searchQuery.set('');
    this.selectedIndex.set(0);
    // Focus input after view updates
    setTimeout(() => {
      this.searchInput?.nativeElement?.focus();
    }, 0);
  }

  close(): void {
    this.isOpen.set(false);
    this.searchQuery.set('');
  }

  onSearch(query: string): void {
    this.searchQuery.set(query);
    this.selectedIndex.set(0);
  }

  onKeyDown(event: KeyboardEvent): void {
    const commands = this.filteredCommands();

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.update(i => Math.min(i + 1, commands.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.update(i => Math.max(i - 1, 0));
        break;
      case 'Enter': {
        event.preventDefault();
        const selected = commands[this.selectedIndex()];
        if (selected) {
          this.executeCommand(selected);
        }
        break;
      }
    }
  }

  executeCommand(command: Command): void {
    if (command.isEnabled && !command.isEnabled()) {
      return;
    }
    this.close();
    command.action();
  }
}
