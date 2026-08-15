import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  Output,
  EventEmitter,
  HostListener,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AgGridAngular } from 'ag-grid-angular';
import {
  ColDef,
  GridApi,
  GridReadyEvent,
  CellClickedEvent,
  CellContextMenuEvent,
  ValueFormatterParams,
  CellClassParams,
  ModuleRegistry,
  AllCommunityModule,
} from 'ag-grid-community';
import type { ResultSet, ColumnMetadata } from '@forgedb/shared';
import { NotificationService } from '../../../core/services/notification.service';
import { IpcService } from '../../../core/services/ipc.service';
import { SettingsService } from '../../../core/services/settings.service';
import { Subscription, firstValueFrom } from 'rxjs';
import { keyHint } from '../../../core/utils/platform';

interface ColumnStats {
  column: string;
  type: string;
  nullCount: number;
  distinctCount: number;
  minValue?: unknown;
  maxValue?: unknown;
  avgValue?: number;
}

// Register all community modules
ModuleRegistry.registerModules([AllCommunityModule]);

interface FkPreviewData {
  value: unknown;
  foreignKey: {
    referencedSchema: string;
    referencedTable: string;
    referencedColumn: string;
    constraintName?: string;
  };
  record: Record<string, unknown> | null;
  columns: ColumnMetadata[];
  loading: boolean;
  error: string | null;
}

