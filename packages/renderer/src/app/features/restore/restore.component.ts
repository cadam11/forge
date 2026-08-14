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
import { MatTableModule } from '@angular/material/table';
import { firstValueFrom, Subscription } from 'rxjs';
import { IpcService } from '../../core/services/ipc.service';
import { ConnectionStateService } from '../../core/state/connection.state';
import { NotificationService } from '../../core/services/notification.service';
import type { RestoreProgress, RestoreRequest } from '@forgedb/shared';

interface FileMapping {
  logicalName: string;
  physicalName: string;
  type: string;
  newPath: string;
}

@Component({
  selector: 'app-restore',
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
    MatTableModule,
  ],
  template: `
    <div class="restore-container">
      <div class="restore-header">
        <mat-icon>restore</mat-icon>
        <h1>Restore Database</h1>
      </div>

      <mat-card class="restore-form">
        <mat-card-content>
          <mat-stepper [linear]="true" #stepper>
            <!-- Step 1: Select Backup File -->
            <mat-step [completed]="!!formData.backupPath && fileMappings.length > 0">
              <ng-template matStepLabel>Select Backup</ng-template>
              <div class="step-content">
                <div class="path-input">
                  <mat-form-field appearance="outline" class="flex-1">
                    <mat-label>Backup File Path</mat-label>
                    <input
                      matInput
                      [(ngModel)]="formData.backupPath"
                      placeholder="/path/to/backup.bak"
                    />
                  </mat-form-field>
                  <button mat-stroked-button (click)="browseBackupFile()">
                    <mat-icon>folder_open</mat-icon>
                    Browse
                  </button>
                </div>

                <div class="step-actions">
                  <button
                    mat-stroked-button
                    color="primary"
                    [disabled]="!formData.backupPath || loadingFiles()"
                    (click)="loadBackupInfo()"
                  >
                    @if (loadingFiles()) {
                      <mat-icon class="spinning">sync</mat-icon>
                    }
                    Read Backup Info
                  </button>
                  <button mat-button matStepperNext [disabled]="fileMappings.length === 0">
                    Next
                  </button>
                </div>

                @if (fileMappings.length > 0) {
                  <div class="backup-info">
                    <h4>Backup Contents</h4>
                    <table mat-table [dataSource]="fileMappings" class="file-table">
                      <ng-container matColumnDef="logicalName">
                        <th mat-header-cell *matHeaderCellDef>Logical Name</th>
                        <td mat-cell *matCellDef="let file">{{ file.logicalName }}</td>
                      </ng-container>
                      <ng-container matColumnDef="type">
                        <th mat-header-cell *matHeaderCellDef>Type</th>
                        <td mat-cell *matCellDef="let file">{{ file.type }}</td>
                      </ng-container>
                      <ng-container matColumnDef="physicalName">
                        <th mat-header-cell *matHeaderCellDef>Original Path</th>
                        <td mat-cell *matCellDef="let file" class="mono">
                          {{ file.physicalName }}
                        </td>
                      </ng-container>
                      <tr
                        mat-header-row
                        *matHeaderRowDef="['logicalName', 'type', 'physicalName']"
                      ></tr>
                      <tr
                        mat-row
                        *matRowDef="let row; columns: ['logicalName', 'type', 'physicalName']"
                      ></tr>
                    </table>
                  </div>
                }
              </div>
            </mat-step>

            <!-- Step 2: Configure Restore -->
            <mat-step [completed]="!!formData.targetDatabase">
              <ng-template matStepLabel>Configure Restore</ng-template>
              <div class="step-content">
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Target Database Name</mat-label>
                  <input
                    matInput
                    [(ngModel)]="formData.targetDatabase"
                    placeholder="DatabaseName"
                  />
                  <mat-hint>Enter a new name or select an existing database to overwrite</mat-hint>
                </mat-form-field>

                <h4>File Locations</h4>
                <p class="hint">Specify where to restore each file:</p>

                @for (file of fileMappings; track file.logicalName) {
                  <div class="file-mapping">
                    <span class="file-label">
                      <mat-icon>{{ file.type === 'D' ? 'storage' : 'description' }}</mat-icon>
                      {{ file.logicalName }}
                    </span>
                    <div class="path-input">
                      <mat-form-field appearance="outline" class="flex-1">
                        <input matInput [(ngModel)]="file.newPath" />
                      </mat-form-field>
                      <button mat-icon-button (click)="browseFilePath(file)">
                        <mat-icon>folder_open</mat-icon>
                      </button>
                    </div>
                  </div>
                }

                <div class="checkbox-group">
                  <mat-checkbox [(ngModel)]="formData.replaceExisting">
                    Replace existing database (WITH REPLACE)
                  </mat-checkbox>
                  <mat-checkbox [(ngModel)]="formData.recoveryState" [value]="'RECOVERY'">
                    Complete recovery (RESTORE WITH RECOVERY)
                  </mat-checkbox>
                </div>

                <div class="step-actions">
                  <button mat-button matStepperPrevious>Back</button>
                  <button mat-button matStepperNext [disabled]="!formData.targetDatabase">
                    Next
                  </button>
                </div>
              </div>
            </mat-step>

            <!-- Step 3: Review & Execute -->
            <mat-step>
              <ng-template matStepLabel>Review & Execute</ng-template>
              <div class="step-content">
                <div class="review-section">
                  <h3>Restore Summary</h3>
                  <div class="review-item">
                    <span class="label">Source:</span>
                    <span class="value mono">{{ formData.backupPath }}</span>
                  </div>
                  <div class="review-item">
                    <span class="label">Target:</span>
                    <span class="value">{{ formData.targetDatabase }}</span>
                  </div>
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

                @if (restoring()) {
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

                <div class="warning-box">
                  <mat-icon>warning</mat-icon>
                  <div>
                    <strong>Warning:</strong> This operation will restore the database.
                    @if (formData.replaceExisting) {
                      The existing database will be overwritten.
                    }
                    Make sure you have a recent backup before proceeding.
                  </div>
                </div>

                <div class="step-actions">
                  <button mat-button matStepperPrevious [disabled]="restoring()">Back</button>
                  <button
                    mat-flat-button
                    color="primary"
                    [disabled]="restoring()"
                    (click)="startRestore()"
                  >
                    <mat-icon [class.spinning]="restoring()">{{
                      restoring() ? 'sync' : 'restore'
                    }}</mat-icon>
                    <span>{{ restoring() ? 'Restoring...' : 'Start Restore' }}</span>
                  </button>
                  @if (restoring()) {
                    <button mat-stroked-button color="warn" (click)="cancelRestore()">
                      Cancel
                    </button>
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
      .restore-container {
        padding: var(--spacing-lg);
        max-width: 900px;
        margin: 0 auto;
      }

      .restore-header {
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

      .restore-form {
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
      }

      .backup-info {
        margin-top: var(--spacing-md);
        padding: var(--spacing-md);
        background-color: var(--bg-tertiary);
        border-radius: var(--radius-md);

        h4 {
          margin: 0 0 var(--spacing-sm);
          font-size: var(--font-size-md);
        }
      }

      .file-table {
        width: 100%;
        background: transparent;

        .mono {
          font-family: var(--font-mono);
          font-size: var(--font-size-xs);
        }
      }

      h4 {
        font-size: var(--font-size-md);
        font-weight: 600;
        margin: var(--spacing-lg) 0 var(--spacing-sm);
      }

      .hint {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        margin-bottom: var(--spacing-md);
      }

      .file-mapping {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        margin-bottom: var(--spacing-md);
        padding: var(--spacing-sm);
        background-color: var(--bg-tertiary);
        border-radius: var(--radius-md);

        .file-label {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          font-weight: 500;
          font-size: var(--font-size-sm);

          mat-icon {
            font-size: 16px;
            width: 16px;
            height: 16px;
            color: var(--text-secondary);
          }
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
          width: 80px;
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
          white-space: pre-wrap;
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

      .warning-box {
        display: flex;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background-color: rgba(255, 152, 0, 0.1);
        border-left: 3px solid var(--status-warning);
        border-radius: var(--radius-sm);
        margin: var(--spacing-md) 0;

        mat-icon {
          color: var(--status-warning);
        }

        strong {
          color: var(--status-warning);
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
export class RestoreComponent implements OnInit, OnDestroy {
  private readonly ipc = inject(IpcService);
  readonly connectionState = inject(ConnectionStateService);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);

  private progressSubscription?: Subscription;
  private currentRestoreId: string | null = null;

  formData = {
    backupPath: '',
    targetDatabase: '',
    replaceExisting: false,
    recoveryState: 'RECOVERY',
  };

  fileMappings: FileMapping[] = [];
  loadingFiles = signal(false);
  restoring = signal(false);
  progress = signal<RestoreProgress | null>(null);

  ngOnInit(): void {
    this.progressSubscription = this.ipc.getRestoreProgress().subscribe(p => {
      this.progress.set(p);
      if (p.status === 'completed') {
        this.restoring.set(false);
        this.notification.success('Restore completed successfully');
        const focusId = this.connectionState.focusedConnectionId();
        if (focusId) this.connectionState.loadDatabases(focusId);
      } else if (p.status === 'failed') {
        this.restoring.set(false);
        this.notification.error(p.error || 'Restore failed');
      }
    });
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
  }

  async browseBackupFile(): Promise<void> {
    const result = await firstValueFrom(
      this.ipc.showOpenDialog({
        title: 'Select Backup File',
        properties: ['openFile'],
        filters: [
          { name: 'Backup Files', extensions: ['bak'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
    );

    if (result && !result.canceled && result.filePaths?.[0]) {
      this.formData.backupPath = result.filePaths[0];
    }
  }

  async browseFilePath(file: FileMapping): Promise<void> {
    const isLog = file.type === 'L';
    const result = await firstValueFrom(
      this.ipc.showSaveDialog({
        title: `Select Location for ${file.logicalName}`,
        defaultPath: file.newPath,
        filters: [
          {
            name: isLog ? 'Log Files' : 'Data Files',
            extensions: [isLog ? 'ldf' : 'mdf'],
          },
        ],
      })
    );

    if (result && !result.canceled && result.filePath) {
      file.newPath = result.filePath;
    }
  }

  async loadBackupInfo(): Promise<void> {
    const connectionId = this.connectionState.focusedConnectionId();
    if (!connectionId || !this.formData.backupPath) return;

    this.loadingFiles.set(true);
    try {
      const files = await firstValueFrom(
        this.ipc.getRestoreFileList(connectionId, this.formData.backupPath)
      );

      this.fileMappings =
        files?.map(f => ({
          ...f,
          newPath: f.physicalName, // Default to original path
        })) ?? [];

      // Try to extract database name from backup
      if (this.fileMappings.length > 0 && !this.formData.targetDatabase) {
        const dataFile = this.fileMappings.find(f => f.type === 'D');
        if (dataFile) {
          this.formData.targetDatabase = dataFile.logicalName;
        }
      }
    } catch (error) {
      this.notification.error('Failed to read backup file');
      console.error(error);
    } finally {
      this.loadingFiles.set(false);
    }
  }

  getOptionsText(): string {
    const options: string[] = [];
    if (this.formData.replaceExisting) options.push('Replace Existing');
    options.push(this.formData.recoveryState === 'RECOVERY' ? 'With Recovery' : 'No Recovery');
    return options.join(', ');
  }

  generatedTsql(): string {
    const db = this.formData.targetDatabase;
    const path = this.formData.backupPath;

    let sql = `RESTORE DATABASE [${db}]\nFROM DISK = N'${path}'\nWITH `;

    const options: string[] = [];

    // File relocations
    for (const file of this.fileMappings) {
      if (file.newPath !== file.physicalName) {
        options.push(`MOVE N'${file.logicalName}' TO N'${file.newPath}'`);
      }
    }

    if (this.formData.replaceExisting) {
      options.push('REPLACE');
    }

    options.push(this.formData.recoveryState);
    options.push('STATS = 10');

    sql += options.join(',\n     ');
    return sql + ';';
  }

  async startRestore(): Promise<void> {
    const connectionId = this.connectionState.focusedConnectionId();
    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    this.currentRestoreId = `restore-${Date.now()}`;
    this.restoring.set(true);
    this.progress.set({
      restoreId: this.currentRestoreId,
      status: 'starting',
      percentComplete: 0,
    });

    const fileRelocations = this.fileMappings
      .filter(f => f.newPath !== f.physicalName)
      .map(f => ({
        logicalName: f.logicalName,
        physicalName: f.newPath,
      }));

    const request: RestoreRequest = {
      connectionId,
      backupPath: this.formData.backupPath,
      targetDatabase: this.formData.targetDatabase,
      fileRelocations,
      replaceExisting: this.formData.replaceExisting,
      recoveryState: this.formData.recoveryState as 'RECOVERY' | 'NORECOVERY',
      restoreId: this.currentRestoreId,
    };

    try {
      await firstValueFrom(this.ipc.startRestore(request));
    } catch (error) {
      this.restoring.set(false);
      this.notification.error(error instanceof Error ? error.message : 'Failed to start restore');
    }
  }

  async cancelRestore(): Promise<void> {
    if (this.currentRestoreId) {
      await firstValueFrom(this.ipc.cancelRestore(this.currentRestoreId));
      this.restoring.set(false);
      this.notification.info('Restore cancelled');
    }
  }
}
