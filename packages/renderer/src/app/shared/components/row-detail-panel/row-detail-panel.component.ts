import {
  Component,
  Input,
  Output,
  EventEmitter,
  HostListener,
  computed,
  signal,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import type { ColumnMetadata, FkRecordRequest } from '@joinery/shared';
import { IpcService } from '../../../core/services/ipc.service';

interface FkPreviewState {
  columnName: string;
  foreignKey: {
    referencedSchema: string;
    referencedTable: string;
    referencedColumn: string;
  };
  value: unknown;
  record: Record<string, unknown> | null;
  columns: ColumnMetadata[];
  loading: boolean;
  error: string | null;
}

export interface RowDetailData {
  rowIndex: number;
  row: Record<string, unknown>;
  columns: ColumnMetadata[];
}

@Component({
  selector: 'app-row-detail-panel',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule, MatTabsModule],
  template: `
    @if (isOpen()) {
      <div class="detail-overlay" (click)="close()"></div>
      <div class="detail-panel" (click)="$event.stopPropagation()">
        <header class="panel-header">
          <div class="header-info">
            <mat-icon>table_rows</mat-icon>
            <h3>Row {{ (data()?.rowIndex ?? 0) + 1 }} Details</h3>
          </div>
          <div class="header-actions">
            <button mat-icon-button (click)="copyAllToClipboard()" matTooltip="Copy all values">
              <mat-icon>content_copy</mat-icon>
            </button>
            <button mat-icon-button (click)="close()" matTooltip="Close (Esc)">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        </header>

        <div class="panel-content">
          <mat-tab-group animationDuration="150ms">
            <mat-tab label="Values">
              <div class="tab-content">
                <div class="column-list">
                  @for (col of columnDetails(); track col.name) {
                    <div
                      class="column-item"
                      [class.selected]="selectedColumn() === col.name"
                      [class.fk-column]="col.foreignKey && !col.isNull"
                      (click)="selectColumn(col.name)"
                    >
                      <div class="column-header">
                        <span class="column-name">
                          @if (col.isPrimaryKey) {
                            <span class="key-badge pk" title="Primary Key">PK</span>
                          }
                          @if (col.foreignKey) {
                            <span
                              class="key-badge fk"
                              title="FK to {{ col.foreignKey.referencedSchema }}.{{
                                col.foreignKey.referencedTable
                              }}"
                              >FK</span
                            >
                          }
                          {{ col.name }}
                        </span>
                        <span class="column-type">{{ col.type }}</span>
                      </div>
                      <div
                        class="column-value"
                        [class.null-value]="col.isNull"
                        [class.fk-value]="col.foreignKey && !col.isNull"
                      >
                        @if (col.isNull) {
                          <span class="null-indicator">NULL</span>
                        } @else if (col.foreignKey) {
                          <button class="fk-link-btn" (click)="showFkPreview(col, $event)">
                            <span class="value-text">{{ col.displayValue }}</span>
                            <mat-icon class="fk-link-icon">link</mat-icon>
                          </button>
                        } @else if (col.isTruncated) {
                          <span class="value-text">{{ col.displayValue }}</span>
                          <span class="truncated-indicator">...</span>
                        } @else {
                          <span class="value-text">{{ col.displayValue }}</span>
                        }
                      </div>
                      <div class="column-actions">
                        @if (col.foreignKey && !col.isNull) {
                          <button
                            mat-icon-button
                            class="small-btn"
                            (click)="openFkInNewTab(col, $event)"
                            matTooltip="Open in new tab"
                          >
                            <mat-icon>open_in_new</mat-icon>
                          </button>
                        }
                        <button
                          mat-icon-button
                          class="small-btn"
                          (click)="copyValue(col.rawValue, $event)"
                          matTooltip="Copy value"
                        >
                          <mat-icon>content_copy</mat-icon>
                        </button>
                      </div>
                    </div>
                  }
                </div>
              </div>
            </mat-tab>

            <mat-tab label="Full Value">
              <div class="tab-content full-value-tab">
                @if (selectedColumnData()) {
                  <div class="full-value-header">
                    <span class="column-name">{{ selectedColumnData()?.name }}</span>
                    <span class="column-type">{{ selectedColumnData()?.type }}</span>
                    <button
                      mat-stroked-button
                      class="copy-btn"
                      (click)="copyValue(selectedColumnData()?.rawValue)"
                    >
                      <mat-icon>content_copy</mat-icon>
                      Copy
                    </button>
                  </div>
                  <div class="full-value-content">
                    @if (selectedColumnData()?.isNull) {
                      <span class="null-indicator large">NULL</span>
                    } @else {
                      <pre class="value-pre">{{ selectedColumnData()?.fullValue }}</pre>
                    }
                  </div>
                } @else {
                  <div class="no-selection">
                    <mat-icon>touch_app</mat-icon>
                    <p>Select a column from the Values tab to view its full content</p>
                  </div>
                }
              </div>
            </mat-tab>

            <mat-tab label="Schema">
              <div class="tab-content schema-tab">
                <table class="schema-table">
                  <thead>
                    <tr>
                      <th class="col-key-header">Key</th>
                      <th>Column</th>
                      <th>Data Type</th>
                      <th>Nullable</th>
                      <th>Default</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (col of data()?.columns ?? []; track col.name) {
                      <tr [class.pk-row]="col.isPrimaryKey" [class.fk-row]="col.foreignKey">
                        <td class="col-key">
                          @if (col.isPrimaryKey) {
                            <span class="key-badge pk" title="Primary Key">PK</span>
                          }
                          @if (col.foreignKey) {
                            <span
                              class="key-badge fk"
                              title="Foreign Key to {{ col.foreignKey.referencedSchema }}.{{
                                col.foreignKey.referencedTable
                              }}.{{ col.foreignKey.referencedColumn }}"
                              >FK</span
                            >
                          }
                          @if (col.isIdentity) {
                            <span class="key-badge identity" title="Identity Column">ID</span>
                          }
                        </td>
                        <td class="col-name">{{ col.name }}</td>
                        <td class="col-type">{{ formatColumnType(col) }}</td>
                        <td class="col-nullable">
                          @if (col.nullable) {
                            <span class="nullable-yes">Yes</span>
                          } @else {
                            <span class="nullable-no">No</span>
                          }
                        </td>
                        <td class="col-default">{{ col.defaultValue ?? '-' }}</td>
                      </tr>
                      @if (col.foreignKey) {
                        <tr class="fk-detail-row">
                          <td></td>
                          <td colspan="4" class="fk-reference">
                            <mat-icon class="fk-icon">subdirectory_arrow_right</mat-icon>
                            References: {{ col.foreignKey.referencedSchema }}.{{
                              col.foreignKey.referencedTable
                            }}({{ col.foreignKey.referencedColumn }})
                          </td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            </mat-tab>
          </mat-tab-group>

          <!-- FK Preview Popover -->
          @if (fkPreview()) {
            <div class="fk-preview-popover">
              <div class="fk-preview-header">
                <span class="fk-preview-title">
                  <mat-icon>table_chart</mat-icon>
                  {{ fkPreview()!.foreignKey.referencedSchema }}.{{
                    fkPreview()!.foreignKey.referencedTable
                  }}
                </span>
                <button class="fk-close-btn" (click)="closeFkPreview()">
                  <mat-icon>close</mat-icon>
                </button>
              </div>

              @if (fkPreview()!.loading) {
                <div class="fk-preview-loading">
                  <div class="spinner"></div>
                  <span>Loading record...</span>
                </div>
              } @else if (fkPreview()!.error) {
                <div class="fk-preview-error">
                  <mat-icon>error_outline</mat-icon>
                  <span>{{ fkPreview()!.error }}</span>
                </div>
              } @else if (fkPreview()!.record) {
                <div class="fk-preview-content">
                  @for (col of fkPreview()!.columns; track col.name) {
                    <div class="fk-field-row" [class.pk-field]="col.isPrimaryKey">
                      <span class="fk-field-name">
                        @if (col.isPrimaryKey) {
                          <mat-icon class="key-icon">key</mat-icon>
                        }
                        {{ col.name }}
                      </span>
                      <span
                        class="fk-field-value"
                        [class.null]="fkPreview()!.record![col.name] === null"
                      >
                        {{ formatFkFieldValue(fkPreview()!.record![col.name]) }}
                      </span>
                    </div>
                  }
                </div>
                <div class="fk-preview-actions">
                  <button class="fk-action-btn primary" (click)="openFkFromPreview()">
                    <mat-icon>open_in_new</mat-icon>
                    Open in New Tab
                  </button>
                </div>
              }
            </div>
          }
        </div>

        <footer class="panel-footer">
          <span class="column-count">{{ data()?.columns?.length ?? 0 }} columns</span>
          <button mat-stroked-button (click)="previousRow()" [disabled]="!canGoPrevious()">
            <mat-icon>chevron_left</mat-icon>
            Previous
          </button>
          <button mat-stroked-button (click)="nextRow()" [disabled]="!canGoNext()">
            Next
            <mat-icon>chevron_right</mat-icon>
          </button>
        </footer>
      </div>
    }
  `,
  styles: [
    `
      .detail-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.4);
        z-index: 1000;
        animation: fadeIn 0.15s ease;
      }

      .detail-panel {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 480px;
        max-width: 95vw;
        background-color: var(--bg-secondary);
        border-left: 1px solid var(--border-primary);
        z-index: 1001;
        display: flex;
        flex-direction: column;
        animation: slideIn 0.2s ease;
        box-shadow: var(--shadow-lg);
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes slideIn {
        from {
          transform: translateX(100%);
        }
        to {
          transform: translateX(0);
        }
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);

        .header-info {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);

          mat-icon {
            color: var(--status-info);
          }

          h3 {
            font-size: var(--font-size-md);
            font-weight: 600;
            margin: 0;
            color: var(--text-primary);
          }
        }

        .header-actions {
          display: flex;
          gap: var(--spacing-xs);
        }
      }

      .panel-content {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;

        ::ng-deep .mat-mdc-tab-group {
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        ::ng-deep .mat-mdc-tab-body-wrapper {
          flex: 1;
          overflow: hidden;
        }

        ::ng-deep .mat-mdc-tab-body-content {
          height: 100%;
          overflow: hidden;
        }
      }

      .tab-content {
        height: 100%;
        overflow-y: auto;
        padding: var(--spacing-sm);
      }

      .column-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .column-item {
        display: grid;
        grid-template-columns: 1fr auto;
        grid-template-rows: auto auto;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);
        border: 1px solid var(--border-primary);
        cursor: pointer;
        transition: all var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
          border-color: var(--border-secondary);
        }

        &.selected {
          border-color: var(--status-info);
          background-color: rgba(55, 148, 255, 0.1);
        }

        .column-header {
          display: flex;
          align-items: baseline;
          gap: var(--spacing-sm);
        }

        .column-name {
          font-weight: 600;
          color: var(--text-primary);
          font-size: var(--font-size-sm);
        }

        .column-type {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          font-family: var(--font-mono);
        }

        .column-value {
          grid-column: 1;
          font-family: var(--font-mono);
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;

          &.null-value {
            color: var(--text-muted);
            font-style: italic;
          }

          .truncated-indicator {
            color: var(--text-muted);
          }
        }

        .column-actions {
          grid-column: 2;
          grid-row: 1 / 3;
          display: flex;
          align-items: center;
          opacity: 0;
          transition: opacity var(--transition-fast);

          .small-btn {
            width: 28px;
            height: 28px;

            mat-icon {
              font-size: 16px;
              width: 16px;
              height: 16px;
            }
          }
        }

        &:hover .column-actions {
          opacity: 1;
        }
      }

      .null-indicator {
        color: var(--text-muted);
        font-style: italic;

        &.large {
          font-size: var(--font-size-lg);
          padding: var(--spacing-lg);
          text-align: center;
          display: block;
        }
      }

      .full-value-tab {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);

        .full-value-header {
          display: flex;
          align-items: center;
          gap: var(--spacing-md);
          padding: var(--spacing-sm) var(--spacing-md);
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-md);

          .column-name {
            font-weight: 600;
            color: var(--text-primary);
          }

          .column-type {
            font-size: var(--font-size-sm);
            color: var(--text-muted);
            font-family: var(--font-mono);
          }

          .copy-btn {
            margin-left: auto;
            display: flex;
            align-items: center;
            gap: var(--spacing-xs);

            mat-icon {
              font-size: 16px;
              width: 16px;
              height: 16px;
            }
          }
        }

        .full-value-content {
          flex: 1;
          overflow: auto;
          background-color: var(--bg-primary);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-md);
          padding: var(--spacing-md);
        }

        .value-pre {
          font-family: var(--font-mono);
          font-size: var(--font-size-sm);
          color: var(--text-primary);
          white-space: pre-wrap;
          word-break: break-all;
          margin: 0;
        }

        .no-selection {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 200px;
          color: var(--text-muted);
          gap: var(--spacing-sm);

          mat-icon {
            font-size: 48px;
            width: 48px;
            height: 48px;
            opacity: 0.5;
          }

          p {
            margin: 0;
            text-align: center;
          }
        }
      }

      .schema-tab {
        .schema-table {
          width: 100%;
          border-collapse: collapse;
          font-size: var(--font-size-sm);

          th,
          td {
            padding: var(--spacing-sm) var(--spacing-md);
            text-align: left;
            border-bottom: 1px solid var(--border-primary);
          }

          th {
            font-weight: 600;
            color: var(--text-secondary);
            background-color: var(--bg-tertiary);
            position: sticky;
            top: 0;
          }

          .col-key-header {
            width: 70px;
            text-align: center;
          }

          td {
            color: var(--text-primary);
          }

          .col-key {
            text-align: center;
            display: flex;
            gap: 4px;
            justify-content: center;
          }

          .key-badge {
            display: inline-block;
            font-size: 9px;
            font-weight: 700;
            padding: 2px 5px;
            border-radius: 3px;
            text-transform: uppercase;
            letter-spacing: 0.5px;

            &.pk {
              background-color: rgba(255, 193, 7, 0.2);
              color: #ffc107;
              border: 1px solid rgba(255, 193, 7, 0.4);
            }

            &.fk {
              background-color: rgba(33, 150, 243, 0.2);
              color: #2196f3;
              border: 1px solid rgba(33, 150, 243, 0.4);
            }

            &.identity {
              background-color: rgba(156, 39, 176, 0.2);
              color: #ce93d8;
              border: 1px solid rgba(156, 39, 176, 0.4);
            }
          }

          .col-name {
            font-weight: 500;
          }

          .col-type {
            font-family: var(--font-mono);
            color: var(--status-info);
          }

          .col-nullable {
            .nullable-yes {
              color: var(--text-muted);
            }
            .nullable-no {
              color: var(--status-warning);
              font-weight: 500;
            }
          }

          .col-default {
            font-family: var(--font-mono);
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
            max-width: 150px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .pk-row td {
            background-color: rgba(255, 193, 7, 0.05);
          }

          .fk-row td {
            background-color: rgba(33, 150, 243, 0.05);
          }

          .fk-detail-row {
            .fk-reference {
              font-size: var(--font-size-xs);
              color: var(--status-info);
              font-family: var(--font-mono);
              padding-top: 0;
              padding-bottom: var(--spacing-sm);
              display: flex;
              align-items: center;
              gap: var(--spacing-xs);

              .fk-icon {
                font-size: 14px;
                width: 14px;
                height: 14px;
                color: var(--text-muted);
              }
            }
          }

          tr:hover td {
            background-color: var(--bg-hover);
          }
        }
      }

      .panel-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);
        gap: var(--spacing-sm);

        .column-count {
          font-size: var(--font-size-sm);
          color: var(--text-muted);
        }

        button {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
          }
        }
      }

      /* FK Column Styles */
      .column-item.fk-column {
        border-color: rgba(33, 150, 243, 0.3);

        &:hover {
          border-color: rgba(33, 150, 243, 0.5);
        }
      }

      .column-header .key-badge {
        display: inline-block;
        font-size: 9px;
        font-weight: 700;
        padding: 2px 5px;
        border-radius: 3px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-right: 4px;

        &.pk {
          background-color: rgba(255, 193, 7, 0.2);
          color: #ffc107;
          border: 1px solid rgba(255, 193, 7, 0.4);
        }

        &.fk {
          background-color: rgba(33, 150, 243, 0.2);
          color: #2196f3;
          border: 1px solid rgba(33, 150, 243, 0.4);
        }
      }

      .column-value.fk-value {
        color: var(--status-info);
      }

      .fk-link-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        font: inherit;
        color: var(--status-info);
        text-decoration: underline;
        text-decoration-style: dotted;
        text-underline-offset: 2px;

        &:hover {
          text-decoration-style: solid;
        }

        .fk-link-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
          opacity: 0.7;
        }
      }

      /* FK Preview Popover */
      .fk-preview-popover {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 100;
        min-width: 320px;
        max-width: 420px;
        max-height: 400px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .fk-preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        background: var(--bg-tertiary);
        border-bottom: 1px solid var(--border-primary);
      }

      .fk-preview-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 500;
        color: var(--text-primary);
        font-size: 13px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--status-info);
        }
      }

      .fk-close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        background: none;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        color: var(--text-muted);

        &:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }

      .fk-preview-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 32px;
        color: var(--text-muted);

        .spinner {
          width: 20px;
          height: 20px;
          border: 2px solid var(--border-secondary);
          border-top-color: var(--status-info);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .fk-preview-error {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 16px;
        color: var(--status-error);

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }
      }

      .fk-preview-content {
        flex: 1;
        overflow-y: auto;
        padding: 8px 0;
      }

      .fk-field-row {
        display: flex;
        padding: 6px 12px;
        gap: 12px;

        &:hover {
          background: var(--bg-hover);
        }

        &.pk-field {
          background: rgba(255, 193, 7, 0.08);
        }
      }

      .fk-field-name {
        flex: 0 0 110px;
        display: flex;
        align-items: center;
        gap: 4px;
        font-weight: 500;
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 12px;

        .key-icon {
          font-size: 14px !important;
          width: 14px !important;
          height: 14px !important;
          color: var(--status-warning);
        }
      }

      .fk-field-value {
        flex: 1;
        color: var(--text-primary);
        word-break: break-word;
        font-size: 12px;
        font-family: var(--font-mono);

        &.null {
          color: var(--text-muted);
          font-style: italic;
        }
      }

      .fk-preview-actions {
        display: flex;
        justify-content: flex-end;
        padding: 8px 12px;
        border-top: 1px solid var(--border-primary);
        background: var(--bg-tertiary);
      }

      .fk-action-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: none;
        border: 1px solid var(--border-primary);
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        color: var(--text-primary);
        transition: all 0.15s ease;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }

        &:hover {
          background: var(--bg-hover);
        }

        &.primary {
          background: var(--status-info);
          border-color: var(--status-info);
          color: white;

          &:hover {
            filter: brightness(1.1);
          }
        }
      }
    `,
  ],
})
export class RowDetailPanelComponent {
  private readonly _data = signal<RowDetailData | null>(null);
  readonly data = this._data.asReadonly();

