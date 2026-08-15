import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import Fuse from 'fuse.js';
import { ConnectionStateService } from '../../../core/state/connection.state';
import { TabStateService } from '../../../core/state/tab.state';
import { IpcService } from '../../../core/services/ipc.service';
import type { ObjectMetadata } from '@forgedb/shared';
import { firstValueFrom } from 'rxjs';

interface SearchableObject {
  name: string;
  schema: string;
  type: string;
  displayType: string;
  icon: string;
  database: string;
}

@Component({
  selector: 'app-object-search',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    @if (isOpen()) {
      <div class="object-search-overlay" (click)="close()">
        <div class="object-search" (click)="$event.stopPropagation()">
          <div class="search-container">
            <mat-icon>search</mat-icon>
            <input
              #searchInput
              type="text"
              placeholder="Search tables, views, procedures..."
              [(ngModel)]="searchQuery"
              (ngModelChange)="onSearch($event)"
              (keydown)="onKeyDown($event)"
            />
            @if (loading()) {
              <mat-spinner diameter="18"></mat-spinner>
            } @else {
              <span class="shortcut-hint">ESC to close</span>
            }
          </div>

          <div class="results-container">
            @if (!connectionState.hasAnyConnection()) {
              <div class="message-state">
                <mat-icon>cloud_off</mat-icon>
                <span>Connect to a server first</span>
              </div>
            } @else if (
              !connectionState.selectedDatabaseFor(connectionState.focusedConnectionId())
            ) {
              <div class="message-state">
                <mat-icon>storage</mat-icon>
                <span>Select a database first</span>
              </div>
            } @else if (loading()) {
              <div class="message-state">
                <mat-spinner diameter="24"></mat-spinner>
                <span>Loading objects...</span>
              </div>
            } @else if (filteredObjects().length === 0 && searchQuery()) {
              <div class="message-state">
                <mat-icon>search_off</mat-icon>
                <span>No objects found matching "{{ searchQuery() }}"</span>
              </div>
            } @else if (filteredObjects().length === 0) {
              <div class="message-state">
                <mat-icon>inbox</mat-icon>
                <span>Start typing to search objects</span>
              </div>
            } @else {
              @for (obj of filteredObjects(); track obj.schema + '.' + obj.name; let i = $index) {
                <div
                  class="object-item"
                  [class.selected]="selectedIndex() === i"
                  (click)="selectObject(obj)"
                  (mouseenter)="selectedIndex.set(i)"
                >
                  <mat-icon [class]="'icon-' + obj.type">{{ obj.icon }}</mat-icon>
                  <div class="object-content">
                    <span class="object-name">{{ obj.schema }}.{{ obj.name }}</span>
                    <span class="object-type">{{ obj.displayType }}</span>
                  </div>
                </div>
              }
            }
          </div>

          @if (
            connectionState.hasAnyConnection() &&
            connectionState.selectedDatabaseFor(connectionState.focusedConnectionId())
          ) {
            <div class="search-footer">
              <span class="count">
                {{ filteredObjects().length }} of {{ allObjects().length }} objects
              </span>
              <span class="tip">↑↓ to navigate, ⏎ to select</span>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      .object-search-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        padding-top: 80px;
        z-index: 10000;
      }

      .object-search {
        width: 550px;
        max-height: 450px;
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

      .message-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--text-muted);
        text-align: center;

        mat-icon {
          font-size: 36px;
          width: 36px;
          height: 36px;
          margin-bottom: var(--spacing-sm);
        }
      }

      .object-item {
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

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;

          &.icon-table {
            color: var(--status-info);
          }
          &.icon-view {
            color: var(--status-warning);
          }
          &.icon-procedure {
            color: var(--status-success);
          }
          &.icon-function {
            color: var(--status-info);
          }
        }

        .object-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;

          .object-name {
            font-weight: 500;
            color: var(--text-primary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .object-type {
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
          }
        }
      }

      .search-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);
        font-size: var(--font-size-xs);
        color: var(--text-muted);
      }
    `,
  ],
})
export class ObjectSearchComponent implements OnInit, OnDestroy {
  readonly connectionState = inject(ConnectionStateService);
  private readonly tabState = inject(TabStateService);
  private readonly ipc = inject(IpcService);

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  readonly isOpen = signal(false);
  readonly searchQuery = signal('');
  readonly selectedIndex = signal(0);
  readonly loading = signal(false);
  readonly allObjects = signal<SearchableObject[]>([]);

  private fuse: Fuse<SearchableObject> | null = null;
  private cachedDatabase: string | null = null;

  readonly filteredObjects = computed(() => {
    const query = this.searchQuery();
    const objects = this.allObjects();

    if (!query.trim()) {
      return objects.slice(0, 50); // Show first 50 when no query
    }

    if (!this.fuse) {
      return [];
    }

    return this.fuse
      .search(query)
      .slice(0, 50)
      .map(r => r.item);
  });

  private keydownHandler = (event: KeyboardEvent) => {
    // Cmd+T or Ctrl+T to open object search
    if ((event.metaKey || event.ctrlKey) && event.key === 't') {
      event.preventDefault();
      this.toggle();
    }
    // Cmd+P or Ctrl+P to open object search (standard shortcut)
    if ((event.metaKey || event.ctrlKey) && event.key === 'p' && !event.shiftKey) {
      event.preventDefault();
      this.toggle();
    }
  };

  private openEventHandler = () => this.open();

  ngOnInit(): void {
    document.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('forge:open-object-search', this.openEventHandler);
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('forge:open-object-search', this.openEventHandler);
  }

  toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  async open(): Promise<void> {
    this.isOpen.set(true);
    this.searchQuery.set('');
    this.selectedIndex.set(0);

    // Focus input after view updates
    setTimeout(() => {
      this.searchInput?.nativeElement?.focus();
    }, 0);

    // Load objects if connected and database selected
    const focusId = this.connectionState.focusedConnectionId();
    const db = this.connectionState.selectedDatabaseFor(focusId);
    if (focusId && db && db !== this.cachedDatabase) {
      await this.loadObjects();
    }
  }

  close(): void {
    this.isOpen.set(false);
    this.searchQuery.set('');
  }

  private async loadObjects(): Promise<void> {
    const connectionId = this.connectionState.focusedConnectionId();
    const database = this.connectionState.selectedDatabaseFor(connectionId);

    if (!connectionId || !database) return;

    this.loading.set(true);
    try {
      // Load all object types
      const objects: SearchableObject[] = [];

      // Get tables
      const tables = await this.loadObjectType(connectionId, database, 'tables');
      objects.push(...tables.map(obj => this.mapToSearchable(obj, 'table', 'Table')));

      // Get views
      const views = await this.loadObjectType(connectionId, database, 'views');
      objects.push(...views.map(obj => this.mapToSearchable(obj, 'view', 'View')));

      // Get stored procedures
      const procs = await this.loadObjectType(connectionId, database, 'procedures');
      objects.push(...procs.map(obj => this.mapToSearchable(obj, 'procedure', 'Stored Procedure')));

      // Get functions
      const funcs = await this.loadObjectType(connectionId, database, 'functions');
      objects.push(...funcs.map(obj => this.mapToSearchable(obj, 'function', 'Function')));

      this.allObjects.set(objects);
      this.cachedDatabase = database;

      // Initialize Fuse for fuzzy search
      this.fuse = new Fuse(objects, {
        keys: ['name', 'schema'],
        threshold: 0.4,
        includeScore: true,
      });
    } catch (error) {
      console.error('Failed to load objects:', error);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadObjectType(
    connectionId: string,
    database: string,
    path: string
  ): Promise<ObjectMetadata[]> {
    try {
      return await firstValueFrom(this.ipc.getExplorerChildren(connectionId, database, path));
    } catch {
      return [];
    }
  }

  private mapToSearchable(
    obj: ObjectMetadata,
    type: string,
    displayType: string
  ): SearchableObject {
    const iconMap: Record<string, string> = {
      table: 'table_chart',
      view: 'view_list',
      procedure: 'functions',
      function: 'calculate',
    };

    return {
      name: obj.name,
      schema: obj.schema || 'dbo',
      type,
      displayType,
      icon: iconMap[type] || 'description',
      database: this.connectionState.selectedDatabaseFor(
        this.connectionState.focusedConnectionId()
      )!,
    };
  }

  onSearch(query: string): void {
    this.searchQuery.set(query);
    this.selectedIndex.set(0);
  }

  onKeyDown(event: KeyboardEvent): void {
    const objects = this.filteredObjects();

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.update(i => Math.min(i + 1, objects.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.update(i => Math.max(i - 1, 0));
        break;
      case 'Enter': {
        event.preventDefault();
        const selected = objects[this.selectedIndex()];
        if (selected) {
          this.selectObject(selected);
        }
        break;
      }
    }
  }

  selectObject(obj: SearchableObject): void {
    this.close();

    const connectionId = this.connectionState.focusedConnectionId();
    if (!connectionId) return;

    // Open a query tab with SELECT statement for tables/views
    if (obj.type === 'table' || obj.type === 'view') {
      const sql = `SELECT TOP 1000 * FROM [${obj.schema}].[${obj.name}]`;
      this.tabState.openQueryTab(connectionId, obj.database, sql, true);
    } else if (obj.type === 'procedure' || obj.type === 'function') {
      // For procedures/functions, open with EXEC or show definition
      const sql =
        obj.type === 'procedure'
          ? `EXEC [${obj.schema}].[${obj.name}]`
          : `SELECT [${obj.schema}].[${obj.name}]()`;
      this.tabState.openQueryTab(connectionId, obj.database, sql, false);
    }
  }
}
