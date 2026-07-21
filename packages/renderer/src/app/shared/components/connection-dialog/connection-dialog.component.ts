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
import { IpcService } from '../../../core/services/ipc.service';
import { isDsqlEndpoint } from '@mj-forge/shared';
import type {
  ConnectionProfile,
  AuthenticationType,
  SshAuthType,
  SshTunnelConfig,
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
  ],
  template: `
    <div class="connection-dialog">
      <h2 mat-dialog-title>
        <mat-icon>dns</mat-icon>
        <span>{{ isEditing() ? 'Edit Connection' : 'New Connection' }}</span>
      </h2>

      <mat-dialog-content>
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
            <input
              matInput
              [(ngModel)]="formData.server"
              (ngModelChange)="onServerChange($event)"
              placeholder="localhost or hostname"
            />
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
        @if (formData.engine === 'mssql' || formData.engine === 'postgresql') {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Authentication Type</mat-label>
            <mat-select
              [(ngModel)]="formData.authenticationType"
              (ngModelChange)="onAuthTypeChange($event)"
            >
              @if (formData.engine === 'mssql') {
                <mat-option value="sql">SQL Server Authentication</mat-option>
                <mat-option value="windows">Windows Authentication</mat-option>
                <mat-option value="entra-id">Microsoft Entra ID</mat-option>
              }
              @if (formData.engine === 'postgresql') {
                <mat-option value="sql">Password Authentication</mat-option>
                <mat-option value="aws-iam">AWS IAM (Aurora DSQL)</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }

        @if (needsUsernamePassword()) {
          <div class="form-row">
            <mat-form-field appearance="outline" class="flex-1">
              <mat-label>Username</mat-label>
              <input matInput [(ngModel)]="formData.username" />
            </mat-form-field>
            @if (!isAwsIamAuth()) {
              <mat-form-field appearance="outline" class="flex-1">
                <mat-label>Password</mat-label>
                <input matInput type="password" [(ngModel)]="formData.password" />
              </mat-form-field>
            }
          </div>
        }

        @if (formData.authenticationType === 'entra-id') {
          <p class="auth-hint">Signs in via Microsoft login window. Supports MFA.</p>
        }

        @if (isAwsIamAuth()) {
          @if (awsProfiles().length > 0) {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>AWS Profile</mat-label>
              <mat-select [(ngModel)]="formData.awsProfile">
                @for (p of awsProfiles(); track p) {
                  <mat-option [value]="p">{{ p }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          } @else {
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>AWS Profile</mat-label>
              <input matInput [(ngModel)]="formData.awsProfile" placeholder="default" />
            </mat-form-field>
          }
          <p class="auth-hint">
            Tokens are minted automatically from your AWS credentials — nothing is stored.
          </p>
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
        @if (isAwsIamAuth()) {
          <p class="auth-hint">
            TLS is always enabled and the server certificate is always validated for Aurora DSQL.
          </p>
        } @else {
          <div class="checkbox-row">
            <mat-checkbox [(ngModel)]="formData.encrypt">Encrypt Connection</mat-checkbox>
            <mat-checkbox [(ngModel)]="formData.trustServerCertificate">
              Trust Server Certificate
            </mat-checkbox>
          </div>
        }

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
            <mat-select [(ngModel)]="formData.mysqlCollation">
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
        @if (isAwsIamAuth()) {
          <p class="auth-hint">
            SSH tunneling isn't available with AWS IAM authentication — Aurora DSQL uses a public
            TLS endpoint.
          </p>
        } @else {
          <mat-checkbox [(ngModel)]="formData.sshEnabled">Connect via SSH tunnel</mat-checkbox>

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
              <mat-select [(ngModel)]="formData.sshAuthType">
                <mat-option value="password">Password</mat-option>
                <mat-option value="privateKey">Private Key</mat-option>
              </mat-select>
            </mat-form-field>

            @if (formData.sshAuthType === 'password') {
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>SSH Password</mat-label>
                <input matInput type="password" [(ngModel)]="formData.sshPassword" />
              </mat-form-field>
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
            }
          }
        }
      </mat-dialog-content>

      @if (validationHint(); as hint) {
        <p class="validation-hint">{{ hint }}</p>
      }

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
  private readonly ipc = inject(IpcService);
  readonly dialogRef = inject(MatDialogRef<ConnectionDialogComponent>);
  readonly data: ConnectionDialogData = inject(MAT_DIALOG_DATA) || {};

  readonly isEditing = signal(false);
  readonly testing = signal(false);
  readonly saving = signal(false);

  /** AWS CLI/config profile names for the aws-iam picker; loaded lazily, cached for the dialog's lifetime. */
  readonly awsProfiles = signal<string[]>([]);
  private awsProfilesLoaded = false;

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
    awsProfile: undefined,
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
      if (this.formData.authenticationType === 'aws-iam') {
        this.formData.awsProfile ||= 'default';
        this.loadAwsProfiles();
      }
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

  async testConnection(): Promise<void> {
    if (!this.canTestConnection()) return;

    this.testing.set(true);
    try {
      const profile = this.buildTestProfile();
      await this.connectionState.testConnection(
        profile,
        this.resolvedPassword(),
        this.formData.sshPassword,
        this.formData.sshPassphrase
      );
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
        this.resolvedPassword(),
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
      this.resolvedPassword(),
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
   * True when the form must collect at least a username from the user.
   * Non-mssql engines always need one. On mssql, only "sql" auth uses
   * form credentials — "windows" uses the OS principal, "entra-id" uses
   * MSAL via the system browser. The password half of this is further
   * narrowed by isAwsIamAuth() — aws-iam never takes a form password.
   */
  needsUsernamePassword(): boolean {
    if (this.formData.engine !== 'mssql') return true;
    return this.formData.authenticationType === 'sql';
  }

  isEntraAuth(): boolean {
    return this.formData.authenticationType === 'entra-id';
  }

  /** Aurora DSQL auth: the pool mints IAM tokens, so no password is ever collected. */
  isAwsIamAuth(): boolean {
    return this.formData.authenticationType === 'aws-iam';
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
    // aws-iam defaults an empty username to 'admin' at save time (see
    // resolvedUsername()), so a blank field here must not block the form.
    const baseValid = !!(
      this.formData.name &&
      this.formData.server &&
      this.formData.port &&
      (!needsCreds || this.formData.username || this.isAwsIamAuth())
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
    // Reset authenticationType to 'sql' unless it's valid for the new engine:
    // mssql supports sql/windows/entra-id; postgresql supports sql/aws-iam;
    // mysql supports sql only. This also covers switching away from
    // postgresql while aws-iam is selected (e.g. to mssql, which has no
    // aws-iam option in its dropdown).
    const currentAuth = this.formData.authenticationType;
    const authValidForEngine =
      engine === 'mssql'
        ? currentAuth === 'sql' || currentAuth === 'windows' || currentAuth === 'entra-id'
        : engine === 'postgresql'
          ? currentAuth === 'sql' || currentAuth === 'aws-iam'
          : currentAuth === 'sql';
    if (!authValidForEngine) {
      this.formData.authenticationType = 'sql';
    }
    // Re-run DSQL detection when landing on postgresql: a server value
    // pasted while a different engine was selected (e.g. mssql, the
    // dialog's default) never got split/detected because onServerChange
    // short-circuits on engine. Running it here makes paste-then-switch
    // and switch-then-paste behave identically.
    if (engine === 'postgresql') {
      this.applyDsqlAutoDetect();
    }
  }

  /**
   * Fires when the auth-type dropdown changes. Only aws-iam needs follow-up:
   * default the AWS profile field and kick off the lazy profile-name fetch.
   */
  onAuthTypeChange(authType: string): void {
    if (authType !== 'aws-iam') return;
    this.formData.awsProfile ||= 'default';
    this.loadAwsProfiles();
  }

  /**
   * Fires on every Server field edit. Delegates to applyDsqlAutoDetect(),
   * which normalizes the field and — when the engine/auth/password state
   * allows it — auto-switches the form to aws-iam.
   */
  onServerChange(server: string): void {
    this.formData.server = server;
    this.applyDsqlAutoDetect();
  }

  /**
   * Normalize the server field (trim, split a pasted ":<port>" suffix) and,
   * when the host is a DSQL endpoint on a postgresql profile with untouched
   * sql-auth defaults, auto-select AWS IAM. Called from onServerChange and
   * from onEngineChange when the engine switches to postgresql, so
   * field-entry order (paste-then-switch-engine, or the reverse) doesn't
   * matter.
   *
   * Normalization (trim + port-split) always runs, for every engine — a
   * trimmed bare host is correct regardless of engine. Only the aws-iam
   * auto-select is gated to postgresql/sql-auth/no-password, so this never
   * clobbers a deliberate manual choice and never fires for mssql/mysql.
   */
  private applyDsqlAutoDetect(): void {
    // formData.server defaults to '' (never undefined) at runtime; the
    // Partial<ConnectionProfile> intersection just widens its static type.
    const { host, port } = this.splitHostPort(this.formData.server ?? '');
    this.formData.server = host;
    if (port !== undefined) {
      this.formData.port = port;
    }

    // Aurora DSQL is a PostgreSQL-compatible service only — gating on engine
    // keeps this a no-op for mssql/mysql even in the (astronomically
    // unlikely) case a non-DSQL host matches the endpoint pattern.
    if (
      this.formData.engine !== 'postgresql' ||
      this.formData.authenticationType !== 'sql' ||
      this.formData.password ||
      !isDsqlEndpoint(host)
    ) {
      return;
    }

    this.formData.authenticationType = 'aws-iam';
    this.formData.database = 'postgres';
    this.formData.encrypt = true;
    this.formData.awsProfile ||= 'default';
    this.loadAwsProfiles();
  }

  /**
   * Splits a pasted "host:port" string into its parts. isDsqlEndpoint's
   * regex only matches bare hostnames, so callers must strip a port suffix
   * before testing — otherwise a pasted "<id>.dsql.<region>.on.aws:5432"
   * would silently fail auto-detection.
   *
   * IPv6 guard: only splits when the part before the final colon contains
   * no other colon. A bare IPv6 literal ("2001:db8::1") or a bracketed one
   * ("[::1]") has multiple colons, so it's left untouched rather than
   * truncated at the last one — only an unambiguous single "host:port" or
   * "host:port" trailing-digits suffix gets split.
   */
  private splitHostPort(value: string): { host: string; port?: number } {
    const trimmed = value.trim();
    const separatorIndex = trimmed.lastIndexOf(':');
    if (separatorIndex <= 0) return { host: trimmed };

    const hostPart = trimmed.slice(0, separatorIndex);
    if (hostPart.includes(':')) return { host: trimmed };

    const port = Number(trimmed.slice(separatorIndex + 1));
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return { host: trimmed };

    return { host: hostPart, port };
  }

  /**
   * Loads AWS CLI/config profile names for the aws-iam picker once per
   * dialog lifetime. Failure (e.g. no ~/.aws directory) degrades to an
   * empty list, which the template renders as a free-text input instead.
   */
  private loadAwsProfiles(): void {
    if (this.awsProfilesLoaded) return;
    this.awsProfilesLoaded = true;
    this.ipc.listAwsProfiles().subscribe({
      next: profiles => this.awsProfiles.set(profiles),
      error: (error: unknown) => {
        console.warn('Failed to load AWS profiles, falling back to free-text entry:', error);
        this.awsProfiles.set([]);
      },
    });
  }

  /** aws-iam never sends a form password — the pool mints IAM tokens instead. */
  private resolvedPassword(): string | undefined {
    return this.isAwsIamAuth() ? undefined : this.formData.password;
  }

  /** aws-iam defaults an empty username (DB role) to 'admin' at save/test time. */
  private resolvedUsername(): string | undefined {
    if (this.isAwsIamAuth() && !this.formData.username) return 'admin';
    return this.formData.username;
  }

  canTestConnection(): boolean {
    const needsCreds = this.needsUsernamePassword();
    return !!(
      this.formData.server &&
      this.formData.port &&
      (!needsCreds || this.formData.username || this.isAwsIamAuth())
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
      id: 'test-connection',
      name: this.formData.name || 'Test Connection',
      engine: this.formData.engine || 'mssql',
      server: this.formData.server!,
      port: this.formData.port!,
      authenticationType: this.formData.authenticationType as AuthenticationType,
      username: this.resolvedUsername(),
      database: this.formData.database || undefined,
      encrypt: this.formData.encrypt ?? true,
      trustServerCertificate: this.formData.trustServerCertificate ?? true,
      connectionTimeout: this.formData.connectionTimeout || 30,
      color: this.formData.color,
      mysqlCollation: this.formData.mysqlCollation || undefined,
      awsProfile: this.formData.awsProfile || undefined,
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
      username: this.resolvedUsername(),
      database: this.formData.database || undefined,
      encrypt: this.formData.encrypt ?? true,
      trustServerCertificate: this.formData.trustServerCertificate ?? true,
      connectionTimeout: this.formData.connectionTimeout || 30,
      color: this.formData.color,
      mysqlCollation: this.formData.mysqlCollation || undefined,
      awsProfile: this.formData.awsProfile || undefined,
      sshTunnel: this.buildSshTunnelConfig(),
    };
  }
}
