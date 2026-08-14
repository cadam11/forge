import { Component, inject, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConnectionStateService } from '../../core/state/connection.state';
import { ExplorerStateService } from '../../core/state/explorer.state';
import { NotificationService } from '../../core/services/notification.service';
import { ConfirmDialogComponent } from '../../shared/components/dialog/confirm-dialog.component';
import { PasswordHygieneWarningComponent } from '../../shared/components/password-hygiene-warning/password-hygiene-warning.component';
import { TestResultPanelComponent } from '../../shared/components/test-result-panel/test-result-panel.component';
import type { ConnectionProfile, AuthenticationType, TestConnectionResult } from '@forgedb/shared';

@Component({
  selector: 'app-connections',
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
    MatProgressSpinnerModule,
    MatCardModule,
    MatDividerModule,
    MatTooltipModule,
    ConfirmDialogComponent,
    PasswordHygieneWarningComponent,
    TestResultPanelComponent,
  ],
  template: `
    <div class="connections-container">
      <div class="connections-sidebar">
        <div class="sidebar-header">
          <h2>Connections</h2>
          <button mat-icon-button matTooltip="New Connection" (click)="newConnection()">
            <mat-icon>add</mat-icon>
          </button>
        </div>
        <div class="connection-list">
          @for (profile of connectionState.profiles(); track profile.id) {
            <div
              class="connection-item"
              tabindex="0"
              role="button"
              [attr.aria-label]="'Select ' + profile.name"
              [class.selected]="selectedProfileId() === profile.id"
              (click)="selectProfile(profile)"
              (keydown.enter)="selectProfile(profile)"
            >
              <mat-icon>dns</mat-icon>
              <div class="connection-info">
                <span class="name">{{ profile.name }}</span>
                <span class="server">{{ profile.server }}</span>
              </div>
              <button
                mat-icon-button
                matTooltip="Delete"
                (click)="deleteProfile(profile.id, $event)"
              >
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          }
          @if (!connectionState.hasProfiles()) {
            <div class="empty-state">
              <mat-icon>cloud_off</mat-icon>
              <p>No saved connections</p>
            </div>
          }
        </div>
      </div>

      <div class="connection-form">
        <h2>{{ isEditing() ? 'Edit Connection' : 'New Connection' }}</h2>

        <mat-card>
          <!-- Any edit invalidates the last Test result (text fields via the
               bubbled input event; selects/checkboxes clear explicitly). -->
          <mat-card-content (input)="clearTestResult()">
            <!-- Connection Name -->
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Connection Name *</mat-label>
              <input matInput [(ngModel)]="formData.name" placeholder="My SQL Server" required />
              <mat-hint>Required for saving the connection</mat-hint>
            </mat-form-field>

            <!-- Server -->
            <div class="form-row">
              <mat-form-field appearance="outline" class="flex-2">
                <mat-label>Server</mat-label>
                <input matInput [(ngModel)]="formData.server" placeholder="localhost or hostname" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="flex-1">
                <mat-label>Port</mat-label>
                <input matInput type="number" [(ngModel)]="formData.port" placeholder="1433" />
              </mat-form-field>
            </div>

            <mat-divider />

            <!-- Authentication -->
            <h3>Authentication</h3>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Authentication Type</mat-label>
              <mat-select
                [(ngModel)]="formData.authenticationType"
                (ngModelChange)="clearTestResult()"
              >
                <mat-option value="sql">SQL Server Authentication</mat-option>
                <mat-option value="windows">Windows Authentication</mat-option>
                <mat-option value="entra-id">Microsoft Entra ID</mat-option>
              </mat-select>
            </mat-form-field>

            @if (formData.authenticationType === 'sql') {
              <div class="form-row">
                <mat-form-field appearance="outline" class="flex-1">
                  <mat-label>Username</mat-label>
                  <input matInput [(ngModel)]="formData.username" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="flex-1">
                  <mat-label>Password</mat-label>
                  <input matInput type="password" [(ngModel)]="formData.password" />
                </mat-form-field>
              </div>
              <app-password-hygiene-warning [value]="formData.password" />
            }

            <mat-divider />

            <!-- Options -->
            <h3>Options</h3>
            <div class="checkbox-row">
              <mat-checkbox [(ngModel)]="formData.encrypt" (ngModelChange)="clearTestResult()">
                Encrypt Connection
              </mat-checkbox>
              <mat-checkbox
                [(ngModel)]="formData.trustServerCertificate"
                (ngModelChange)="clearTestResult()"
              >
                Trust Server Certificate
              </mat-checkbox>
            </div>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Connection Timeout (seconds)</mat-label>
              <input matInput type="number" [(ngModel)]="formData.connectionTimeout" />
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Default Database (optional)</mat-label>
              <input matInput [(ngModel)]="formData.database" placeholder="master" />
            </mat-form-field>

            <app-test-result-panel [result]="testResult()" />
          </mat-card-content>

          <mat-card-actions align="end">
            <button mat-button (click)="cancel()">Cancel</button>
            <button
              mat-stroked-button
              color="primary"
              [disabled]="!canTestConnection() || testing()"
              (click)="testConnection()"
            >
              @if (testing()) {
                <mat-spinner diameter="18" />
              } @else {
                Test Connection
              }
            </button>
            <button
              mat-flat-button
              color="primary"
              [disabled]="!isValid() || saving()"
              (click)="saveConnection()"
            >
              @if (saving()) {
                <mat-spinner diameter="18" />
              } @else {
                {{ isEditing() ? 'Update' : 'Save' }}
              }
            </button>
            <button
              mat-flat-button
              color="accent"
              [disabled]="!isValid() || connectionState.connecting()"
              (click)="connectNow()"
            >
              @if (connectionState.connecting()) {
                <mat-spinner diameter="18" />
              } @else {
                Connect
              }
            </button>
          </mat-card-actions>
        </mat-card>
      </div>
    </div>
    <app-confirm-dialog #deleteDialog (confirmed)="onDeleteConfirmed()" />
  `,
  styles: [
    `
      .connections-container {
        display: flex;
        height: 100%;
        overflow: hidden;
      }

      .connections-sidebar {
        width: 280px;
        border-right: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);
        display: flex;
        flex-direction: column;
      }

      .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--border-primary);

        h2 {
          font-size: var(--font-size-lg);
          font-weight: 600;
          margin: 0;
        }
      }

      .connection-list {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-sm);
      }

      .connection-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }

        &.selected {
          background-color: var(--bg-active);
        }

        mat-icon {
          color: var(--text-secondary);
        }

        .connection-info {
          flex: 1;
          min-width: 0;

          .name {
            display: block;
            font-weight: 500;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .server {
            display: block;
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
        }

        button {
          opacity: 0;
          transition: opacity var(--transition-fast);
        }

        &:hover button {
          opacity: 1;
        }
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--spacing-xl);
        color: var(--text-muted);
        text-align: center;

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          opacity: 0.5;
          margin-bottom: var(--spacing-sm);
        }
      }

      .connection-form {
        flex: 1;
        padding: var(--spacing-lg);
        overflow-y: auto;

        h2 {
          font-size: var(--font-size-xl);
          font-weight: 600;
          margin-bottom: var(--spacing-md);
        }

        h3 {
          font-size: var(--font-size-md);
          font-weight: 600;
          margin: var(--spacing-md) 0;
          color: var(--text-secondary);
        }
      }

      mat-card {
        max-width: 600px;
        background-color: var(--bg-secondary);
      }

      .full-width {
        width: 100%;
      }

      .form-row {
        display: flex;
        gap: var(--spacing-md);
      }

      .flex-1 {
        flex: 1;
      }

      .flex-2 {
        flex: 2;
      }

      .checkbox-row {
        display: flex;
        gap: var(--spacing-lg);
        margin-bottom: var(--spacing-md);
      }

      mat-card-actions {
        padding: var(--spacing-md);
        gap: var(--spacing-sm);

        button mat-spinner {
          display: inline-block;
        }
      }

      mat-divider {
        margin: var(--spacing-md) 0;
      }
    `,
  ],
})
export class ConnectionsComponent {
  readonly connectionState = inject(ConnectionStateService);
  private readonly explorerState = inject(ExplorerStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  @ViewChild('deleteDialog') deleteDialog!: ConfirmDialogComponent;
  private readonly notification = inject(NotificationService);
  private pendingDeleteProfileId: string | null = null;

  selectedProfileId = signal<string | null>(null);
  isEditing = signal(false);
  testing = signal(false);
  saving = signal(false);
  /**
   * Last FAILED "Test Connection" result, rendered inline with its guidance
   * (successes only toast). Cleared on any form edit or profile switch so a
   * stale error never describes a configuration that has since changed.
   */
  testResult = signal<TestConnectionResult | null>(null);

  formData: Partial<ConnectionProfile> & { password?: string } = {
    name: '',
    engine: 'mssql',
    server: '',
    port: 1433,
    authenticationType: 'sql',
    username: '',
    password: '',
    encrypt: true,
    trustServerCertificate: true,
    connectionTimeout: 30,
    database: '',
  };

  constructor() {
    // Check for query params (from Docker container selection)
    this.route.queryParams.subscribe(params => {
      if (params['server']) {
        this.formData.server = params['server'];
      }
      if (params['port']) {
        this.formData.port = parseInt(params['port'], 10);
      }
    });
  }

  newConnection(): void {
    this.selectedProfileId.set(null);
    this.isEditing.set(false);
    this.clearTestResult();
    this.resetForm();
  }

  selectProfile(profile: ConnectionProfile): void {
    this.selectedProfileId.set(profile.id);
    this.isEditing.set(true);
    this.clearTestResult();
    this.formData = {
      ...profile,
      password: '', // Don't show stored password
    };
  }

  clearTestResult(): void {
    this.testResult.set(null);
  }

  deleteProfile(profileId: string, event: Event): void {
    event.stopPropagation();
    const profile = this.connectionState.profiles().find(p => p.id === profileId);
    this.pendingDeleteProfileId = profileId;
    this.deleteDialog.open({
      title: 'Delete Connection',
      message: `Are you sure you want to delete "${profile?.name || 'this connection'}"? This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      type: 'danger',
    });
  }

  async onDeleteConfirmed(): Promise<void> {
    const profileId = this.pendingDeleteProfileId;
    this.pendingDeleteProfileId = null;
    if (!profileId) return;

    await this.connectionState.deleteProfile(profileId);
    this.notification.success('Connection deleted');
    if (this.selectedProfileId() === profileId) {
      this.newConnection();
    }
  }

  /**
   * When editing a saved profile with the password field left blank, send
   * undefined so the main process falls back to the keychain-stored password
   * (buildTestProfile passes the real profile id for the same reason) — Test
   * then exercises exactly what Connect will use, instead of ''.
   */
  private testPassword(): string | undefined {
    if (this.isEditing() && this.formData.password === '') return undefined;
    return this.formData.password;
  }

  async testConnection(): Promise<void> {
    if (!this.canTestConnection()) return;

    this.testing.set(true);
    this.clearTestResult();
    try {
      const profile = this.buildTestProfile();
      // notifyErrors: false — failures render in the inline panel; a toast on
      // top would announce the same error twice.
      const result = await this.connectionState.testConnection(
        profile,
        this.testPassword(),
        undefined,
        undefined,
        { notifyErrors: false }
      );
      this.testResult.set(result.success ? null : result);
    } finally {
      this.testing.set(false);
    }
  }

  private buildTestProfile(): ConnectionProfile {
    return {
      // The real id when editing lets the test IPC handler resolve the
      // keychain-stored password for a blank password field (see testPassword).
      id: this.selectedProfileId() ?? 'test-connection',
      name: this.formData.name || 'Test Connection',
      engine: this.formData.engine || 'mssql',
      server: this.formData.server!,
      port: this.formData.port!,
      authenticationType: this.formData.authenticationType as AuthenticationType,
      username: this.formData.username,
      database: this.formData.database || undefined,
      encrypt: this.formData.encrypt ?? true,
      trustServerCertificate: this.formData.trustServerCertificate ?? true,
      connectionTimeout: this.formData.connectionTimeout || 30,
    };
  }

  async saveConnection(): Promise<void> {
    if (!this.isValid() || this.saving()) return;

    this.saving.set(true);
    try {
      const profile = this.buildProfile();
      const savedProfile = await this.connectionState.saveProfile(profile, this.formData.password);
      if (savedProfile) {
        this.selectedProfileId.set(savedProfile.id);
        this.isEditing.set(true);
      }
    } finally {
      this.saving.set(false);
    }
  }

  async connectNow(): Promise<void> {
    if (!this.isValid() || this.saving() || this.connectionState.connecting()) return;

    this.saving.set(true);
    // Save first if needed
    const profile = this.buildProfile();
    const savedProfile = await this.connectionState.saveProfile(profile, this.formData.password);

    if (!savedProfile) {
      this.saving.set(false);
      return; // Save failed, error already shown
    }

    this.saving.set(false);

    // Then connect
    const success = await this.connectionState.connect(savedProfile.id);
    if (success) {
      // Add to explorer and navigate
      this.explorerState.addServerNode(savedProfile.id, savedProfile.name);
      this.explorerState.expandNode(`server-${savedProfile.id}`);
      this.router.navigate(['/']);
    }
  }

  cancel(): void {
    this.router.navigate(['/']);
  }

  /**
   * Mirrors connection-dialog.component.ts: form needs username/password
   * only for "sql" auth on mssql, or for any non-mssql engine. Windows
   * auth uses the OS principal; Entra ID uses MSAL via the system browser.
   */
  needsUsernamePassword(): boolean {
    if (this.formData.engine !== 'mssql') return true;
    return this.formData.authenticationType === 'sql';
  }

  isValid(): boolean {
    const needsCreds = this.needsUsernamePassword();
    return !!(
      this.formData.name &&
      this.formData.server &&
      this.formData.port &&
      (!needsCreds || this.formData.username)
    );
  }

  canTestConnection(): boolean {
    const needsCreds = this.needsUsernamePassword();
    return !!(
      this.formData.server &&
      this.formData.port &&
      (!needsCreds || this.formData.username)
    );
  }

  private buildProfile(): Partial<ConnectionProfile> & { id?: string } {
    // Only include ID if we're editing an existing profile
    const existingId = this.selectedProfileId();

    return {
      ...(existingId ? { id: existingId } : {}),
      name: this.formData.name!,
      engine: this.formData.engine || 'mssql',
      server: this.formData.server!,
      port: this.formData.port!,
      authenticationType: this.formData.authenticationType as AuthenticationType,
      username: this.formData.username,
      database: this.formData.database || undefined,
      encrypt: this.formData.encrypt ?? true,
      trustServerCertificate: this.formData.trustServerCertificate ?? true,
      connectionTimeout: this.formData.connectionTimeout || 30,
    };
  }

  private resetForm(): void {
    this.formData = {
      name: '',
      engine: 'mssql',
      server: '',
      port: 1433,
      authenticationType: 'sql',
      username: '',
      password: '',
      encrypt: true,
      trustServerCertificate: true,
      connectionTimeout: 30,
      database: '',
    };
  }
}