  @Input()
  set inputData(value: RowDetailData | null) {
    this._data.set(value);
    if (value) {
      this._isOpen.set(true);
      this._selectedColumn.set(null);
    }
  }

  @Input() totalRows = 0;
  @Input() connectionId: string | null = null;
  @Input() database: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() navigateRow = new EventEmitter<'next' | 'previous'>();
  @Output() openQueryRequested = new EventEmitter<{ sql: string; title: string }>();

  private readonly ipc = inject(IpcService);
  private readonly _isOpen = signal(false);
  private readonly _selectedColumn = signal<string | null>(null);
  readonly fkPreview = signal<FkPreviewState | null>(null);

  readonly isOpen = this._isOpen.asReadonly();
  readonly selectedColumn = this._selectedColumn.asReadonly();

  readonly columnDetails = computed(() => {
    const data = this._data();
    if (!data) return [];

    return data.columns.map(col => {
      const rawValue = data.row[col.name];
      const isNull = rawValue === null || rawValue === undefined;
      const fullValue = isNull ? '' : this.formatFullValue(rawValue);
      const displayValue = this.truncateValue(fullValue, 100);

      return {
        name: col.name,
        type: col.type,
        rawValue,
        fullValue,
        displayValue,
        isNull,
        isTruncated: displayValue.length < fullValue.length,
        foreignKey: col.foreignKey,
        isPrimaryKey: col.isPrimaryKey,
      };
    });
  });

