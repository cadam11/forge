/**
 * Context Menu Service
 * Manages context menu state and actions
 */

import { Injectable, signal } from '@angular/core';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  divider?: boolean;
  shortcut?: string;
  action?: () => void | Promise<void>;
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  data?: unknown;
}

@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  private readonly _state = signal<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    items: [],
  });

  readonly state = this._state.asReadonly();

  show(event: MouseEvent, items: ContextMenuItem[], data?: unknown): void {
    event.preventDefault();
    event.stopPropagation();

    // Calculate position, ensuring menu stays within viewport
    const x = Math.min(event.clientX, window.innerWidth - 200);
    const y = Math.min(event.clientY, window.innerHeight - 300);

    this._state.set({
      visible: true,
      x,
      y,
      items,
      data,
    });
  }

  hide(): void {
    this._state.update(state => ({
      ...state,
      visible: false,
    }));
  }

  async executeItem(item: ContextMenuItem): Promise<void> {
    if (item.disabled || !item.action) return;

    this.hide();
    await item.action();
  }
}