@Component({
  selector: 'app-results-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatDividerModule,
    MatTooltipModule,
    AgGridAngular,
  ],
  template: `
    <div class="results-grid-container">
      <div class="grid-toolbar">
        <div class="grid-info">
          @if (resultSet?.truncated) {
            <span
              class="row-count truncated"
              matTooltip="Result capped by the 'Max rows to display' setting; the full set was {{
                rowCount()
              }} rows"
              >showing first {{ displayedRowCount() }} of {{ rowCount() }} rows</span
            >
          } @else {
            <span class="row-count">{{ rowCount() }} rows</span>
          }
          @if (selectedCount() > 0) {
            <span class="selection-info">{{ selectedCount() }} selected</span>
          }
          @if (filterText()) {
            <span class="filter-info">filtered</span>
          }
        </div>

        <div class="grid-search">
          <input
            type="text"
            placeholder="Quick filter..."
            [ngModel]="filterText()"
            (ngModelChange)="onFilterChange($event)"
          />
          @if (filterText()) {
            <button class="clear-btn" (click)="clearFilter()">
              <mat-icon>close</mat-icon>
            </button>
          }
        </div>

        <div class="grid-actions">
          <button
            class="grid-btn"
            matTooltip="Column Statistics"
            (click)="toggleStats()"
            [class.active]="showStats()"
          >
            <mat-icon>analytics</mat-icon>
          </button>
          <button class="grid-btn" matTooltip="Auto-size columns" (click)="autoSizeAllColumns()">
            <mat-icon>view_column</mat-icon>
          </button>
          <button
            class="grid-btn"
            [matTooltip]="'Copy selected (' + copyKeyHint + ')'"
            (click)="copySelectedToClipboard()"
          >
            <mat-icon>content_copy</mat-icon>
          </button>
          <button class="grid-btn" [matMenuTriggerFor]="exportMenu" matTooltip="Export">
            <mat-icon>download</mat-icon>
          </button>

          <mat-menu #exportMenu="matMenu">
            <button mat-menu-item (click)="exportCsv()">
              <mat-icon>description</mat-icon>
              <span>Export as CSV</span>
            </button>
            <button mat-menu-item (click)="exportJson()">
              <mat-icon>code</mat-icon>
              <span>Export as JSON</span>
            </button>
            <button mat-menu-item (click)="exportSqlInsert()">
              <mat-icon>storage</mat-icon>
              <span>Export as SQL INSERT</span>
            </button>
            <mat-divider></mat-divider>
            <button mat-menu-item (click)="copyJson()">
              <mat-icon>content_paste</mat-icon>
              <span>Copy as JSON</span>
            </button>
            <button
              mat-menu-item
              (click)="copySelectedToClipboard({ format: 'tsv', includeHeaders: true })"
            >
              <mat-icon>table_chart</mat-icon>
              <span>Copy as TSV with Headers</span>
            </button>
          </mat-menu>
        </div>
      </div>

      <!-- Column Statistics Panel -->
      @if (showStats()) {
        <div class="stats-panel">
          <div class="stats-header">
            <h4>Column Statistics</h4>
            <button class="close-btn" (click)="showStats.set(false)">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="stats-content">
            @for (stat of columnStats(); track stat.column) {
              <div class="stat-item">
                <div class="stat-name">{{ stat.column }}</div>
                <div class="stat-details">
                  <span class="stat-type">{{ stat.type }}</span>
                  <span>{{ stat.distinctCount }} distinct</span>
                  <span>{{ stat.nullCount }} nulls</span>
                  @if (stat.minValue !== undefined) {
                    <span>min: {{ stat.minValue }}</span>
                  }
                  @if (stat.maxValue !== undefined) {
                    <span>max: {{ stat.maxValue }}</span>
                  }
                  @if (stat.avgValue !== undefined) {
                    <span>avg: {{ stat.avgValue | number: '1.2-2' }}</span>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      }

      <div class="grid-wrapper">
        @if (rowData.length === 0 && columnDefs.length > 0) {
          <div class="empty-results">
            <mat-icon>search_off</mat-icon>
            <span>Query executed successfully — 0 rows returned</span>
          </div>
        }
        <ag-grid-angular
          class="ag-theme-quartz-dark"
          [theme]="'legacy'"
          [rowData]="rowData"
          [columnDefs]="columnDefs"
          [defaultColDef]="defaultColDef"
          [rowSelection]="rowSelectionOptions"
          [suppressClipboardPaste]="true"
          [animateRows]="true"
          [suppressRowHoverHighlight]="false"
          [rowBuffer]="20"
          [quickFilterText]="filterText()"
          [enableCellTextSelection]="true"
          [enableRangeSelection]="false"
          [suppressMultiSort]="false"
          (gridReady)="onGridReady($event)"
          (cellClicked)="onCellClicked($event)"
          (cellContextMenu)="onCellContextMenu($event)"
          (selectionChanged)="onSelectionChanged()"
        />
      </div>

      <!-- Cell Value Preview Panel -->
      @if (selectedCell()) {
        <div class="preview-panel">
          <div class="preview-header">
            <span class="preview-column">{{ selectedCell()!.column }}</span>
            <span class="preview-type">{{ selectedCell()!.type }}</span>
            <button class="close-btn" (click)="selectedCell.set(null)">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="preview-content">
            <pre>{{ formatPreviewValue(selectedCell()!.value) }}</pre>
          </div>
          <div class="preview-actions">
            <button class="action-btn" (click)="copyPreviewValue()">
              <mat-icon>content_copy</mat-icon>
              Copy
            </button>
          </div>
        </div>
      }

      <!-- Context Menu -->
      @if (contextMenuPosition()) {
        <div
          class="context-menu"
          [style.top.px]="contextMenuPosition()!.y"
          [style.left.px]="contextMenuPosition()!.x"
          (mouseleave)="closeContextMenu()"
        >
          <button class="menu-item" (click)="copyCellValue()">
            <mat-icon>content_copy</mat-icon>
            Copy Cell Value
          </button>
          <button class="menu-item" (click)="copyRowAsJson()">
            <mat-icon>code</mat-icon>
            Copy Row as JSON
          </button>
          <button class="menu-item" (click)="copyRowAsSql()">
            <mat-icon>storage</mat-icon>
            Copy as INSERT
          </button>
          <div class="menu-divider"></div>
          <button class="menu-item" (click)="filterByValue()">
            <mat-icon>filter_alt</mat-icon>
            Filter by Value
          </button>
          <button class="menu-item" (click)="excludeValue()">
            <mat-icon>filter_alt_off</mat-icon>
            Exclude Value
          </button>
          @if (getContextMenuFkColumn()) {
            <div class="menu-divider"></div>
            <button class="menu-item fk-menu-item" (click)="showFkPreview($event)">
              <mat-icon>link</mat-icon>
              View Referenced Record
            </button>
            <button class="menu-item fk-menu-item" (click)="openFkInNewTab()">
              <mat-icon>open_in_new</mat-icon>
              Open FK in New Tab
            </button>
          }
        </div>
      }

      <!-- FK Preview Popover -->
      @if (fkPreview()) {
        <div
          class="fk-preview-popover"
          [style.top.px]="fkPreviewPosition()?.y"
          [style.left.px]="fkPreviewPosition()?.x"
        >
          <div class="fk-popover-header">
            <span class="fk-popover-title">
              <mat-icon>table_chart</mat-icon>
              {{ fkPreview()!.foreignKey.referencedSchema }}.{{
                fkPreview()!.foreignKey.referencedTable
              }}
            </span>
            <button class="close-btn" (click)="closeFkPreview()">
              <mat-icon>close</mat-icon>
            </button>
          </div>

          @if (fkPreview()!.loading) {
            <div class="fk-popover-loading">
              <div class="spinner"></div>
              <span>Loading record...</span>
            </div>
          } @else if (fkPreview()!.error) {
            <div class="fk-popover-error">
              <mat-icon>error_outline</mat-icon>
              <span>{{ fkPreview()!.error }}</span>
            </div>
          } @else if (fkPreview()!.record) {
            <div class="fk-popover-content">
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
            <div class="fk-popover-actions">
              <button class="fk-action-btn primary" (click)="openFkInNewTabFromPreview()">
                <mat-icon>open_in_new</mat-icon>
                Open in New Tab
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .results-grid-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        position: relative;
      }

      .grid-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 8px;
        background-color: var(--bg-tertiary);
        border-bottom: 1px solid var(--border-primary);
        min-height: 36px;
        gap: 12px;
      }

      .grid-info {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 12px;
        color: var(--text-secondary);
        flex-shrink: 0;
      }

      .row-count {
        color: var(--text-primary);
      }

      .selection-info {
        color: var(--status-info);
      }

      .filter-info {
        color: var(--status-warning);
      }

      .grid-search {
        flex: 1;
        max-width: 300px;
        position: relative;

        input {
          width: 100%;
          padding: 4px 28px 4px 8px;
          background-color: var(--bg-primary);
          border: 1px solid var(--border-primary);
          border-radius: 4px;
          color: var(--text-primary);
          font-size: 12px;

          &:focus {
            outline: none;
            border-color: var(--border-focus);
          }

          &::placeholder {
            color: var(--text-muted);
          }
        }

        .clear-btn {
          position: absolute;
          right: 4px;
          top: 50%;
          transform: translateY(-50%);
          width: 20px;
          height: 20px;
          padding: 0;
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;

          mat-icon {
            font-size: 14px;
            width: 14px;
            height: 14px;
          }

          &:hover {
            color: var(--text-primary);
          }
        }
      }

      .grid-actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
      }

      .grid-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.15s ease;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }

        &:hover {
          background-color: var(--bg-hover);
          color: var(--text-primary);
        }

        &:active {
          background-color: var(--bg-active);
        }

        &.active {
          background-color: var(--status-info);
          color: white;
        }
      }

      .grid-wrapper {
        flex: 1;
        overflow: hidden;
        position: relative;
      }

      .empty-results {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        color: var(--text-muted);
        font-size: 13px;
        z-index: 1;

        mat-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;
          opacity: 0.5;
        }
      }

      ag-grid-angular {
        width: 100%;
        height: 100%;
      }

      /* Stats Panel */
      .stats-panel {
        background-color: var(--bg-secondary);
        border-bottom: 1px solid var(--border-primary);
        max-height: 200px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .stats-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid var(--border-primary);

        h4 {
          margin: 0;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
        }
      }

      .stats-content {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 8px;
      }

      .stat-item {
        padding: 8px;
        background-color: var(--bg-tertiary);
        border-radius: 4px;

        .stat-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 4px;
        }

        .stat-details {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          font-size: 11px;
          color: var(--text-secondary);

          .stat-type {
            color: var(--status-info);
          }
        }
      }

      /* Preview Panel */
      .preview-panel {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background-color: var(--bg-secondary);
        border-top: 1px solid var(--border-primary);
        max-height: 150px;
        display: flex;
        flex-direction: column;
        z-index: 100;
      }

      .preview-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--border-primary);

        .preview-column {
          font-weight: 600;
          color: var(--text-primary);
        }

        .preview-type {
          font-size: 11px;
          color: var(--text-muted);
          padding: 2px 6px;
          background-color: var(--bg-tertiary);
          border-radius: 4px;
        }
      }

      .preview-content {
        flex: 1;
        overflow: auto;
        padding: 8px 12px;

        pre {
          margin: 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--text-primary);
          white-space: pre-wrap;
          word-break: break-all;
        }
      }

      .preview-actions {
        display: flex;
        gap: 4px;
        padding: 6px 12px;
        border-top: 1px solid var(--border-primary);
      }

      .action-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: transparent;
        border: 1px solid var(--border-primary);
        border-radius: 4px;
        color: var(--text-secondary);
        font-size: 11px;
        cursor: pointer;

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

      .close-btn {
        width: 24px;
        height: 24px;
        padding: 0;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--text-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-left: auto;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }

        &:hover {
          background-color: var(--bg-hover);
          color: var(--text-primary);
        }
      }

      /* Context Menu */
      .context-menu {
        position: fixed;
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        box-shadow: var(--shadow-md);
        min-width: 180px;
        z-index: 10000;
        padding: 4px 0;
      }

      .menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 12px;
        background: transparent;
        border: none;
        color: var(--text-primary);
        font-size: 12px;
        cursor: pointer;
        text-align: left;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          color: var(--text-secondary);
        }

        &:hover {
          background-color: var(--bg-hover);
        }
      }

      .menu-divider {
        height: 1px;
        background-color: var(--border-primary);
        margin: 4px 0;
      }

      .fk-menu-item mat-icon {
        color: var(--status-info);
      }

      /* FK Preview Popover */
      .fk-preview-popover {
        position: fixed;
        z-index: 10001;
        min-width: 320px;
        max-width: 480px;
        max-height: 400px;
        background: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .fk-popover-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        background: var(--bg-tertiary);
        border-bottom: 1px solid var(--border-primary);
      }

      .fk-popover-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 500;
        color: var(--text-primary);

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--status-info);
        }
      }

      .fk-popover-loading {
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

      .fk-popover-error {
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

      .fk-popover-content {
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
        flex: 0 0 120px;
        display: flex;
        align-items: center;
        gap: 4px;
        font-weight: 500;
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 12px;
      }

      .key-icon {
        font-size: 14px !important;
        width: 14px !important;
        height: 14px !important;
        color: var(--status-warning);
      }

      .fk-field-value {
        flex: 1;
        color: var(--text-primary);
        word-break: break-word;
        font-size: 12px;
        font-family: 'JetBrains Mono', monospace;

        &.null {
          color: var(--text-muted);
          font-style: italic;
        }
      }

      .fk-popover-actions {
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

      /* Custom ag-Grid theme overrides for dark mode */
      :host ::ng-deep .ag-theme-quartz-dark {
        --ag-background-color: var(--bg-primary);
        --ag-header-background-color: var(--grid-header-bg);
        --ag-odd-row-background-color: var(--grid-row-odd);
        --ag-even-row-background-color: var(--grid-row-even);
        --ag-row-hover-color: var(--grid-row-hover);
        --ag-selected-row-background-color: var(--grid-row-selected);
        --ag-range-selection-background-color: var(--grid-range-selection);
        --ag-range-selection-border-color: var(--grid-range-border);
        --ag-header-foreground-color: var(--text-secondary);
        --ag-foreground-color: var(--text-primary);
        --ag-border-color: var(--border-primary);
        --ag-secondary-foreground-color: var(--text-muted);
        --ag-font-family: 'JetBrains Mono', 'Consolas', monospace;
        --ag-font-size: 12px;
        --ag-row-height: 24px;
        --ag-header-height: 32px;
        --ag-cell-horizontal-padding: 8px;

        /* Checkbox styling for dark/light mode */
        --ag-checkbox-background-color: var(--bg-tertiary);
        --ag-checkbox-checked-color: var(--status-info);
        --ag-checkbox-unchecked-color: var(--border-secondary);
        --ag-checkbox-indeterminate-color: var(--status-info);

        /* Input styling */
        --ag-input-border-color: var(--border-primary);
        --ag-input-focus-border-color: var(--border-focus);
        --ag-input-disabled-background-color: var(--bg-secondary);

        /* Icon colors */
        --ag-icon-font-color: var(--text-secondary);

        /* Popup/modal backgrounds */
        --ag-modal-overlay-background-color: rgba(0, 0, 0, 0.5);
        --ag-popup-background-color: var(--bg-elevated);

        .ag-root-wrapper {
          border: none;
        }

        .ag-header {
          border-bottom: 1px solid var(--border-primary);
        }

        .ag-header-cell {
          font-weight: 600;
          font-size: 11px;
          letter-spacing: 0.3px;
        }

        .ag-header-cell-text {
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ag-cell {
          border-right: 1px solid var(--grid-cell-border);
          line-height: 24px;
        }

        .ag-row {
          border-bottom: 1px solid var(--grid-cell-border);
        }

        .ag-cell.cell-null {
          color: var(--text-muted);
          font-style: italic;
        }

        .ag-cell.cell-number {
          text-align: right;
        }

        .ag-cell.cell-boolean {
          color: var(--status-info);
        }

        .ag-cell.cell-date {
          color: var(--status-warning);
        }

        .ag-cell.cell-fk {
          color: var(--status-info);
          cursor: pointer;
          text-decoration: underline;
          text-decoration-style: dotted;
          text-underline-offset: 2px;

          &:hover {
            text-decoration-style: solid;
          }
        }

        /* Row number column */
        .ag-cell.row-number-cell {
          background-color: var(--grid-header-bg);
          color: var(--text-muted);
          text-align: right;
          font-size: 10px;
          border-right: 1px solid var(--border-primary);
        }

        /* Context menu styling */
        .ag-menu {
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          box-shadow: var(--shadow-md);
        }

        .ag-menu-option {
          padding: 8px 12px;
          cursor: pointer;

          &:hover {
            background-color: var(--bg-hover);
          }
        }

        .ag-menu-option-text {
          font-size: 12px;
        }

        /* Scrollbar styling */
        ::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }

        ::-webkit-scrollbar-track {
          background: var(--bg-primary);
        }

        ::-webkit-scrollbar-thumb {
          background: var(--border-secondary);
          border-radius: 5px;

          &:hover {
            background: var(--text-muted);
          }
        }

        /* Filter styling */
        .ag-filter {
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-primary);
        }

        .ag-filter-body-wrapper {
          padding: 8px;
        }

        .ag-text-field-input {
          background-color: var(--bg-primary);
          border: 1px solid var(--border-primary);
          color: var(--text-primary);
          padding: 4px 8px;
          border-radius: 4px;

          &:focus {
            border-color: var(--border-focus);
            outline: none;
          }
        }

        /* Checkbox styling */
        .ag-checkbox-input-wrapper {
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-secondary);
          border-radius: 3px;

          &::after {
            color: var(--status-info);
          }

          &.ag-checked {
            background-color: var(--status-info);
            border-color: var(--status-info);

            &::after {
              color: white;
            }
          }

          &:hover {
            border-color: var(--status-info);
          }
        }

        /* Input elements in ag-Grid */
        input[class^='ag-'],
        input[class*=' ag-'] {
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          color: var(--text-primary);

          &:focus {
            border-color: var(--border-focus);
            outline: none;
          }
        }

        /* Select elements */
        .ag-select {
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          color: var(--text-primary);
        }

        .ag-picker-field-wrapper {
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
        }

        /* Icons */
        .ag-icon {
          color: var(--text-secondary);
        }

        /* Header checkbox */
        .ag-header-select-all {
          .ag-checkbox-input-wrapper {
            background-color: var(--bg-secondary);
          }
        }

        /* Tooltip */
        .ag-tooltip {
          background-color: var(--bg-elevated);
          color: var(--text-primary);
          border: 1px solid var(--border-primary);
          box-shadow: var(--shadow-md);
        }

        /* Column header sort icons */
        .ag-sort-indicator-icon {
          color: var(--text-secondary);
        }

        /* Filter icons */
        .ag-header-cell-filter-button {
          color: var(--text-secondary);

          &:hover {
            color: var(--text-primary);
          }
        }
      }
    `,
  ],
})
export class ResultsGridComponent implements OnChanges, OnDestroy {
  @Input() resultSet: ResultSet | null = null;
  @Input() tableName: string = 'result';
  @Input() connectionId: string | null = null;
  @Input() database: string | null = null;
  @Output() cellSelected = new EventEmitter<{
    row: number;
    column: string;
    value: unknown;
    data: Record<string, unknown>;
  }>();
  @Output() exportRequested = new EventEmitter<'csv' | 'json' | 'sql'>();
  @Output() openQueryRequested = new EventEmitter<{ sql: string; title: string }>();

