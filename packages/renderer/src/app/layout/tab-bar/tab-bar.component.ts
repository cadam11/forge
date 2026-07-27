import { Component, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { TabStateService, Tab } from '../../core/state/tab.state';
import { ConnectionStateService } from '../../core/state/connection.state';

@Component({
  selector: 'app-tab-bar',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatMenuModule,
    MatDividerModule,
  ],
  template: `
    <div class="tab-bar-container">
      <div class="tabs-scroll">
        @for (tab of tabState.tabs(); track tab.id) {
          <div
            class="tab"
            [class.active]="tab.id === tabState.activeTabId()"
            [class.dirty]="tab.isDirty"
            (click)="activateTab(tab)"
            (auxclick)="onMiddleClick(tab, $event)"
            (contextmenu)="onContextMenu($event, tab)"
          >
            <mat-icon class="tab-icon">{{ tab.icon }}</mat-icon>
            <span class="tab-title">{{ tab.title }}</span>
            @if (tab.isDirty) {
              <span class="dirty-indicator"></span>
            }
            @if (tab.type !== 'welcome' || tabState.tabCount() > 1) {
              <button class="close-btn" (click)="closeTab(tab, $event)" matTooltip="Close">
                <mat-icon>close</mat-icon>
              </button>
            }
          </div>
        }
      </div>
      <div class="tab-actions">
        <button
          mat-icon-button
          matTooltip="New Query Tab"
          (click)="newQueryTab()"
          [disabled]="!canCreateQuery()"
        >
          <mat-icon>add</mat-icon>
        </button>
      </div>
    </div>

    <!-- Tab context menu (positioned dynamically) -->
    <div
      style="position: fixed; visibility: hidden"
      [style.left.px]="contextMenuX"
      [style.top.px]="contextMenuY"
      [matMenuTriggerFor]="tabContextMenu"
      #contextMenuTrigger="matMenuTrigger"
    ></div>
    <mat-menu #tabContextMenu="matMenu">
      <button mat-menu-item (click)="closeContextTab()">
        <mat-icon>close</mat-icon>
        <span>Close</span>
      </button>
      <button mat-menu-item (click)="closeOtherTabs()">
        <mat-icon>tab_unselected</mat-icon>
        <span>Close Others</span>
      </button>
      <button mat-menu-item (click)="closeTabsToRight()">
        <mat-icon>chevron_right</mat-icon>
        <span>Close to the Right</span>
      </button>
      <mat-divider></mat-divider>
      <button mat-menu-item (click)="duplicateTab()">
        <mat-icon>content_copy</mat-icon>
        <span>Duplicate</span>
      </button>
      @if (contextTab?.isPinned) {
        <button mat-menu-item (click)="togglePinTab()">
          <mat-icon>push_pin</mat-icon>
          <span>Unpin</span>
        </button>
      } @else {
        <button mat-menu-item (click)="togglePinTab()">
          <mat-icon>push_pin</mat-icon>
          <span>Pin</span>
        </button>
      }
    </mat-menu>
  `,
  styles: [
    `
      .tab-bar-container {
        display: flex;
        align-items: center;
        height: 100%;
        padding: 0 var(--spacing-xs);
        gap: var(--spacing-xs);
      }

      .tabs-scroll {
        display: flex;
        flex: 1;
        overflow-x: auto;
        overflow-y: hidden;
        gap: 1px;

        &::-webkit-scrollbar {
          height: 3px;
        }
      }

      .tab {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: 0 var(--spacing-sm);
        height: calc(var(--tab-height) - 4px);
        background-color: var(--bg-secondary);
        border-radius: var(--radius-sm) var(--radius-sm) 0 0;
        cursor: pointer;
        min-width: 100px;
        max-width: 200px;
        user-select: none;
        position: relative;
        transition: background-color var(--transition-fast);
        color: var(--text-secondary);

        &:hover {
          background-color: var(--bg-hover);
          color: var(--text-primary);
        }

        &.active {
          background-color: var(--bg-primary);
          color: var(--text-primary);

          &::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 2px;
            background-color: var(--border-focus);
          }
        }

        &.dirty .tab-title {
          font-style: italic;
        }
      }

      .tab-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--text-secondary);
      }

      .tab-title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--font-size-sm);
      }

      .dirty-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: var(--text-secondary);
      }

      .close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        padding: 0;
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--text-muted);
        cursor: pointer;
        opacity: 0;
        transition:
          opacity var(--transition-fast),
          background-color var(--transition-fast);

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

      .tab:hover .close-btn,
      .tab.active .close-btn {
        opacity: 1;
      }

      .tab-actions {
        display: flex;
        align-items: center;
        padding-left: var(--spacing-sm);
        border-left: 1px solid var(--border-primary);
      }
    `,
  ],
})
export class TabBarComponent {
  readonly tabState = inject(TabStateService);
  private readonly connectionState = inject(ConnectionStateService);
  private readonly router = inject(Router);

