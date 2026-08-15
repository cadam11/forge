/**
 * Schema Diff Dialog
 * Lets user pick two databases and generates a comparison query
 */

import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { ConnectionStateService } from '../../../core/state/connection.state';
import { TabStateService } from '../../../core/state/tab.state';

@Component({
  selector: 'app-schema-diff-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatDividerModule,
  ],
  template: `
    <div class="schema-diff-dialog">
      <h2 mat-dialog-title>
        <mat-icon>compare_arrows</mat-icon>
        <span>Schema Diff</span>
      </h2>

      <mat-dialog-content>
        <p class="description">
          Compare table and column schemas between two databases. This generates a T-SQL comparison
          query in a new tab.
        </p>

        <div class="form-row">
          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Source Database</mat-label>
            <mat-select [(ngModel)]="sourceDb">
              @for (db of databases(); track db) {
                <mat-option [value]="db" [disabled]="db === targetDb">{{ db }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-icon class="arrow-icon">arrow_forward</mat-icon>

          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Target Database</mat-label>
            <mat-select [(ngModel)]="targetDb">
              @for (db of databases(); track db) {
                <mat-option [value]="db" [disabled]="db === sourceDb">{{ db }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <mat-divider />

        <h3>Compare</h3>
        <div class="check-options">
          <label class="option">
            <input type="checkbox" [(ngModel)]="compareTables" />
            <mat-icon>table_chart</mat-icon>
            <span>Tables & Columns</span>
          </label>
          <label class="option">
            <input type="checkbox" [(ngModel)]="compareIndexes" />
            <mat-icon>format_list_numbered</mat-icon>
            <span>Indexes</span>
          </label>
          <label class="option">
            <input type="checkbox" [(ngModel)]="compareProcs" />
            <mat-icon>functions</mat-icon>
            <span>Stored Procedures</span>
          </label>
          <label class="option">
            <input type="checkbox" [(ngModel)]="compareViews" />
            <mat-icon>view_list</mat-icon>
            <span>Views</span>
          </label>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions align="start">
        <button
          mat-flat-button
          color="primary"
          [disabled]="!sourceDb || !targetDb || sourceDb === targetDb"
          (click)="generateDiff()"
        >
          Generate Diff Query
        </button>
        <button mat-button (click)="cancel()">Cancel</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .schema-diff-dialog {
        width: 480px;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: 10px;

        mat-icon {
          color: var(--status-info);
          font-size: 22px;
          width: 22px;
          height: 22px;
        }

        span {
          font-size: 15px;
          font-weight: 600;
        }
      }

      .description {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        margin-bottom: 16px;
        line-height: 1.5;
      }

      .form-row {
        display: flex;
        gap: 12px;
        align-items: center;
      }

      .flex-1 {
        flex: 1;
      }

      .arrow-icon {
        color: var(--text-muted);
        flex-shrink: 0;
      }

      h3 {
        font-size: var(--font-size-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin: 16px 0 12px;
        color: var(--text-secondary);
      }

      .check-options {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: var(--radius-md);
        cursor: pointer;
        font-size: var(--font-size-sm);
        color: var(--text-primary);
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }

        input[type='checkbox'] {
          accent-color: var(--accent-primary);
        }

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          color: var(--text-secondary);
        }
      }

      mat-divider {
        margin: 12px 0 !important;
      }
    `,
  ],
})
export class SchemaDiffDialogComponent implements OnInit {
  private readonly connectionState = inject(ConnectionStateService);
  private readonly tabState = inject(TabStateService);
  private readonly dialogRef = inject(MatDialogRef<SchemaDiffDialogComponent>);

  readonly databases = signal<string[]>([]);

  sourceDb = '';
  targetDb = '';
  compareTables = true;
  compareIndexes = true;
  compareProcs = true;
  compareViews = true;

