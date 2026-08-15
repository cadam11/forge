import {
  Component,
  input,
  output,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import type { DatabaseEngine } from '@forgedb/shared';
import { ConnectionStateService } from '../../../core/state/connection.state';

@Component({
  selector: 'app-connection-context-chip',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDividerModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      class="context-chip"
      [style.border-left-color]="connectionColor()"
      [matMenuTriggerFor]="contextMenu"
      (menuOpened)="onMenuOpened()"
      [matTooltip]="chipTooltip()"
      matTooltipShowDelay="400"
    >
      <i class="engine-icon" [ngClass]="engineIconClass()" [style.color]="connectionColor()"></i>
      @if (showConnectionName()) {
        <span class="connection-name">{{ connectionName() }}</span>
        <span class="separator">/</span>
      }
      <span class="database-name">{{ databaseName() || 'Select Database' }}</span>
      <mat-icon class="chevron">expand_more</mat-icon>
    </button>

    <mat-menu #contextMenu="matMenu" class="context-chip-menu">
      @if (showConnectionSection()) {
        <div class="menu-section-label" (click)="$event.stopPropagation()">CONNECTION</div>
        @for (profile of connectionState.profiles(); track profile.id) {
          <button mat-menu-item class="menu-item-connection" (click)="selectConnection(profile.id)">
            <i
              class="menu-engine-icon"
              [ngClass]="getEngineIconClass(profile.engine)"
              [style.color]="profile.color"
            ></i>
            <span>{{ profile.name }}</span>
            @if (profile.id === connectionId()) {
              <mat-icon class="check-icon">check</mat-icon>
            }
          </button>
        }
        <mat-divider />
      }

      <div class="menu-section-label" (click)="$event.stopPropagation()">DATABASE</div>
      @if (loadingDatabases()) {
        <div class="menu-loading" (click)="$event.stopPropagation()">
          <mat-spinner diameter="16" />
          <span>Loading databases...</span>
        </div>
      } @else {
        @for (db of databases(); track db.name) {
          <button mat-menu-item class="menu-item-database" (click)="selectDatabase(db.name)">
            <span>{{ db.name }}</span>
            @if (db.name === databaseName()) {
              <mat-icon class="check-icon">check</mat-icon>
            }
          </button>
        }
        @if (databases().length === 0) {
          <div class="menu-empty" (click)="$event.stopPropagation()">No databases found</div>
        }
      }
    </mat-menu>
  `,
  styles: [
    `
      .context-chip {
        display: flex;
        align-items: center;
        gap: 4px;
        height: 28px;
        padding: 0 8px;
        border: 1px solid var(--border-primary);
        border-left: 3px solid transparent;
        border-radius: 4px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        cursor: pointer;
        font-size: 12px;
        white-space: nowrap;
        max-width: 280px;
        transition: background-color 0.15s ease;
      }

      .context-chip:hover {
        background: var(--bg-tertiary);
      }

      .engine-icon {
        font-size: 14px;
        flex-shrink: 0;
      }

      .connection-name {
        opacity: 0.7;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .separator {
        opacity: 0.4;
        flex-shrink: 0;
      }

      .database-name {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .chevron {
        font-size: 16px;
        width: 16px;
        height: 16px;
        opacity: 0.5;
        flex-shrink: 0;
        margin-left: 2px;
      }

      .menu-section-label {
        padding: 6px 16px 4px;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.5px;
        color: var(--text-secondary);
        text-transform: uppercase;
        cursor: default;
      }

      .menu-engine-icon {
        font-size: 16px;
        margin-right: 8px;
        vertical-align: middle;
      }

      .check-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        margin-left: auto;
        color: var(--accent-primary, #007acc);
      }

      .menu-loading {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        font-size: 12px;
        color: var(--text-secondary);
      }

      .menu-empty {
        padding: 8px 16px;
        font-size: 12px;
        color: var(--text-secondary);
        font-style: italic;
      }

      :host ::ng-deep .menu-item-connection,
      :host ::ng-deep .menu-item-database {
        display: flex;
        align-items: center;
        font-size: 13px;
      }
    `,
  ],
})
export class ConnectionContextChipComponent {
  readonly connectionState = inject(ConnectionStateService);

  readonly connectionId = input<string | null>(null);
  readonly databaseName = input<string | null>(null);

  readonly connectionChanged = output<string>();
  readonly databaseChanged = output<string>();

  readonly databases = signal<{ name: string }[]>([]);
  readonly loadingDatabases = signal(false);

  readonly connectionProfile = computed(() => {
    const id = this.connectionId();
    if (!id) return null;
    return this.connectionState.getProfile(id) ?? null;
  });

  readonly connectionName = computed(() => this.connectionProfile()?.name ?? 'Not Connected');

  readonly connectionColor = computed(() => this.connectionProfile()?.color ?? undefined);

  readonly engineIconClass = computed(() => {
    const engine = this.connectionProfile()?.engine ?? 'mssql';
    return this.getEngineIconClass(engine);
  });

  readonly showConnectionName = computed(() => this.connectionState.profiles().length > 1);

  readonly showConnectionSection = computed(() => this.connectionState.profiles().length > 1);

  readonly chipTooltip = computed(() => {
    const name = this.connectionName();
    const db = this.databaseName() || 'No database';
    return `${name} / ${db}`;
  });

  getEngineIconClass(engine: DatabaseEngine): string {
    switch (engine) {
      case 'mysql':
        return 'devicon-mysql-original';
      case 'postgresql':
        return 'devicon-postgresql-plain';
      case 'mssql':
        return 'devicon-azuresqldatabase-plain';
    }
  }

  async onMenuOpened(): Promise<void> {
    const id = this.connectionId();
    if (!id) return;
    this.loadingDatabases.set(true);
    try {
      const dbs = await this.connectionState.getDatabasesForConnection(id);
      this.databases.set(dbs);
    } catch {
      this.databases.set([]);
    } finally {
      this.loadingDatabases.set(false);
    }
  }

  selectConnection(profileId: string): void {
    if (profileId === this.connectionId()) return;
    this.connectionChanged.emit(profileId);
  }

  selectDatabase(name: string): void {
    if (name === this.databaseName()) return;
    this.databaseChanged.emit(name);
  }
}
