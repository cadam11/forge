import { Component, inject, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
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
import type { DockerStatus, DockerContainer } from '@joinery/shared';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  template: `
    <div class="welcome-container">
      <section class="concept-shell joinery-concept" aria-label="Joinery welcome">
        <header class="concept-nav">
          <div class="concept-lockup">
            <span class="joinery-stack-mark" aria-hidden="true">
              <span></span><span></span><span></span>
            </span>
            <strong>Joinery</strong>
          </div>
          <span class="concept-index">RELATIONAL WORKBENCH / LOCAL DESKTOP</span>
        </header>

        <div class="concept-hero-grid">
          <div class="concept-copy">
            <span class="concept-kicker">SQL SERVER · POSTGRESQL · MYSQL</span>
            <h1>Your database,<br />fitted to the way<br />you <em>work.</em></h1>
            <p>
              Write, understand, and safely operate across every relationship—with AI that reads the
              schema and shows its work.
            </p>
            <div class="concept-cta-row">
              <button class="concept-primary" (click)="newConnection()">
                Fit a connection <span>↗</span>
              </button>
              <button class="concept-secondary" (click)="startTour()">See how it joins</button>
            </div>
          </div>

          <div class="joinery-diagram" aria-hidden="true">
            <span class="diagram-label">RELATION / 03</span>
            <div class="relation-node node-a"><b>customers</b><small>id · name</small></div>
            <div class="relation-link"><span>customer_id</span></div>
            <div class="relation-node node-b"><b>orders</b><small>id · total</small></div>
            <div class="join-status">JOIN VERIFIED <b>18 ms</b></div>
          </div>
        </div>

        <div class="concept-action-grid">
          <button (click)="newConnection()">
            <span>01</span><strong>CONNECT</strong><small>Secure credentials</small>
          </button>
          <button (click)="openDockerSection()">
            <span>02</span><strong>UNDERSTAND</strong><small>{{ dockerStatusText }}</small>
          </button>
          <button (click)="openChat()">
            <span>03</span><strong>QUERY</strong><small>Ask with context</small>
          </button>
          <button (click)="startTour()">
            <span>04</span><strong>VERIFY</strong><small>Inspect every action</small>
          </button>
        </div>
      </section>

      <div class="welcome-content shared-content">
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
                  Joinery speaks SQL Server, PostgreSQL, and MySQL. Make sure your server is
                  reachable over the network — directly or through an SSH tunnel.
                </p>
              </div>
            </div>
            <div class="tip">
              <mat-icon>sailing</mat-icon>
              <div>
                <h4>Use Docker for Local Development</h4>
                <p>
                  Running databases in Docker is the easiest way to develop locally. Joinery detects
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

      .concept-shell {
        --concept-bg: #121514;
        --concept-ink: #f4efe5;
        --concept-muted: #a5aaa5;
        --concept-rule: #363c39;
        --concept-accent: #ff5b35;
        --concept-signal: #c9ff3f;
        position: relative;
        width: min(1120px, 100%);
        height: max-content;
        min-height: 704px;
        margin: 0 auto 48px;
        padding: 30px 34px 0;
        overflow: hidden;
        color: var(--concept-ink);
        background: var(--concept-bg);
        border: 1px solid var(--concept-rule);
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.24);
        font-family: 'IBM Plex Mono', 'JetBrains Mono', monospace;
      }

      .concept-nav,
      .concept-lockup,
      .concept-cta-row,
      .join-status {
        display: flex;
        align-items: center;
      }

      .concept-nav {
        justify-content: space-between;
        padding-bottom: 22px;
        border-bottom: 1px solid var(--concept-rule);
      }

      .concept-lockup {
        gap: 12px;
      }

      .concept-lockup strong {
        color: var(--concept-ink);
        font-family: 'Arial Narrow', 'Helvetica Neue', sans-serif;
        font-size: 22px;
        font-weight: 800;
        letter-spacing: -0.04em;
      }

      .concept-index,
      .concept-kicker,
      .diagram-label {
        color: var(--concept-muted);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.13em;
      }

      .concept-hero-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr);
        gap: clamp(36px, 7vw, 88px);
        align-items: center;
        padding: 54px 4px 48px;
      }

      .concept-copy h1 {
        max-width: 650px;
        margin: 14px 0 18px;
        color: var(--concept-ink);
        font-family: 'Arial Narrow', 'Helvetica Neue', sans-serif;
        font-size: clamp(42px, 5.4vw, 72px);
        font-stretch: condensed;
        font-weight: 900;
        letter-spacing: -0.065em;
        line-height: 0.9;
        text-transform: uppercase;
      }

      .concept-copy h1 em {
        color: var(--concept-accent);
        font-style: normal;
      }

      .concept-copy > p {
        max-width: 610px;
        margin: 0;
        color: var(--concept-muted);
        font-family: 'Inter', sans-serif;
        font-size: 14px;
        line-height: 1.65;
      }

      .concept-cta-row {
        gap: 10px;
        margin-top: 26px;
      }

      .concept-cta-row button {
        min-height: 42px;
        padding: 0 17px;
        border: 1px solid var(--concept-rule);
        border-radius: 0;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.035em;
      }

      .concept-cta-row .concept-primary {
        display: inline-flex;
        gap: 22px;
        align-items: center;
        color: #fff;
        background: var(--concept-accent);
        border-color: var(--concept-accent);
      }

      .concept-cta-row .concept-secondary {
        color: var(--concept-ink);
        background: transparent;
      }

      .concept-action-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        margin: 0 -34px;
        border-top: 1px solid var(--concept-rule);
      }

      .concept-action-grid button {
        position: relative;
        display: grid;
        grid-template-columns: 30px 1fr;
        grid-template-rows: auto auto;
        gap: 1px 10px;
        min-height: 88px;
        padding: 19px 20px;
        color: var(--concept-ink);
        text-align: left;
        border-right: 1px solid var(--concept-rule);
        border-radius: 0;
        transition:
          background 140ms ease,
          color 140ms ease;
      }

      .concept-action-grid button:last-child {
        border-right: 0;
      }

      .concept-action-grid button:hover {
        color: var(--concept-bg);
        background: var(--concept-signal);
      }

      .concept-action-grid span {
        grid-row: 1 / 3;
        color: var(--concept-accent);
        font-size: 10px;
        font-weight: 800;
      }

      .concept-action-grid button:hover span {
        color: var(--concept-bg);
      }

      .concept-action-grid strong {
        font-size: 12px;
        letter-spacing: 0.08em;
      }

      .concept-action-grid small {
        color: var(--concept-muted);
        font-family: 'Inter', sans-serif;
        font-size: 10px;
      }

      .concept-action-grid button:hover small {
        color: color-mix(in srgb, var(--concept-bg) 72%, transparent);
      }

      .joinery-concept {
        --concept-bg: #f2efe7;
        --concept-ink: #171817;
        --concept-muted: #676961;
        --concept-rule: #b9b8ae;
        --concept-accent: #d6492f;
        --concept-signal: #c8f04a;
        background:
          linear-gradient(
            118deg,
            transparent 0 82%,
            rgba(214, 73, 47, 0.08) 82% 86%,
            transparent 86%
          ),
          #f2efe7;
      }

      .joinery-stack-mark {
        position: relative;
        display: inline-block;
        width: 32px;
        height: 32px;
      }

      .joinery-stack-mark span {
        position: absolute;
        left: 3px;
        display: block;
        height: 7px;
        transform: skewX(-24deg);
      }

      .joinery-stack-mark span:nth-child(1) {
        top: 2px;
        width: 27px;
        background: var(--concept-accent);
      }

      .joinery-stack-mark span:nth-child(2) {
        top: 12px;
        width: 20px;
        background: var(--concept-ink);
      }

      .joinery-stack-mark span:nth-child(3) {
        top: 22px;
        width: 13px;
        background: var(--concept-signal);
      }

      .joinery-concept .concept-lockup strong {
        font-family: 'Instrument Sans', 'Inter', sans-serif;
        font-size: 23px;
        letter-spacing: -0.05em;
        text-transform: none;
      }

      .joinery-diagram {
        position: relative;
        min-height: 250px;
        border: 1px solid var(--concept-rule);
        background:
          linear-gradient(rgba(23, 24, 23, 0.06) 1px, transparent 1px) 0 0 / 100% 32px,
          linear-gradient(90deg, rgba(23, 24, 23, 0.06) 1px, transparent 1px) 0 0 / 32px 100%,
          #fbfaf5;
      }

      .diagram-label {
        position: absolute;
        top: 15px;
        left: 17px;
        color: var(--concept-accent);
      }

      .relation-node {
        position: absolute;
        z-index: 1;
        display: flex;
        flex-direction: column;
        width: 142px;
        padding: 14px;
        background: #fbfaf5;
        border: 1px solid var(--concept-ink);
        box-shadow: 6px 6px 0 rgba(23, 24, 23, 0.12);
      }

      .relation-node b {
        font-size: 12px;
      }

      .relation-node small {
        margin-top: 5px;
        color: var(--concept-muted);
        font-size: 9px;
      }

      .node-a {
        top: 70px;
        left: 26px;
      }

      .node-b {
        top: 132px;
        right: 26px;
      }

      .relation-link {
        position: absolute;
        top: 105px;
        left: 142px;
        width: 142px;
        height: 72px;
        border-top: 3px solid var(--concept-accent);
        border-right: 3px solid var(--concept-accent);
      }

      .relation-link span {
        position: absolute;
        top: -18px;
        right: 3px;
        color: var(--concept-accent);
        font-size: 8px;
      }

      .join-status {
        position: absolute;
        right: 16px;
        bottom: 14px;
        gap: 16px;
        padding: 7px 10px;
        color: #171817;
        background: var(--concept-signal);
        font-size: 8px;
        letter-spacing: 0.08em;
      }

      @media (max-width: 860px) {
        .concept-shell {
          padding: 24px 24px 0;
        }

        .concept-index {
          display: none;
        }

        .concept-hero-grid {
          grid-template-columns: 1fr;
          gap: 34px;
          padding: 40px 0;
        }

        .concept-copy h1 {
          font-size: clamp(38px, 11vw, 62px);
        }

        .concept-action-grid {
          grid-template-columns: repeat(2, 1fr);
          margin: 0 -24px;
        }

        .concept-action-grid button:nth-child(2) {
          border-right: 0;
        }

        .concept-action-grid button:nth-child(-n + 2) {
          border-bottom: 1px solid var(--concept-rule);
        }
      }

      @media (max-width: 520px) {
        .welcome-container {
          padding: var(--spacing-md);
        }

        .concept-cta-row {
          align-items: stretch;
          flex-direction: column;
        }

        .concept-action-grid {
          grid-template-columns: 1fr;
        }

        .concept-action-grid button,
        .concept-action-grid button:nth-child(2) {
          border-right: 0;
          border-bottom: 1px solid var(--concept-rule);
        }
      }

      .welcome-content {
        flex: 1;
        max-width: 1120px;
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
    this.ipc.openExternal('https://github.com/cadam11/joinery/wiki').subscribe();
  }

  openGitHub(event: Event): void {
    event.preventDefault();
    this.ipc.openExternal('https://github.com/cadam11/joinery').subscribe();
  }
}