  ngOnInit(): void {
    const focusId = this.connectionState.focusedConnectionId();
    const dbs = this.connectionState.databasesFor(focusId).map(d => d.name);
    this.databases.set(dbs);

    // Pre-select the focused tab's database as source
    const current = this.connectionState.selectedDatabaseFor(focusId);
    if (current) {
      this.sourceDb = current;
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }

  generateDiff(): void {
    if (!this.sourceDb || !this.targetDb) return;

    const connectionId = this.connectionState.focusedConnectionId();
    if (!connectionId) return;

    const sql = this.buildDiffSql();

    this.tabState.openQueryTab(connectionId, this.sourceDb, sql, true);
    this.dialogRef.close();
  }

  private buildDiffSql(): string {
    const parts: string[] = [];
    parts.push(`-- Schema Diff: [${this.sourceDb}] vs [${this.targetDb}]`);
    parts.push(`-- Generated ${new Date().toLocaleString()}\n`);

    if (this.compareTables) {
      parts.push(`-- ============================================`);
      parts.push(`-- TABLES & COLUMNS DIFF`);
      parts.push(`-- ============================================`);
      parts.push(`
-- Tables only in [${this.sourceDb}]
SELECT '${this.sourceDb} only' AS [Location], s.TABLE_SCHEMA, s.TABLE_NAME
FROM [${this.sourceDb}].INFORMATION_SCHEMA.TABLES s
WHERE s.TABLE_TYPE = 'BASE TABLE'
  AND NOT EXISTS (
    SELECT 1 FROM [${this.targetDb}].INFORMATION_SCHEMA.TABLES t
    WHERE t.TABLE_SCHEMA = s.TABLE_SCHEMA AND t.TABLE_NAME = s.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
  )
UNION ALL
-- Tables only in [${this.targetDb}]
SELECT '${this.targetDb} only', t.TABLE_SCHEMA, t.TABLE_NAME
FROM [${this.targetDb}].INFORMATION_SCHEMA.TABLES t
WHERE t.TABLE_TYPE = 'BASE TABLE'
  AND NOT EXISTS (
    SELECT 1 FROM [${this.sourceDb}].INFORMATION_SCHEMA.TABLES s
    WHERE s.TABLE_SCHEMA = t.TABLE_SCHEMA AND s.TABLE_NAME = t.TABLE_NAME AND s.TABLE_TYPE = 'BASE TABLE'
  )
ORDER BY TABLE_SCHEMA, TABLE_NAME;
`);
      parts.push(`
-- Column differences in shared tables
SELECT
  COALESCE(s.TABLE_SCHEMA, t.TABLE_SCHEMA) AS [Schema],
  COALESCE(s.TABLE_NAME, t.TABLE_NAME) AS [Table],
  COALESCE(s.COLUMN_NAME, t.COLUMN_NAME) AS [Column],
  CASE
    WHEN s.COLUMN_NAME IS NULL THEN '${this.targetDb} only'
    WHEN t.COLUMN_NAME IS NULL THEN '${this.sourceDb} only'
    ELSE 'Type mismatch'
  END AS [Difference],
  s.DATA_TYPE AS [${this.sourceDb}_Type],
  s.CHARACTER_MAXIMUM_LENGTH AS [${this.sourceDb}_MaxLen],
  t.DATA_TYPE AS [${this.targetDb}_Type],
  t.CHARACTER_MAXIMUM_LENGTH AS [${this.targetDb}_MaxLen]
FROM [${this.sourceDb}].INFORMATION_SCHEMA.COLUMNS s
FULL OUTER JOIN [${this.targetDb}].INFORMATION_SCHEMA.COLUMNS t
  ON s.TABLE_SCHEMA = t.TABLE_SCHEMA
  AND s.TABLE_NAME = t.TABLE_NAME
  AND s.COLUMN_NAME = t.COLUMN_NAME
WHERE (s.COLUMN_NAME IS NULL OR t.COLUMN_NAME IS NULL
  OR s.DATA_TYPE <> t.DATA_TYPE
  OR ISNULL(s.CHARACTER_MAXIMUM_LENGTH, 0) <> ISNULL(t.CHARACTER_MAXIMUM_LENGTH, 0))
  -- Only compare tables that exist in both databases
  AND EXISTS (
    SELECT 1 FROM [${this.sourceDb}].INFORMATION_SCHEMA.TABLES st
    WHERE st.TABLE_SCHEMA = COALESCE(s.TABLE_SCHEMA, t.TABLE_SCHEMA)
      AND st.TABLE_NAME = COALESCE(s.TABLE_NAME, t.TABLE_NAME)
  )
  AND EXISTS (
    SELECT 1 FROM [${this.targetDb}].INFORMATION_SCHEMA.TABLES tt
    WHERE tt.TABLE_SCHEMA = COALESCE(s.TABLE_SCHEMA, t.TABLE_SCHEMA)
      AND tt.TABLE_NAME = COALESCE(s.TABLE_NAME, t.TABLE_NAME)
  )
ORDER BY [Schema], [Table], [Column];
`);
    }

    if (this.compareViews) {
      parts.push(`-- ============================================`);
      parts.push(`-- VIEWS DIFF`);
      parts.push(`-- ============================================`);
      parts.push(`
SELECT '${this.sourceDb} only' AS [Location], s.TABLE_SCHEMA, s.TABLE_NAME AS [View_Name]
FROM [${this.sourceDb}].INFORMATION_SCHEMA.VIEWS s
WHERE NOT EXISTS (
  SELECT 1 FROM [${this.targetDb}].INFORMATION_SCHEMA.VIEWS t
  WHERE t.TABLE_SCHEMA = s.TABLE_SCHEMA AND t.TABLE_NAME = s.TABLE_NAME
)
UNION ALL
SELECT '${this.targetDb} only', t.TABLE_SCHEMA, t.TABLE_NAME
FROM [${this.targetDb}].INFORMATION_SCHEMA.VIEWS t
WHERE NOT EXISTS (
  SELECT 1 FROM [${this.sourceDb}].INFORMATION_SCHEMA.VIEWS s
  WHERE s.TABLE_SCHEMA = t.TABLE_SCHEMA AND s.TABLE_NAME = t.TABLE_NAME
)
ORDER BY TABLE_SCHEMA, [View_Name];
`);
    }

    if (this.compareProcs) {
      parts.push(`-- ============================================`);
      parts.push(`-- STORED PROCEDURES DIFF`);
      parts.push(`-- ============================================`);
      parts.push(`
SELECT '${this.sourceDb} only' AS [Location], s.ROUTINE_SCHEMA, s.ROUTINE_NAME
FROM [${this.sourceDb}].INFORMATION_SCHEMA.ROUTINES s
WHERE s.ROUTINE_TYPE = 'PROCEDURE'
  AND NOT EXISTS (
    SELECT 1 FROM [${this.targetDb}].INFORMATION_SCHEMA.ROUTINES t
    WHERE t.ROUTINE_SCHEMA = s.ROUTINE_SCHEMA AND t.ROUTINE_NAME = s.ROUTINE_NAME AND t.ROUTINE_TYPE = 'PROCEDURE'
  )
UNION ALL
SELECT '${this.targetDb} only', t.ROUTINE_SCHEMA, t.ROUTINE_NAME
FROM [${this.targetDb}].INFORMATION_SCHEMA.ROUTINES t
WHERE t.ROUTINE_TYPE = 'PROCEDURE'
  AND NOT EXISTS (
    SELECT 1 FROM [${this.sourceDb}].INFORMATION_SCHEMA.ROUTINES s
    WHERE s.ROUTINE_SCHEMA = t.ROUTINE_SCHEMA AND s.ROUTINE_NAME = t.ROUTINE_NAME AND s.ROUTINE_TYPE = 'PROCEDURE'
  )
ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME;
`);
    }

    if (this.compareIndexes) {
      parts.push(`-- ============================================`);
      parts.push(`-- INDEXES DIFF`);
      parts.push(`-- ============================================`);
      parts.push(`
SELECT '${this.sourceDb} only' AS [Location],
  OBJECT_SCHEMA_NAME(s.object_id, DB_ID('${this.sourceDb}')) AS [Schema],
  OBJECT_NAME(s.object_id, DB_ID('${this.sourceDb}')) AS [Table],
  s.name AS [Index_Name], s.type_desc
FROM [${this.sourceDb}].sys.indexes s
INNER JOIN [${this.sourceDb}].sys.tables st ON s.object_id = st.object_id
WHERE s.name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM [${this.targetDb}].sys.indexes t
    INNER JOIN [${this.targetDb}].sys.tables tt ON t.object_id = tt.object_id
    WHERE t.name = s.name
  )
UNION ALL
SELECT '${this.targetDb} only',
  OBJECT_SCHEMA_NAME(t.object_id, DB_ID('${this.targetDb}')),
  OBJECT_NAME(t.object_id, DB_ID('${this.targetDb}')),
  t.name, t.type_desc
FROM [${this.targetDb}].sys.indexes t
INNER JOIN [${this.targetDb}].sys.tables tt ON t.object_id = tt.object_id
WHERE t.name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM [${this.sourceDb}].sys.indexes s
    INNER JOIN [${this.sourceDb}].sys.tables st ON s.object_id = st.object_id
    WHERE s.name = t.name
  )
ORDER BY [Schema], [Table], [Index_Name];
`);
    }

    return parts.join('\n');
  }
}