  @ViewChild('contextMenuTrigger') contextMenuTrigger!: MatMenuTrigger;
  contextMenuX = 0;
  contextMenuY = 0;
  contextTab: Tab | null = null;

  activateTab(tab: Tab): void {
    this.tabState.activateTab(tab.id);
    this.navigateToTab(tab);
  }

  closeTab(tab: Tab, event: Event): void {
    event.stopPropagation();
    this.tabState.closeTab(tab.id);

    // Navigate to the new active tab
    const activeTab = this.tabState.activeTab();
    if (activeTab) {
      this.navigateToTab(activeTab);
    }
  }

  onMiddleClick(tab: Tab, event: MouseEvent): void {
    // Middle mouse button
    if (event.button === 1) {
      event.preventDefault();
      this.tabState.closeTab(tab.id);
    }
  }

  onContextMenu(event: MouseEvent, tab: Tab): void {
    event.preventDefault();
    this.contextTab = tab;
    this.contextMenuX = event.clientX;
    this.contextMenuY = event.clientY;
    this.contextMenuTrigger.openMenu();
  }

  closeContextTab(): void {
    if (this.contextTab) {
      this.tabState.closeTab(this.contextTab.id);
      const activeTab = this.tabState.activeTab();
      if (activeTab) this.navigateToTab(activeTab);
    }
  }

  closeOtherTabs(): void {
    if (this.contextTab) {
      this.tabState.closeOtherTabs(this.contextTab.id);
      this.navigateToTab(this.contextTab);
    }
  }

  closeTabsToRight(): void {
    if (this.contextTab) {
      this.tabState.closeTabsToRight(this.contextTab.id);
      const activeTab = this.tabState.activeTab();
      if (activeTab) this.navigateToTab(activeTab);
    }
  }

  duplicateTab(): void {
    if (!this.contextTab) return;
    const tab = this.contextTab;
    if (tab.type === 'query' && tab.connectionId && tab.databaseName) {
      const newId = this.tabState.openQueryTab(
        tab.connectionId,
        tab.databaseName,
        this.tabState.getTabContent(tab.id)
      );
      this.tabState.renameTab(newId, tab.title + ' (copy)');
      this.router.navigate(['/query']);
    }
  }

  togglePinTab(): void {
    if (this.contextTab) {
      this.tabState.togglePin(this.contextTab.id);
    }
  }

  newQueryTab(): void {
    const connId = this.connectionState.mostRecentConnectionId();
    if (!connId) return;
    const db = this.connectionState.defaultDatabaseFor(connId);
    if (!db) return;
    this.tabState.openQueryTab(connId, db, undefined, false, false);
    this.router.navigate(['/query']);
  }

  canCreateQuery(): boolean {
    const connId = this.connectionState.mostRecentConnectionId();
    return !!connId && !!this.connectionState.defaultDatabaseFor(connId);
  }

  private navigateToTab(tab: Tab): void {
    switch (tab.type) {
      case 'welcome':
        this.router.navigate(['/']);
        break;
      case 'query':
        this.router.navigate(['/query']);
        break;
      case 'object':
        this.router.navigate(['/explorer']);
        break;
      case 'erd':
        this.router.navigate(['/erd']);
        break;
      default:
        this.router.navigate(['/']);
    }
  }
}
