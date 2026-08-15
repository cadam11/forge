/**
 * Generic Tree View Component
 */

import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

export interface TreeNode<T = unknown> {
  id: string;
  label: string;
  icon?: string;
  iconColor?: string;
  data?: T;
  children?: TreeNode<T>[];
  hasChildren?: boolean;
  isLoading?: boolean;
  isExpanded?: boolean;
  isSelected?: boolean;
  level?: number;
}

@Component({
  selector: 'app-tree-view',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="tree-container"
      role="tree"
      [attr.aria-label]="ariaLabel"
      (keydown)="onKeyDown($event)"
    >
      @for (node of nodes; track node.id) {
        <ng-container
          *ngTemplateOutlet="nodeTemplate; context: { $implicit: node, level: 0 }"
        ></ng-container>
      }
    </div>

    <ng-template #nodeTemplate let-node let-level="level">
      <div
        class="tree-node"
        [class.expanded]="isExpanded(node.id)"
        [class.selected]="isSelected(node.id)"
        [class.has-children]="node.hasChildren || node.children?.length"
        [style.padding-left.px]="level * indentSize + 8"
        [attr.role]="'treeitem'"
        [attr.aria-expanded]="
          node.hasChildren || node.children?.length ? isExpanded(node.id) : null
        "
        [attr.aria-selected]="isSelected(node.id)"
        [attr.aria-level]="level + 1"
        [attr.data-node-id]="node.id"
        tabindex="0"
        (click)="onNodeClick(node, $event)"
        (dblclick)="onNodeDoubleClick(node, $event)"
        (contextmenu)="onNodeContextMenu(node, $event)"
      >
        <span class="node-toggle" (click)="onToggleClick(node, $event)">
          @if (node.isLoading) {
            <mat-spinner diameter="16"></mat-spinner>
          } @else if (node.hasChildren || node.children?.length) {
            <mat-icon class="toggle-icon">
              {{ isExpanded(node.id) ? 'expand_more' : 'chevron_right' }}
            </mat-icon>
          } @else {
            <span class="toggle-spacer"></span>
          }
        </span>

        @if (node.icon) {
          <mat-icon class="node-icon" [style.color]="node.iconColor">
            {{ node.icon }}
          </mat-icon>
        }

        <span class="node-label">{{ node.label }}</span>
      </div>

      @if (isExpanded(node.id) && node.children?.length) {
        <div class="tree-children" role="group">
          @for (child of node.children; track child.id) {
            <ng-container
              *ngTemplateOutlet="nodeTemplate; context: { $implicit: child, level: level + 1 }"
            ></ng-container>
          }
        </div>
      }
    </ng-template>
  `,
  styles: [
    `
      .tree-container {
        font-size: var(--font-size-sm);
        user-select: none;
      }

      .tree-node {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        cursor: pointer;
        border-radius: var(--radius-sm);
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }

        &:focus {
          outline: none;
          background-color: var(--bg-hover);
        }

        &.selected {
          background-color: var(--bg-selected);
        }
      }

      .node-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        flex-shrink: 0;

        .toggle-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--text-secondary);
          transition: transform var(--transition-fast);
        }

        .toggle-spacer {
          width: 18px;
        }

        mat-spinner {
          margin: 2px;
        }
      }

      .node-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
      }

      .node-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--text-primary);
      }

      .tree-children {
        position: relative;

        &::before {
          content: '';
          position: absolute;
          left: 18px;
          top: 0;
          bottom: 0;
          width: 1px;
          background-color: var(--border-primary);
        }
      }
    `,
  ],
})
export class TreeViewComponent<T = unknown> {
  @Input() nodes: TreeNode<T>[] = [];
  @Input() indentSize = 16;
  @Input() ariaLabel = 'Tree view';

  @Output() nodeSelect = new EventEmitter<TreeNode<T>>();
  @Output() nodeExpand = new EventEmitter<TreeNode<T>>();
  @Output() nodeCollapse = new EventEmitter<TreeNode<T>>();
  @Output() nodeDoubleClick = new EventEmitter<TreeNode<T>>();
  @Output() nodeContextMenu = new EventEmitter<{ node: TreeNode<T>; event: MouseEvent }>();
  @Output() loadChildren = new EventEmitter<TreeNode<T>>();

  private expandedNodes = signal<Set<string>>(new Set());
  private selectedNodeId = signal<string | null>(null);

  isExpanded(nodeId: string): boolean {
    return this.expandedNodes().has(nodeId);
  }

  isSelected(nodeId: string): boolean {
    return this.selectedNodeId() === nodeId;
  }

  onNodeClick(node: TreeNode<T>, event: Event): void {
    event.stopPropagation();
    this.selectNode(node);
  }

  onToggleClick(node: TreeNode<T>, event: Event): void {
    event.stopPropagation();
    this.toggleNode(node);
  }

  onNodeDoubleClick(node: TreeNode<T>, event: Event): void {
    event.stopPropagation();
    this.nodeDoubleClick.emit(node);

    // Also toggle expansion on double-click if has children
    if (node.hasChildren || node.children?.length) {
      this.toggleNode(node);
    }
  }

  onNodeContextMenu(node: TreeNode<T>, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectNode(node);
    this.nodeContextMenu.emit({ node, event });
  }

  onKeyDown(event: KeyboardEvent): void {
    const selectedId = this.selectedNodeId();
    if (!selectedId) return;

    const node = this.findNode(selectedId);
    if (!node) return;

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        if (node.hasChildren || node.children?.length) {
          if (!this.isExpanded(node.id)) {
            this.expandNode(node);
          } else if (node.children?.length) {
            // Select first child
            this.selectNode(node.children[0]);
          }
        }
        break;

      case 'ArrowLeft':
        event.preventDefault();
        if (this.isExpanded(node.id)) {
          this.collapseNode(node);
        } else {
          // Select parent (would need parent tracking)
        }
        break;

      case 'ArrowDown':
        event.preventDefault();
        this.selectNextNode();
        break;

      case 'ArrowUp':
        event.preventDefault();
        this.selectPreviousNode();
        break;

      case 'Enter':
        event.preventDefault();
        this.nodeDoubleClick.emit(node);
        break;

      case ' ':
        event.preventDefault();
        this.toggleNode(node);
        break;
    }
  }

  private selectNode(node: TreeNode<T>): void {
    this.selectedNodeId.set(node.id);
    this.nodeSelect.emit(node);
  }

  private toggleNode(node: TreeNode<T>): void {
    if (this.isExpanded(node.id)) {
      this.collapseNode(node);
    } else {
      this.expandNode(node);
    }
  }

  private expandNode(node: TreeNode<T>): void {
    if (!node.hasChildren && !node.children?.length) return;

    this.expandedNodes.update(set => {
      const newSet = new Set(set);
      newSet.add(node.id);
      return newSet;
    });

    // Emit load children if no children loaded yet
    if (node.hasChildren && (!node.children || node.children.length === 0)) {
      this.loadChildren.emit(node);
    }

    this.nodeExpand.emit(node);
  }

  private collapseNode(node: TreeNode<T>): void {
    this.expandedNodes.update(set => {
      const newSet = new Set(set);
      newSet.delete(node.id);
      return newSet;
    });
    this.nodeCollapse.emit(node);
  }

  private findNode(id: string, nodes: TreeNode<T>[] = this.nodes): TreeNode<T> | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = this.findNode(id, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  private getFlatNodeList(): TreeNode<T>[] {
    const flat: TreeNode<T>[] = [];
    const addNodes = (nodes: TreeNode<T>[]) => {
      for (const node of nodes) {
        flat.push(node);
        if (this.isExpanded(node.id) && node.children) {
          addNodes(node.children);
        }
      }
    };
    addNodes(this.nodes);
    return flat;
  }

  private selectNextNode(): void {
    const flat = this.getFlatNodeList();
    const currentIndex = flat.findIndex(n => n.id === this.selectedNodeId());
    if (currentIndex < flat.length - 1) {
      this.selectNode(flat[currentIndex + 1]);
    }
  }

  private selectPreviousNode(): void {
    const flat = this.getFlatNodeList();
    const currentIndex = flat.findIndex(n => n.id === this.selectedNodeId());
    if (currentIndex > 0) {
      this.selectNode(flat[currentIndex - 1]);
    }
  }

  // Public methods for external control
  expand(nodeId: string): void {
    const node = this.findNode(nodeId);
    if (node) this.expandNode(node);
  }

  collapse(nodeId: string): void {
    const node = this.findNode(nodeId);
    if (node) this.collapseNode(node);
  }

  expandAll(): void {
    const expandRecursive = (nodes: TreeNode<T>[]) => {
      for (const node of nodes) {
        if (node.hasChildren || node.children?.length) {
          this.expandedNodes.update(set => {
            const newSet = new Set(set);
            newSet.add(node.id);
            return newSet;
          });
          if (node.children) expandRecursive(node.children);
        }
      }
    };
    expandRecursive(this.nodes);
  }

  collapseAll(): void {
    this.expandedNodes.set(new Set());
  }

  select(nodeId: string): void {
    const node = this.findNode(nodeId);
    if (node) this.selectNode(node);
  }
}
