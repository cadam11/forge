/**
 * Server File Browser Component
 * Allows browsing the SQL Server's file system for backup/restore operations
 */

import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { IpcService } from '../../../core/services/ipc.service';
import type { ServerDrive, ServerFileEntry } from '@joinery/shared';

export interface ServerFileBrowserDialogData {
  connectionId: string;
  title: string;
  mode: 'open' | 'save';
  initialPath?: string;
  fileFilter?: string; // e.g., ".bak" for backup files
  defaultFileName?: string;
}

export interface ServerFileBrowserResult {
  path: string;
  fileName?: string;
}

@Component({
  selector: 'app-server-file-browser',
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
    MatTooltipModule,
  ],
  template: `
    <div class="server-file-browser">
      <h2 mat-dialog-title>{{ data.title }}</h2>

      <mat-dialog-content>
        <!-- Path Bar -->
        <div class="path-bar">
          <button mat-icon-button matTooltip="Go up" [disabled]="!canGoUp()" (click)="goUp()">
            <mat-icon>arrow_upward</mat-icon>
          </button>
          <button mat-icon-button matTooltip="Refresh" [disabled]="loading()" (click)="refresh()">
            <mat-icon [class.spinning]="loading()">refresh</mat-icon>
          </button>
          <div class="path-input-container">
            <input
              class="path-input"
              [(ngModel)]="currentPath"
              (keydown.enter)="navigateToPath()"
              placeholder="Enter path..."
            />
          </div>
          <button mat-icon-button matTooltip="Go to path" (click)="navigateToPath()">
            <mat-icon>arrow_forward</mat-icon>
          </button>
        </div>

        <!-- Drives -->
        @if (showDrives()) {
          <div class="drives-list">
            @for (drive of drives(); track drive.drive) {
              <button
                class="drive-item"
                (click)="selectDrive(drive)"
                matTooltip="{{ drive.freeSpaceMB | number }} MB free"
              >
                <mat-icon>storage</mat-icon>
                <span class="drive-name">{{ drive.drive }}</span>
              </button>
            }
          </div>
        }

        <!-- File List -->
        @if (!showDrives()) {
          <div class="file-list" [class.loading]="loading()">
            @if (loading()) {
              <div class="loading-overlay">
                <mat-spinner diameter="40"></mat-spinner>
              </div>
            }
            @if (error() && !loading()) {
              <div class="empty-state error-state">
                <mat-icon>error_outline</mat-icon>
                <span>{{ error() }}</span>
                <button mat-stroked-button (click)="refresh()">Retry</button>
              </div>
            } @else if (entries().length === 0 && !loading()) {
              <div class="empty-state">
                <mat-icon>folder_off</mat-icon>
                <span>This folder is empty</span>
              </div>
            }
            @for (entry of entries(); track entry.path) {
              <button
                class="file-item"
                [class.selected]="selectedEntry()?.path === entry.path"
                [class.directory]="entry.isDirectory"
                (click)="selectEntry(entry)"
                (dblclick)="openEntry(entry)"
              >
                <mat-icon>{{ entry.isDirectory ? 'folder' : 'description' }}</mat-icon>
                <span class="file-name">{{ entry.name }}</span>
              </button>
            }
          </div>
        }

        <!-- File Name Input (for save mode) -->
        @if (data.mode === 'save') {
          <mat-form-field appearance="outline" class="filename-field">
            <mat-label>File name</mat-label>
            <input
              matInput
              [(ngModel)]="fileName"
              [placeholder]="data.defaultFileName || 'backup.bak'"
            />
          </mat-form-field>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="start">
        <button mat-flat-button color="primary" [disabled]="!canConfirm()" (click)="confirm()">
          {{ data.mode === 'save' ? 'Save' : 'Select' }}
        </button>
        <button mat-button (click)="cancel()">Cancel</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .server-file-browser {
        display: flex;
        flex-direction: column;
        min-width: 500px;
        max-width: 700px;
      }

      .path-bar {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm) 0;
        border-bottom: 1px solid var(--border-primary);
        margin-bottom: var(--spacing-sm);
      }

      .path-input-container {
        flex: 1;
      }

      .path-input {
        width: 100%;
        padding: var(--spacing-sm);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-sm);
        background-color: var(--bg-primary);
        color: var(--text-primary);
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);

        &:focus {
          outline: none;
          border-color: var(--status-info);
        }
      }

      .drives-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
      }

      .drive-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-md);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        background-color: var(--bg-secondary);
        cursor: pointer;
        transition: all var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
          border-color: var(--status-info);
        }

        mat-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;
          color: var(--status-info);
        }

        .drive-name {
          font-weight: 500;
        }
      }

      .file-list {
        min-height: 300px;
        max-height: 400px;
        overflow-y: auto;
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        position: relative;

        &.loading {
          pointer-events: none;
          opacity: 0.7;
        }
      }

      .loading-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: rgba(0, 0, 0, 0.3);
        z-index: 1;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xl);
        color: var(--text-muted);

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
        }

        &.error-state {
          color: var(--status-error);

          mat-icon {
            color: var(--status-error);
          }
        }
      }

      .file-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        width: 100%;
        padding: var(--spacing-sm) var(--spacing-md);
        border: none;
        border-bottom: 1px solid var(--border-primary);
        background-color: transparent;
        color: var(--text-primary);
        cursor: pointer;
        text-align: left;
        transition: background-color var(--transition-fast);

        &:last-child {
          border-bottom: none;
        }

        &:hover {
          background-color: var(--bg-hover);
        }

        &.selected {
          background-color: var(--bg-tertiary);
        }

        &.directory mat-icon {
          color: var(--status-warning);
        }

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          color: var(--text-secondary);
        }

        .file-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }

      .filename-field {
        width: 100%;
        margin-top: var(--spacing-md);
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
export class ServerFileBrowserComponent implements OnInit {
  private readonly ipc = inject(IpcService);
  readonly dialogRef = inject(MatDialogRef<ServerFileBrowserComponent>);
  readonly data: ServerFileBrowserDialogData = inject(MAT_DIALOG_DATA);

  // State
  readonly loading = signal(false);
  readonly error = signal<string>('');
  readonly drives = signal<ServerDrive[]>([]);
  readonly entries = signal<ServerFileEntry[]>([]);
  readonly selectedEntry = signal<ServerFileEntry | null>(null);
  currentPath = '';
  fileName = '';

  // Computed
  readonly showDrives = computed(() => !this.currentPath || this.currentPath === '');

  ngOnInit(): void {
    this.fileName = this.data.defaultFileName || '';

    if (this.data.initialPath) {
      this.currentPath = this.data.initialPath;
      this.loadDirectory(this.currentPath);
    } else {
      this.loadDrives();
    }
  }

  async loadDrives(): Promise<void> {
    this.loading.set(true);
    this.error.set('');

    try {
      const drives = await firstValueFrom(this.ipc.getServerDrives(this.data.connectionId));
      this.drives.set(drives || []);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load drives');
    } finally {
      this.loading.set(false);
    }
  }

  async loadDirectory(path: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.selectedEntry.set(null);

    try {
      const entries = await firstValueFrom(
        this.ipc.listServerDirectory(this.data.connectionId, path, true)
      );

      // Filter by file extension if specified
      let filteredEntries = entries || [];
      if (this.data.fileFilter && this.data.mode === 'open') {
        filteredEntries = filteredEntries.filter(
          e => e.isDirectory || e.name.toLowerCase().endsWith(this.data.fileFilter!.toLowerCase())
        );
      }

      // Sort: directories first, then alphabetically
      filteredEntries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      this.entries.set(filteredEntries);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load directory');
      this.entries.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  selectDrive(drive: ServerDrive): void {
    this.currentPath = drive.drive + '\\';
    this.loadDirectory(this.currentPath);
  }

  selectEntry(entry: ServerFileEntry): void {
    this.selectedEntry.set(entry);
    if (!entry.isDirectory && this.data.mode === 'save') {
      this.fileName = entry.name;
    }
  }

  openEntry(entry: ServerFileEntry): void {
    if (entry.isDirectory) {
      this.currentPath = entry.path;
      this.loadDirectory(entry.path);
    } else if (this.data.mode === 'open') {
      // Double-click on file in open mode confirms selection
      this.confirm();
    }
  }

  navigateToPath(): void {
    if (this.currentPath.trim()) {
      this.loadDirectory(this.currentPath);
    } else {
      this.loadDrives();
    }
  }

  goUp(): void {
    if (!this.currentPath) return;

    // Remove trailing backslash
    const path = this.currentPath.endsWith('\\') ? this.currentPath.slice(0, -1) : this.currentPath;

    const lastSlash = path.lastIndexOf('\\');
    if (lastSlash <= 2) {
      // We're at root, show drives
      this.currentPath = '';
      this.loadDrives();
    } else {
      this.currentPath = path.substring(0, lastSlash);
      this.loadDirectory(this.currentPath);
    }
  }

  canGoUp(): boolean {
    return !!this.currentPath;
  }

  refresh(): void {
    if (this.currentPath) {
      this.loadDirectory(this.currentPath);
    } else {
      this.loadDrives();
    }
  }

  canConfirm(): boolean {
    if (this.data.mode === 'save') {
      return !!this.currentPath && !!this.fileName.trim();
    } else {
      const selected = this.selectedEntry();
      return !!selected && !selected.isDirectory;
    }
  }

  confirm(): void {
    let result: ServerFileBrowserResult;

    if (this.data.mode === 'save') {
      // Ensure path ends with backslash
      const basePath = this.currentPath.endsWith('\\') ? this.currentPath : this.currentPath + '\\';
      result = {
        path: basePath + this.fileName,
        fileName: this.fileName,
      };
    } else {
      const selected = this.selectedEntry();
      if (!selected) return;
      result = {
        path: selected.path,
        fileName: selected.name,
      };
    }

    this.dialogRef.close(result);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
