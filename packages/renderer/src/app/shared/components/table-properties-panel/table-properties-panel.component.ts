/**
 * Table Properties Panel Component
 * A comprehensive slide-in panel showing all table metadata, storage info, and extended properties
 */

import { Component, Output, EventEmitter, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import type { TableProperties, ColumnInfo, ExtendedProperty } from '@forgedb/shared';

export interface TablePropertiesRequest {
  connectionId: string;
  databaseName: string;
  schema: string;
  tableName: string;
}

@Component({
  selector: 'app-table-properties-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatTableModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatExpansionModule,
    MatChipsModule,
    MatBadgeModule,
  ],
  template: `
    @if (isOpen()) {
      <div class="properties-overlay" (click)="close()"></div>
      <div class="properties-panel" (click)="$event.stopPropagation()">
        <header class="panel-header">
          <div class="header-info">
            <mat-icon class="table-icon">table_chart</mat-icon>
            <div class="header-text">
              <h2>{{ properties()?.schema }}.{{ properties()?.name }}</h2>
              <span class="subtitle">Table Properties</span>
            </div>
          </div>
          <button mat-icon-button (click)="close()" matTooltip="Close (Esc)">
            <mat-icon>close</mat-icon>
          </button>
        </header>

        @if (loading()) {
          <div class="loading-state">
            <mat-spinner diameter="48"></mat-spinner>
            <p>Loading table properties...</p>
          </div>
        } @else if (error()) {
          <div class="error-state">
            <mat-icon>error_outline</mat-icon>
            <h3>Error Loading Properties</h3>
            <p>{{ error() }}</p>
            <button mat-stroked-button (click)="retry()">
              <mat-icon>refresh</mat-icon>
              Retry
            </button>
          </div>
        } @else if (properties()) {
          <div class="panel-content">
            <mat-tab-group animationDuration="200ms">
              <!-- General Tab -->
              <mat-tab>
                <ng-template mat-tab-label>
                  <mat-icon>info</mat-icon>
                  General
                </ng-template>
                <div class="tab-content">
                  <section class="info-section">
                    <h3>Basic Information</h3>
                    <div class="info-grid">
                      <div class="info-item">
                        <span class="label">Schema</span>
                        <span class="value">{{ properties()!.schema }}</span>
                      </div>
                      <div class="info-item">
                        <span class="label">Table Name</span>
                        <span class="value">{{ properties()!.name }}</span>
                      </div>
                      <div class="info-item">
                        <span class="label">Object ID</span>
                        <span class="value mono">{{ properties()!.objectId }}</span>
                      </div>
                      <div class="info-item">
                        <span class="label">Created</span>
                        <span class="value">{{ formatDate(properties()!.createdAt) }}</span>
                      </div>
                      @if (properties()!.modifiedAt) {
                        <div class="info-item">
                          <span class="label">Last Modified</span>
                          <span class="value">{{ formatDate(properties()!.modifiedAt) }}</span>
                        </div>
                      }
                      <div class="info-item">
                        <span class="label">Row Count</span>
                        <span class="value">{{ formatNumber(properties()!.rowCount) }}</span>
                      </div>
                    </div>
                  </section>

                  <section class="info-section">
                    <h3>Storage</h3>
                    <div class="storage-summary">
                      <div class="storage-item data">
                        <mat-icon>storage</mat-icon>
                        <div class="storage-details">
                          <span class="storage-label">Data Space</span>
                          <span class="storage-value">{{
                            formatSize(properties()!.dataSpaceKb)
                          }}</span>
                        </div>
                      </div>
                      <div class="storage-item index">
                        <mat-icon>format_list_numbered</mat-icon>
                        <div class="storage-details">
                          <span class="storage-label">Index Space</span>
                          <span class="storage-value">{{
                            formatSize(properties()!.indexSpaceKb)
                          }}</span>
                        </div>
                      </div>
                      <div class="storage-item unused">
                        <mat-icon>layers_clear</mat-icon>
                        <div class="storage-details">
                          <span class="storage-label">Unused Space</span>
                          <span class="storage-value">{{
                            formatSize(properties()!.unusedSpaceKb)
                          }}</span>
                        </div>
                      </div>
                      <div class="storage-item total">
                        <mat-icon>pie_chart</mat-icon>
                        <div class="storage-details">
                          <span class="storage-label">Total Size</span>
                          <span class="storage-value highlight">{{
                            formatSize(properties()!.totalSpaceKb)
                          }}</span>
                        </div>
                      </div>
                    </div>
                    <div class="info-grid">
                      <div class="info-item">
                        <span class="label">Filegroup</span>
                        <span class="value">{{ properties()!.filegroup }}</span>
                      </div>
                      @if (properties()!.hasTextImage) {
                        <div class="info-item">
                          <span class="label">Text/Image Filegroup</span>
                          <span class="value">{{
                            properties()!.textImageOnFilegroup || 'Default'
                          }}</span>
                        </div>
                      }
                    </div>
                  </section>

                  <section class="info-section">
                    <h3>Options</h3>
                    <div class="options-grid">
                      <div class="option-chip" [class.active]="properties()!.hasIdentity">
                        <mat-icon>{{
                          properties()!.hasIdentity ? 'check_circle' : 'cancel'
                        }}</mat-icon>
                        <span>Identity</span>
                      </div>
                      <div class="option-chip" [class.active]="properties()!.isReplicated">
                        <mat-icon>{{
                          properties()!.isReplicated ? 'check_circle' : 'cancel'
                        }}</mat-icon>
                        <span>Replicated</span>
                      </div>
                      <div class="option-chip" [class.active]="properties()!.hasTextImage">
                        <mat-icon>{{
                          properties()!.hasTextImage ? 'check_circle' : 'cancel'
                        }}</mat-icon>
                        <span>Text/Image</span>
                      </div>
                    </div>
                    @if (properties()!.hasIdentity && properties()!.identityColumn) {
                      <div class="identity-info">
                        <div class="info-item">
                          <span class="label">Identity Column</span>
                          <span class="value mono">{{ properties()!.identityColumn }}</span>
                        </div>
                        <div class="info-item">
                          <span class="label">Seed</span>
                          <span class="value mono">{{ properties()!.identitySeed }}</span>
                        </div>
                        <div class="info-item">
                          <span class="label">Increment</span>
                          <span class="value mono">{{ properties()!.identityIncrement }}</span>
                        </div>
                      </div>
                    }
                  </section>
                </div>
              </mat-tab>

              <!-- Columns Tab -->
              <mat-tab>
                <ng-template mat-tab-label>
                  <mat-icon>view_column</mat-icon>
                  Columns
                  <span class="badge">{{ properties()!.columns.length }}</span>
                </ng-template>
                <div class="tab-content scrollable">
                  @for (column of properties()!.columns; track column.name) {
                    <div class="column-card" [class.primary-key]="column.isPrimaryKey">
                      <div class="column-header">
                        <div class="column-name">
                          @if (column.isPrimaryKey) {
                            <mat-icon class="pk-icon" matTooltip="Primary Key">key</mat-icon>
                          }
                          @if (column.isForeignKey) {
                            <mat-icon class="fk-icon" matTooltip="Foreign Key">link</mat-icon>
                          }
                          <span class="name">{{ column.name }}</span>
                        </div>
                        <div class="column-type">
                          <code>{{ formatDataType(column) }}</code>
                        </div>
                      </div>
                      <div class="column-details">
                        <span class="detail" [class.nullable]="column.isNullable">
                          {{ column.isNullable ? 'NULL' : 'NOT NULL' }}
                        </span>
                        @if (column.defaultValue) {
                          <span class="detail default">
                            Default: <code>{{ column.defaultValue }}</code>
                          </span>
                        }
                        @if (getColumnExtendedProperties(column.name).length > 0) {
                          <span class="detail has-docs">
                            <mat-icon>description</mat-icon>
                            {{ getColumnExtendedProperties(column.name).length }} properties
                          </span>
                        }
                      </div>
                      @if (getColumnDescription(column.name)) {
                        <div class="column-description">
                          {{ getColumnDescription(column.name) }}
                        </div>
                      }
                    </div>
                  }
                </div>
              </mat-tab>

              <!-- Indexes Tab -->
              <mat-tab>
                <ng-template mat-tab-label>
                  <mat-icon>format_list_numbered</mat-icon>
                  Indexes
                  <span class="badge">{{ properties()!.indexes.length }}</span>
                </ng-template>
                <div class="tab-content scrollable">
                  @if (properties()!.indexes.length === 0) {
                    <div class="empty-state">
                      <mat-icon>format_list_numbered</mat-icon>
                      <p>No indexes defined</p>
                    </div>
                  } @else {
                    @for (index of properties()!.indexes; track index.name) {
                      <div
                        class="index-card"
                        [class.primary]="index.isPrimaryKey"
                        [class.unique]="index.isUnique"
                      >
                        <div class="index-header">
                          <div class="index-name">
                            @if (index.isPrimaryKey) {
                              <mat-icon class="pk-icon" matTooltip="Primary Key">key</mat-icon>
                            } @else if (index.isUnique) {
                              <mat-icon class="unique-icon" matTooltip="Unique"
                                >fingerprint</mat-icon
                              >
                            } @else {
                              <mat-icon>format_list_numbered</mat-icon>
                            }
                            <span>{{ index.name }}</span>
                          </div>
                          <div class="index-badges">
                            <span class="type-badge">{{ index.type }}</span>
                            @if (index.isUnique && !index.isPrimaryKey) {
                              <span class="unique-badge">Unique</span>
                            }
                          </div>
                        </div>
                        <div class="index-columns">
                          <span class="columns-label">Columns:</span>
                          @for (col of index.columns; track col; let last = $last) {
                            <code>{{ col }}</code
                            >{{ last ? '' : ', ' }}
                          }
                        </div>
                      </div>
                    }
                  }
                </div>
              </mat-tab>

              <!-- Keys & Constraints Tab -->
              <mat-tab>
                <ng-template mat-tab-label>
                  <mat-icon>link</mat-icon>
                  Keys
                  <span class="badge">{{
                    properties()!.foreignKeys.length + properties()!.constraints.length
                  }}</span>
                </ng-template>
                <div class="tab-content scrollable">
                  @if (properties()!.foreignKeys.length > 0) {
                    <h4 class="section-title">
                      <mat-icon>link</mat-icon>
                      Foreign Keys
                    </h4>
                    @for (fk of properties()!.foreignKeys; track fk.name) {
                      <div class="fk-card">
                        <div class="fk-header">
                          <mat-icon>link</mat-icon>
                          <span class="fk-name">{{ fk.name }}</span>
                        </div>
                        <div class="fk-details">
                          <div class="fk-mapping">
                            <div class="fk-source">
                              <span class="label">From</span>
                              <code>{{ fk.columns.join(', ') }}</code>
                            </div>
                            <mat-icon class="arrow">arrow_forward</mat-icon>
                            <div class="fk-target">
                              <span class="label">To</span>
                              <code
                                >{{ fk.referencedSchema }}.{{ fk.referencedTable }}({{
                                  fk.referencedColumns.join(', ')
                                }})</code
                              >
                            </div>
                          </div>
                          <div class="fk-actions">
                            <span class="action">ON DELETE: {{ fk.onDelete || 'NO ACTION' }}</span>
                            <span class="action">ON UPDATE: {{ fk.onUpdate || 'NO ACTION' }}</span>
                          </div>
                        </div>
                      </div>
                    }
                  }

                  @if (properties()!.constraints.length > 0) {
                    <h4 class="section-title">
                      <mat-icon>rule</mat-icon>
                      Constraints
                    </h4>
                    @for (constraint of properties()!.constraints; track constraint.name) {
                      <div class="constraint-card" [attr.data-type]="constraint.type">
                        <div class="constraint-header">
                          <mat-icon>{{ getConstraintIcon(constraint.type) }}</mat-icon>
                          <span class="constraint-name">{{ constraint.name }}</span>
                          <span class="constraint-type">{{ constraint.type }}</span>
                        </div>
                        @if (constraint.columns.length > 0) {
                          <div class="constraint-columns">
                            Columns: <code>{{ constraint.columns.join(', ') }}</code>
                          </div>
                        }
                        @if (constraint.definition) {
                          <div class="constraint-definition">
                            <code>{{ constraint.definition }}</code>
                          </div>
                        }
                      </div>
                    }
                  }

                  @if (
                    properties()!.foreignKeys.length === 0 && properties()!.constraints.length === 0
                  ) {
                    <div class="empty-state">
                      <mat-icon>link_off</mat-icon>
                      <p>No foreign keys or constraints defined</p>
                    </div>
                  }
                </div>
              </mat-tab>

              <!-- Extended Properties Tab -->
              <mat-tab>
                <ng-template mat-tab-label>
                  <mat-icon>description</mat-icon>
                  Documentation
                  <span class="badge">{{ properties()!.extendedProperties.length }}</span>
                </ng-template>
                <div class="tab-content scrollable">
                  @if (properties()!.extendedProperties.length === 0) {
                    <div class="empty-state docs">
                      <mat-icon>description</mat-icon>
                      <h3>No Extended Properties</h3>
                      <p>
                        Extended properties allow you to add documentation directly to database
                        objects.
                      </p>
                      <div class="doc-hint">
                        <h4>How to Add Documentation</h4>
                        <p>Use SQL Server's sp_addextendedproperty stored procedure:</p>
                        <pre><code>-- Add table description
EXEC sp_addextendedproperty
  @name = N'MS_Description',
  @value = N'Your description here',
  @level0type = N'SCHEMA', @level0name = N'{{ properties()!.schema }}',
  @level1type = N'TABLE', @level1name = N'{{ properties()!.name }}';

-- Add column description
EXEC sp_addextendedproperty
  @name = N'MS_Description',
  @value = N'Column description',
  @level0type = N'SCHEMA', @level0name = N'{{ properties()!.schema }}',
  @level1type = N'TABLE', @level1name = N'{{ properties()!.name }}',
  @level2type = N'COLUMN', @level2name = N'ColumnName';</code></pre>
                      </div>
                    </div>
                  } @else {
                    <!-- Table-level properties -->
                    @if (tableExtendedProperties().length > 0) {
                      <h4 class="section-title">
                        <mat-icon>table_chart</mat-icon>
                        Table Properties
                      </h4>
                      @for (prop of tableExtendedProperties(); track prop.name) {
                        <div class="property-card table-level">
                          <div class="property-header">
                            <span class="property-name">{{ prop.name }}</span>
                            @if (prop.name === 'MS_Description') {
                              <mat-icon class="doc-icon" matTooltip="Description property"
                                >info</mat-icon
                              >
                            }
                          </div>
                          <div class="property-value">{{ prop.value }}</div>
                        </div>
                      }
                    }

                    <!-- Column-level properties -->
                    @if (columnExtendedProperties().length > 0) {
                      <h4 class="section-title">
                        <mat-icon>view_column</mat-icon>
                        Column Properties
                      </h4>
                      @for (group of columnPropertyGroups(); track group.column) {
                        <mat-expansion-panel class="column-props-panel">
                          <mat-expansion-panel-header>
                            <mat-panel-title>
                              <code>{{ group.column }}</code>
                            </mat-panel-title>
                            <mat-panel-description>
                              {{ group.properties.length }}
                              {{ group.properties.length === 1 ? 'property' : 'properties' }}
                            </mat-panel-description>
                          </mat-expansion-panel-header>
                          @for (prop of group.properties; track prop.name) {
                            <div class="property-card column-level">
                              <div class="property-header">
                                <span class="property-name">{{ prop.name }}</span>
                              </div>
                              <div class="property-value">{{ prop.value }}</div>
                            </div>
                          }
                        </mat-expansion-panel>
                      }
                    }
                  }
                </div>
              </mat-tab>

              <!-- Triggers Tab -->
              <mat-tab>
                <ng-template mat-tab-label>
                  <mat-icon>bolt</mat-icon>
                  Triggers
                  <span class="badge">{{ properties()!.triggers.length }}</span>
                </ng-template>
                <div class="tab-content scrollable">
                  @if (properties()!.triggers.length === 0) {
                    <div class="empty-state">
                      <mat-icon>bolt</mat-icon>
                      <p>No triggers defined</p>
                    </div>
                  } @else {
                    @for (trigger of properties()!.triggers; track trigger.name) {
                      <div class="trigger-card" [class.disabled]="!trigger.isEnabled">
                        <div class="trigger-header">
                          <mat-icon>bolt</mat-icon>
                          <span class="trigger-name">{{ trigger.name }}</span>
                          <span class="trigger-type">{{ trigger.triggerType.toUpperCase() }}</span>
                          @if (!trigger.isEnabled) {
                            <span class="disabled-badge">Disabled</span>
                          }
                        </div>
                        @if (trigger.createdAt) {
                          <div class="trigger-created">
                            Created: {{ formatDate(trigger.createdAt) }}
                          </div>
                        }
                      </div>
                    }
                  }
                </div>
              </mat-tab>
            </mat-tab-group>
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      .properties-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        z-index: 1000;
        animation: fadeIn 0.2s ease;
      }

      .properties-panel {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 560px;
        max-width: 90vw;
        background-color: var(--bg-secondary);
        border-left: 1px solid var(--border-primary);
        z-index: 1001;
        display: flex;
        flex-direction: column;
        animation: slideIn 0.25s ease;
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
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);
      }

      .header-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
      }

      .table-icon {
        font-size: 32px;
        width: 32px;
        height: 32px;
        color: var(--syntax-type);
      }

      .header-text {
        h2 {
          font-size: var(--font-size-lg);
          font-weight: 600;
          margin: 0;
          font-family: var(--font-mono);
          color: var(--text-primary);
        }
        .subtitle {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
        }
      }

      .loading-state,
      .error-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        color: var(--text-secondary);
        padding: var(--spacing-xl);
        text-align: center;
      }

      .error-state {
        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          color: var(--status-error);
        }
        h3 {
          margin: 0;
          color: var(--text-primary);
        }
        p {
          margin: var(--spacing-sm) 0;
        }
      }

      .panel-content {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      mat-tab-group {
        height: 100%;
        ::ng-deep .mat-mdc-tab-body-wrapper {
          flex: 1;
          overflow: hidden;
        }
        ::ng-deep .mat-mdc-tab-body {
          overflow: hidden;
        }
        ::ng-deep .mat-mdc-tab-body-content {
          height: 100%;
          overflow: hidden;
        }
      }

      ::ng-deep .mat-mdc-tab .mdc-tab__content {
        gap: var(--spacing-xs);
      }

      ::ng-deep .mat-mdc-tab .mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      .badge {
        margin-left: var(--spacing-xs);
        padding: 2px 6px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
        background-color: var(--bg-hover);
        color: var(--text-secondary);
      }

      .tab-content {
        padding: var(--spacing-md);
        height: 100%;
        overflow: hidden;

        &.scrollable {
          overflow-y: auto;
        }
      }

      .info-section {
        margin-bottom: var(--spacing-lg);

        h3 {
          font-size: var(--font-size-md);
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 var(--spacing-md);
          padding-bottom: var(--spacing-xs);
          border-bottom: 1px solid var(--border-primary);
        }
      }

      .info-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-sm) var(--spacing-md);
      }

      .info-item {
        display: flex;
        flex-direction: column;
        gap: 2px;

        .label {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .value {
          font-size: var(--font-size-md);
          color: var(--text-primary);
          &.mono {
            font-family: var(--font-mono);
          }
        }
      }

      .storage-summary {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-md);
      }

      .storage-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        border-radius: var(--radius-md);
        background-color: var(--bg-primary);

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          opacity: 0.7;
        }

        &.data mat-icon {
          color: var(--status-info);
        }
        &.index mat-icon {
          color: var(--syntax-function);
        }
        &.unused mat-icon {
          color: var(--text-muted);
        }
        &.total mat-icon {
          color: var(--syntax-keyword);
        }

        .storage-details {
          display: flex;
          flex-direction: column;
        }
        .storage-label {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
        }
        .storage-value {
          font-size: var(--font-size-md);
          font-weight: 500;
          font-family: var(--font-mono);
          &.highlight {
            color: var(--syntax-keyword);
          }
        }
      }

      .options-grid {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-md);
      }

      .option-chip {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: var(--radius-full);
        font-size: var(--font-size-sm);
        background-color: var(--bg-primary);
        color: var(--text-secondary);

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }

        &.active {
          background-color: var(--status-success);
          background-color: rgba(52, 199, 89, 0.15);
          color: var(--status-success);
        }
      }

      .identity-info {
        display: flex;
        gap: var(--spacing-md);
        padding: var(--spacing-sm);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);
      }

      /* Column cards */
      .column-card {
        padding: var(--spacing-sm) var(--spacing-md);
        margin-bottom: var(--spacing-sm);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);
        border-left: 3px solid transparent;

        &.primary-key {
          border-left-color: var(--syntax-function);
        }
      }

      .column-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-xs);
      }

      .column-name {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-weight: 500;

        .pk-icon {
          color: var(--syntax-function);
          font-size: 16px;
          width: 16px;
          height: 16px;
        }
        .fk-icon {
          color: var(--status-info);
          font-size: 16px;
          width: 16px;
          height: 16px;
        }
      }

      .column-type code {
        font-size: var(--font-size-sm);
        color: var(--syntax-type);
        background-color: var(--bg-tertiary);
        padding: 2px 6px;
        border-radius: var(--radius-sm);
      }

      .column-details {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        font-size: var(--font-size-xs);

        .detail {
          color: var(--text-secondary);
          &.nullable {
            color: var(--text-muted);
          }
          &.default code {
            color: var(--syntax-string);
          }
          &.has-docs {
            display: flex;
            align-items: center;
            gap: 2px;
            color: var(--status-info);
            mat-icon {
              font-size: 14px;
              width: 14px;
              height: 14px;
            }
          }
        }
      }

      .column-description {
        margin-top: var(--spacing-xs);
        padding-top: var(--spacing-xs);
        border-top: 1px dashed var(--border-primary);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        font-style: italic;
      }

      /* Index cards */
      .index-card {
        padding: var(--spacing-sm) var(--spacing-md);
        margin-bottom: var(--spacing-sm);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);
        border-left: 3px solid var(--border-primary);

        &.primary {
          border-left-color: var(--syntax-function);
        }
        &.unique {
          border-left-color: var(--status-info);
        }
      }

      .index-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-xs);

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--text-secondary);
        }
        .pk-icon {
          color: var(--syntax-function);
        }
        .unique-icon {
          color: var(--status-info);
        }
      }

      .index-badges {
        margin-left: auto;
        display: flex;
        gap: var(--spacing-xs);

        span {
          font-size: var(--font-size-xs);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
          background-color: var(--bg-tertiary);
          text-transform: uppercase;
        }
        .unique-badge {
          color: var(--status-info);
        }
      }

      .index-columns {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        code {
          color: var(--syntax-keyword);
        }
      }

      /* Section titles */
      .section-title {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--text-primary);
        margin: var(--spacing-md) 0 var(--spacing-sm);
        text-transform: uppercase;
        letter-spacing: 0.5px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--text-secondary);
        }
      }

      /* Foreign key cards */
      .fk-card {
        padding: var(--spacing-md);
        margin-bottom: var(--spacing-sm);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);
        border-left: 3px solid var(--status-info);
      }

      .fk-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-sm);
        mat-icon {
          color: var(--status-info);
        }
        .fk-name {
          font-weight: 500;
        }
      }

      .fk-mapping {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-sm);
        font-size: var(--font-size-sm);

        .fk-source,
        .fk-target {
          .label {
            color: var(--text-muted);
            font-size: var(--font-size-xs);
          }
          code {
            color: var(--syntax-keyword);
          }
        }
        .arrow {
          color: var(--text-muted);
        }
      }

      .fk-actions {
        display: flex;
        gap: var(--spacing-md);
        font-size: var(--font-size-xs);
        color: var(--text-muted);
      }

      /* Constraint cards */
      .constraint-card {
        padding: var(--spacing-sm) var(--spacing-md);
        margin-bottom: var(--spacing-sm);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);
      }

      .constraint-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--text-secondary);
        }
        .constraint-type {
          margin-left: auto;
          font-size: var(--font-size-xs);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
          background-color: var(--bg-tertiary);
          text-transform: uppercase;
        }
      }

      .constraint-columns,
      .constraint-definition {
        font-size: var(--font-size-sm);
        margin-top: var(--spacing-xs);
        color: var(--text-secondary);
        code {
          color: var(--syntax-keyword);
        }
      }

      /* Trigger cards */
      .trigger-card {
        padding: var(--spacing-sm) var(--spacing-md);
        margin-bottom: var(--spacing-sm);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);

        &.disabled {
          opacity: 0.6;
        }
      }

      .trigger-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        mat-icon {
          color: var(--syntax-function);
        }
        .trigger-type {
          margin-left: auto;
          font-size: var(--font-size-xs);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
          background-color: var(--bg-tertiary);
        }
        .disabled-badge {
          font-size: var(--font-size-xs);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
          background-color: var(--status-warning);
          color: var(--bg-primary);
        }
      }

      .trigger-created {
        font-size: var(--font-size-xs);
        color: var(--text-muted);
        margin-top: var(--spacing-xs);
      }

      /* Extended properties */
      .property-card {
        padding: var(--spacing-sm) var(--spacing-md);
        margin-bottom: var(--spacing-sm);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);

        &.table-level {
          border-left: 3px solid var(--syntax-type);
        }
        &.column-level {
          border-left: 3px solid var(--syntax-function);
        }
      }

      .property-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-xs);
        .property-name {
          font-weight: 500;
          font-family: var(--font-mono);
        }
        .doc-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          color: var(--status-info);
        }
      }

      .property-value {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        white-space: pre-wrap;
      }

      .column-props-panel {
        margin-bottom: var(--spacing-sm);
        ::ng-deep .mat-expansion-panel-body {
          padding: var(--spacing-sm);
        }
      }

      /* Empty state */
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--text-muted);
        text-align: center;

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          opacity: 0.5;
          margin-bottom: var(--spacing-md);
        }

        &.docs {
          h3 {
            color: var(--text-primary);
            margin: 0 0 var(--spacing-sm);
          }
          p {
            margin: 0;
            max-width: 300px;
          }
        }
      }

      .doc-hint {
        margin-top: var(--spacing-lg);
        padding: var(--spacing-md);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);
        text-align: left;
        width: 100%;

        h4 {
          font-size: var(--font-size-sm);
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 var(--spacing-sm);
        }
        p {
          font-size: var(--font-size-sm);
          margin: 0 0 var(--spacing-sm);
        }
        pre {
          margin: 0;
          padding: var(--spacing-sm);
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-sm);
          overflow-x: auto;
          code {
            font-size: var(--font-size-xs);
            color: var(--syntax-keyword);
          }
        }
      }
    `,
  ],
})
export class TablePropertiesPanelComponent {
  private readonly _isOpen = signal(false);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _properties = signal<TableProperties | null>(null);
  private readonly _request = signal<TablePropertiesRequest | null>(null);

