/**
 * AI Setup Dialog - First-time setup for AI features
 */

import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AIStateService } from '../../../core/state/ai.state';

interface ProviderOption {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
}

@Component({
  selector: 'app-ai-setup-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="ai-setup">
      <div class="setup-header">
        <span class="sparkle">✨</span>
        <h2>Set Up AI Features</h2>
      </div>

      <div class="setup-body">
        <p class="setup-description">
          Choose an AI provider to enable smart autocomplete, chat assistant, and result analysis.
        </p>

        <label class="field-label">Choose Provider</label>
        <div class="provider-cards">
          @for (provider of providers; track provider.id) {
            <div class="provider-card"
                 [class.selected]="selectedProvider() === provider.id"
                 (click)="selectProvider(provider.id)">
              <h4>
                {{ provider.name }}
                @if (provider.recommended) {
                  <span class="recommended">Recommended</span>
                }
              </h4>
              <p>{{ provider.description }}</p>
            </div>
          }
        </div>

        <div class="form-group">
          <label class="field-label">API Key</label>
          <input
            class="form-input"
            type="password"
            [placeholder]="'Enter your ' + selectedProviderName() + ' API key'"
            [(ngModel)]="apiKey"
          />
          @if (validationStatus() === 'success') {
            <div class="validation-badge success">✓ Key validated successfully</div>
          } @else if (validationStatus() === 'error') {
            <div class="validation-badge error">✗ Invalid API key</div>
          }
        </div>

        <div class="features-box">
          <div class="features-title">Features Enabled:</div>
          <div class="features-list">
            <div>✅ Smart SQL Autocomplete</div>
            <div>✅ AI Chat Assistant with tool calling</div>
            <div>✅ Query result analysis</div>
            <div>✅ Intelligent tab renaming</div>
          </div>
        </div>
      </div>

      <div class="setup-footer">
        <button class="btn-secondary" (click)="cancel()">Cancel</button>
        <button class="btn-primary" (click)="save()" [disabled]="!apiKey || saving()">
          @if (saving()) {
            <mat-spinner diameter="16"></mat-spinner>
          }
          Enable AI
        </button>
      </div>
    </div>
  `,
  styles: [`
    .ai-setup {
      width: 480px;
      background: var(--bg-secondary);
      border-radius: 12px;
      overflow: hidden;
    }

    .setup-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 20px 24px 0;
    }
    .sparkle { font-size: 24px; }
    .setup-header h2 {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0;
    }

    .setup-body { padding: 16px 24px; }

    .setup-description {
      color: var(--text-secondary);
      font-size: 13px;
      margin: 0 0 16px;
      line-height: 1.5;
    }

    .field-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      display: block;
      margin-bottom: 8px;
    }

    .provider-cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 16px;
    }
    .provider-card {
      padding: 12px;
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
      background: var(--bg-primary);
    }
    .provider-card:hover { border-color: var(--accent); }
    .provider-card.selected {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary));
    }
    .provider-card h4 {
      font-size: 13px;
      font-weight: 600;
      margin: 0 0 4px;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .provider-card p {
      font-size: 11px;
      color: var(--text-secondary);
      margin: 0;
      line-height: 1.4;
    }
    .recommended {
      font-size: 9px;
      background: var(--accent);
      color: white;
      padding: 1px 6px;
      border-radius: 8px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .form-group { margin-bottom: 16px; }
    .form-input {
      width: 100%;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 10px 12px;
      color: var(--text-primary);
      font-size: 13px;
      outline: none;
      box-sizing: border-box;
    }
    .form-input:focus { border-color: var(--accent); }
    .form-input::placeholder { color: var(--text-muted); }

    .validation-badge {
      font-size: 11px;
      margin-top: 6px;
      padding: 4px 8px;
      border-radius: 4px;
    }
    .validation-badge.success { color: var(--status-success); background: color-mix(in srgb, var(--status-success) 10%, transparent); }
    .validation-badge.error { color: var(--status-error); background: color-mix(in srgb, var(--status-error) 10%, transparent); }

    .features-box {
      background: var(--bg-tertiary);
      border-radius: 8px;
      padding: 12px;
    }
    .features-title { font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary); }
    .features-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .setup-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 16px 24px;
      border-top: 1px solid var(--border-primary);
    }
    .btn-secondary {
      background: none;
      border: 1px solid var(--border-primary);
      color: var(--text-secondary);
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
    }
    .btn-secondary:hover { background: var(--bg-hover); }
    .btn-primary {
      background: var(--accent);
      border: none;
      color: white;
      padding: 8px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-primary:disabled { opacity: 0.5; cursor: default; }
  `],
})
export class AISetupDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<AISetupDialogComponent>);
  private readonly aiState = inject(AIStateService);

  readonly selectedProvider = signal('google');
  readonly validationStatus = signal<'none' | 'success' | 'error'>('none');
  readonly saving = signal(false);
  apiKey = '';

  readonly providers: ProviderOption[] = [
    { id: 'google', name: 'Google Gemini', description: 'Fast, affordable. Great for autocomplete and chat.', recommended: true },
    { id: 'openai', name: 'OpenAI', description: 'GPT-4o, GPT-4o-mini. Industry standard.' },
    { id: 'anthropic', name: 'Anthropic', description: 'Claude Sonnet/Haiku. Excellent reasoning.' },
    { id: 'groq', name: 'Groq', description: 'Ultra-fast inference. Free tier available.' },
  ];

  readonly selectedProviderName = () => {
    return this.providers.find(p => p.id === this.selectedProvider())?.name || 'AI';
  };

  selectProvider(id: string): void {
    this.selectedProvider.set(id);
    this.validationStatus.set('none');
  }

  async save(): Promise<void> {
    if (!this.apiKey) return;
    this.saving.set(true);

    try {
      const success = await this.aiState.setApiKey(this.selectedProvider(), this.apiKey);
      if (success) {
        this.validationStatus.set('success');
        await this.aiState.setEnabled(true);
        this.dialogRef.close(true);
      } else {
        this.validationStatus.set('error');
      }
    } catch {
      this.validationStatus.set('error');
    } finally {
      this.saving.set(false);
    }
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
