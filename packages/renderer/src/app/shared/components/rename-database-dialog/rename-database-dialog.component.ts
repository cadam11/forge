/**
 * Rename Database Dialog Component
 * Simple modal dialog for renaming a database
 */

import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { IpcService } from '../../../core/services/ipc.service';
import { NotificationService } from '../../../core/services/notification.service';

export interface RenameDatabaseDialogData {
  connectionId: string;
  databaseName: string;
}

@Component({
  selector: 'app-rename-database-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="rename-dialog">
      <h2 mat-dialog-title>
        <mat-icon>edit</mat-icon>
        Rename Database
      </h2>

      <mat-dialog-content>
        <div class="info-row">
          <span class="label">Current name:</span>
          <span class="value">{{ data.databaseName }}</span>
        </div>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>New Database Name</mat-label>
          <input
            matInput
            [(ngModel)]="newName"
            [disabled]="renaming()"
            placeholder="Enter new database name"
            (keydown.enter)="rename()"
            cdkFocusInitial
          />
          <mat-hint>
            Use only letters, numbers, and underscores. Name must be unique on the server.
          </mat-hint>
        </mat-form-field>

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
          [disabled]="!canRename() || renaming()"
          (click)="rename()"
        >
          @if (renaming()) {
            <mat-spinner diameter="20" />
          } @else {
            <mat-icon>check</mat-icon>
          }
          <span>{{ renaming() ? 'Renaming...' : 'Rename' }}</span>
        </button>
        <button mat-button (click)="cancel()" [disabled]="renaming()">Cancel</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .rename-dialog {
        min-width: 400px;
        max-width: 500px;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);

        mat-icon {
          color: var(--status-info);
        }
      }

      .info-row {
        display: flex;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-tertiary);
        border-radius: var(--radius-md);
        margin-bottom: var(--spacing-md);

        .label {
          color: var(--text-secondary);
        }

        .value {
          font-weight: 500;
          font-family: var(--font-mono);
        }
      }

      .full-width {
        width: 100%;
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
export class RenameDatabaseDialogComponent {
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);
  readonly dialogRef = inject(MatDialogRef<RenameDatabaseDialogComponent>);
  readonly data: RenameDatabaseDialogData = inject(MAT_DIALOG_DATA);

  newName = '';
  readonly renaming = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    // Pre-fill with current name
    this.newName = this.data.databaseName;
  }

  canRename(): boolean {
    const trimmed = this.newName.trim();
    return (
      trimmed.length > 0 &&
      trimmed !== this.data.databaseName &&
      /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)
    );
  }

  async rename(): Promise<void> {
    if (!this.canRename()) return;

    this.renaming.set(true);
    this.error.set(null);

    try {
      const result = await firstValueFrom(
        this.ipc.renameDatabase(this.data.connectionId, {
          currentName: this.data.databaseName,
          newName: this.newName.trim(),
        })
      );

      if (result?.success) {
        this.notification.success(`Database renamed to "${this.newName.trim()}"`);
        this.dialogRef.close({ success: true, newName: this.newName.trim() });
      } else {
        this.error.set(result?.error || 'Failed to rename database');
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to rename database');
    } finally {
      this.renaming.set(false);
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