  readonly isOpen = this._isOpen.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly properties = this._properties.asReadonly();

  @Output() closed = new EventEmitter<void>();
  @Output() loadRequested = new EventEmitter<TablePropertiesRequest>();

  // Computed properties for extended properties grouping
  readonly tableExtendedProperties = computed(() => {
    const props = this._properties()?.extendedProperties || [];
    return props.filter(p => !p.level2Type);
  });

  readonly columnExtendedProperties = computed(() => {
    const props = this._properties()?.extendedProperties || [];
    return props.filter(p => p.level2Type === 'COLUMN');
  });

  readonly columnPropertyGroups = computed(() => {
    const props = this.columnExtendedProperties();
    const groups = new Map<string, ExtendedProperty[]>();

    for (const prop of props) {
      const column = prop.level2Name || 'Unknown';
      if (!groups.has(column)) {
        groups.set(column, []);
      }
      groups.get(column)!.push(prop);
    }

    return Array.from(groups.entries()).map(([column, properties]) => ({
      column,
      properties,
    }));
  });

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this._isOpen()) {
      this.close();
    }
  }

  open(request: TablePropertiesRequest): void {
    this._request.set(request);
    this._isOpen.set(true);
    this._loading.set(true);
    this._error.set(null);
    this._properties.set(null);
    this.loadRequested.emit(request);
  }

  setProperties(properties: TableProperties): void {
    this._properties.set(properties);
    this._loading.set(false);
    this._error.set(null);
  }

  setError(error: string): void {
    this._error.set(error);
    this._loading.set(false);
    this._properties.set(null);
  }

  close(): void {
    this._isOpen.set(false);
    this.closed.emit();
  }

  retry(): void {
    const request = this._request();
    if (request) {
      this._loading.set(true);
      this._error.set(null);
      this.loadRequested.emit(request);
    }
  }

  formatDate(dateStr?: string): string {
    if (!dateStr) return 'N/A';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  }

  formatNumber(num: number): string {
    return num.toLocaleString();
  }

  formatSize(kb: number): string {
    if (kb < 1024) return `${kb} KB`;
    if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
  }

  formatDataType(column: ColumnInfo): string {
    let type = column.dataType;

    if (
      ['varchar', 'nvarchar', 'char', 'nchar', 'binary', 'varbinary'].includes(type.toLowerCase())
    ) {
      const len = column.maxLength === -1 ? 'MAX' : column.maxLength;
      type += `(${len})`;
    } else if (['decimal', 'numeric'].includes(type.toLowerCase())) {
      type += `(${column.precision}, ${column.scale})`;
    }

    return type;
  }

  getConstraintIcon(type: string): string {
    const icons: Record<string, string> = {
      primary_key: 'key',
      foreign_key: 'link',
      unique: 'fingerprint',
      check: 'rule',
      default: 'edit_note',
    };
    return icons[type] || 'rule';
  }

  getColumnExtendedProperties(columnName: string): ExtendedProperty[] {
    return this.columnExtendedProperties().filter(p => p.level2Name === columnName);
  }

  getColumnDescription(columnName: string): string | null {
    const props = this.getColumnExtendedProperties(columnName);
    const desc = props.find(p => p.name === 'MS_Description');
    return desc?.value || null;
  }
}