  readonly copyKeyHint = keyHint('C');

  private readonly notification = inject(NotificationService);
  private readonly ipc = inject(IpcService);
  private readonly settings = inject(SettingsService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private gridApi: GridApi | null = null;
  private fkSubscription: Subscription | null = null;

  // Edit > Copy (⌘C / Ctrl+C). MenuService's `forge:menu-copy` event is
  // forwarded from the main-process menu (the renderer never sees the raw
  // keystroke — Electron's menu accelerator captures it). We claim it
  // when:
  //   - the grid contains the active element (the user is "in" the grid)
  //   - they don't have a native text selection (e.g., drag-selected
  //     across cell text — they want that string, not the row)
  //   - they're not in an editable surface inside the grid (quick-filter
  //     input, future cell-value editor)
  // When we claim, we prevent default and route through
  // `copySelectedToClipboard()` which honors the user's Copy Format
  // setting. Otherwise MenuService falls back to document.execCommand.
  @HostListener('window:forge:menu-copy', ['$event'])
  onMenuCopy(event: Event): void {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !this.host.nativeElement.contains(active)) return;

    const tag = active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return;

    const sel = document.getSelection();
    if (sel && sel.toString().length > 0) return;

    event.preventDefault();
    this.copySelectedToClipboard();
  }

