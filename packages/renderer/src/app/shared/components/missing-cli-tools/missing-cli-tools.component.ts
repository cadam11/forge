/**
 * Missing CLI Tools — setup-instructions card.
 *
 * Renders inside the Backup/Restore dialog when the host is missing one
 * of the engine-specific binaries Forge shells out to (pg_dump,
 * pg_restore, mysqldump, mysql). Shows the platform-appropriate install
 * steps sourced from `@forgedb/shared`'s `getCliInstallInstructions`,
 * along with which tools were probed and which came back missing.
 *
 * The host gets a "Re-check" button so they can install the tools in a
 * separate terminal, click re-check, and proceed without closing the
 * dialog.
 */

import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { CliInstallInstructions, CliInstallStep, CliToolStatus } from '@forgedb/shared';

@Component({
  selector: 'app-missing-cli-tools',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <section class="missing-tools" data-testid="missing-cli-tools">
      <header class="header">
        <mat-icon class="warn-icon">warning_amber</mat-icon>
        <div class="header-text">
          <h3>{{ instructions.title }}</h3>
          <p class="lede">
            Forge needs the
            {{ engineLabel() }} command-line tools installed on this machine to back up and restore
            databases. They are not bundled with the app.
          </p>
        </div>
      </header>

      <div class="tools-status" *ngIf="tools.length">
        <span class="tools-status-label">Probed:</span>
        <ul class="tools-list">
          <li
            *ngFor="let tool of tools"
            class="tool-row"
            [class.missing]="!tool.available"
            [attr.data-testid]="'tool-status-' + tool.tool"
          >
            <mat-icon class="tool-icon">{{ tool.available ? 'check_circle' : 'cancel' }}</mat-icon>
            <code>{{ tool.tool }}</code>
            <span class="tool-version" *ngIf="tool.version">{{ tool.version }}</span>
            <span class="tool-missing-tag" *ngIf="!tool.available">missing</span>
          </li>
        </ul>
      </div>

      <ol class="steps">
        <li *ngFor="let step of instructions.steps; let i = index" class="step">
          <div class="step-num">{{ i + 1 }}</div>
          <div class="step-body">
            <p class="step-desc">{{ step.description }}</p>
            <div class="step-command" *ngIf="step.command">
              <code>{{ step.command }}</code>
              <button
                mat-icon-button
                class="copy-btn"
                matTooltip="Copy"
                (click)="copy(step)"
                aria-label="Copy command"
              >
                <mat-icon>content_copy</mat-icon>
              </button>
            </div>
            <a
              *ngIf="step.link"
              class="step-link"
              href="javascript:void(0)"
              (click)="openExternal(step.link.url)"
            >
              <mat-icon>open_in_new</mat-icon>
              <span>{{ step.link.label }}</span>
            </a>
          </div>
        </li>
      </ol>

      <ul class="notes" *ngIf="instructions.notes?.length">
        <li *ngFor="let note of instructions.notes">{{ note }}</li>
      </ul>

      <div class="actions">
        <button
          mat-flat-button
          color="primary"
          (click)="recheck.emit()"
          [disabled]="rechecking"
          data-testid="missing-cli-tools-recheck"
        >
          <mat-icon [class.spinning]="rechecking">{{ rechecking ? 'sync' : 'refresh' }}</mat-icon>
          <span>{{ rechecking ? 'Re-checking...' : 'Re-check' }}</span>
        </button>
      </div>
    </section>
  `,
  styles: [
    `
      .missing-tools {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 4px 0;
      }

      .header {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }

      .warn-icon {
        color: var(--status-warning, #f59e0b);
        font-size: 32px;
        width: 32px;
        height: 32px;
        flex-shrink: 0;
      }

      .header-text h3 {
        margin: 0 0 4px 0;
        font-size: 16px;
        font-weight: 600;
      }

      .lede {
        margin: 0;
        font-size: 13px;
        color: var(--text-secondary);
      }

      .tools-status {
        padding: 10px 12px;
        background-color: var(--bg-tertiary);
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .tools-status-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .tools-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .tool-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }

      .tool-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--status-success, #10b981);
      }

      .tool-row.missing .tool-icon {
        color: var(--status-error, #ef4444);
      }

      .tool-row code {
        font-family: var(--font-mono);
        font-size: 12px;
      }

      .tool-version {
        font-size: 11px;
        color: var(--text-muted);
        font-family: var(--font-mono);
      }

      .tool-missing-tag {
        font-size: 10px;
        font-weight: 600;
        color: var(--status-error, #ef4444);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .steps {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .step {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }

      .step-num {
        flex-shrink: 0;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background-color: var(--accent-primary, #6366f1);
        color: white;
        font-size: 12px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
      }

      .step-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .step-desc {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
      }

      .step-command {
        display: flex;
        align-items: center;
        gap: 4px;
        background-color: var(--bg-primary);
        border: 1px solid var(--border-primary);
        border-radius: 4px;
        padding: 6px 8px;
      }

      .step-command code {
        flex: 1;
        font-family: var(--font-mono);
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-all;
      }

      .copy-btn mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      .step-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--accent-primary, #6366f1);
        font-size: 13px;
        text-decoration: none;
      }

      .step-link mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }

      .step-link:hover {
        text-decoration: underline;
      }

      .notes {
        list-style: disc inside;
        margin: 0;
        padding: 10px 12px;
        background-color: var(--bg-tertiary);
        border-radius: 6px;
        font-size: 12px;
        color: var(--text-secondary);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .notes li {
        line-height: 1.5;
      }

      .actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }

      .actions button mat-icon + span {
        margin-left: 4px;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .spinning {
        animation: spin 1s linear infinite;
      }
    `,
  ],
})
export class MissingCliToolsComponent {
  @Input({ required: true }) instructions!: CliInstallInstructions;
  @Input() tools: CliToolStatus[] = [];
  @Input() rechecking = false;

  @Output() readonly recheck = new EventEmitter<void>();
  @Output() readonly copyCommand = new EventEmitter<string>();
  @Output() readonly openLink = new EventEmitter<string>();

  engineLabel(): string {
    return this.instructions.engine === 'postgresql' ? 'PostgreSQL' : 'MySQL';
  }

  copy(step: CliInstallStep): void {
    if (step.command) this.copyCommand.emit(step.command);
  }

  openExternal(url: string): void {
    this.openLink.emit(url);
  }
}
