/**
 * Create Database Dialog Component
 * Modal dialog for creating a new database
 */

import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { IpcService } from '../../../core/services/ipc.service';
import { NotificationService } from '../../../core/services/notification.service';
import type { RecoveryModel } from '@forgedb/shared';

export interface CreateDatabaseDialogData {
  connectionId: string;
  engine?: 'mssql' | 'postgresql' | 'mysql';
}

@Component({
  selector: 'app-create-database-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="create-dialog">
      <h2 mat-dialog-title>
        <mat-icon>add_circle</mat-icon>
        New Database
      </h2>

      <mat-dialog-content>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Database Name</mat-label>
          <input
            matInput
            [(ngModel)]="dbName"
            [disabled]="creating()"
            placeholder="Enter database name"
            (keydown.enter)="create()"
            cdkFocusInitial
          />
          <mat-hint>
            Use only letters, numbers, and underscores. Name must be unique on the server.
          </mat-hint>
        </mat-form-field>

        @if (data.engine !== 'postgresql' && data.engine !== 'mysql') {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Recovery Model</mat-label>
            <mat-select [(ngModel)]="recoveryModel" [disabled]="creating()">
              <mat-option value="simple">Simple</mat-option>
              <mat-option value="full">Full</mat-option>
              <mat-option value="bulk_logged">Bulk-Logged</mat-option>
            </mat-select>
            <mat-hint> Simple: No log backups needed. Full: Point-in-time recovery. </mat-hint>
          </mat-form-field>
        }

        @if (error()) {
          <div class="error-message">
            <mat-icon>error</mat-icon>
            {{ error() }}
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="start">
        <button
          mat-flat-button
          color="primary"
          [disabled]="!canCreate() || creating()"
          (click)="create()"
        >
          @if (creating()) {
            <mat-spinner diameter="20" />
          } @else {
            <mat-icon>add</mat-icon>
          }
          <span>{{ creating() ? 'Creating...' : 'Create' }}</span>
        </button>
        <button mat-button (click)="cancel()" [disabled]="creating()">Cancel</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .create-dialog {
        min-width: 400px;
        max-width: 500px;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);

        mat-icon {
          color: var(--status-success);
        }
      }

      .full-width {
        width: 100%;
        margin-bottom: var(--spacing-md);
      }

      .error-message {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--status-error-bg, rgba(244, 67, 54, 0.1));
        border-radius: var(--radius-md);
        color: var(--status-error);
        margin-top: var(--spacing-md);

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }

      button mat-spinner {
        display: inline-block;
        margin-right: var(--spacing-xs);
      }
    `,
  ],
})
export class CreateDatabaseDialogComponent {
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);
  readonly dialogRef = inject(MatDialogRef<CreateDatabaseDialogComponent>);
  readonly data: CreateDatabaseDialogData = inject(MAT_DIALOG_DATA);

  dbName = '';
  recoveryModel: RecoveryModel = 'simple';
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);

  canCreate(): boolean {
    const trimmed = this.dbName.trim();
    return trimmed.length > 0 && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed);
  }

  async create(): Promise<void> {
    if (!this.canCreate()) return;

    this.creating.set(true);
    this.error.set(null);

    try {
      const result = await firstValueFrom(
        this.ipc.createDatabase(this.data.connectionId, {
          name: this.dbName.trim(),
          recoveryModel: this.recoveryModel,
        })
      );

      if (result?.success) {
        this.notification.success(`Database "${this.dbName.trim()}" created successfully`);
        this.dialogRef.close({ success: true, databaseName: this.dbName.trim() });
      } else {
        this.error.set(result?.error || 'Failed to create database');
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to create database');
    } finally {
      this.creating.set(false);
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
