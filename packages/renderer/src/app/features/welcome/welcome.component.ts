import { Component, inject, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { ConnectionStateService } from '../../core/state/connection.state';
import { ExplorerStateService } from '../../core/state/explorer.state';
import { AIStateService } from '../../core/state/ai.state';
import { ChatStateService } from '../../core/state/chat.state';
import { OnboardingService } from '../../core/services/onboarding.service';
import { firstValueFrom } from 'rxjs';
import { IpcService } from '../../core/services/ipc.service';
import {
  ConnectionDialogComponent,
  ConnectionDialogData,
} from '../../shared/components/connection-dialog/connection-dialog.component';
import type { DockerStatus, DockerContainer } from '@forgedb/shared';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatCardModule],
  template: `
    <div class="welcome-container">
      <div class="welcome-header">
        <div class="logo-section">
          <mat-icon class="app-logo">storage</mat-icon>
          <h1>Forge</h1>
          <p class="tagline">Multi-engine SQL IDE for macOS &amp; Windows</p>
        </div>
      </div>

      <div class="welcome-content">
        <!-- Quick Actions -->
        <section class="quick-actions">
          <h2>Quick Actions</h2>
          <div class="action-cards">
            <mat-card
              class="action-card"
              tabindex="0"
              role="button"
              aria-label="New Connection"
              (click)="newConnection()"
              (keydown.enter)="newConnection()"
              (keydown.space)="newConnection(); $event.preventDefault()"
            >
              <mat-icon>add_circle</mat-icon>
              <h3>New Connection</h3>
              <p>Connect to a database</p>
            </mat-card>

            @if (connectionState.hasProfiles()) {
              <mat-card
                class="action-card"
                tabindex="0"
                role="button"
                aria-label="Recent Connection"
                (click)="reconnect()"
                (keydown.enter)="reconnect()"
                (keydown.space)="reconnect(); $event.preventDefault()"
              >
                <mat-icon>refresh</mat-icon>
                <h3>Recent Connection</h3>
                <p>{{ recentConnectionName }}</p>
              </mat-card>
            }

            <mat-card
              class="action-card"
              tabindex="0"
              role="button"
              aria-label="Docker Containers"
              (click)="openDockerSection()"
              (keydown.enter)="openDockerSection()"
              (keydown.space)="openDockerSection(); $event.preventDefault()"
            >
              <mat-icon>sailing</mat-icon>
              <h3>Docker Containers</h3>
              <p>{{ dockerStatusText }}</p>
            </mat-card>

            <mat-card
              class="action-card tour-card"
              tabindex="0"
              role="button"
              aria-label="Take a Tour"
              (click)="startTour()"
              (keydown.enter)="startTour()"
              (keydown.space)="startTour(); $event.preventDefault()"
            >
              <mat-icon>explore</mat-icon>
              <h3>Take a Tour</h3>
              <p>Learn the basics of Forge</p>
            </mat-card>
          </div>
        </section>

        <!-- Recent Connections -->
        @if (connectionState.hasProfiles()) {
          <section class="recent-connections">
            <h2>Recent Connections</h2>
            <div class="connection-list">
              @for (profile of connectionState.profiles().slice(0, 5); track profile.id) {
                <div
                  class="connection-item"
                  tabindex="0"
                  role="button"
                  [attr.aria-label]="'Connect to ' + profile.name"
                  (click)="quickConnect(profile)"
                  (keydown.enter)="quickConnect(profile)"
                  (keydown.space)="quickConnect(profile); $event.preventDefault()"
                >
                  <mat-icon>dns</mat-icon>
                  <div class="connection-info">
                    <span class="connection-name">{{ profile.name }}</span>
                    <span class="connection-server">{{ profile.server }}:{{ profile.port }}</span>
                  </div>
                  <mat-icon class="connect-icon">arrow_forward</mat-icon>
                </div>
              }
            </div>
          </section>
        }

        <!-- Docker Containers -->
        @if (dockerStatus?.isAvailable && sqlContainers.length > 0) {
          <section class="docker-section" #dockerSection>
            <h2>Database Containers</h2>
            <div class="container-list">
              @for (container of sqlContainers; track container.id) {
                <div class="container-item">
                  <mat-icon [class.running]="container.state === 'running'">
                    {{ container.state === 'running' ? 'play_circle' : 'pause_circle' }}
                  </mat-icon>
                  <div class="container-info">
                    <span class="container-name">{{ container.name }}</span>
                    <span class="container-status">{{ container.status }}</span>
                  </div>
                  @if (container.state === 'running') {
                    <button mat-stroked-button (click)="connectToContainer(container)">
                      Connect
                    </button>
                  } @else {
                    <button mat-stroked-button (click)="startContainer(container)">Start</button>
                  }
                </div>
              }
            </div>
          </section>
        }

        <!-- AI Features -->
        <section class="ai-features">
          @if (!aiState.hasConfiguredVendors()) {
            <div class="ai-promo-card">
              <div class="ai-promo-icon">
                <mat-icon>auto_awesome</mat-icon>
              </div>
              <div class="ai-promo-content">
                <h3>Enable AI Features</h3>
                <p>
                  Supercharge your workflow with AI-powered autocomplete, chat assistant, and query
                  analysis.
                </p>
              </div>
              <div class="ai-promo-actions">
                <button mat-flat-button color="primary" (click)="openAISetup()">Set Up AI</button>
                <button mat-button (click)="dismissAIPromo()">Maybe Later</button>
              </div>
            </div>
          } @else {
            <div class="ai-enabled-card">
              <div class="ai-enabled-header">
                <mat-icon>auto_awesome</mat-icon>
                <h3>AI Features Active</h3>
              </div>
              <div class="ai-feature-chips">
                <span class="ai-chip" (click)="openChat()">
                  <mat-icon>chat</mat-icon> Chat Assistant
                </span>
                <span class="ai-chip"> <mat-icon>code</mat-icon> Smart Autocomplete </span>
                <span class="ai-chip"> <mat-icon>analytics</mat-icon> Result Analysis </span>
              </div>
            </div>
          }
        </section>

        <!-- Getting Started -->
        <section class="getting-started">
          <h2>Getting Started</h2>
          <div class="tips">
            <div class="tip">
              <mat-icon>lightbulb</mat-icon>
              <div>
                <h4>Connect to a Database</h4>
                <p>
                  Forge speaks SQL Server, PostgreSQL, and MySQL. Make sure your server is reachable
                  over the network — directly or through an SSH tunnel.
                </p>
              </div>
            </div>
            <div class="tip">
              <mat-icon>sailing</mat-icon>
              <div>
                <h4>Use Docker for Local Development</h4>
                <p>
                  Running databases in Docker is the easiest way to develop locally. Forge detects
                  SQL Server, PostgreSQL, and MySQL containers automatically.
                </p>
              </div>
            </div>
            <div class="tip">
              <mat-icon>security</mat-icon>
              <div>
                <h4>Secure Credential Storage</h4>
                <p>
                  Your connection credentials are securely stored in macOS Keychain, never in plain
                  text files.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="welcome-footer">
        <a href="#" (click)="openDocs($event)">Documentation</a>
        <span class="separator">|</span>
        <a href="#" (click)="openGitHub($event)">GitHub</a>
      </div>
    </div>
  `,
  styles: [
    `
      .welcome-container {
        display: flex;
        flex-direction: column;
        min-height: 100%;
        padding: var(--spacing-xl);
        overflow-y: auto;
      }

      .welcome-header {
        text-align: center;
        padding: var(--spacing-xl) 0;
      }

      .logo-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);

        .app-logo {
          font-size: 64px;
          width: 64px;
          height: 64px;
          color: var(--status-info);
        }

        h1 {
          font-size: 32px;
          font-weight: 700;
          margin: 0;
          color: var(--text-primary);
        }

        .tagline {
          color: var(--text-secondary);
          margin: 0;
        }
      }

      .welcome-content {
        flex: 1;
        max-width: 900px;
        margin: 0 auto;
        width: 100%;
      }

      section {
        margin-bottom: var(--spacing-xl);

        h2 {
          font-size: var(--font-size-lg);
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-md);
        }
      }

      .action-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: var(--spacing-md);
      }

      .action-card {
        padding: var(--spacing-lg);
        cursor: pointer;
        transition:
          background-color var(--transition-fast),
          transform var(--transition-fast);
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-primary);

        &:hover {
          background-color: var(--bg-hover);
          transform: translateY(-2px);
        }

        mat-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;
          color: var(--status-info);
          margin-bottom: var(--spacing-sm);
        }

        h3 {
          font-size: var(--font-size-md);
          font-weight: 600;
          margin: 0 0 var(--spacing-xs);
          color: var(--text-primary);
        }

        p {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
          margin: 0;
        }
      }

      .connection-list,
      .container-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .connection-item,
      .container-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }

        mat-icon {
          color: var(--text-secondary);

          &.running {
            color: var(--status-success);
          }
        }

        .connection-info,
        .container-info {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .connection-name,
        .container-name {
          font-weight: 500;
          color: var(--text-primary);
        }

        .connection-server,
        .container-status {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
        }

        .connect-icon {
          opacity: 0;
          transition: opacity var(--transition-fast);
        }

        &:hover .connect-icon {
          opacity: 1;
        }
      }

      .tips {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .tip {
        display: flex;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background-color: var(--bg-secondary);
        border-radius: var(--radius-md);
        border-left: 3px solid var(--status-info);

        mat-icon {
          color: var(--status-info);
          flex-shrink: 0;
        }

        h4 {
          font-size: var(--font-size-md);
          font-weight: 600;
          margin: 0 0 var(--spacing-xs);
          color: var(--text-primary);
        }

        p {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
          margin: 0;
          line-height: 1.5;
        }
      }

      .ai-promo-card {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-lg);
        background: linear-gradient(
          135deg,
          color-mix(in srgb, var(--accent) 12%, var(--bg-secondary)),
          var(--bg-secondary)
        );
        border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border-primary));
        border-radius: var(--radius-md);
      }

      .ai-promo-icon {
        flex-shrink: 0;
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--accent);
        border-radius: var(--radius-md);
        mat-icon {
          font-size: 28px;
          width: 28px;
          height: 28px;
          color: white;
        }
      }

      .ai-promo-content {
        flex: 1;
        h3 {
          font-size: var(--font-size-md);
          font-weight: 600;
          margin: 0 0 var(--spacing-xs);
          color: var(--text-primary);
        }
        p {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
          margin: 0;
          line-height: 1.5;
        }
      }

      .ai-promo-actions {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        flex-shrink: 0;
      }

      .ai-enabled-card {
        padding: var(--spacing-lg);
        background: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
      }

      .ai-enabled-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-md);
        mat-icon {
          color: var(--accent);
        }
        h3 {
          font-size: var(--font-size-md);
          font-weight: 600;
          margin: 0;
          color: var(--text-primary);
        }
      }

      .ai-feature-chips {
        display: flex;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }

      .ai-chip {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--bg-tertiary);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        cursor: pointer;
        transition: background-color var(--transition-fast);
        &:hover {
          background: var(--bg-hover);
          color: var(--accent);
        }
        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }
      }

      .welcome-footer {
        text-align: center;
        padding: var(--spacing-lg) 0;
        color: var(--text-muted);
        font-size: var(--font-size-sm);

        mat-icon {
          font-size: 14px;
          vertical-align: middle;
          color: var(--status-error);
        }

        a {
          color: var(--text-accent);
          margin: 0 var(--spacing-xs);
        }

        .separator {
          color: var(--border-primary);
        }
      }
    `,
  ],
})
export class WelcomeComponent implements OnInit {
  readonly connectionState = inject(ConnectionStateService);
  readonly aiState = inject(AIStateService);
  private readonly chatState = inject(ChatStateService);
  private readonly onboarding = inject(OnboardingService);
  private readonly explorerState = inject(ExplorerStateService);
  private readonly ipc = inject(IpcService);
  private readonly dialog = inject(MatDialog);

