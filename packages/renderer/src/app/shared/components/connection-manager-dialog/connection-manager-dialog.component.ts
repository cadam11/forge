/**
 * Connection Manager Dialog Component
 * Shows a list of saved connections with edit, delete, and connect actions.
 */

import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConnectionStateService } from '../../../core/state/connection.state';
import { ExplorerStateService } from '../../../core/state/explorer.state';
import {
  ConnectionDialogComponent,
  ConnectionDialogData,
} from '../connection-dialog/connection-dialog.component';

@Component({
  selector: 'app-connection-manager-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatTooltipModule,
  ],
  template: `
    <div class="connection-manager-dialog">
      <h2 mat-dialog-title>
        <mat-icon>settings</mat-icon>
        <span>Manage Connections</span>
      </h2>

      <mat-dialog-content>
        @if (connectionState.profiles().length === 0) {
          <div class="empty-state">
            <mat-icon>dns</mat-icon>
            <p>No saved connections</p>
            <button mat-stroked-button (click)="addConnection()">
              <mat-icon>add</mat-icon>
              Add Connection
            </button>
          </div>
        } @else {
          <div class="connection-list">
            @for (profile of connectionState.profiles(); track profile.id) {
              <div class="connection-item" [class.active]="connectionState.isConnected(profile.id)">
                <div class="connection-info">
                  @if (profile.color) {
                    <span class="color-dot" [style.background]="profile.color"></span>
                  }
                  <mat-icon class="engine-icon">{{
                    profile.engine === 'postgresql'
                      ? 'view_cozy'
                      : profile.engine === 'mysql'
                        ? 'grid_on'
                        : 'dns'
                  }}</mat-icon>
                  <div class="connection-details">
                    <span class="connection-name">{{ profile.name }}</span>
                    <span class="connection-server">{{ profile.server }}:{{ profile.port }}</span>
                  </div>
                  @if (connectionState.isConnected(profile.id)) {
                    <span class="connected-badge">Connected</span>
                  }
                </div>
                <div class="connection-actions">
                  @if (!connectionState.isConnected(profile.id)) {
                    <button mat-icon-button matTooltip="Connect" (click)="connectTo(profile.id)">
                      <mat-icon>power</mat-icon>
                    </button>
                  } @else {
                    <button
                      mat-icon-button
                      matTooltip="Disconnect"
                      (click)="disconnect(profile.id)"
                    >
                      <mat-icon>power_off</mat-icon>
                    </button>
                  }
                  <button mat-icon-button matTooltip="Edit" (click)="editConnection(profile)">
                    <mat-icon>edit</mat-icon>
                  </button>
                  @if (confirmDeleteId() === profile.id) {
                    <button
                      mat-icon-button
                      matTooltip="Confirm delete"
                      class="delete-confirm"
                      (click)="confirmDelete(profile.id)"
                    >
                      <mat-icon>check</mat-icon>
                    </button>
                    <button mat-icon-button matTooltip="Cancel" (click)="cancelDelete()">
                      <mat-icon>close</mat-icon>
                    </button>
                  } @else {
                    <button mat-icon-button matTooltip="Delete" (click)="promptDelete(profile.id)">
                      <mat-icon>delete</mat-icon>
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-stroked-button (click)="addConnection()">
          <mat-icon>add</mat-icon>
          New Connection
        </button>
        <button mat-button mat-dialog-close>Close</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .connection-manager-dialog {
        width: 520px;
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

      mat-dialog-content {
        padding-top: 8px !important;
        min-height: 120px;
        max-height: calc(80vh - 160px) !important;
        overflow-y: auto;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 32px 16px;
        color: var(--text-muted);

        mat-icon {
          font-size: 40px;
          width: 40px;
          height: 40px;
          margin-bottom: 12px;
        }

        p {
          margin: 0 0 16px;
          font-size: var(--font-size-sm);
        }
      }

      .connection-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .connection-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-radius: 6px;
        transition: background-color 0.15s ease;

        &:hover {
          background: var(--bg-tertiary);
        }

        &.active {
          background: color-mix(in srgb, var(--status-info) 10%, transparent);
        }
      }

      .connection-info {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
      }

      .color-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .engine-icon {
        color: var(--text-secondary);
        font-size: 20px;
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }

      .connection-details {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .connection-name {
        font-size: var(--font-size-sm);
        font-weight: 500;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .connection-server {
        font-size: var(--font-size-xs);
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .connected-badge {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--status-success);
        background: color-mix(in srgb, var(--status-success) 12%, transparent);
        padding: 2px 8px;
        border-radius: 10px;
        flex-shrink: 0;
      }

      .connection-actions {
        display: flex;
        align-items: center;
        gap: 0;
        flex-shrink: 0;

        button {
          width: 32px;
          height: 32px;

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
          }

          &.delete-confirm mat-icon {
            color: var(--status-error);
          }
        }
      }

      mat-dialog-actions {
        margin: 0 !important;
        padding: 12px 24px !important;
        gap: 8px;

        button mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          margin-right: 4px;
        }
      }
    `,
  ],
})
export class ConnectionManagerDialogComponent {
  readonly connectionState = inject(ConnectionStateService);
  private readonly explorerState = inject(ExplorerStateService);
  private readonly dialog = inject(MatDialog);

  readonly confirmDeleteId = signal<string | null>(null);

  addConnection(): void {
    this.dialog.open(ConnectionDialogComponent, {
      data: {} as ConnectionDialogData,
      width: '540px',
      maxHeight: '90vh',
    });
  }

  editConnection(profile: { id: string; name: string }): void {
    const fullProfile = this.connectionState.getProfile(profile.id);
    if (!fullProfile) return;

    this.dialog.open(ConnectionDialogComponent, {
      data: { profile: fullProfile } as ConnectionDialogData,
      width: '540px',
      maxHeight: '90vh',
    });
  }

  promptDelete(profileId: string): void {
    this.confirmDeleteId.set(profileId);
  }

  cancelDelete(): void {
    this.confirmDeleteId.set(null);
  }

  async confirmDelete(profileId: string): Promise<void> {
    this.confirmDeleteId.set(null);
    await this.connectionState.deleteProfile(profileId);
  }

  async connectTo(profileId: string): Promise<void> {
    const success = await this.connectionState.connect(profileId);
    if (success) {
      const profile = this.connectionState.getProfile(profileId);
      if (profile) {
        this.explorerState.addServerNode(profileId, profile.name);
        this.explorerState.expandNode(`server-${profileId}`);
      }
    }
  }

  async disconnect(profileId: string): Promise<void> {
    await this.connectionState.disconnect(profileId);
  }
}
