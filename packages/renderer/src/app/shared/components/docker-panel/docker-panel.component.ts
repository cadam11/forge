import { Component, inject, OnInit, signal, output, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { firstValueFrom } from 'rxjs';
import { IpcService } from '../../../core/services/ipc.service';
import { NotificationService } from '../../../core/services/notification.service';
import type { DockerStatus, DockerContainer } from '@joinery/shared';
import { Router } from '@angular/router';

@Component({
  selector: 'app-docker-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatInputModule,
    MatFormFieldModule,
  ],
  template: `
    <div class="docker-panel" (click)="$event.stopPropagation()">
      <div class="panel-header">
        <div class="header-title">
          <mat-icon>sailing</mat-icon>
          <h3>Docker Containers</h3>
        </div>
        <button mat-icon-button (click)="close.emit()">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="panel-content">
        @if (loading()) {
          <div class="loading-state">
            <mat-spinner diameter="24"></mat-spinner>
            <span>Detecting Docker...</span>
          </div>
        } @else if (!dockerStatus()) {
          <div class="empty-state">
            <mat-icon>cloud_off</mat-icon>
            <p>Docker not detected</p>
            <span class="hint">Make sure Docker Desktop is installed and running</span>
          </div>
        } @else if (!dockerStatus()!.isRunning) {
          <div class="empty-state warning">
            <mat-icon>warning</mat-icon>
            <p>Docker is not running</p>
            <span class="hint">Start Docker Desktop to manage SQL Server containers</span>
          </div>
        } @else if (containers().length === 0) {
          <div class="empty-state">
            <mat-icon>inbox</mat-icon>
            <p>No SQL Server containers found</p>
            <span class="hint">Pull an mssql image and create a container</span>
          </div>
        } @else {
          <div class="container-list">
            @for (container of containers(); track container.id) {
              <div class="container-item" [class.running]="container.status === 'running'">
                <div
                  class="container-status-indicator"
                  [class.active]="container.status === 'running'"
                ></div>
                <div class="container-info">
                  <span class="container-name">{{ container.name }}</span>
                  <span class="container-details">
                    {{ container.image }} · Port {{ container.ports?.[0]?.external || 'N/A' }}
                  </span>
                </div>
                <div class="container-actions">
                  @if (container.status === 'running') {
                    <button
                      mat-icon-button
                      matTooltip="Stop Container"
                      (click)="stopContainer(container)"
                      [disabled]="actionInProgress() === container.id"
                    >
                      @if (actionInProgress() === container.id) {
                        <mat-spinner diameter="18"></mat-spinner>
                      } @else {
                        <mat-icon>stop</mat-icon>
                      }
                    </button>
                    <button
                      mat-stroked-button
                      color="primary"
                      matTooltip="Connect to this container"
                      (click)="connectToContainer(container)"
                    >
                      Connect
                    </button>
                  } @else {
                    <button
                      mat-icon-button
                      matTooltip="Start Container"
                      (click)="startContainer(container)"
                      [disabled]="actionInProgress() === container.id"
                    >
                      @if (actionInProgress() === container.id) {
                        <mat-spinner diameter="18"></mat-spinner>
                      } @else {
                        <mat-icon>play_arrow</mat-icon>
                      }
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>

      @if (showCreateForm()) {
        <div class="create-form">
          <h4>New SQL Server Container</h4>
          <mat-form-field appearance="outline">
            <mat-label>Container Name</mat-label>
            <input matInput [(ngModel)]="newContainerName" placeholder="mssql-dev" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>SA Password</mat-label>
            <input
              matInput
              [(ngModel)]="newContainerPassword"
              type="password"
              placeholder="Strong!Pass123"
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Host Port</mat-label>
            <input matInput [(ngModel)]="newContainerPort" type="number" placeholder="1433" />
          </mat-form-field>
          <div class="create-actions">
            <button mat-button (click)="showCreateForm.set(false)">Cancel</button>
            <button
              mat-flat-button
              color="primary"
              (click)="createContainer()"
              [disabled]="creating() || !newContainerName || !newContainerPassword"
            >
              @if (creating()) {
                <mat-spinner diameter="16"></mat-spinner>
              } @else {
                Create & Start
              }
            </button>
          </div>
        </div>
      }

      <div class="panel-footer">
        <button mat-button (click)="refresh()" [disabled]="loading()">
          <mat-icon>refresh</mat-icon>
          Refresh
        </button>
        @if (dockerStatus()?.isRunning && !showCreateForm()) {
          <button mat-button (click)="showCreateForm.set(true)">
            <mat-icon>add</mat-icon>
            New Container
          </button>
        } @else {
          <span class="status-text">
            @if (dockerStatus()?.isRunning) {
              {{ runningCount() }}/{{ containers().length }} running
            }
          </span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .docker-panel {
        width: 400px;
        max-height: 500px;
        background-color: var(--bg-primary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);

        .header-title {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);

          mat-icon {
            color: var(--status-info);
          }

          h3 {
            margin: 0;
            font-size: var(--font-size-md);
            font-weight: 600;
          }
        }
      }

      .panel-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-md);
      }

      .loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        padding: var(--spacing-xl);
        color: var(--text-secondary);
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        text-align: center;
        color: var(--text-secondary);

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          margin-bottom: var(--spacing-md);
          opacity: 0.5;
        }

        p {
          margin: 0;
          font-weight: 500;
          font-size: var(--font-size-md);
        }

        .hint {
          margin-top: var(--spacing-xs);
          font-size: var(--font-size-sm);
          color: var(--text-muted);
        }

        &.warning mat-icon {
          color: var(--status-warning);
          opacity: 1;
        }
      }

      .container-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .container-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--radius-md);
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }

        &.running {
          border-left: 3px solid var(--status-success);
        }
      }

      .container-status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: var(--text-muted);

        &.active {
          background-color: var(--status-success);
        }
      }

      .container-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;

        .container-name {
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .container-details {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
        }
      }

      .container-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
      }

      .create-form {
        padding: var(--spacing-md);
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);

        h4 {
          margin: 0 0 var(--spacing-xs);
          font-size: var(--font-size-sm);
          font-weight: 600;
          color: var(--text-primary);
        }

        mat-form-field {
          width: 100%;
          font-size: var(--font-size-sm);
        }

        .create-actions {
          display: flex;
          justify-content: flex-end;
          gap: var(--spacing-sm);
          margin-top: var(--spacing-xs);
        }
      }

      .panel-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);

        .status-text {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
        }
      }
    `,
  ],
})
export class DockerPanelComponent implements OnInit {
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);
  private readonly router = inject(Router);

  readonly close = output<void>();

  readonly loading = signal(false);
  readonly dockerStatus = signal<DockerStatus | null>(null);
  readonly containers = signal<DockerContainer[]>([]);
  readonly actionInProgress = signal<string | null>(null);
  readonly showCreateForm = signal(false);
  readonly creating = signal(false);

  newContainerName = 'mssql-dev';
  newContainerPassword = '';
  newContainerPort = 1433;

  readonly runningCount = signal(0);

  constructor() {
    // Update running count when containers change
    effect(() => {
      const count = this.containers().filter(c => c.status === 'running').length;
      this.runningCount.set(count);
    });
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.ipc.isAvailable) {
      return;
    }

    this.loading.set(true);
    try {
      const status = await firstValueFrom(this.ipc.detectDocker());
      this.dockerStatus.set(status ?? null);

      if (status?.isAvailable && status?.isRunning) {
        const containers = await firstValueFrom(this.ipc.getDockerContainers());
        this.containers.set(containers?.filter(c => c.isSqlServer) ?? []);
      } else {
        this.containers.set([]);
      }
    } catch (error) {
      console.error('Failed to detect Docker:', error);
      this.dockerStatus.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  async startContainer(container: DockerContainer): Promise<void> {
    this.actionInProgress.set(container.id);
    try {
      await firstValueFrom(this.ipc.startDockerContainer(container.id));
      this.notification.success(`Started container: ${container.name}`);
      await this.refresh();
    } catch (error) {
      this.notification.error(`Failed to start container: ${container.name}`);
      console.error('Failed to start container:', error);
    } finally {
      this.actionInProgress.set(null);
    }
  }

  async stopContainer(container: DockerContainer): Promise<void> {
    this.actionInProgress.set(container.id);
    try {
      await firstValueFrom(this.ipc.stopDockerContainer(container.id));
      this.notification.success(`Stopped container: ${container.name}`);
      await this.refresh();
    } catch (error) {
      this.notification.error(`Failed to stop container: ${container.name}`);
      console.error('Failed to stop container:', error);
    } finally {
      this.actionInProgress.set(null);
    }
  }

  connectToContainer(container: DockerContainer): void {
    this.close.emit();
    this.router.navigate(['/connections'], {
      queryParams: {
        server: 'localhost',
        port: container.ports?.[0]?.external || 1433,
      },
    });
  }

  async createContainer(): Promise<void> {
    if (!this.newContainerName || !this.newContainerPassword) return;

    this.creating.set(true);
    try {
      const result = await firstValueFrom(
        this.ipc.createDockerContainer({
          name: this.newContainerName,
          password: this.newContainerPassword,
          port: this.newContainerPort || 1433,
          acceptEula: true,
        })
      );

      if (result?.success) {
        this.notification.success(`Container "${this.newContainerName}" created and started`);
        this.showCreateForm.set(false);
        this.newContainerPassword = '';
        await this.refresh();
      } else {
        this.notification.error(result?.error || 'Failed to create container');
      }
    } catch (error) {
      this.notification.error('Failed to create container');
      console.error('Failed to create container:', error);
    } finally {
      this.creating.set(false);
    }
  }
}
