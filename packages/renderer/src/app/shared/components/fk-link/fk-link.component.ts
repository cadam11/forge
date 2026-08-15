import {
  Component,
  Input,
  Output,
  EventEmitter,
  signal,
  computed,
  ChangeDetectionStrategy,
  inject,
  ElementRef,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IpcService } from '../../../core/services/ipc.service';
import type { ColumnMetadata, FkRecordRequest } from '@joinery/shared';

interface ForeignKeyRef {
  referencedSchema: string;
  referencedTable: string;
  referencedColumn: string;
  constraintName?: string;
}

@Component({
  selector: 'app-fk-link',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="fk-link-container" [class.clickable]="!isNull()">
      @if (isNull()) {
        <span class="null-value">NULL</span>
      } @else {
        <button
          class="fk-link-button"
          [matTooltip]="tooltip()"
          matTooltipPosition="above"
          (click)="togglePopover($event)"
        >
          <span class="fk-value">{{ displayValue() }}</span>
          <mat-icon class="fk-icon">link</mat-icon>
        </button>
      }

      @if (showPopover()) {
        <div class="fk-popover" [class.loading]="loading()">
          <div class="popover-header">
            <span class="popover-title">
              <mat-icon>table_chart</mat-icon>
              {{ foreignKey.referencedSchema }}.{{ foreignKey.referencedTable }}
            </span>
            <button class="close-btn" (click)="closePopover($event)">
              <mat-icon>close</mat-icon>
            </button>
          </div>

          @if (loading()) {
            <div class="popover-loading">
              <mat-spinner diameter="24"></mat-spinner>
              <span>Loading record...</span>
            </div>
          } @else if (error()) {
            <div class="popover-error">
              <mat-icon>error_outline</mat-icon>
              <span>{{ error() }}</span>
            </div>
          } @else if (record()) {
            <div class="popover-content">
              <div class="record-fields">
                @for (field of recordFields(); track field.name) {
                  <div class="field-row" [class.pk-field]="field.isPrimaryKey">
                    <span class="field-name">
                      @if (field.isPrimaryKey) {
                        <mat-icon class="key-icon">key</mat-icon>
                      }
                      {{ field.name }}
                    </span>
                    <span class="field-value" [class.null]="field.isNull">
                      {{ field.displayValue }}
                    </span>
                  </div>
                }
              </div>
            </div>
            <div class="popover-actions">
              <button
                class="action-btn primary"
                (click)="openInNewTab($event)"
                matTooltip="Open full record in new query tab"
              >
                <mat-icon>open_in_new</mat-icon>
                Open in New Tab
              </button>
            </div>
          }
        </div>
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-block;
        position: relative;
      }

      .fk-link-container {
        display: inline-flex;
        align-items: center;
        position: relative;
      }

      .null-value {
        color: var(--text-muted, #888);
        font-style: italic;
      }

      .fk-link-button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        padding: 2px 4px;
        margin: -2px -4px;
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
        color: var(--link-color, #4a9eff);
        transition: background-color 0.15s ease;

        &:hover {
          background-color: var(--hover-bg, rgba(74, 158, 255, 0.1));
        }
      }

      .fk-value {
        text-decoration: underline;
        text-decoration-style: dotted;
        text-underline-offset: 2px;
      }

      .fk-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
        opacity: 0.7;
      }

      .fk-popover {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        z-index: 1000;
        min-width: 320px;
        max-width: 480px;
        max-height: 400px;
        background: var(--panel-bg, #1e1e1e);
        border: 1px solid var(--border-color, #3c3c3c);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        overflow: hidden;
        display: flex;
        flex-direction: column;

        &::before {
          content: '';
          position: absolute;
          top: -6px;
          left: 16px;
          width: 12px;
          height: 12px;
          background: var(--panel-bg, #1e1e1e);
          border-left: 1px solid var(--border-color, #3c3c3c);
          border-top: 1px solid var(--border-color, #3c3c3c);
          transform: rotate(45deg);
        }
      }

      .popover-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        background: var(--header-bg, #252526);
        border-bottom: 1px solid var(--border-color, #3c3c3c);
      }

      .popover-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 500;
        color: var(--text-primary, #e0e0e0);

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--accent-color, #4a9eff);
        }
      }

      .close-btn {
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
        color: var(--text-muted, #888);

        &:hover {
          background: var(--hover-bg, rgba(255, 255, 255, 0.1));
          color: var(--text-primary, #e0e0e0);
        }

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }

      .popover-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 32px;
        color: var(--text-muted, #888);
      }

      .popover-error {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 16px;
        color: var(--error-color, #f44336);

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }
      }

      .popover-content {
        flex: 1;
        overflow-y: auto;
        padding: 8px 0;
      }

      .record-fields {
        display: flex;
        flex-direction: column;
      }

      .field-row {
        display: flex;
        padding: 6px 12px;
        gap: 12px;

        &:hover {
          background: var(--hover-bg, rgba(255, 255, 255, 0.05));
        }

        &.pk-field {
          background: var(--pk-bg, rgba(255, 193, 7, 0.08));
        }
      }

      .field-name {
        flex: 0 0 120px;
        display: flex;
        align-items: center;
        gap: 4px;
        font-weight: 500;
        color: var(--text-secondary, #aaa);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .key-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
        color: var(--warning-color, #ffc107);
      }

      .field-value {
        flex: 1;
        color: var(--text-primary, #e0e0e0);
        word-break: break-word;

        &.null {
          color: var(--text-muted, #888);
          font-style: italic;
        }
      }

      .popover-actions {
        display: flex;
        justify-content: flex-end;
        padding: 8px 12px;
        border-top: 1px solid var(--border-color, #3c3c3c);
        background: var(--header-bg, #252526);
      }

      .action-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: none;
        border: 1px solid var(--border-color, #3c3c3c);
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
        font-size: 13px;
        color: var(--text-primary, #e0e0e0);
        transition: all 0.15s ease;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }

        &:hover {
          background: var(--hover-bg, rgba(255, 255, 255, 0.1));
        }

        &.primary {
          background: var(--accent-color, #4a9eff);
          border-color: var(--accent-color, #4a9eff);
          color: white;

          &:hover {
            background: var(--accent-hover, #3a8eef);
          }
        }
      }
    `,
  ],
})
export class FkLinkComponent {
  @Input({ required: true }) value!: unknown;
  @Input({ required: true }) foreignKey!: ForeignKeyRef;
  @Input({ required: true }) connectionId!: string;
  @Input({ required: true }) database!: string;
  @Output() openQuery = new EventEmitter<{ sql: string; title: string }>();

  private readonly ipc = inject(IpcService);
  private readonly elementRef = inject(ElementRef);

  // State
  showPopover = signal(false);
  loading = signal(false);
  error = signal<string | null>(null);
  record = signal<Record<string, unknown> | null>(null);
  columns = signal<ColumnMetadata[]>([]);

  // Computed
  isNull = computed(() => this.value === null || this.value === undefined);
  displayValue = computed(() => {
    if (this.isNull()) return 'NULL';
    if (typeof this.value === 'object') return JSON.stringify(this.value);
    return String(this.value);
  });

  tooltip = computed(() => {
    const { referencedSchema, referencedTable, referencedColumn } = this.foreignKey;
    return `FK to ${referencedSchema}.${referencedTable}.${referencedColumn}`;
  });

  recordFields = computed(() => {
    const rec = this.record();
    const cols = this.columns();
    if (!rec) return [];

    return cols.map(col => ({
      name: col.name,
      value: rec[col.name],
      displayValue: this.formatFieldValue(rec[col.name]),
      isNull: rec[col.name] === null || rec[col.name] === undefined,
      isPrimaryKey: col.isPrimaryKey ?? false,
    }));
  });

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.showPopover() && !this.elementRef.nativeElement.contains(event.target)) {
      this.showPopover.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.showPopover()) {
      this.showPopover.set(false);
    }
  }

  togglePopover(event: Event): void {
    event.stopPropagation();
    if (this.showPopover()) {
      this.showPopover.set(false);
    } else {
      this.showPopover.set(true);
      this.fetchRecord();
    }
  }

  closePopover(event: Event): void {
    event.stopPropagation();
    this.showPopover.set(false);
  }

  private fetchRecord(): void {
    if (this.loading() || this.record()) return;

    this.loading.set(true);
    this.error.set(null);

    const request: FkRecordRequest = {
      connectionId: this.connectionId,
      database: this.database,
      schema: this.foreignKey.referencedSchema,
      table: this.foreignKey.referencedTable,
      column: this.foreignKey.referencedColumn,
      value: this.value,
    };

    this.ipc.fetchFkRecord(request).subscribe({
      next: result => {
        this.loading.set(false);
        if (result.success && result.record) {
          this.record.set(result.record);
          this.columns.set(result.columns ?? []);
        } else {
          this.error.set(result.error ?? 'Record not found');
        }
      },
      error: err => {
        this.loading.set(false);
        this.error.set(err.message ?? 'Failed to fetch record');
      },
    });
  }

  openInNewTab(event: Event): void {
    event.stopPropagation();
    const { referencedSchema, referencedTable, referencedColumn } = this.foreignKey;
    const escapedValue = this.formatValueForSql(this.value);
    const sql = `SELECT *\nFROM [${referencedSchema}].[${referencedTable}]\nWHERE [${referencedColumn}] = ${escapedValue}`;
    const title = `${referencedTable} - ${this.displayValue()}`;
    this.openQuery.emit({ sql, title });
    this.showPopover.set(false);
  }

  private formatFieldValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const str = JSON.stringify(value);
      return str.length > 100 ? str.substring(0, 100) + '...' : str;
    }
    const str = String(value);
    return str.length > 200 ? str.substring(0, 200) + '...' : str;
  }

  private formatValueForSql(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? '1' : '0';
    const str = String(value);
    const escaped = str.replace(/'/g, "''");
    return `N'${escaped}'`;
  }
}
