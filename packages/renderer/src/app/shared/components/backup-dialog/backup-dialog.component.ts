/**
 * Backup Database Dialog Component
 * Modal dialog for backing up a database with server-side file browsing
 */

import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA,
  MatDialog,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { firstValueFrom, Subscription } from 'rxjs';
import { IpcService } from '../../../core/services/ipc.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  ServerFileBrowserComponent,
  ServerFileBrowserDialogData,
} from '../server-file-browser/server-file-browser.component';
import { MissingCliToolsComponent } from '../missing-cli-tools/missing-cli-tools.component';
import type {
  BackupRequest,
  BackupType,
  BackupProgress,
  BackupHistoryEntry,
  CliDepsResult,
  CliEngine,
} from '@forgedb/shared';

export interface BackupDialogData {
  connectionId: string;
  databaseName: string;
  engine?: 'mssql' | 'postgresql' | 'mysql';
}

@Component({
  selector: 'app-backup-dialog',
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
    MatCheckboxModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatExpansionModule,
    MissingCliToolsComponent,
  ],
  template: `
    <div class="backup-dialog">
      <h2 mat-dialog-title>
        <mat-icon>backup</mat-icon>
        <span>Backup Database: {{ data.databaseName }}</span>
      </h2>

      <mat-dialog-content>
        @if (checkingTools()) {
          <div class="checking-tools" data-testid="backup-tools-checking">
            <mat-spinner diameter="20" />
            <span>Checking for required CLI tools…</span>
          </div>
        } @else if (showMissingTools()) {
          <app-missing-cli-tools
            [instructions]="toolsCheck()!.installInstructions!"
            [tools]="toolsCheck()!.tools"
            [rechecking]="rechecking()"
            (recheck)="recheckTools()"
            (copyCommand)="copyToClipboard($event)"
            (openLink)="openExternalLink($event)"
          />
        } @else {
          <div class="form-grid">
            <!-- Backup Type -->
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>{{
                data.engine === 'postgresql'
                  ? 'Dump Format'
                  : data.engine === 'mysql'
                    ? 'Dump Format'
                    : 'Backup Type'
              }}</mat-label>
              @if (data.engine === 'postgresql') {
                <mat-select [(ngModel)]="formData.backupType" [disabled]="backing()">
                  <mat-option value="full">Custom (compressed, pg_restore)</mat-option>
                  <mat-option value="differential">Plain SQL (readable text)</mat-option>
                  <mat-option value="log">Directory (parallel dump)</mat-option>
                </mat-select>
              } @else if (data.engine === 'mysql') {
                <mat-select [(ngModel)]="formData.backupType" [disabled]="backing()">
                  <mat-option value="full">SQL dump (mysqldump)</mat-option>
                </mat-select>
              } @else {
                <mat-select [(ngModel)]="formData.backupType" [disabled]="backing()">
                  <mat-option value="full">Full Backup</mat-option>
                  <mat-option value="differential">Differential Backup</mat-option>
                  <mat-option value="log">Transaction Log Backup</mat-option>
                </mat-select>
              }
            </mat-form-field>

            <!-- Backup Path -->
            <div class="path-row">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="flex-1">
                <mat-label>{{
                  data.engine === 'mssql'
                    ? 'Backup Path (on SQL Server)'
                    : 'Backup File Path (local)'
                }}</mat-label>
                <input
                  matInput
                  [(ngModel)]="formData.backupPath"
                  [disabled]="backing()"
                  [placeholder]="
                    data.engine === 'postgresql'
                      ? 'e.g., /tmp/mydb.dump'
                      : data.engine === 'mysql'
                        ? 'e.g., /tmp/mydb.sql'
                        : 'e.g., /var/opt/mssql/backup/db.bak'
                  "
                />
              </mat-form-field>
              @if (data.engine === 'mssql' || !data.engine) {
                <button
                  mat-icon-button
                  [disabled]="backing()"
                  (click)="browseBackupPath()"
                  matTooltip="Browse server"
                >
                  <mat-icon>folder_open</mat-icon>
                </button>
              }
            </div>

            <!-- Options (MSSQL only — mysqldump/pg_dump handle these differently) -->
            @if (data.engine === 'mssql' || !data.engine) {
              <div class="options-row">
                <mat-checkbox [(ngModel)]="formData.compression" [disabled]="backing()"
                  >Compression</mat-checkbox
                >
                <mat-checkbox [(ngModel)]="formData.copyOnly" [disabled]="backing()"
                  >Copy-Only</mat-checkbox
                >
                <mat-checkbox [(ngModel)]="formData.checksum" [disabled]="backing()"
                  >Checksum</mat-checkbox
                >
              </div>

              <!-- Description -->
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>Description (optional)</mat-label>
                <input matInput [(ngModel)]="formData.description" [disabled]="backing()" />
              </mat-form-field>
            }
          </div>

          <!-- Progress -->
          @if (backing()) {
            <div class="progress-section">
              <div class="progress-header">
                <span>{{ progress()?.currentPhase || 'Starting backup...' }}</span>
                @if ((progress()?.percentComplete ?? 0) >= 0) {
                  <span>{{ progress()?.percentComplete || 0 }}%</span>
                }
              </div>
              <mat-progress-bar
                [mode]="(progress()?.percentComplete ?? 0) < 0 ? 'indeterminate' : 'determinate'"
                [value]="
                  (progress()?.percentComplete ?? 0) < 0 ? 0 : progress()?.percentComplete || 0
                "
              />
            </div>
          }

          <!-- Expandable panels (MSSQL only) -->
          @if (data.engine === 'mssql' || !data.engine) {
            <mat-accordion class="panels">
              <mat-expansion-panel>
                <mat-expansion-panel-header>
                  <mat-panel-title><mat-icon>code</mat-icon>T-SQL Preview</mat-panel-title>
                </mat-expansion-panel-header>
                <pre class="tsql-code">{{ generatedTsql() }}</pre>
              </mat-expansion-panel>

              <mat-expansion-panel>
                <mat-expansion-panel-header>
                  <mat-panel-title><mat-icon>history</mat-icon>Backup History</mat-panel-title>
                </mat-expansion-panel-header>
                <div class="history-list">
                  @if (loadingHistory()) {
                    <div class="empty-text">Loading...</div>
                  } @else if (backupHistory().length === 0) {
                    <div class="empty-text">No backup history</div>
                  } @else {
                    @for (entry of backupHistory(); track entry.backupStartDate) {
                      <div class="history-item">
                        <div class="history-main">
                          <span class="history-type">{{ entry.backupType }}</span>
                          <span class="history-date">{{
                            entry.backupFinishDate | date: 'short'
                          }}</span>
                        </div>
                        <div class="history-details">
                          <span class="history-path">{{ entry.physicalDeviceName }}</span>
                          <span class="history-size">{{ formatBytes(entry.backupSizeBytes) }}</span>
                        </div>
                      </div>
                    }
                  }
                </div>
              </mat-expansion-panel>
            </mat-accordion>
          }
        }
      </mat-dialog-content>

      <mat-dialog-actions align="start">
        @if (!checkingTools() && !showMissingTools()) {
          <button
            mat-flat-button
            color="primary"
            [disabled]="!canBackup() || backing()"
            (click)="startBackup()"
          >
            <mat-icon>{{ backing() ? 'sync' : 'backup' }}</mat-icon>
            <span>{{ backing() ? 'Backing Up...' : 'Start Backup' }}</span>
          </button>
        }
        <button mat-button (click)="cancel()" [disabled]="backing()">
          {{ checkingTools() || showMissingTools() ? 'Close' : 'Cancel' }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .backup-dialog {
        overflow: hidden;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 0;

        mat-icon {
          color: var(--status-info);
        }
      }

      mat-dialog-content {
        padding-top: 16px;
        overflow-x: hidden !important;
      }

      .form-grid {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .path-row {
        display: flex;
        gap: 8px;
        align-items: center;

        .flex-1 {
          flex: 1;
        }
      }

      .options-row {
        display: flex;
        gap: 24px;
        padding: 12px 16px;
        background-color: var(--bg-tertiary);
        border-radius: 6px;
      }

      .progress-section {
        margin: 16px 0;
        padding: 12px;
        background-color: var(--bg-tertiary);
        border-radius: 6px;

        .progress-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
          font-size: 13px;
        }
      }

      .panels {
        margin-top: 16px;

        mat-panel-title {
          display: flex;
          align-items: center;
          gap: 8px;

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
          }
        }
      }

      .tsql-code {
        font-family: var(--font-mono);
        font-size: 12px;
        padding: 12px;
        background-color: var(--bg-primary);
        border-radius: 4px;
        overflow-x: auto;
        margin: 0;
        white-space: pre-wrap;
      }

      .history-list {
        max-height: 150px;
        overflow-y: auto;
      }

      .history-item {
        padding: 8px 0;
        border-bottom: 1px solid var(--border-primary);

        &:last-child {
          border-bottom: none;
        }
      }

      .history-main {
        display: flex;
        justify-content: space-between;
        margin-bottom: 4px;
      }

      .history-type {
        font-weight: 500;
        font-size: 13px;
      }

      .history-date {
        font-size: 12px;
        color: var(--text-secondary);
      }

      .history-details {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: var(--text-muted);
      }

      .history-path {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--font-mono);
      }

      .empty-text {
        padding: 16px;
        text-align: center;
        color: var(--text-muted);
        font-size: 13px;
      }

      .checking-tools {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 24px 0;
        color: var(--text-secondary);
        font-size: 13px;
      }

      button mat-icon {
        &.spinning {
          animation: spin 1s linear infinite;
        }
      }

      mat-dialog-actions button mat-icon + span {
        margin-left: 4px;
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
export class BackupDialogComponent implements OnInit, OnDestroy {
  private readonly ipc = inject(IpcService);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  readonly dialogRef = inject(MatDialogRef<BackupDialogComponent>);
  readonly data: BackupDialogData = inject(MAT_DIALOG_DATA);

  private progressSubscription?: Subscription;

  formData = {
    backupType: 'full' as BackupType,
    backupPath: '',
    description: '',
    compression: true,
    copyOnly: false,
    checksum: true,
  };

  readonly backing = signal(false);
  readonly progress = signal<BackupProgress | null>(null);
  readonly backupHistory = signal<BackupHistoryEntry[]>([]);
  readonly loadingHistory = signal(false);

  // CLI dependency probe state. Only relevant for engines that shell out
  // to host-installed CLI tools (PG and MySQL today). MSSQL uses T-SQL
  // BACKUP DATABASE so the deps check is skipped — `checkingTools` stays
  // false and `showMissingTools` always returns false for MSSQL.
  readonly toolsCheck = signal<CliDepsResult | null>(null);
  readonly checkingTools = signal(false);
  readonly rechecking = signal(false);
  readonly showMissingTools = computed(() => {
    const result = this.toolsCheck();
    return result !== null && !result.allAvailable;
  });

  readonly generatedTsql = computed(() => {
    const db = this.data.databaseName;
    const path = this.formData.backupPath || '<path>';
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
      if (type === 'differential') {
        sql += ', ' + options.join(', ');
      } else {
        sql += '\nWITH ' + options.join(', ');
      }
    }

    return sql + ';';
  });

  ngOnInit(): void {
    this.checkCliTools();
    this.loadDefaultPath();
    this.loadBackupHistory();

    this.progressSubscription = this.ipc.getBackupProgress().subscribe(p => {
      this.progress.set(p);
      if (p.status === 'completed') {
        this.backing.set(false);
        this.notification.success('Backup completed successfully');
        this.dialogRef.close({ success: true, path: this.formData.backupPath });
      } else if (p.status === 'failed') {
        this.backing.set(false);
        this.notification.error(p.error || 'Backup failed');
      }
    });
  }

  private async checkCliTools(): Promise<void> {
    const cliEngine = this.cliEngineFor(this.data.engine);
    if (!cliEngine) return;

    this.checkingTools.set(true);
    try {
      const result = await firstValueFrom(this.ipc.checkBackupTools(cliEngine));
      this.toolsCheck.set(result);
    } catch (err) {
      this.notification.error(
        err instanceof Error ? err.message : 'Failed to probe backup CLI tools'
      );
    } finally {
      this.checkingTools.set(false);
    }
  }

  async recheckTools(): Promise<void> {
    const cliEngine = this.cliEngineFor(this.data.engine);
    if (!cliEngine) return;

    this.rechecking.set(true);
    try {
      const result = await firstValueFrom(this.ipc.recheckBackupTools(cliEngine));
      this.toolsCheck.set(result);
      if (result.allAvailable) {
        this.notification.success('Required CLI tools are now available');
      }
    } catch (err) {
      this.notification.error(
        err instanceof Error ? err.message : 'Failed to re-check backup CLI tools'
      );
    } finally {
      this.rechecking.set(false);
    }
  }

  private cliEngineFor(engine: BackupDialogData['engine']): CliEngine | null {
    if (engine === 'postgresql' || engine === 'mysql') return engine;
    return null;
  }

  async copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.notification.success('Copied to clipboard');
    } catch (err) {
      this.notification.error(err instanceof Error ? err.message : 'Could not copy to clipboard');
    }
  }

  openExternalLink(url: string): void {
    this.ipc.openExternal(url).subscribe({
      error: err => {
        this.notification.error(err instanceof Error ? err.message : 'Could not open link');
      },
    });
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
  }

  private async loadDefaultPath(): Promise<void> {
    try {
      const paths = await firstValueFrom(this.ipc.getServerDefaultPaths(this.data.connectionId));
      if (paths?.backupPath) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        this.formData.backupPath = `${paths.backupPath}${this.data.databaseName}_${timestamp}.bak`;
      }
    } catch {
      // Ignore errors
    }
  }

  private async loadBackupHistory(): Promise<void> {
    this.loadingHistory.set(true);
    try {
      const history = await firstValueFrom(
        this.ipc.getBackupHistory(this.data.connectionId, this.data.databaseName)
      );
      this.backupHistory.set(history || []);
    } catch {
      // Ignore errors
    } finally {
      this.loadingHistory.set(false);
    }
  }

  browseBackupPath(): void {
    const dialogData: ServerFileBrowserDialogData = {
      connectionId: this.data.connectionId,
      title: 'Select Backup Location',
      mode: 'save',
      initialPath: this.getDirectoryFromPath(this.formData.backupPath),
      fileFilter: '.bak',
      defaultFileName: `${this.data.databaseName}_backup.bak`,
    };

    const dialogRef = this.dialog.open(ServerFileBrowserComponent, {
      data: dialogData,
      width: '600px',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.path) {
        this.formData.backupPath = result.path;
      }
    });
  }

  private getDirectoryFromPath(path: string): string {
    if (!path) return '';
    const lastSlash = path.lastIndexOf('\\');
    return lastSlash > 0 ? path.substring(0, lastSlash) : path;
  }

  canBackup(): boolean {
    return !!this.formData.backupPath.trim();
  }

  async startBackup(): Promise<void> {
    if (!this.canBackup()) return;

    this.backing.set(true);
    this.progress.set({
      backupId: `backup-${Date.now()}`,
      status: 'starting',
      percentComplete: 0,
    });

    const request: BackupRequest = {
      connectionId: this.data.connectionId,
      database: this.data.databaseName,
      backupPath: this.formData.backupPath,
      backupType: this.formData.backupType,
      compression: this.formData.compression,
      copyOnly: this.formData.copyOnly,
      checksum: this.formData.checksum,
      description: this.formData.description || undefined,
    };

    try {
      await firstValueFrom(this.ipc.startBackup(request));
    } catch (error) {
      this.backing.set(false);
      this.notification.error(error instanceof Error ? error.message : 'Failed to start backup');
    }
  }

  cancel(): void {
    if (this.backing()) {
      const backupId = this.progress()?.backupId;
      if (backupId) {
        firstValueFrom(this.ipc.cancelBackup(backupId));
      }
    }
    this.dialogRef.close();
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