  rowData: Record<string, unknown>[] = [];
  columnDefs: ColDef[] = [];
  rowCount = signal(0);
  /** Rows actually present client-side (≤ rowCount when truncated). */
  displayedRowCount = signal(0);
  selectedCount = signal(0);
  filterText = signal('');
  showStats = signal(false);
  selectedCell = signal<{ column: string; type: string; value: unknown } | null>(null);
  contextMenuPosition = signal<{ x: number; y: number } | null>(null);
  private contextMenuCell: { row: Record<string, unknown>; column: string } | null = null;

  // FK Preview state
  fkPreview = signal<FkPreviewData | null>(null);
  fkPreviewPosition = signal<{ x: number; y: number } | null>(null);

  readonly columnStats = computed(() => {
    if (!this.resultSet) return [];
    return this.calculateColumnStats();
  });

  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    floatingFilter: true,
    resizable: true,
    minWidth: 80,
    suppressSizeToFit: false,
  };

  // New object-based row selection (replaces deprecated string values)
  rowSelectionOptions = {
    mode: 'multiRow' as const,
    copySelectedRows: false,
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['resultSet'] && this.resultSet) {
      this.updateGrid();
    }
  }

  ngOnDestroy(): void {
    this.fkSubscription?.unsubscribe();
  }

  private updateGrid(): void {
    if (!this.resultSet) {
      this.rowData = [];
      this.columnDefs = [];
      this.rowCount.set(0);
      return;
    }

    // Build column definitions
    this.columnDefs = [
      // Row number column
      {
        colId: 'rowNumber',
        headerName: '#',
        valueGetter: params => (params.node?.rowIndex != null ? params.node.rowIndex + 1 : ''),
        width: 60,
        maxWidth: 80,
        pinned: 'left',
        sortable: false,
        filter: false,
        resizable: false,
        cellClass: 'row-number-cell',
        suppressSizeToFit: true,
      },
      // Data columns
      ...this.resultSet.columns.map(col => this.createColumnDef(col)),
    ];

    // Set row data. rowCount is the TRUE received count — when the executor
    // capped the set (resultSet.truncated), it exceeds rows.length.
    this.rowData = this.resultSet.rows;
    this.rowCount.set(this.resultSet.rowCount ?? this.resultSet.rows.length);
    this.displayedRowCount.set(this.resultSet.rows.length);

    // Auto-size columns after data loads
    setTimeout(() => this.autoSizeAllColumns(), 100);
  }

  private createColumnDef(column: ColumnMetadata): ColDef {
    // Build header tooltip
    let headerTooltip = `${column.name} (${column.type})`;
    if (column.foreignKey) {
      headerTooltip += `\nFK → ${column.foreignKey.referencedSchema}.${column.foreignKey.referencedTable}.${column.foreignKey.referencedColumn}`;
    }
    if (column.isPrimaryKey) {
      headerTooltip += '\nPrimary Key';
    }

    const colDef: ColDef = {
      field: column.name,
      headerName: column.foreignKey ? `${column.name} 🔗` : column.name,
      headerTooltip,
      valueFormatter: (params: ValueFormatterParams) => this.formatValue(params.value, column),
      cellClass: (params: CellClassParams) => this.getCellClass(params.value, column),
    };

    // Set column width and filter based on data type
    if (this.isNumericType(column.type)) {
      colDef.width = 120;
      colDef.type = 'numericColumn';
      colDef.filter = 'agNumberColumnFilter';
    } else if (this.isBooleanType(column.type)) {
      colDef.width = 80;
    } else if (this.isDateType(column.type)) {
      colDef.width = 180;
      colDef.filter = 'agDateColumnFilter';
    } else if (column.maxLength && column.maxLength < 50) {
      colDef.width = Math.max(100, column.maxLength * 8);
      colDef.filter = 'agTextColumnFilter';
    } else {
      colDef.minWidth = 150;
      colDef.filter = 'agTextColumnFilter';
    }

    // Pin primary key columns to the left for easy reference
    if (column.isPrimaryKey) {
      colDef.pinned = 'left';
    }

    return colDef;
  }

  private formatValue(value: unknown, column: ColumnMetadata): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    // Format numbers with appropriate precision
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return value.toLocaleString();
      }
      // Handle decimal precision based on column metadata
      const precision = column.scale ?? 2;
      return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: precision,
      });
    }

    return String(value);
  }

  private getCellClass(value: unknown, column: ColumnMetadata): string | string[] {
    const classes: string[] = [];

    if (value === null || value === undefined) {
      classes.push('cell-null');
    } else if (this.isNumericType(column.type)) {
      classes.push('cell-number');
    } else if (this.isBooleanType(column.type)) {
      classes.push('cell-boolean');
    } else if (this.isDateType(column.type)) {
      classes.push('cell-date');
    }

    // Add FK class for non-null FK values
    if (column.foreignKey && value !== null && value !== undefined) {
      classes.push('cell-fk');
    }

    return classes;
  }

  private isNumericType(type: string): boolean {
    const numericTypes = [
      'int',
      'bigint',
      'smallint',
      'tinyint',
      'decimal',
      'numeric',
      'float',
      'real',
      'money',
      'smallmoney',
    ];
    return numericTypes.some(t => type.toLowerCase().includes(t));
  }

  private isBooleanType(type: string): boolean {
    return type.toLowerCase() === 'bit' || type.toLowerCase() === 'boolean';
  }

  private isDateType(type: string): boolean {
    const dateTypes = ['date', 'datetime', 'datetime2', 'smalldatetime', 'time', 'datetimeoffset'];
    return dateTypes.some(t => type.toLowerCase().includes(t));
  }

  onGridReady(params: GridReadyEvent): void {
    this.gridApi = params.api;
  }

  onCellClicked(event: CellClickedEvent): void {
    const field = event.colDef.field ?? '';
    const column = this.resultSet?.columns.find(c => c.name === field);

    // event.rowIndex is the DISPLAYED index (post-sort/filter), so it cannot
    // be used to look up the row in the original result set — event.data is
    // the actual clicked row regardless of sort/filter state.
    const rowData = event.data as Record<string, unknown> | undefined;
    if (rowData) {
      this.cellSelected.emit({
        row: event.rowIndex ?? 0,
        column: field,
        value: event.value,
        data: rowData,
      });
    }

    // Update selected cell for preview panel (only for long values)
    if (field && column) {
      const valueStr = this.formatPreviewValue(event.value);
      if (valueStr.length > 50 || valueStr.includes('\n')) {
        this.selectedCell.set({
          column: field,
          type: column.type,
          value: event.value,
        });
      }
    }
  }

  onSelectionChanged(): void {
    if (!this.gridApi) return;

    const selectedRows = this.gridApi.getSelectedRows();
    this.selectedCount.set(selectedRows.length);
  }

  /** Row data at a displayed (post-sort/filter) index, or null when out of range. */
  getDisplayedRowAt(index: number): Record<string, unknown> | null {
    if (!this.gridApi || index < 0) return null;
    const data = this.gridApi.getDisplayedRowAtIndex(index)?.data as
      | Record<string, unknown>
      | undefined;
    return data ?? null;
  }

  /** Number of rows currently displayed (after sort/filter). */
  getDisplayedRowCount(): number {
    return this.gridApi?.getDisplayedRowCount() ?? 0;
  }

  autoSizeAllColumns(): void {
    if (!this.gridApi) return;
    this.gridApi.autoSizeAllColumns();

    // Cap auto-sized columns at ~150 characters width so long values
    // don't blow out the grid. Users can still drag-resize beyond this.
    const maxAutoWidth = 1100;
    const allColumns = this.gridApi.getColumns();
    if (allColumns) {
      for (const col of allColumns) {
        const width = col.getActualWidth();
        if (width > maxAutoWidth) {
          this.gridApi.setColumnWidths([{ key: col, newWidth: maxAutoWidth }]);
        }
      }
    }
  }

  /**
   * Copy rows to clipboard using the format chosen in Settings → Results Grid.
   * If `formatOverride` is supplied (from menu items like "Copy as JSON" /
   * "Copy with Headers"), it wins over the user setting for this one call.
   * Selection rules:
   *   - Some rows selected → copy those rows.
   *   - No rows selected → copy ALL displayed rows (Craig's request — pressing
   *     the button with no selection should never silently copy nothing).
   */
  copySelectedToClipboard(formatOverride?: {
    format?: 'tsv' | 'csv' | 'json';
    includeHeaders?: boolean;
  }): void {
    if (!this.gridApi) return;

    const settings = this.settings.gridSettings();
    const format = formatOverride?.format ?? settings.copyFormat;
    const includeHeaders = formatOverride?.includeHeaders ?? settings.copyIncludeHeaders;

    const selectedRows = this.gridApi.getSelectedRows();
    let rows: Record<string, unknown>[];
    let scopeLabel: string;
    if (selectedRows.length > 0) {
      rows = selectedRows;
      scopeLabel = `${selectedRows.length} row${selectedRows.length > 1 ? 's' : ''}`;
    } else {
      rows = this.collectAllDisplayedRows();
      if (rows.length === 0) {
        this.notification.info('No rows to copy');
        return;
      }
      scopeLabel = `all ${rows.length} row${rows.length > 1 ? 's' : ''}`;
    }

    const columns = this.gridApi.getAllDisplayedColumns().filter(col => {
      const colId = col.getColId();
      return colId !== 'rowNumber' && colId !== 'ag-Grid-SelectionColumn';
    });
    const colMeta = columns.map(col => ({
      id: col.getColId(),
      header: col.getColDef().headerName || col.getColId(),
    }));

    let text: string;
    if (format === 'json') {
      text = this.buildJsonClipboard(rows, colMeta);
    } else if (format === 'csv') {
      text = this.buildDelimitedClipboard(rows, colMeta, ',', includeHeaders);
    } else {
      text = this.buildDelimitedClipboard(rows, colMeta, '\t', includeHeaders);
    }

    navigator.clipboard.writeText(text);
    this.notification.info(`Copied ${scopeLabel} to clipboard (${format.toUpperCase()})`);
  }

  private collectAllDisplayedRows(): Record<string, unknown>[] {
    if (!this.gridApi) return [];
    const out: Record<string, unknown>[] = [];
    const total = this.gridApi.getDisplayedRowCount();
    for (let i = 0; i < total; i++) {
      const node = this.gridApi.getDisplayedRowAtIndex(i);
      if (node?.data) out.push(node.data);
    }
    return out;
  }

  private buildJsonClipboard(
    rows: Record<string, unknown>[],
    colMeta: { id: string; header: string }[]
  ): string {
    const projected = rows.map(row => {
      const obj: Record<string, unknown> = {};
      for (const col of colMeta) obj[col.header] = row[col.id] ?? null;
      return obj;
    });
    return JSON.stringify(projected, null, 2);
  }

  private buildDelimitedClipboard(
    rows: Record<string, unknown>[],
    colMeta: { id: string; header: string }[],
    delimiter: ',' | '\t',
    includeHeaders: boolean
  ): string {
    const isCsv = delimiter === ',';
    const lines: string[] = [];
    if (includeHeaders) {
      lines.push(colMeta.map(c => this.encodeDelimitedValue(c.header, isCsv)).join(delimiter));
    }
    for (const row of rows) {
      lines.push(
        colMeta
          .map(c => this.encodeDelimitedValue(this.formatValueForClipboard(row[c.id]), isCsv))
          .join(delimiter)
      );
    }
    return lines.join('\n');
  }

  /**
   * RFC 4180 quoting for CSV; for TSV we strip embedded tabs/newlines so the
   * row structure stays intact when pasted into Excel/Sheets.
   */
  private encodeDelimitedValue(value: string, isCsv: boolean): string {
    if (isCsv) {
      const needsQuotes = /[",\n\r]/.test(value);
      if (!needsQuotes) return value;
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value.replace(/[\t\r\n]+/g, ' ');
  }

  private formatValueForClipboard(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  exportCsv(): void {
    if (!this.gridApi) return;
    // Get only data columns (exclude row number and selection columns)
    const dataColumnKeys = this.gridApi
      .getAllDisplayedColumns()
      .filter(col => {
        const colId = col.getColId();
        return colId !== 'rowNumber' && colId !== 'ag-Grid-SelectionColumn';
      })
      .map(col => col.getColId());

    this.gridApi.exportDataAsCsv({
      skipColumnGroupHeaders: true,
      skipColumnHeaders: false,
      columnKeys: dataColumnKeys,
      onlySelected: false,
      fileName: `query-results-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    this.notification.info('Results exported to CSV');
  }

  async exportJson(): Promise<void> {
    if (!this.resultSet || !this.ipc.isAvailable) return;

    const json = JSON.stringify(this.resultSet.rows, null, 2);
    const defaultPath = `query-results-${new Date().toISOString().slice(0, 10)}.json`;

    try {
      const result = await firstValueFrom(
        this.ipc.saveToFile(
          {
            title: 'Export as JSON',
            defaultPath,
            filters: [{ name: 'JSON Files', extensions: ['json'] }],
          },
          json
        )
      );

      if (!result.canceled) {
        this.notification.success('Results exported to JSON');
      }
    } catch (error) {
      this.notification.error('Failed to export JSON');
    }
  }

  async copyJson(): Promise<void> {
    if (!this.resultSet) return;
    try {
      const json = JSON.stringify(this.resultSet.rows, null, 2);
      await navigator.clipboard.writeText(json);
      this.notification.info('Results copied as JSON');
    } catch {
      this.notification.error('Failed to copy to clipboard');
    }
  }

  async exportSqlInsert(): Promise<void> {
    if (!this.resultSet) return;

    const columns = this.resultSet.columns.map(c => `[${c.name}]`).join(', ');
    const inserts: string[] = [];

    for (const row of this.resultSet.rows) {
      const values = this.resultSet.columns.map(col => {
        const value = row[col.name];
        return this.formatSqlValue(value, col);
      });
      inserts.push(`INSERT INTO [${this.tableName}] (${columns}) VALUES (${values.join(', ')});`);
    }

    const sql = inserts.join('\n');

    if (this.ipc.isAvailable) {
      const defaultPath = `insert-${this.tableName}-${new Date().toISOString().slice(0, 10)}.sql`;

      try {
        const result = await firstValueFrom(
          this.ipc.saveToFile(
            {
              title: 'Export as SQL INSERT',
              defaultPath,
              filters: [{ name: 'SQL Files', extensions: ['sql'] }],
            },
            sql
          )
        );

        if (!result.canceled) {
          this.notification.success('Results exported as SQL INSERT statements');
        }
      } catch (error) {
        this.notification.error('Failed to export SQL');
      }
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(sql);
      this.notification.info('SQL INSERT statements copied to clipboard');
    }
  }

  private formatSqlValue(value: unknown, _column: ColumnMetadata): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }

    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }

    if (typeof value === 'string') {
      return `N'${value.replace(/'/g, "''")}'`;
    }

    if (typeof value === 'object') {
      return `N'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }

    return `N'${String(value).replace(/'/g, "''")}'`;
  }

  onFilterChange(text: string): void {
    this.filterText.set(text);
  }

  clearFilter(): void {
    this.filterText.set('');
  }

  toggleStats(): void {
    this.showStats.update(v => !v);
  }

  private calculateColumnStats(): ColumnStats[] {
    if (!this.resultSet) return [];

    return this.resultSet.columns.map(col => {
      const values = this.resultSet!.rows.map(r => r[col.name]);
      const nonNullValues = values.filter(v => v !== null && v !== undefined);
      const distinctValues = new Set(nonNullValues.map(v => JSON.stringify(v)));

      const stats: ColumnStats = {
        column: col.name,
        type: col.type,
        nullCount: values.length - nonNullValues.length,
        distinctCount: distinctValues.size,
      };

      // Calculate min/max for comparable types
      if (nonNullValues.length > 0) {
        if (this.isNumericType(col.type)) {
          const numericValues = nonNullValues.filter(v => typeof v === 'number') as number[];
          if (numericValues.length > 0) {
            stats.minValue = Math.min(...numericValues);
            stats.maxValue = Math.max(...numericValues);
            stats.avgValue = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
          }
        } else if (this.isDateType(col.type)) {
          const dateValues = nonNullValues
            .map(v => (v instanceof Date ? v : new Date(String(v))))
            .filter(d => !isNaN(d.getTime()));
          if (dateValues.length > 0) {
            stats.minValue = new Date(Math.min(...dateValues.map(d => d.getTime())))
              .toISOString()
              .slice(0, 10);
            stats.maxValue = new Date(Math.max(...dateValues.map(d => d.getTime())))
              .toISOString()
              .slice(0, 10);
          }
        } else if (typeof nonNullValues[0] === 'string') {
          const stringValues = nonNullValues.filter(v => typeof v === 'string') as string[];
          if (stringValues.length > 0) {
            const sorted = [...stringValues].sort();
            stats.minValue = sorted[0].slice(0, 20) + (sorted[0].length > 20 ? '...' : '');
            stats.maxValue =
              sorted[sorted.length - 1].slice(0, 20) +
              (sorted[sorted.length - 1].length > 20 ? '...' : '');
          }
        }
      }

      return stats;
    });
  }

  onCellContextMenu(event: CellContextMenuEvent): void {
    event.event?.preventDefault();

    const mouseEvent = event.event as MouseEvent;
    this.contextMenuPosition.set({ x: mouseEvent.clientX, y: mouseEvent.clientY });
    this.contextMenuCell = {
      row: event.data,
      column: event.colDef?.field || '',
    };
  }

  closeContextMenu(): void {
    this.contextMenuPosition.set(null);
    this.contextMenuCell = null;
  }

  copyCellValue(): void {
    if (this.contextMenuCell) {
      const value = this.contextMenuCell.row[this.contextMenuCell.column];
      navigator.clipboard.writeText(this.formatValueForClipboard(value));
      this.notification.info('Cell value copied');
    }
    this.closeContextMenu();
  }

  copyRowAsJson(): void {
    if (this.contextMenuCell) {
      const json = JSON.stringify(this.contextMenuCell.row, null, 2);
      navigator.clipboard.writeText(json);
      this.notification.info('Row copied as JSON');
    }
    this.closeContextMenu();
  }

  copyRowAsSql(): void {
    if (this.contextMenuCell && this.resultSet) {
      const columns = this.resultSet.columns.map(c => `[${c.name}]`).join(', ');
      const values = this.resultSet.columns.map(col => {
        const value = this.contextMenuCell!.row[col.name];
        return this.formatSqlValue(value, col);
      });
      const sql = `INSERT INTO [${this.tableName}] (${columns}) VALUES (${values.join(', ')});`;
      navigator.clipboard.writeText(sql);
      this.notification.info('Row copied as INSERT statement');
    }
    this.closeContextMenu();
  }

  filterByValue(): void {
    if (this.contextMenuCell) {
      const value = this.contextMenuCell.row[this.contextMenuCell.column];
      const filterValue = value === null ? 'NULL' : String(value);
      this.filterText.set(filterValue);
    }
    this.closeContextMenu();
  }

  excludeValue(): void {
    if (this.contextMenuCell) {
      // Note: Quick filter doesn't support exclusion
      this.notification.info('Use column filter for exclusion');
    }
    this.closeContextMenu();
  }

  formatPreviewValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  copyPreviewValue(): void {
    const cell = this.selectedCell();
    if (cell) {
      navigator.clipboard.writeText(this.formatPreviewValue(cell.value));
      this.notification.info('Value copied to clipboard');
    }
  }

  // FK Navigation Methods

  getContextMenuFkColumn(): ColumnMetadata | null {
    if (!this.contextMenuCell || !this.resultSet) return null;
    const column = this.resultSet.columns.find(c => c.name === this.contextMenuCell!.column);
    if (column?.foreignKey) {
      return column;
    }
    return null;
  }

  showFkPreview(event: Event): void {
    event.stopPropagation();
    const fkColumn = this.getContextMenuFkColumn();
    if (!fkColumn?.foreignKey || !this.contextMenuCell || !this.connectionId || !this.database) {
      this.closeContextMenu();
      return;
    }

    const value = this.contextMenuCell.row[this.contextMenuCell.column];
    if (value === null || value === undefined) {
      this.notification.info('Cannot navigate to NULL foreign key value');
      this.closeContextMenu();
      return;
    }

    const pos = this.contextMenuPosition();
    this.fkPreviewPosition.set(pos ? { x: pos.x + 20, y: pos.y } : null);
    this.fkPreview.set({
      value,
      foreignKey: fkColumn.foreignKey,
      record: null,
      columns: [],
      loading: true,
      error: null,
    });

    this.closeContextMenu();
    this.fetchFkRecord(value, fkColumn.foreignKey);
  }

  private fetchFkRecord(
    value: unknown,
    foreignKey: { referencedSchema: string; referencedTable: string; referencedColumn: string }
  ): void {
    if (!this.connectionId || !this.database) return;

    // Cancel any in-flight FK fetch
    this.fkSubscription?.unsubscribe();

    this.fkSubscription = this.ipc
      .fetchFkRecord({
        connectionId: this.connectionId,
        database: this.database,
        schema: foreignKey.referencedSchema,
        table: foreignKey.referencedTable,
        column: foreignKey.referencedColumn,
        value,
      })
      .subscribe({
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
    this.fkPreviewPosition.set(null);
  }

  openFkInNewTab(): void {
    const fkColumn = this.getContextMenuFkColumn();
    if (!fkColumn?.foreignKey || !this.contextMenuCell) {
      this.closeContextMenu();
      return;
    }

    const value = this.contextMenuCell.row[this.contextMenuCell.column];
    this.emitFkQuery(value, fkColumn.foreignKey);
    this.closeContextMenu();
  }

  openFkInNewTabFromPreview(): void {
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
      return str.length > 100 ? str.substring(0, 100) + '...' : str;
    }
    const str = String(value);
    return str.length > 200 ? str.substring(0, 200) + '...' : str;
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
    return str.length > 30 ? str.substring(0, 30) + '...' : str;
  }
}
