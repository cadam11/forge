/**
 * Connection Dialog Component
 * Modal dialog for creating or editing a database connection
 */

import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConnectionStateService } from '../../../core/state/connection.state';
import { ExplorerStateService } from '../../../core/state/explorer.state';
import { PasswordHygieneWarningComponent } from '../password-hygiene-warning/password-hygiene-warning.component';
import { TestResultPanelComponent } from '../test-result-panel/test-result-panel.component';
import type {
  ConnectionProfile,
  AuthenticationType,
  SshAuthType,
  SshTunnelConfig,
  TestConnectionResult,
} from '@mj-forge/shared';

export interface ConnectionDialogData {
  /** Profile to edit, or undefined for new connection */
  profile?: ConnectionProfile;
  /** Pre-fill server (e.g., from Docker container) */
  server?: string;
  /** Pre-fill port */
  port?: number;
}

export interface ConnectionDialogResult {
  /** The saved/connected profile */
  profile: ConnectionProfile;
  /** Whether connection was established */
  connected: boolean;
}

@Component({
  selector: 'app-connection-dialog',
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
    MatProgressSpinnerModule,
    MatDividerModule,
    MatTooltipModule,
    PasswordHygieneWarningComponent,
    TestResultPanelComponent,
  ],
  template: `
    <div class="connection-dialog">
      <h2 mat-dialog-title>
        <mat-icon>dns</mat-icon>
        <span>{{ isEditing() ? 'Edit Connection' : 'New Connection' }}</span>
      </h2>

      <!-- Any edit invalidates the last Test result — the (input) listener
           catches every text field; selects/checkboxes clear explicitly. -->
      <mat-dialog-content (input)="clearTestResult()">
        <!-- Database Engine -->
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Database Engine</mat-label>
          <mat-select [(ngModel)]="formData.engine" (ngModelChange)="onEngineChange($event)">
            <mat-option value="mssql">SQL Server</mat-option>
            <mat-option value="postgresql">PostgreSQL</mat-option>
            <mat-option value="mysql">MySQL</mat-option>
          </mat-select>
        </mat-form-field>

        <!-- Connection Name -->
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Connection Name</mat-label>
          <input matInput [(ngModel)]="formData.name" placeholder="My SQL Server" />
          <mat-hint>A friendly name for this connection</mat-hint>
        </mat-form-field>

        <!-- Server -->
        <div class="form-row">
          <mat-form-field appearance="outline" class="flex-2">
            <mat-label>Server</mat-label>
            <input matInput [(ngModel)]="formData.server" placeholder="localhost or hostname" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Port</mat-label>
            <input
              matInput
              type="number"
              [(ngModel)]="formData.port"
              [placeholder]="
                formData.engine === 'postgresql'
                  ? '5432'
                  : formData.engine === 'mysql'
                    ? '3306'
                    : '1433'
              "
            />
          </mat-form-field>
        </div>

        <mat-divider />

        <!-- Authentication -->
        <h3>Authentication</h3>
        @if (formData.engine === 'mssql') {
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
        }

        @if (needsUsernamePassword()) {
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

        @if (formData.authenticationType === 'entra-id') {
          <p class="auth-hint">Signs in via Microsoft login window. Supports MFA.</p>
        }

        <mat-divider />

        <!-- Color -->
        <h3>Color Tag</h3>
        <div class="color-picker-row">
          @for (c of presetColors; track c.value) {
            <button
              type="button"
              class="color-circle"
              [style.background]="c.value"
              [class.selected]="formData.color === c.value"
              [matTooltip]="c.label"
              (click)="selectColor(c.value)"
            ></button>
          }
          <button
            type="button"
            class="color-circle color-none"
            [class.selected]="!formData.color"
            matTooltip="No color"
            (click)="selectColor(undefined)"
          >
            <mat-icon>close</mat-icon>
          </button>
        </div>

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

        <div class="form-row">
          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Connection Timeout (seconds)</mat-label>
            <input matInput type="number" [(ngModel)]="formData.connectionTimeout" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Default Database</mat-label>
            <input
              matInput
              [(ngModel)]="formData.database"
              [placeholder]="
                formData.engine === 'postgresql'
                  ? 'postgres'
                  : formData.engine === 'mysql'
                    ? 'mysql'
                    : 'master'
              "
            />
            @if (isEntraAuth()) {
              <mat-hint>Leave blank to connect to master — most users need a specific DB.</mat-hint>
            }
          </mat-form-field>
        </div>

        @if (formData.engine === 'mysql') {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Collation</mat-label>
            <mat-select [(ngModel)]="formData.mysqlCollation" (ngModelChange)="clearTestResult()">
              <mat-option [value]="undefined">Server default</mat-option>
              <mat-option value="utf8mb4_0900_ai_ci">utf8mb4_0900_ai_ci (MySQL 8.0+)</mat-option>
              <mat-option value="utf8mb4_unicode_ci">utf8mb4_unicode_ci</mat-option>
              <mat-option value="utf8mb4_general_ci">utf8mb4_general_ci</mat-option>
              <mat-option value="utf8mb4_bin">utf8mb4_bin</mat-option>
              <mat-option value="utf8_general_ci">utf8_general_ci (legacy)</mat-option>
            </mat-select>
            <mat-hint
              >Match your server's collation to avoid "Illegal mix of collations" errors</mat-hint
            >
          </mat-form-field>
        }

        <mat-divider />

        <!-- SSH Tunnel -->
        <h3>SSH Tunnel</h3>
        <mat-checkbox [(ngModel)]="formData.sshEnabled" (ngModelChange)="clearTestResult()">
          Connect via SSH tunnel
        </mat-checkbox>

        @if (formData.sshEnabled) {
          <div class="form-row" style="margin-top: 12px">
            <mat-form-field appearance="outline" class="flex-2">
              <mat-label>SSH Host</mat-label>
              <input matInput [(ngModel)]="formData.sshHost" placeholder="bastion.example.com" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="flex-1">
              <mat-label>SSH Port</mat-label>
              <input matInput type="number" [(ngModel)]="formData.sshPort" />
            </mat-form-field>
          </div>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>SSH Username</mat-label>
            <input matInput [(ngModel)]="formData.sshUsername" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>SSH Auth Type</mat-label>
            <mat-select [(ngModel)]="formData.sshAuthType" (ngModelChange)="clearTestResult()">
              <mat-option value="password">Password</mat-option>
              <mat-option value="privateKey">Private Key</mat-option>
            </mat-select>
          </mat-form-field>

          @if (formData.sshAuthType === 'password') {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>SSH Password</mat-label>
              <input matInput type="password" [(ngModel)]="formData.sshPassword" />
            </mat-form-field>
            <app-password-hygiene-warning [value]="formData.sshPassword" />
          }

          @if (formData.sshAuthType === 'privateKey') {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Private Key Path</mat-label>
              <input
                matInput
                [(ngModel)]="formData.sshPrivateKeyPath"
                placeholder="~/.ssh/id_rsa"
              />
            </mat-form-field>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Passphrase (optional)</mat-label>
              <input matInput type="password" [(ngModel)]="formData.sshPassphrase" />
            </mat-form-field>
            <app-password-hygiene-warning [value]="formData.sshPassphrase" />
          }
        }
      </mat-dialog-content>

      @if (validationHint(); as hint) {
        <p class="validation-hint">{{ hint }}</p>
      }

      <app-test-result-panel [result]="testResult()" />

      <mat-dialog-actions align="start">
        <button
          mat-flat-button
          color="primary"
          [disabled]="!isValid() || connectionState.connecting() || saving()"
          (click)="connectNow()"
        >
          @if (connectionState.connecting()) {
            <mat-spinner diameter="18" />
          } @else {
            Connect
          }
        </button>
        <button
          mat-stroked-button
          color="primary"
          [disabled]="!isValid() || saving()"
          (click)="saveConnection()"
        >
          @if (saving()) {
            <mat-spinner diameter="18" />
          } @else {
            Save
          }
        </button>
        <button
          mat-stroked-button
          [disabled]="!canTestConnection() || testing()"
          (click)="testConnection()"
        >
          @if (testing()) {
            <mat-spinner diameter="18" />
          } @else {
            Test
          }
        </button>
        <button mat-button (click)="cancel()" [disabled]="saving()">Cancel</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .connection-dialog {
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
        padding-top: 12px !important;
        overflow-y: auto;
        max-height: calc(80vh - 160px) !important;

        h3 {
          font-size: var(--font-size-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin: 12px 0 12px;
          color: var(--text-secondary);
        }
      }

      .full-width {
        width: 100%;
        margin-bottom: 8px;
      }

      .form-row {
        display: flex;
        gap: 12px;
        margin-bottom: 8px;
      }

      .flex-1 {
        flex: 1;
      }

      .auth-hint {
        font-size: 12px;
        color: var(--text-secondary);
        margin: -4px 0 12px;
        line-height: 1.4;
      }

      .auth-hint code {
        background: var(--bg-tertiary);
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 11px;
      }

      app-password-hygiene-warning {
        margin: -2px 0 12px;
      }

      app-test-result-panel {
        margin: 12px 24px 0;
      }

      .validation-hint {
        margin: 12px 24px 0;
        padding: 10px 12px;
        background: var(--warning-bg, rgba(255, 193, 7, 0.12));
        border-left: 3px solid var(--status-warning, #f2a900);
        color: var(--text-primary);
        font-size: 13px;
        line-height: 1.4;
        border-radius: 2px;
      }

      .flex-2 {
        flex: 2;
      }

      .checkbox-row {
        display: flex;
        gap: 24px;
        margin-bottom: 16px;
      }

      .color-picker-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }

      .color-circle {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        transition:
          transform 0.12s ease,
          border-color 0.12s ease;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;

        &:hover {
          transform: scale(1.15);
        }

        &.selected {
          border-color: var(--text-primary);
          transform: scale(1.15);
        }
      }

      .color-none {
        background: var(--bg-tertiary) !important;
        border: 2px dashed var(--border-secondary);

        mat-icon {
          font-size: 12px;
          width: 12px;
          height: 12px;
          color: var(--text-muted);
        }

        &.selected {
          border-color: var(--text-primary);
          border-style: solid;
        }
      }

      mat-divider {
        margin: 8px 0 !important;
      }

      mat-dialog-actions {
        margin: 0 !important;
        padding: 12px 24px !important;

        button mat-spinner {
          display: inline-block;
        }
      }
    `,
  ],
})
export class ConnectionDialogComponent {
  readonly connectionState = inject(ConnectionStateService);
  private readonly explorerState = inject(ExplorerStateService);
  readonly dialogRef = inject(MatDialogRef<ConnectionDialogComponent>);
  readonly data: ConnectionDialogData = inject(MAT_DIALOG_DATA) || {};

