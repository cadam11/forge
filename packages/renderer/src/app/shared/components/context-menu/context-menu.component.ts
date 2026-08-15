/**
 * Context Menu Component
 * Displays a floating context menu at the specified position
 */

import { Component, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';
import { ContextMenuService, ContextMenuItem } from '../../../core/services/context-menu.service';

@Component({
  selector: 'app-context-menu',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatRippleModule],
  template: `
    @if (menuService.state().visible) {
      <div
        class="context-menu-backdrop"
        (click)="menuService.hide()"
        (contextmenu)="onBackdropRightClick($event)"
      ></div>
      <div
        class="context-menu"
        [style.left.px]="menuService.state().x"
        [style.top.px]="menuService.state().y"
      >
        @for (item of menuService.state().items; track item.id) {
          @if (item.divider) {
            <div class="menu-divider"></div>
          } @else {
            <button
              class="menu-item"
              [class.disabled]="item.disabled"
              matRipple
              [matRippleDisabled]="!!item.disabled"
              (click)="onItemClick(item)"
            >
              @if (item.icon) {
                <mat-icon class="menu-icon">{{ item.icon }}</mat-icon>
              }
              <span class="menu-label">{{ item.label }}</span>
              @if (item.shortcut) {
                <span class="menu-shortcut">{{ item.shortcut }}</span>
              }
            </button>
          }
        }
      </div>
    }
  `,
  styles: [
    `
      .context-menu-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 10001;
      }

      .context-menu {
        position: fixed;
        z-index: 10002;
        min-width: 180px;
        max-width: 280px;
        background-color: var(--bg-elevated);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        padding: 4px 0;
        overflow: hidden;
      }

      .menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 12px;
        border: none;
        background: none;
        color: var(--text-primary);
        font-size: var(--font-size-sm);
        text-align: left;
        cursor: pointer;
        transition: background-color var(--transition-fast);

        &:hover:not(.disabled) {
          background-color: var(--bg-hover);
        }

        &.disabled {
          color: var(--text-muted);
          cursor: not-allowed;
        }
      }

      .menu-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--text-secondary);

        .disabled & {
          color: var(--text-muted);
        }
      }

      .menu-label {
        flex: 1;
      }

      .menu-shortcut {
        color: var(--text-muted);
        font-size: var(--font-size-xs);
      }

      .menu-divider {
        height: 1px;
        background-color: var(--border-primary);
        margin: 4px 0;
      }
    `,
  ],
})
export class ContextMenuComponent {
  readonly menuService = inject(ContextMenuService);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.menuService.hide();
  }

  onBackdropRightClick(event: MouseEvent): void {
    event.preventDefault();
    this.menuService.hide();
  }

  onItemClick(item: ContextMenuItem): void {
    this.menuService.executeItem(item);
  }
}
