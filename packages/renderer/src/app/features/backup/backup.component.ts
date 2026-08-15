import { Component, inject, signal, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCardModule } from '@angular/material/card';
import { MatStepperModule } from '@angular/material/stepper';
import { firstValueFrom, Subscription } from 'rxjs';
import { IpcService } from '../../core/services/ipc.service';
import { ConnectionStateService } from '../../core/state/connection.state';
import { NotificationService } from '../../core/services/notification.service';
import type { BackupProgress, BackupType, BackupRequest } from '@joinery/shared';

@Component({
  selector: 'app-backup',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatCheckboxModule,
    MatProgressBarModule,
    MatCardModule,
    MatStepperModule,
  ],
  template: `
    <div class="backup-container">
      <div class="backup-header">
        <mat-icon>backup</mat-icon>
        <h1>Backup Database</h1>
      </div>

      <mat-card class="backup-form">
        <mat-card-content>
          <mat-stepper [linear]="true" #stepper>
            <!-- Step 1: Select Database -->
            <mat-step [completed]="!!formData.database">
              <ng-template matStepLabel>Select Database</ng-template>
              <div class="step-content">
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Database</mat-label>
                  <mat-select [(ngModel)]="formData.database">
                    @for (
                      db of connectionState.databasesFor(connectionState.focusedConnectionId());
                      track db.name
                    ) {
                      <mat-option [value]="db.name">{{ db.name }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>

                <div class="step-actions">
                  <button mat-button matStepperNext [disabled]="!formData.database">Next</button>
                </div>
              </div>
            </mat-step>

            <!-- Step 2: Backup Options -->
            <mat-step [completed]="!!formData.backupPath">
              <ng-template matStepLabel>Backup Options</ng-template>
              <div class="step-content">
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Backup Type</mat-label>
                  <mat-select [(ngModel)]="formData.backupType">
                    <mat-option value="full">Full Backup</mat-option>
                    <mat-option value="differential">Differential Backup</mat-option>
                    <mat-option value="log">Transaction Log Backup</mat-option>
                  </mat-select>
                </mat-form-field>

                <div class="path-input">
                  <mat-form-field appearance="outline" class="flex-1">
                    <mat-label>Backup Path</mat-label>
                    <input
                      matInput
                      [(ngModel)]="formData.backupPath"
                      placeholder="/path/to/backup.bak"
                    />
                  </mat-form-field>
                  <button mat-stroked-button (click)="browseBackupPath()">
                    <mat-icon>folder_open</mat-icon>
                    Browse
                  </button>
                </div>

                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Description (optional)</mat-label>
                  <textarea matInput [(ngModel)]="formData.description" rows="2"></textarea>
                </mat-form-field>

                <div class="checkbox-group">
                  <mat-checkbox [(ngModel)]="formData.compression"> Use Compression </mat-checkbox>
                  <mat-checkbox [(ngModel)]="formData.copyOnly"> Copy-Only Backup </mat-checkbox>
                  <mat-checkbox [(ngModel)]="formData.checksum"> Perform Checksum </mat-checkbox>
                </div>

                <div class="step-actions">
                  <button mat-button matStepperPrevious>Back</button>
                  <button mat-button matStepperNext [disabled]="!formData.backupPath">Next</button>
                </div>
              </div>
            </mat-step>

            <!-- Step 3: Review & Execute -->
            <mat-step>
              <ng-template matStepLabel>Review & Execute</ng-template>
              <div class="step-content">
                <div class="review-section">
                  <h3>Backup Summary</h3>
                  <div class="review-item">
                    <span class="label">Database:</span>
                    <span class="value">{{ formData.database }}</span>
                  </div>
                  <div class="review-item">
                    <span class="label">Type:</span>
                    <span class="value">{{ formData.backupType | titlecase }} Backup</span>
                  </div>
                  <div class="review-item">
                    <span class="label">Path:</span>
                    <span class="value mono">{{ formData.backupPath }}</span>
                  </div>
                  @if (formData.description) {
                    <div class="review-item">
                      <span class="label">Description:</span>
                      <span class="value">{{ formData.description }}</span>
                    </div>
                  }
                  <div class="review-item">
                    <span class="label">Options:</span>
                    <span class="value">
                      {{ getOptionsText() }}
                    </span>
                  </div>
                </div>

                <!-- T-SQL Preview -->
                <div class="tsql-preview">
                  <h4>
                    <mat-icon>code</mat-icon>
                    T-SQL Command
                  </h4>
                  <pre>{{ generatedTsql() }}</pre>
                </div>

                @if (backing()) {
                  <div class="progress-section">
                    <div class="progress-header">
                      <span>{{ progress()?.status || 'Preparing...' }}</span>
                      <span>{{ progress()?.percentComplete || 0 }}%</span>
                    </div>
                    <mat-progress-bar
                      mode="determinate"
                      [value]="progress()?.percentComplete || 0"
                    />
                  </div>
                }

                <div class="step-actions">
                  <button mat-button matStepperPrevious [disabled]="backing()">Back</button>
                  <button
                    mat-flat-button
                    color="primary"
                    [disabled]="backing()"
                    (click)="startBackup()"
                  >
                    <mat-icon [class.spinning]="backing()">{{
                      backing() ? 'sync' : 'backup'
                    }}</mat-icon>
                    <span>{{ backing() ? 'Backing Up...' : 'Start Backup' }}</span>
                  </button>
                  @if (backing()) {
                    <button mat-stroked-button color="warn" (click)="cancelBackup()">Cancel</button>
                  }
                </div>
              </div>
            </mat-step>
          </mat-stepper>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .backup-container {
        padding: var(--spacing-lg);
        max-width: 800px;
        margin: 0 auto;
      }

      .backup-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-lg);

        mat-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;
          color: var(--status-info);
        }

        h1 {
          font-size: var(--font-size-xl);
          font-weight: 600;
          margin: 0;
        }
      }

      .backup-form {
        background-color: var(--bg-secondary);
      }

      .step-content {
        padding: var(--spacing-md) 0;
      }

      .full-width {
        width: 100%;
      }

      .path-input {
        display: flex;
        gap: var(--spacing-sm);
        align-items: flex-start;

        .flex-1 {
          flex: 1;
        }

        button {
          margin-top: 4px;
        }
      }

      .checkbox-group {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        margin: var(--spacing-md) 0;
      }

      .step-actions {
        display: flex;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-lg);
        justify-content: flex-end;
      }

      .review-section {
        background-color: var(--bg-tertiary);
        padding: var(--spacing-md);
        border-radius: var(--radius-md);
        margin-bottom: var(--spacing-md);

        h3 {
          font-size: var(--font-size-md);
          font-weight: 600;
          margin: 0 0 var(--spacing-md);
        }
      }

      .review-item {
        display: flex;
        gap: var(--spacing-md);
        padding: var(--spacing-xs) 0;

        .label {
          width: 100px;
          color: var(--text-secondary);
        }

        .value {
          flex: 1;

          &.mono {
            font-family: var(--font-mono);
            font-size: var(--font-size-sm);
          }
        }
      }

      .tsql-preview {
        background-color: var(--bg-tertiary);
        border-radius: var(--radius-md);
        margin-bottom: var(--spacing-md);

        h4 {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          padding: var(--spacing-sm) var(--spacing-md);
          margin: 0;
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border-primary);

          mat-icon {
            font-size: 16px;
            width: 16px;
            height: 16px;
          }
        }

        pre {
          padding: var(--spacing-md);
          margin: 0;
          font-family: var(--font-mono);
          font-size: var(--font-size-sm);
          overflow-x: auto;
          color: var(--syntax-keyword);
        }
      }

      .progress-section {
        margin: var(--spacing-md) 0;

        .progress-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: var(--spacing-xs);
          font-size: var(--font-size-sm);
        }
      }

      .spinning {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class BackupComponent implements OnInit, OnDestroy {
  private readonly ipc = inject(IpcService);
  readonly connectionState = inject(ConnectionStateService);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);

  private progressSubscription?: Subscription;
  private currentBackupId: string | null = null;

  formData = {
    database: '',
    backupType: 'full' as BackupType,
    backupPath: '',
    description: '',
    compression: true,
    copyOnly: false,
    checksum: true,
  };

  backing = signal(false);
  progress = signal<BackupProgress | null>(null);

  ngOnInit(): void {
    // Pre-select the focused tab's database when this dialog opens.
    const selected = this.connectionState.selectedDatabaseFor(
      this.connectionState.focusedConnectionId()
    );
    if (selected) {
      this.formData.database = selected;
    }

    // Subscribe to progress updates
    this.progressSubscription = this.ipc.getBackupProgress().subscribe(p => {
      this.progress.set(p);
      if (p.status === 'completed') {
        this.backing.set(false);
        this.notification.success('Backup completed successfully');
      } else if (p.status === 'failed') {
        this.backing.set(false);
        this.notification.error(p.error || 'Backup failed');
      }
    });
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
  }

  async browseBackupPath(): Promise<void> {
    const result = await firstValueFrom(
      this.ipc.showSaveDialog({
        title: 'Save Backup File',
        defaultPath: `${this.formData.database}_backup.bak`,
        filters: [
          { name: 'Backup Files', extensions: ['bak'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
    );

    if (result && !result.canceled && result.filePath) {
      this.formData.backupPath = result.filePath;
    }
  }

  getOptionsText(): string {
    const options: string[] = [];
    if (this.formData.compression) options.push('Compression');
    if (this.formData.copyOnly) options.push('Copy-Only');
    if (this.formData.checksum) options.push('Checksum');
    return options.length > 0 ? options.join(', ') : 'None';
  }

  generatedTsql(): string {
    const db = this.formData.database;
    const path = this.formData.backupPath;
    const type = this.formData.backupType;

    let sql = '';
    if (type === 'full') {
      sql = `BACKUP DATABASE [${db}]\nTO DISK = N'${path}'`;
    } else if (type === 'differential') {
      sql = `BACKUP DATABASE [${db}]\nTO DISK = N'${path}'\nWITH DIFFERENTIAL`;
    } else {
      sql = `BACKUP LOG [${db}]\nTO DISK = N'${path}'`;
    }

    const options: string[] = [];
    if (this.formData.compression) options.push('COMPRESSION');
    if (this.formData.copyOnly) options.push('COPY_ONLY');
    if (this.formData.checksum) options.push('CHECKSUM');
    if (this.formData.description) {
      options.push(`DESCRIPTION = N'${this.formData.description}'`);
    }

    if (options.length > 0) {
      sql += '\nWITH ' + options.join(', ');
    }

    return sql + ';';
  }

  async startBackup(): Promise<void> {
    const connectionId = this.connectionState.focusedConnectionId();
    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    this.currentBackupId = `backup-${Date.now()}`;
    this.backing.set(true);
    this.progress.set({
      backupId: this.currentBackupId,
      status: 'starting',
      percentComplete: 0,
    });

    const request: BackupRequest = {
      connectionId,
      database: this.formData.database,
      backupPath: this.formData.backupPath,
      backupType: this.formData.backupType,
      compression: this.formData.compression,
      copyOnly: this.formData.copyOnly,
      checksum: this.formData.checksum,
      description: this.formData.description || undefined,
      backupId: this.currentBackupId,
    };

    try {
      await firstValueFrom(this.ipc.startBackup(request));
    } catch (error) {
      this.backing.set(false);
      this.notification.error(error instanceof Error ? error.message : 'Failed to start backup');
    }
  }

  async cancelBackup(): Promise<void> {
    if (this.currentBackupId) {
      await firstValueFrom(this.ipc.cancelBackup(this.currentBackupId));
      this.backing.set(false);
      this.notification.info('Backup cancelled');
    }
  }
}