  @ViewChild('dockerSection') dockerSectionRef?: ElementRef<HTMLElement>;

  dockerStatus: DockerStatus | null = null;
  sqlContainers: DockerContainer[] = [];

  get recentConnectionName(): string {
    const profiles = this.connectionState.profiles();
    return profiles.length > 0 ? profiles[0].name : 'None';
  }

  get dockerStatusText(): string {
    if (!this.dockerStatus) return 'Checking...';
    if (!this.dockerStatus.isAvailable) return 'Docker not available';
    if (this.sqlContainers.length === 0) return 'No database containers';
    const running = this.sqlContainers.filter(c => c.state === 'running').length;
    return `${running}/${this.sqlContainers.length} running`;
  }

  ngOnInit(): void {
    this.checkDocker();
  }

  private async checkDocker(): Promise<void> {
    try {
      const status = await firstValueFrom(this.ipc.detectDocker());
      this.dockerStatus = status ?? null;
      if (this.dockerStatus?.isAvailable) {
        const containers = await firstValueFrom(this.ipc.getDockerContainers());
        this.sqlContainers = containers?.filter(c => c.isSqlServer) ?? [];
      }
    } catch {
      // Docker not available, that's fine
    }
  }

  newConnection(): void {
    this.dialog.open(ConnectionDialogComponent, {
      data: {} as ConnectionDialogData,
      width: '540px',
      maxHeight: '90vh',
    });
  }

