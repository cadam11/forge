/**
 * Restore Database Dialog Component
 * Modal dialog for restoring a database from a backup file or backup history
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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { firstValueFrom, Subscription } from 'rxjs';
import { IpcService } from '../../../core/services/ipc.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  ServerFileBrowserComponent,
  ServerFileBrowserDialogData,
} from '../server-file-browser/server-file-browser.component';
import { MissingCliToolsComponent } from '../missing-cli-tools/missing-cli-tools.component';
import type {
  RestoreRequest,
  RestoreProgress,
  BackupFileInfo,
  BackupHistoryEntry,
  CliDepsResult,
  CliEngine,
  FileRelocation,
} from '@forgedb/shared';

export interface RestoreDialogData {
  connectionId: string;
  databaseName?: string;
  engine?: 'mssql' | 'postgresql' | 'mysql';
}

@Component({
  selector: 'app-restore-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatCheckboxModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatExpansionModule,
    MatTabsModule,
    MissingCliToolsComponent,
  ],
  template: `
    <div class="restore-dialog">
      <h2 mat-dialog-title>
        <mat-icon>restore</mat-icon>
        <span>Restore Database</span>
      </h2>

      <mat-dialog-content>
        @if (checkingTools()) {
          <div class="checking-tools" data-testid="restore-tools-checking">
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
          @if (data.engine === 'mssql' || !data.engine) {
            <!-- Source Selection Tabs (MSSQL: browse server + backup history) -->
            <mat-tab-group
              [(selectedIndex)]="sourceTab"
              (selectedIndexChange)="onSourceTabChange()"
            >
              <mat-tab label="Browse File">
                <div class="tab-content">
                  <div class="path-row">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="flex-1">
                      <mat-label>Backup File (on SQL Server)</mat-label>
                      <input
                        matInput
                        [(ngModel)]="formData.backupPath"
                        [disabled]="restoring()"
                        placeholder="e.g., /var/opt/mssql/backup/db.bak"
                        (ngModelChange)="onBackupPathChange()"
                      />
                    </mat-form-field>
                    <button
                      mat-icon-button
                      [disabled]="restoring()"
                      (click)="browseBackupFile()"
                      matTooltip="Browse server"
                    >
                      <mat-icon>folder_open</mat-icon>
                    </button>
                    <button
                      mat-icon-button
                      [disabled]="restoring() || !formData.backupPath"
                      (click)="loadBackupInfo()"
                      matTooltip="Read backup info"
                    >
                      <mat-icon>{{ loadingInfo() ? 'hourglass_empty' : 'info' }}</mat-icon>
                    </button>
                  </div>
                </div>
              </mat-tab>

              <mat-tab label="Backup History">
                <div class="tab-content">
                  @if (data.databaseName) {
                    <div class="history-filter">
                      <mat-checkbox
                        [(ngModel)]="showAllDatabases"
                        (ngModelChange)="onShowAllChange()"
                      >
                        Show all databases
                      </mat-checkbox>
                      @if (!showAllDatabases) {
                        <span class="filter-label">Showing: {{ data.databaseName }}</span>
                      }
                    </div>
                  }
                  @if (loadingHistory()) {
                    <div class="empty-text">Loading backup history...</div>
                  } @else if (backupHistory().length === 0) {
                    <div class="empty-text">No backup history found</div>
                  } @else {
                    <div class="history-list">
                      @for (entry of backupHistory(); track entry.backupStartDate) {
                        <div
                          class="history-item"
                          [class.selected]="selectedHistoryEntry() === entry"
                          (click)="selectHistoryEntry(entry)"
                        >
                          <div class="history-row">
                            @if (showAllDatabases) {
                              <span class="history-db">{{ entry.databaseName }}</span>
                            }
                            <span class="history-date">{{
                              entry.backupFinishDate | date: 'M/d/yy h:mm a'
                            }}</span>
                            <span class="history-type">{{ entry.backupType }}</span>
                            <span class="history-size">{{
                              formatBytes(entry.backupSizeBytes)
                            }}</span>
                          </div>
                          @if (entry.description) {
                            <div class="history-description">{{ entry.description }}</div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              </mat-tab>
            </mat-tab-group>
          } @else {
            <!-- Simple file path input for MySQL/PostgreSQL (local file, no server browse or backup history) -->
            <div class="file-section">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width">
                <mat-label>Backup File Path (local)</mat-label>
                <input
                  matInput
                  [(ngModel)]="formData.backupPath"
                  [disabled]="restoring()"
                  [placeholder]="
                    data.engine === 'postgresql' ? 'e.g., /tmp/mydb.dump' : 'e.g., /tmp/mydb.sql'
                  "
                  (ngModelChange)="onBackupPathChange()"
                />
              </mat-form-field>
            </div>
          }

          <!-- Backup Info -->
          @if (backupInfo()) {
            <div class="backup-info">
              <div class="info-row">
                <span class="label">Database:</span>
                <span class="value">{{ backupInfo()!.databaseName }}</span>
              </div>
              <div class="info-row">
                <span class="label">Type:</span>
                <span class="value">{{ backupInfo()!.backupType }}</span>
              </div>
              <div class="info-row">
                <span class="label">Date:</span>
                <span class="value">{{ backupInfo()!.backupFinishDate | date: 'medium' }}</span>
              </div>
              <div class="info-row">
                <span class="label">Size:</span>
                <span class="value">{{ formatBytes(backupInfo()!.backupSizeBytes) }}</span>
              </div>
              @if (backupInfo()!.description) {
                <div class="info-row">
                  <span class="label">Comment:</span>
                  <span class="value">{{ backupInfo()!.description }}</span>
                </div>
              }
            </div>
          }

          <!-- Destination -->
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width">
            <mat-label>Restore As Database</mat-label>
            <input
              matInput
              [(ngModel)]="formData.targetDatabase"
              [disabled]="restoring()"
              placeholder="Leave empty for original name"
            />
          </mat-form-field>

          <!-- Options (MSSQL only — these don't apply to mysqldump/pg_restore) -->
          @if (data.engine === 'mssql' || !data.engine) {
            <div class="options-section">
              <div class="options-row">
                <mat-checkbox [(ngModel)]="formData.withReplace" [disabled]="restoring()">
                  Overwrite (REPLACE)
                </mat-checkbox>
                <mat-checkbox [(ngModel)]="formData.withRecovery" [disabled]="restoring()">
                  Recovery
                </mat-checkbox>
                <mat-checkbox
                  [(ngModel)]="formData.withNoRecovery"
                  [disabled]="restoring() || formData.withRecovery"
                >
                  No Recovery
                </mat-checkbox>
              </div>
            </div>
          }

          <!-- Progress -->
          @if (restoring()) {
            <div class="progress-section">
              <div class="progress-header">
                <span>{{ progress()?.currentPhase || 'Starting restore...' }}</span>
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

          <!-- Expandable panels (MSSQL only — file relocations and T-SQL preview) -->
          @if (data.engine === 'mssql' || !data.engine) {
            <mat-accordion class="panels">
              @if (backupInfo()?.files?.length) {
                <mat-expansion-panel>
                  <mat-expansion-panel-header>
                    <mat-panel-title
                      ><mat-icon>folder_copy</mat-icon>File Relocations</mat-panel-title
                    >
                  </mat-expansion-panel-header>
                  <div class="files-list">
                    @for (file of backupInfo()!.files; track file.logicalName; let i = $index) {
                      <div class="file-item">
                        <div class="file-header">
                          <span class="file-name">{{ file.logicalName }}</span>
                          <span class="file-type">{{
                            file.fileType === 'D' ? 'Data' : 'Log'
                          }}</span>
                        </div>
                        <div class="file-path">
                          <mat-form-field
                            appearance="outline"
                            subscriptSizing="dynamic"
                            class="full-width"
                          >
                            <input
                              matInput
                              [(ngModel)]="fileRelocations[i].newPath"
                              [disabled]="restoring()"
                            />
                          </mat-form-field>
                          <button
                            mat-icon-button
                            [disabled]="restoring()"
                            (click)="browseFilePath(i)"
                          >
                            <mat-icon>folder_open</mat-icon>
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                </mat-expansion-panel>
              }

              <mat-expansion-panel>
                <mat-expansion-panel-header>
                  <mat-panel-title><mat-icon>code</mat-icon>T-SQL Preview</mat-panel-title>
                </mat-expansion-panel-header>
                <pre class="tsql-code">{{ generatedTsql() }}</pre>
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
            [disabled]="!canRestore() || restoring()"
            (click)="startRestore()"
          >
            <mat-icon>{{ restoring() ? 'sync' : 'restore' }}</mat-icon>
            <span>{{ restoring() ? 'Restoring...' : 'Start Restore' }}</span>
          </button>
        }
        <button mat-button (click)="cancel()" [disabled]="restoring()">
          {{ checkingTools() || showMissingTools() ? 'Close' : 'Cancel' }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .restore-dialog {
        overflow: hidden;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 0;

        mat-icon {
          color: var(--status-warning);
        }
      }

      mat-dialog-content {
        padding-top: 8px;
        overflow-x: hidden !important;
      }

      .tab-content {
        padding: 12px 0;
      }

      .file-section {
        padding: 12px 0;
      }

      .path-row {
        display: flex;
        gap: 8px;
        align-items: center;
        min-width: 0;

        .flex-1 {
          flex: 1;
          min-width: 0;
        }
      }

      .history-filter {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--border-primary);
      }

      .filter-label {
        font-size: 12px;
        color: var(--text-secondary);
      }

      .history-list {
        max-height: 160px;
        overflow-y: auto;
        border: 1px solid var(--border-primary);
        border-radius: 6px;
      }

      .history-item {
        padding: 8px 12px;
        border-bottom: 1px solid var(--border-primary);
        cursor: pointer;
        transition: background-color 0.15s;

        &:last-child {
          border-bottom: none;
        }

        &:hover {
          background-color: var(--bg-tertiary);
        }

        &.selected {
          background-color: var(--status-info-bg, rgba(33, 150, 243, 0.1));
          border-left: 3px solid var(--status-info);
        }
      }

      .history-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .history-db {
        font-weight: 500;
        font-size: 13px;
        min-width: 100px;
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .history-date {
        font-size: 13px;
        flex: 1;
      }

      .history-type {
        font-size: 11px;
        padding: 2px 8px;
        background-color: var(--bg-tertiary);
        border-radius: 4px;
        text-transform: capitalize;
      }

      .history-size {
        font-size: 12px;
        color: var(--text-secondary);
        min-width: 60px;
        text-align: right;
      }

      .history-description {
        font-size: 11px;
        color: var(--text-secondary);
        opacity: 0.8;
        margin-top: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .backup-info {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px 16px;
        padding: 12px;
        background-color: var(--bg-tertiary);
        border-radius: 6px;
        border-left: 3px solid var(--status-info);
        margin-bottom: 12px;

        .info-row {
          display: flex;
          gap: 8px;

          .label {
            color: var(--text-secondary);
            font-size: 12px;
          }

          .value {
            font-weight: 500;
            font-size: 13px;
          }
        }
      }

      .full-width {
        width: 100%;
        margin-bottom: 16px;
      }

      .options-section {
        margin: 16px 0;
        padding: 12px 16px;
        background-color: var(--bg-tertiary);
        border-radius: 6px;
      }

      .options-row {
        display: flex;
        gap: 24px;
        flex-wrap: wrap;
      }

      .progress-section {
        margin: 12px 0;
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
        margin-top: 12px;

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

      .files-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .file-item {
        padding: 8px;
        background-color: var(--bg-primary);
        border-radius: 4px;
      }

      .file-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;

        .file-name {
          font-weight: 500;
          font-size: 13px;
        }

        .file-type {
          font-size: 11px;
          padding: 2px 6px;
          background-color: var(--bg-tertiary);
          border-radius: 4px;
          color: var(--text-secondary);
        }
      }

      .file-path {
        display: flex;
        gap: 8px;
        align-items: center;
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

      .empty-text {
        padding: 24px;
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

      mat-dialog-actions button mat-icon + span {
        margin-left: 4px;
      }
    `,
  ],
})
export class RestoreDialogComponent implements OnInit, OnDestroy {
  private readonly ipc = inject(IpcService);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  readonly dialogRef = inject(MatDialogRef<RestoreDialogComponent>);
  readonly data: RestoreDialogData = inject(MAT_DIALOG_DATA);

  private progressSubscription?: Subscription;

  sourceTab = 0;
  showAllDatabases = false;

  formData = {
    backupPath: '',
    targetDatabase: '',
    withReplace: false,
    withRecovery: true,
    withNoRecovery: false,
  };

  fileRelocations: { logicalName: string; newPath: string }[] = [];

  readonly restoring = signal(false);
  readonly loadingInfo = signal(false);
  readonly loadingHistory = signal(false);
  readonly progress = signal<RestoreProgress | null>(null);
  readonly backupInfo = signal<BackupFileInfo | null>(null);
  readonly backupHistory = signal<BackupHistoryEntry[]>([]);
  readonly selectedHistoryEntry = signal<BackupHistoryEntry | null>(null);

  // CLI dependency probe state — see backup-dialog.component.ts for the
  // matching pattern. MSSQL skips the probe (uses T-SQL RESTORE).
  readonly toolsCheck = signal<CliDepsResult | null>(null);
  readonly checkingTools = signal(false);
  readonly rechecking = signal(false);
  readonly showMissingTools = computed(() => {
    const result = this.toolsCheck();
    return result !== null && !result.allAvailable;
  });

  readonly generatedTsql = computed(() => {
    const path = this.formData.backupPath || '<backup_path>';
    const db = this.formData.targetDatabase || this.backupInfo()?.databaseName || '<database>';

    let sql = `RESTORE DATABASE [${db}]\nFROM DISK = N'${path}'`;
    const withOptions: string[] = [];

    if (this.fileRelocations.length > 0) {
      this.fileRelocations.forEach(f => {
        if (f.newPath) {
          withOptions.push(`MOVE N'${f.logicalName}' TO N'${f.newPath}'`);
        }
      });
    }

    if (this.formData.withNoRecovery) {
      withOptions.push('NORECOVERY');
    } else if (this.formData.withRecovery) {
      withOptions.push('RECOVERY');
    }

    if (this.formData.withReplace) {
      withOptions.push('REPLACE');
    }

    withOptions.push('STATS = 10');

    if (withOptions.length > 0) {
      sql += '\nWITH ' + withOptions.join(',\n     ');
    }

    return sql + ';';
  });

  ngOnInit(): void {
    if (this.data.databaseName) {
      this.formData.targetDatabase = this.data.databaseName;
    }

    this.checkCliTools();
    this.loadBackupHistory();

    this.progressSubscription = this.ipc.getRestoreProgress().subscribe(p => {
      this.progress.set(p);
      if (p.status === 'completed') {
        this.restoring.set(false);
        this.notification.success('Database restored successfully');
        this.dialogRef.close({
          success: true,
          database: this.formData.targetDatabase || this.backupInfo()?.databaseName,
        });
      } else if (p.status === 'failed') {
        this.restoring.set(false);
        this.notification.error(p.error || 'Restore failed');
      }
    });
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
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
        err instanceof Error ? err.message : 'Failed to probe restore CLI tools'
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
        err instanceof Error ? err.message : 'Failed to re-check restore CLI tools'
      );
    } finally {
      this.rechecking.set(false);
    }
  }

  private cliEngineFor(engine: RestoreDialogData['engine']): CliEngine | null {
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

  onSourceTabChange(): void {
    this.backupInfo.set(null);
    this.fileRelocations = [];
    this.selectedHistoryEntry.set(null);
  }

  onBackupPathChange(): void {
    this.backupInfo.set(null);
    this.fileRelocations = [];
  }

  onShowAllChange(): void {
    this.loadBackupHistory();
  }

  private async loadBackupHistory(): Promise<void> {
    this.loadingHistory.set(true);
    try {
      // Filter by database if one is provided and not showing all
      const dbFilter = this.showAllDatabases ? undefined : this.data.databaseName;
      const history = await firstValueFrom(
        this.ipc.getBackupHistory(this.data.connectionId, dbFilter)
      );
      this.backupHistory.set(history || []);
    } catch {
      // Ignore errors
    } finally {
      this.loadingHistory.set(false);
    }
  }

  selectHistoryEntry(entry: BackupHistoryEntry): void {
    this.selectedHistoryEntry.set(entry);
    this.formData.backupPath = entry.physicalDeviceName;
    this.formData.targetDatabase = entry.databaseName;
    this.loadBackupInfo();
  }

  browseBackupFile(): void {
    const dialogData: ServerFileBrowserDialogData = {
      connectionId: this.data.connectionId,
      title: 'Select Backup File',
      mode: 'open',
      initialPath: this.getDirectoryFromPath(this.formData.backupPath),
      fileFilter: '.bak',
    };

    const dialogRef = this.dialog.open(ServerFileBrowserComponent, {
      data: dialogData,
      width: '600px',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.path) {
        this.formData.backupPath = result.path;
        this.loadBackupInfo();
      }
    });
  }

  browseFilePath(index: number): void {
    const file = this.backupInfo()?.files?.[index];
    if (!file) return;

    const dialogData: ServerFileBrowserDialogData = {
      connectionId: this.data.connectionId,
      title: `Select Location for ${file.logicalName}`,
      mode: 'save',
      initialPath: this.getDirectoryFromPath(
        this.fileRelocations[index]?.newPath || file.physicalName
      ),
      fileFilter: file.fileType === 'D' ? '.mdf' : '.ldf',
      defaultFileName: this.getFileNameFromPath(file.physicalName),
    };

    const dialogRef = this.dialog.open(ServerFileBrowserComponent, {
      data: dialogData,
      width: '600px',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.path) {
        this.fileRelocations[index].newPath = result.path;
      }
    });
  }

  async loadBackupInfo(): Promise<void> {
    if (!this.formData.backupPath) return;

    this.loadingInfo.set(true);
    try {
      const info = await firstValueFrom(
        this.ipc.getBackupInfo(this.data.connectionId, this.formData.backupPath)
      );

      if (info) {
        this.backupInfo.set(info);

        if (info.files) {
          this.fileRelocations = info.files.map(f => ({
            logicalName: f.logicalName,
            newPath: f.physicalName,
          }));
        }

        if (!this.formData.targetDatabase && info.databaseName) {
          this.formData.targetDatabase = info.databaseName;
        }
      }
    } catch (error) {
      this.notification.error(
        error instanceof Error ? error.message : 'Failed to read backup file'
      );
    } finally {
      this.loadingInfo.set(false);
    }
  }

  private getDirectoryFromPath(path: string): string {
    if (!path) return '';
    const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
    return lastSlash > 0 ? path.substring(0, lastSlash) : path;
  }

  private getFileNameFromPath(path: string): string {
    if (!path) return '';
    const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
    return lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
  }

  canRestore(): boolean {
    return !!this.formData.backupPath.trim();
  }

  async startRestore(): Promise<void> {
    if (!this.canRestore()) return;

    this.restoring.set(true);
    this.progress.set({
      restoreId: `restore-${Date.now()}`,
      status: 'starting',
      percentComplete: 0,
    });

    const relocations: FileRelocation[] = this.fileRelocations
      .filter(
        f =>
          f.newPath !==
          this.backupInfo()?.files?.find(bf => bf.logicalName === f.logicalName)?.physicalName
      )
      .map(f => ({ logicalName: f.logicalName, physicalName: f.newPath }) as FileRelocation);

    const request: RestoreRequest = {
      connectionId: this.data.connectionId,
      backupPath: this.formData.backupPath,
      targetDatabase: this.formData.targetDatabase || undefined,
      withReplace: this.formData.withReplace,
      withRecovery: this.formData.withRecovery,
      withNoRecovery: this.formData.withNoRecovery,
      fileRelocations: relocations.length > 0 ? relocations : undefined,
    };

    try {
      await firstValueFrom(this.ipc.startRestore(request));
    } catch (error) {
      this.restoring.set(false);
      this.notification.error(error instanceof Error ? error.message : 'Failed to start restore');
    }
  }

  cancel(): void {
    if (this.restoring()) {
      const restoreId = this.progress()?.restoreId;
      if (restoreId) {
        firstValueFrom(this.ipc.cancelRestore(restoreId));
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