  readonly isEditing = signal(false);
  readonly testing = signal(false);
  readonly saving = signal(false);
  /**
   * Last FAILED "Test" result, rendered inline with its guidance (successes
   * only toast). Cleared on any form edit so a stale error can never describe
   * a configuration the user has since changed.
   */
  readonly testResult = signal<TestConnectionResult | null>(null);

  readonly presetColors = [
    { value: '#e53935', label: 'Red' },
    { value: '#fb8c00', label: 'Orange' },
    { value: '#fdd835', label: 'Yellow' },
    { value: '#43a047', label: 'Green' },
    { value: '#00897b', label: 'Teal' },
    { value: '#1e88e5', label: 'Blue' },
    { value: '#8e24aa', label: 'Purple' },
    { value: '#d81b60', label: 'Pink' },
  ];

  formData: Partial<ConnectionProfile> & {
    password?: string;
    sshEnabled?: boolean;
    sshHost?: string;
    sshPort?: number;
    sshUsername?: string;
    sshAuthType?: SshAuthType;
    sshPassword?: string;
    sshPrivateKeyPath?: string;
    sshPassphrase?: string;
  } = {
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
    color: undefined,
    mysqlCollation: undefined,
    sshEnabled: false,
    sshHost: '',
    sshPort: 22,
    sshUsername: '',
    sshAuthType: 'password',
    sshPassword: '',
    sshPrivateKeyPath: '',
    sshPassphrase: '',
  };