  reconnect(): void {
    const profiles = this.connectionState.profiles();
    if (profiles.length > 0) {
      this.connectTo(profiles[0].id);
    }
  }

  quickConnect(profile: { id: string }): void {
    this.connectTo(profile.id);
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

  openDockerSection(): void {
    this.dockerSectionRef?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  connectToContainer(container: DockerContainer): void {
    // Open connection dialog with container info pre-filled
    this.dialog.open(ConnectionDialogComponent, {
      data: {
        server: 'localhost',
        port: container.ports?.[0]?.external || 1433,
      } as ConnectionDialogData,
      width: '540px',
      maxHeight: '90vh',
    });
  }

  async startContainer(container: DockerContainer): Promise<void> {
    try {
      await firstValueFrom(this.ipc.startDockerContainer(container.id));
      await this.checkDocker();
    } catch {
      // Container may have failed to start — refresh status to show current state
      await this.checkDocker();
    }
  }

  startTour(): void {
    this.onboarding.startTour('welcome');
  }

  openAISetup(): void {
    import('../../shared/components/ai-setup-dialog/ai-setup-dialog.component').then(mod => {
      this.dialog.open(mod.AISetupDialogComponent, {
        width: '520px',
        panelClass: 'ai-setup-dialog-container',
      });
    });
  }

  dismissAIPromo(): void {
    // Simply hides the promo card for this session
    // The card will re-appear on next launch if AI is still not configured
  }

  openChat(): void {
    this.chatState.openPanel();
  }

  openDocs(event: Event): void {
    event.preventDefault();
    this.ipc.openExternal('https://github.com/cadam11/forge/wiki').subscribe();
  }

  openGitHub(event: Event): void {
    event.preventDefault();
    this.ipc.openExternal('https://github.com/cadam11/forge').subscribe();
  }
}