  readonly selectedColumnData = computed(() => {
    const name = this._selectedColumn();
    if (!name) return null;
    return this.columnDetails().find(c => c.name === name) ?? null;
  });

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this._isOpen()) {
      this.close();
    }
  }

  open(): void {
    this._isOpen.set(true);
    this._selectedColumn.set(null);
  }

  close(): void {
    this._isOpen.set(false);
    this.closed.emit();
  }

  selectColumn(name: string): void {
    this._selectedColumn.set(name);
  }

  canGoPrevious(): boolean {
    const data = this._data();
    return !!data && data.rowIndex > 0;
  }

  canGoNext(): boolean {
    const data = this._data();
    return !!data && data.rowIndex < this.totalRows - 1;
  }

  previousRow(): void {
    if (this.canGoPrevious()) {
      this.navigateRow.emit('previous');
    }
  }

  nextRow(): void {
    if (this.canGoNext()) {
      this.navigateRow.emit('next');
    }
  }

  copyValue(value: unknown, event?: Event): void {
    event?.stopPropagation();
    const text = this.formatFullValue(value);
    navigator.clipboard.writeText(text);
  }

  copyAllToClipboard(): void {
    const data = this._data();
    if (!data) return;

    const lines = data.columns.map(col => {
      const value = data.row[col.name];
      return `${col.name}: ${this.formatFullValue(value)}`;
    });

    navigator.clipboard.writeText(lines.join('\n'));
  }

  private formatFullValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  }

  private truncateValue(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return value.substring(0, maxLength);
  }

  formatColumnType(col: ColumnMetadata): string {
    let typeStr = col.type;

    // Add length/precision info for certain types
    if (col.maxLength && col.maxLength > 0 && col.maxLength !== 2147483647) {
      if (
        ['varchar', 'nvarchar', 'char', 'nchar', 'binary', 'varbinary'].some(t =>
          col.type.toLowerCase().includes(t)
        )
      ) {
        typeStr = `${col.type}(${col.maxLength === -1 ? 'MAX' : col.maxLength})`;
      }
    } else if (col.precision && col.precision > 0) {
      if (['decimal', 'numeric'].some(t => col.type.toLowerCase().includes(t))) {
        typeStr = `${col.type}(${col.precision}${col.scale ? ',' + col.scale : ''})`;
      }
    }

    return typeStr;
  }

  // FK Navigation Methods
  showFkPreview(
    col: {
      name: string;
      rawValue: unknown;
      foreignKey?: { referencedSchema: string; referencedTable: string; referencedColumn: string };
    },
    event: Event
  ): void {
    event.stopPropagation();

    if (!col.foreignKey || col.rawValue === null || col.rawValue === undefined) {
      return;
    }

    if (!this.connectionId || !this.database) {
      return;
    }

    this.fkPreview.set({
      columnName: col.name,
      foreignKey: col.foreignKey,
      value: col.rawValue,
      record: null,
      columns: [],
      loading: true,
      error: null,
    });

    this.fetchFkRecord(col.rawValue, col.foreignKey);
  }

  private fetchFkRecord(
    value: unknown,
    foreignKey: { referencedSchema: string; referencedTable: string; referencedColumn: string }
  ): void {
    if (!this.connectionId || !this.database) return;

    const request: FkRecordRequest = {
      connectionId: this.connectionId,
      database: this.database,
      schema: foreignKey.referencedSchema,
      table: foreignKey.referencedTable,
      column: foreignKey.referencedColumn,
      value,
    };

    this.ipc.fetchFkRecord(request).subscribe({
      next: result => {
        const current = this.fkPreview();
        if (current) {
          if (result.success && result.record) {
            this.fkPreview.set({
              ...current,
              record: result.record,
              columns: result.columns ?? [],
              loading: false,
              error: null,
            });
          } else {
            this.fkPreview.set({
              ...current,
              loading: false,
              error: result.error ?? 'Record not found',
            });
          }
        }
      },
      error: err => {
        const current = this.fkPreview();
        if (current) {
          this.fkPreview.set({
            ...current,
            loading: false,
            error: err.message ?? 'Failed to fetch record',
          });
        }
      },
    });
  }

  closeFkPreview(): void {
    this.fkPreview.set(null);
  }

  openFkInNewTab(
    col: {
      rawValue: unknown;
      foreignKey?: { referencedSchema: string; referencedTable: string; referencedColumn: string };
    },
    event: Event
  ): void {
    event.stopPropagation();

    if (!col.foreignKey || col.rawValue === null || col.rawValue === undefined) {
      return;
    }

    this.emitFkQuery(col.rawValue, col.foreignKey);
  }

  openFkFromPreview(): void {
    const preview = this.fkPreview();
    if (!preview) return;

    this.emitFkQuery(preview.value, preview.foreignKey);
    this.closeFkPreview();
  }

  private emitFkQuery(
    value: unknown,
    foreignKey: { referencedSchema: string; referencedTable: string; referencedColumn: string }
  ): void {
    const escapedValue = this.formatFkValueForSql(value);
    const sql = `SELECT *\nFROM [${foreignKey.referencedSchema}].[${foreignKey.referencedTable}]\nWHERE [${foreignKey.referencedColumn}] = ${escapedValue}`;
    const title = `${foreignKey.referencedTable} - ${this.formatDisplayValue(value)}`;
    this.openQueryRequested.emit({ sql, title });
  }

  formatFkFieldValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const str = JSON.stringify(value);
      return str.length > 80 ? str.substring(0, 80) + '...' : str;
    }
    const str = String(value);
    return str.length > 150 ? str.substring(0, 150) + '...' : str;
  }

  private formatFkValueForSql(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? '1' : '0';
    const str = String(value);
    const escaped = str.replace(/'/g, "''");
    return `N'${escaped}'`;
  }

  private formatDisplayValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'object') return JSON.stringify(value);
    const str = String(value);
    return str.length > 25 ? str.substring(0, 25) + '...' : str;
  }
}
