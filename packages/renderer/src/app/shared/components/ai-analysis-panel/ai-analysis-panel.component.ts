/**
 * AI Analysis Panel Component
 * Provides AI-powered insights for query results
 */

import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { LoadingComponent } from '../loading/loading.component';
import { MarkdownViewerComponent } from '../../markdown/markdown-viewer.component';
import { AIStateService } from '../../../core/state/ai.state';
import type { ResultSet } from '@forgedb/shared';

interface QuickAction {
  id: string;
  label: string;
  icon: string;
  prompt: string;
}

@Component({
  selector: 'app-ai-analysis-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    LoadingComponent,
    MarkdownViewerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="ai-analysis-panel"
      [class.collapsed]="collapsed() && !embedded"
      [class.embedded]="embedded"
    >
      <!-- Header (only when not embedded) -->
      @if (!embedded) {
        <div
          class="panel-header"
          tabindex="0"
          role="button"
          aria-label="Toggle AI analysis"
          (click)="toggleCollapsed()"
          (keydown.enter)="toggleCollapsed()"
          (keydown.space)="toggleCollapsed(); $event.preventDefault()"
        >
          <div class="header-left">
            <mat-icon>auto_awesome</mat-icon>
            <span class="header-title">AI Analysis</span>
            @if (aiState.analyzingResults()) {
              <mat-spinner diameter="14"></mat-spinner>
            }
          </div>
          <button
            mat-icon-button
            class="collapse-btn"
            (click)="$event.stopPropagation(); toggleCollapsed()"
          >
            <mat-icon>{{ collapsed() ? 'expand_less' : 'expand_more' }}</mat-icon>
          </button>
        </div>
      }

      @if (!collapsed() || embedded) {
        <div class="panel-content">
          @if (!aiState.hasConfiguredVendors()) {
            <!-- No AI configured -->
            <div class="no-ai-message">
              <mat-icon>info</mat-icon>
              <span>Configure an AI provider in Settings to enable analysis</span>
            </div>
          } @else if (!sql || !resultSet) {
            <!-- No data to analyze -->
            <div class="no-data-message">
              <mat-icon>analytics</mat-icon>
              <span>Execute a query to analyze results</span>
            </div>
          } @else {
            <!-- Quick Actions -->
            <div class="quick-actions">
              @for (action of quickActions; track action.id) {
                <button
                  mat-stroked-button
                  class="quick-action-btn"
                  [disabled]="aiState.analyzingResults()"
                  (click)="runQuickAction(action)"
                >
                  <mat-icon>{{ action.icon }}</mat-icon>
                  {{ action.label }}
                </button>
              }
            </div>

            <!-- Custom Prompt Input -->
            <div class="prompt-input-section">
              <input
                type="text"
                class="prompt-input"
                [placeholder]="'Ask about these results...'"
                [(ngModel)]="customPrompt"
                (keydown.enter)="analyzeWithPrompt()"
                [disabled]="aiState.analyzingResults()"
              />
              <button
                mat-icon-button
                class="send-btn"
                [disabled]="!customPrompt || aiState.analyzingResults()"
                (click)="analyzeWithPrompt()"
                matTooltip="Analyze"
              >
                <mat-icon>send</mat-icon>
              </button>
            </div>

            <!-- Loading State -->
            @if (aiState.analyzingResults()) {
              <div class="analysis-loading">
                <app-loading
                  text="Analyzing results..."
                  size="medium"
                  animation="pulse"
                ></app-loading>
              </div>
            }

            <!-- Analysis Result -->
            @if (analysisContent() && !aiState.analyzingResults()) {
              <div class="analysis-result">
                <div class="result-header">
                  <span class="result-label">Analysis</span>
                  <button
                    mat-icon-button
                    class="copy-btn"
                    matTooltip="Copy to clipboard"
                    (click)="copyAnalysis()"
                  >
                    <mat-icon>content_copy</mat-icon>
                  </button>
                </div>
                <div class="result-content">
                  <app-markdown [data]="analysisContent()" />
                </div>
              </div>
            }

            @if (analysisError() && !aiState.analyzingResults()) {
              <div class="analysis-error">
                <mat-icon>error</mat-icon>
                <span>{{ analysisError() }}</span>
              </div>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .ai-analysis-panel {
        display: flex;
        flex-direction: column;
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        overflow: hidden;
        transition: all var(--transition-normal);

        &.collapsed {
          .panel-content {
            display: none;
          }
        }

        &.embedded {
          border: none;
          border-radius: 0;
          background-color: transparent;
          height: 100%;

          .panel-content {
            flex: 1;
            overflow-y: auto;
          }
        }
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-tertiary);
        cursor: pointer;
        user-select: none;

        &:hover {
          background-color: var(--bg-hover);
        }
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--status-info);
        }
      }

      .header-title {
        font-size: var(--font-size-sm);
        font-weight: 500;
        color: var(--text-primary);
      }

      .collapse-btn {
        width: 24px;
        height: 24px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }

      .panel-content {
        padding: var(--spacing-md);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .no-ai-message,
      .no-data-message {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--text-muted);
        }
      }

      .quick-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .quick-action-btn {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-size: var(--font-size-xs);
        padding: var(--spacing-xs) var(--spacing-sm);

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }
      }

      .prompt-input-section {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
      }

      .prompt-input {
        flex: 1;
        padding: var(--spacing-sm) var(--spacing-md);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        background-color: var(--bg-primary);
        color: var(--text-primary);
        font-size: var(--font-size-sm);

        &:focus {
          outline: none;
          border-color: var(--status-info);
        }

        &::placeholder {
          color: var(--text-muted);
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .send-btn {
        width: 32px;
        height: 32px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--status-info);
        }

        &:disabled mat-icon {
          color: var(--text-muted);
        }
      }

      .analysis-result {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);
        border-left: 3px solid var(--status-info);
      }

      .result-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .result-label {
        font-size: var(--font-size-xs);
        font-weight: 500;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .copy-btn {
        width: 24px;
        height: 24px;

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }
      }

      // These now style markup rendered inside app-markdown, a separate component,
      // so they must pierce view encapsulation. The old white-space: pre-wrap is
      // gone with the hand-rolled markdown — real block elements carry their own
      // spacing, and preserving newlines on top of them double-spaces everything.
      .result-content {
        font-size: var(--font-size-sm);
        color: var(--text-primary);
        line-height: 1.6;

        ::ng-deep p {
          margin: 0 0 var(--spacing-sm);

          &:last-child {
            margin-bottom: 0;
          }
        }

        ::ng-deep ul,
        ::ng-deep ol {
          margin: 0 0 var(--spacing-sm);
          padding-left: var(--spacing-lg);
        }

        ::ng-deep code {
          background-color: var(--bg-tertiary);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
          font-family: var(--font-mono);
          font-size: var(--font-size-xs);
        }

        ::ng-deep pre {
          background-color: var(--bg-tertiary);
          padding: var(--spacing-sm);
          border-radius: var(--radius-md);
          overflow-x: auto;

          code {
            background: none;
            padding: 0;
          }
        }
      }

      .analysis-error {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: rgba(244, 67, 54, 0.1);
        border-radius: var(--radius-md);
        color: var(--status-error);
        font-size: var(--font-size-sm);

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }

      .analysis-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-lg);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);
        border-left: 3px solid var(--status-info);
        min-height: 100px;
      }
    `,
  ],
})
export class AIAnalysisPanelComponent {
  readonly aiState = inject(AIStateService);

  @Input() sql: string = '';
  @Input() resultSet: ResultSet | null = null;
  @Input() databaseName: string = '';
  @Input() embedded: boolean = false;

  @Output() readonly analysisRequested = new EventEmitter<string>();

  // Local state
  readonly collapsed = signal(false);
  readonly analysisContent = signal<string>('');
  readonly analysisError = signal<string>('');
  customPrompt = '';

  // Quick actions
  readonly quickActions: QuickAction[] = [
    {
      id: 'summarize',
      label: 'Summarize',
      icon: 'summarize',
      prompt: 'Provide a brief summary of these query results. What are the key findings?',
    },
    {
      id: 'patterns',
      label: 'Find Patterns',
      icon: 'insights',
      prompt: 'Identify any interesting patterns, trends, or anomalies in these results.',
    },
    {
      id: 'suggestions',
      label: 'Suggestions',
      icon: 'lightbulb',
      prompt: 'Based on these results, what follow-up queries or investigations would you suggest?',
    },
  ];

  toggleCollapsed(): void {
    this.collapsed.update(c => !c);
  }

  async runQuickAction(action: QuickAction): Promise<void> {
    await this.analyze(action.prompt);
  }

  async analyzeWithPrompt(): Promise<void> {
    if (!this.customPrompt) return;
    const prompt = this.customPrompt;
    this.customPrompt = '';
    await this.analyze(prompt);
  }

  async analyze(prompt: string): Promise<void> {
    if (!this.sql || !this.resultSet) return;

    this.analysisError.set('');
    this.analysisContent.set('');
    this.analysisRequested.emit(prompt);

    try {
      const response = await this.aiState.analyzeResults({
        sql: this.sql,
        resultSummary: {
          columnCount: this.resultSet.columns.length,
          rowCount: this.resultSet.rowCount ?? this.resultSet.rows.length,
          columns: this.resultSet.columns.map(c => ({
            name: c.name,
            type: c.type,
          })),
          sampleRows: this.resultSet.rows.slice(0, 10),
        },
        prompt,
      });

      if (response) {
        this.analysisContent.set(response.content);
      } else {
        this.analysisError.set('Failed to get analysis. Please try again.');
      }
    } catch (error) {
      this.analysisError.set(error instanceof Error ? error.message : 'An error occurred');
    }
  }

  copyAnalysis(): void {
    const content = this.analysisContent();
    if (content) {
      navigator.clipboard.writeText(content);
    }
  }
}
