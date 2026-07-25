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
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import Fuse from 'fuse.js';
import { TabStateService } from '../../../core/state/tab.state';

export interface Snippet {
  id: string;
  name: string;
  sql: string;
  tags: string[];
  createdAt: string;
}

const STORAGE_KEY = 'forge-snippets';

@Component({
  selector: 'app-snippet-library',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    @if (isOpen()) {
      <div class="snippet-overlay" (click)="close()">
        <div class="snippet-dialog" (click)="$event.stopPropagation()">
          <!-- Search / Header -->
          <div class="search-container">
            <mat-icon>data_object</mat-icon>
            <input
              #searchInput
              type="text"
              placeholder="Search snippets by name or tag..."
              [(ngModel)]="searchQuery"
              (ngModelChange)="onSearch($event)"
              (keydown)="onKeyDown($event)"
            />
            @if (showSaveForm()) {
              <button
                class="cancel-save-btn"
                matTooltip="Cancel save"
                (click)="showSaveForm.set(false)"
              >
                <mat-icon>close</mat-icon>
              </button>
            } @else {
              <button
                class="save-current-btn"
                matTooltip="Save current query as snippet"
                (click)="beginSave()"
              >
                <mat-icon>add</mat-icon>
                <span>Save Current</span>
              </button>
            }
          </div>

          <!-- Save Form -->
          @if (showSaveForm()) {
            <div class="save-form">
              <div class="save-form-row">
                <input
                  #nameInput
                  type="text"
                  class="save-input"
                  placeholder="Snippet name"
                  [(ngModel)]="newSnippetName"
                  (keydown.enter)="saveSnippet()"
                />
                <input
                  type="text"
                  class="save-input tags-input"
                  placeholder="Tags (comma separated)"
                  [(ngModel)]="newSnippetTags"
                  (keydown.enter)="saveSnippet()"
                />
                <button
                  class="save-btn"
                  [disabled]="!newSnippetName().trim()"
                  (click)="saveSnippet()"
                  matTooltip="Save snippet"
                >
                  <mat-icon>save</mat-icon>
                </button>
              </div>
              @if (saveSqlPreview()) {
                <pre class="save-preview">{{ saveSqlPreview() }}</pre>
              }
            </div>
          }

          <!-- Snippet List -->
          <div class="results-container">
            @if (filteredSnippets().length === 0 && searchQuery()) {
              <div class="message-state">
                <mat-icon>search_off</mat-icon>
                <span>No snippets matching "{{ searchQuery() }}"</span>
              </div>
            } @else if (filteredSnippets().length === 0) {
              <div class="message-state">
                <mat-icon>code_off</mat-icon>
                <span>No snippets saved yet</span>
                <span class="hint">Click "Save Current" to save your first snippet</span>
              </div>
            } @else {
              @for (snippet of filteredSnippets(); track snippet.id; let i = $index) {
                <div
                  class="snippet-item"
                  [class.selected]="selectedIndex() === i"
                  (click)="insertSnippet(snippet)"
                  (mouseenter)="selectedIndex.set(i)"
                >
                  <div class="snippet-content">
                    <div class="snippet-header">
                      <span class="snippet-name">{{ snippet.name }}</span>
                      <span class="snippet-date">{{ formatDate(snippet.createdAt) }}</span>
                    </div>
                    @if (snippet.tags.length > 0) {
                      <div class="snippet-tags">
                        @for (tag of snippet.tags; track tag) {
                          <span class="tag">{{ tag }}</span>
                        }
                      </div>
                    }
                    <pre class="snippet-preview">{{ truncateSql(snippet.sql) }}</pre>
                  </div>
                  <button
                    class="delete-btn"
                    matTooltip="Delete snippet"
                    (click)="deleteSnippet($event, snippet)"
                  >
                    <mat-icon>delete_outline</mat-icon>
                  </button>
                </div>
              }
            }
          </div>

          <div class="search-footer">
            <span class="count"
              >{{ filteredSnippets().length }} snippet{{
                filteredSnippets().length !== 1 ? 's' : ''
              }}</span
            >
            <span class="tip">Click to insert, ESC to close</span>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .snippet-overlay {
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

      .snippet-dialog {
        width: 600px;
        max-height: 520px;
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
      }

      .save-current-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-sm);
        background-color: var(--bg-tertiary);
        color: var(--text-secondary);
        font-size: var(--font-size-xs);
        cursor: pointer;
        white-space: nowrap;
        transition: background-color var(--transition-fast);

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }

        &:hover {
          background-color: var(--bg-hover);
          color: var(--text-primary);
        }
      }

      .cancel-save-btn {
        display: flex;
        align-items: center;
        padding: 4px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }

        &:hover {
          color: var(--text-primary);
        }
      }

      .save-form {
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);
      }

      .save-form-row {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
      }

      .save-input {
        flex: 1;
        padding: 6px 10px;
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-sm);
        background-color: var(--bg-primary);
        color: var(--text-primary);
        font-size: var(--font-size-sm);
        outline: none;

        &::placeholder {
          color: var(--text-muted);
        }

        &:focus {
          border-color: var(--border-focus);
        }
      }

      .tags-input {
        flex: 0.7;
      }

      .save-btn {
        display: flex;
        align-items: center;
        padding: 6px;
        border: 1px solid var(--accent-primary);
        border-radius: var(--radius-sm);
        background-color: var(--accent-primary);
        color: white;
        cursor: pointer;
        transition: opacity var(--transition-fast);

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }

        &:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        &:not(:disabled):hover {
          opacity: 0.85;
        }
      }

      .save-preview {
        margin: var(--spacing-xs) 0 0;
        padding: var(--spacing-xs) var(--spacing-sm);
        background-color: var(--bg-tertiary);
        border-radius: var(--radius-sm);
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
        max-height: 48px;
        overflow: hidden;
        white-space: pre-wrap;
        word-break: break-all;
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

        .hint {
          font-size: var(--font-size-xs);
          margin-top: var(--spacing-xs);
        }
      }

      .snippet-item {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background-color var(--transition-fast);

        &:hover,
        &.selected {
          background-color: var(--bg-hover);

          .delete-btn {
            opacity: 1;
          }
        }
      }

      .snippet-content {
        flex: 1;
        min-width: 0;
      }

      .snippet-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-sm);
      }

      .snippet-name {
        font-weight: 500;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .snippet-date {
        font-size: var(--font-size-xs);
        color: var(--text-muted);
        white-space: nowrap;
      }

      .snippet-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
      }

      .tag {
        font-size: 10px;
        padding: 1px 6px;
        background-color: var(--bg-tertiary);
        border: 1px solid var(--border-primary);
        border-radius: 8px;
        color: var(--text-secondary);
      }

      .snippet-preview {
        margin: 4px 0 0;
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 40px;
        overflow: hidden;
      }

      .delete-btn {
        display: flex;
        align-items: center;
        padding: 4px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        opacity: 0;
        transition:
          opacity var(--transition-fast),
          color var(--transition-fast);
        flex-shrink: 0;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }

        &:hover {
          color: var(--status-error);
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
export class SnippetLibraryComponent implements OnInit, OnDestroy {
  private readonly tabState = inject(TabStateService);

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;
  @ViewChild('nameInput') nameInput!: ElementRef<HTMLInputElement>;

  readonly isOpen = signal(false);
  readonly searchQuery = signal('');
  readonly selectedIndex = signal(0);
  readonly allSnippets = signal<Snippet[]>([]);
  readonly showSaveForm = signal(false);
  readonly newSnippetName = signal('');
  readonly newSnippetTags = signal('');

  private fuse: Fuse<Snippet> | null = null;

  readonly filteredSnippets = computed(() => {
    const query = this.searchQuery();
    const snippets = this.allSnippets();

    if (!query.trim()) {
      return snippets;
    }

    if (!this.fuse) {
      return [];
    }

    return this.fuse.search(query).map(r => r.item);
  });

  readonly saveSqlPreview = computed(() => {
    if (!this.showSaveForm()) return '';
    const sql = this.getActiveTabSql();
    if (!sql) return '';
    const cleaned = sql.replace(/\s+/g, ' ').trim();
    return cleaned.length > 120 ? cleaned.substring(0, 120) + '...' : cleaned;
  });

  private keydownHandler = (event: KeyboardEvent) => {
    // Cmd+Shift+S to open snippet library
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.toggle();
    }
  };

  private openEventHandler = () => this.open();

  ngOnInit(): void {
    this.loadSnippets();
    document.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('forge:open-snippets', this.openEventHandler);
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('forge:open-snippets', this.openEventHandler);
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
    this.showSaveForm.set(false);
    this.loadSnippets();

    setTimeout(() => {
      this.searchInput?.nativeElement?.focus();
    }, 0);
  }

  close(): void {
    this.isOpen.set(false);
    this.searchQuery.set('');
    this.showSaveForm.set(false);
    this.newSnippetName.set('');
    this.newSnippetTags.set('');
  }

  onSearch(query: string): void {
    this.searchQuery.set(query);
    this.selectedIndex.set(0);
  }

  onKeyDown(event: KeyboardEvent): void {
    const snippets = this.filteredSnippets();

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.update(i => Math.min(i + 1, snippets.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.update(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        event.preventDefault();
        if (snippets.length > 0) {
          const selected = snippets[this.selectedIndex()];
          if (selected) {
            this.insertSnippet(selected);
          }
        }
        break;
    }
  }

  beginSave(): void {
    const sql = this.getActiveTabSql();
    if (!sql?.trim()) {
      return;
    }
    this.showSaveForm.set(true);
    this.newSnippetName.set('');
    this.newSnippetTags.set('');

    setTimeout(() => {
      this.nameInput?.nativeElement?.focus();
    }, 0);
  }

  saveSnippet(): void {
    const name = this.newSnippetName().trim();
    if (!name) return;

    const sql = this.getActiveTabSql();
    if (!sql?.trim()) return;

    const tags = this.newSnippetTags()
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const snippet: Snippet = {
      id: `snippet-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      name,
      sql: sql.trim(),
      tags,
      createdAt: new Date().toISOString(),
    };

    const snippets = [...this.allSnippets(), snippet];
    this.persistSnippets(snippets);
    this.allSnippets.set(snippets);
    this.rebuildFuse(snippets);

    this.showSaveForm.set(false);
    this.newSnippetName.set('');
    this.newSnippetTags.set('');
  }

  insertSnippet(snippet: Snippet): void {
    this.close();

    // Dispatch a custom event with the SQL to insert into the active query tab
    window.dispatchEvent(new CustomEvent('forge:insert-snippet', { detail: { sql: snippet.sql } }));
  }

  deleteSnippet(event: MouseEvent, snippet: Snippet): void {
    event.stopPropagation();

    const snippets = this.allSnippets().filter(s => s.id !== snippet.id);
    this.persistSnippets(snippets);
    this.allSnippets.set(snippets);
    this.rebuildFuse(snippets);
  }

  formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays < 1) return 'Today';
    if (diffDays < 2) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  truncateSql(sql: string): string {
    const cleaned = sql.replace(/\s+/g, ' ').trim();
    return cleaned.length > 100 ? cleaned.substring(0, 100) + '...' : cleaned;
  }

  private getActiveTabSql(): string {
    const activeTab = this.tabState.activeTab();
    if (activeTab?.type === 'query') {
      return this.tabState.getTabContent(activeTab.id);
    }
    return '';
  }

  private loadSnippets(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const snippets: Snippet[] = raw ? JSON.parse(raw) : [];
      this.allSnippets.set(snippets);
      this.rebuildFuse(snippets);
    } catch {
      this.allSnippets.set([]);
    }
  }

  private persistSnippets(snippets: Snippet[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
    } catch {
      // Storage may be full - silently fail
    }
  }

  private rebuildFuse(snippets: Snippet[]): void {
    this.fuse = new Fuse(snippets, {
      keys: ['name', 'tags', 'sql'],
      threshold: 0.4,
      includeScore: true,
    });
  }
}