  constructor() {
    // Initialize from dialog data
    if (this.data.profile) {
      this.isEditing.set(true);
      const ssh = this.data.profile.sshTunnel;
      this.formData = {
        ...this.data.profile,
        password: '', // Don't show stored password
        sshEnabled: ssh?.enabled ?? false,
        sshHost: ssh?.host ?? '',
        sshPort: ssh?.port ?? 22,
        sshUsername: ssh?.username ?? '',
        sshAuthType: ssh?.authType ?? 'password',
        sshPrivateKeyPath: ssh?.privateKeyPath ?? '',
        sshPassword: '',
        sshPassphrase: '',
      };
    } else {
      // Apply pre-fill values
      if (this.data.server) {
        this.formData.server = this.data.server;
      }
      if (this.data.port) {
        this.formData.port = this.data.port;
      }
    }
  }

  selectColor(color: string | undefined): void {
    this.formData.color = color;
  }

  clearTestResult(): void {
    this.testResult.set(null);
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
        this.formData.sshPassword,
        this.formData.sshPassphrase,
        { notifyErrors: false }
      );
      this.testResult.set(result.success ? null : result);
    } finally {
      this.testing.set(false);
    }
  }

  async saveConnection(): Promise<void> {
    if (!this.isValid() || this.saving()) return;

    this.saving.set(true);
    try {
      const profile = this.buildProfile();
      const savedProfile = await this.connectionState.saveProfile(
        profile,
        this.formData.password,
        this.formData.sshPassword,
        this.formData.sshPassphrase
      );
      if (savedProfile) {
        this.dialogRef.close({ profile: savedProfile, connected: false } as ConnectionDialogResult);
      }
    } finally {
      this.saving.set(false);
    }
  }

  async connectNow(): Promise<void> {
    if (!this.isValid() || this.saving() || this.connectionState.connecting()) return;

    this.saving.set(true);
    const profile = this.buildProfile();
    const savedProfile = await this.connectionState.saveProfile(
      profile,
      this.formData.password,
      this.formData.sshPassword,
      this.formData.sshPassphrase
    );

    if (!savedProfile) {
      this.saving.set(false);
      return;
    }

    this.saving.set(false);

    const success = await this.connectionState.connect(savedProfile.id);
    if (success) {
      this.explorerState.addServerNode(savedProfile.id, savedProfile.name);
      this.explorerState.expandNode(`server-${savedProfile.id}`);
      this.dialogRef.close({ profile: savedProfile, connected: true } as ConnectionDialogResult);
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }

  /**
   * True when the form must collect a username/password from the user.
   * Non-mssql engines always need them. On mssql, only "sql" auth uses
   * form credentials — "windows" uses the OS principal, "entra-id" uses
   * MSAL via the system browser.
   */
  needsUsernamePassword(): boolean {
    if (this.formData.engine !== 'mssql') return true;
    return this.formData.authenticationType === 'sql';
  }

  isEntraAuth(): boolean {
    return this.formData.authenticationType === 'entra-id';
  }

  validationHint(): string {
    if (!this.formData.server) return 'Fill in the Server to continue.';
    if (!this.formData.port) return 'Fill in the Port to continue.';
    if (
      this.formData.engine === 'mssql' &&
      this.formData.authenticationType === 'sql' &&
      !this.formData.username
    ) {
      return 'Fill in Username to continue.';
    }
    if (this.formData.sshEnabled && (!this.formData.sshHost || !this.formData.sshUsername)) {
      return 'Fill in SSH Host and Username to continue.';
    }
    if (!this.formData.name) return 'Give this connection a name to save.';
    return '';
  }

  isValid(): boolean {
    const needsCreds = this.needsUsernamePassword();
    const baseValid = !!(
      this.formData.name &&
      this.formData.server &&
      this.formData.port &&
      (!needsCreds || this.formData.username)
    );

    if (!baseValid) return false;

    // Validate SSH fields if enabled
    if (this.formData.sshEnabled) {
      if (!this.formData.sshHost || !this.formData.sshUsername) return false;
      if (this.formData.sshAuthType === 'privateKey' && !this.formData.sshPrivateKeyPath)
        return false;
    }

    return true;
  }

  onEngineChange(engine: string): void {
    this.clearTestResult();
    const ports: Record<string, number> = { mssql: 1433, postgresql: 5432, mysql: 3306 };
    this.formData.port = ports[engine] || 1433;
    // Adjust default username for engine
    if (
      engine === 'postgresql' &&
      (!this.formData.username ||
        this.formData.username === 'sa' ||
        this.formData.username === 'root')
    ) {
      this.formData.username = 'postgres';
    } else if (
      engine === 'mysql' &&
      (!this.formData.username ||
        this.formData.username === 'sa' ||
        this.formData.username === 'postgres')
    ) {
      this.formData.username = 'root';
    } else if (
      engine === 'mssql' &&
      (!this.formData.username ||
        this.formData.username === 'postgres' ||
        this.formData.username === 'root')
    ) {
      this.formData.username = 'sa';
    }
    // PG/MySQL don't support Windows auth
    if (engine !== 'mssql' && this.formData.authenticationType !== 'sql') {
      this.formData.authenticationType = 'sql';
    }
  }

  canTestConnection(): boolean {
    const needsCreds = this.needsUsernamePassword();
    return !!(
      this.formData.server &&
      this.formData.port &&
      (!needsCreds || this.formData.username)
    );
  }

  private buildSshTunnelConfig(): SshTunnelConfig | undefined {
    if (!this.formData.sshEnabled) return undefined;
    return {
      enabled: true,
      host: this.formData.sshHost!,
      port: this.formData.sshPort || 22,
      username: this.formData.sshUsername!,
      authType: this.formData.sshAuthType || 'password',
      ...(this.formData.sshAuthType === 'privateKey' && this.formData.sshPrivateKeyPath
        ? { privateKeyPath: this.formData.sshPrivateKeyPath }
        : {}),
    };
  }

  private buildTestProfile(): ConnectionProfile {
    return {
      // The real id when editing lets the test IPC handler resolve the
      // keychain-stored password for a blank password field (see testPassword).
      id: this.data.profile?.id ?? 'test-connection',
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
      color: this.formData.color,
      mysqlCollation: this.formData.mysqlCollation || undefined,
      sshTunnel: this.buildSshTunnelConfig(),
    };
  }

  private buildProfile(): Partial<ConnectionProfile> & { id?: string } {
    const existingId = this.data.profile?.id;

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
      color: this.formData.color,
      mysqlCollation: this.formData.mysqlCollation || undefined,
      sshTunnel: this.buildSshTunnelConfig(),
    };
  }
}
