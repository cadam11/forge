import { Component, EventEmitter, HostListener, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

export interface ConfirmDialogConfig {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'info' | 'warning' | 'danger';
  /** If provided, user must type this text to confirm */
  confirmationInput?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  template: `
    @if (isOpen()) {
      <div class="dialog-overlay" (click)="cancel()">
        <div
          class="dialog-container"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="'confirm-dialog-title'"
          [class]="config()?.type || 'info'"
          (click)="$event.stopPropagation()"
        >
          <header class="dialog-header">
            <mat-icon [class]="'icon-' + (config()?.type || 'info')">
              @switch (config()?.type) {
                @case ('danger') {
                  warning
                }
                @case ('warning') {
                  error_outline
                }
                @default {
                  info
                }
              }
            </mat-icon>
            <h3 id="confirm-dialog-title">{{ config()?.title }}</h3>
          </header>

          <div class="dialog-body">
            <p>{{ config()?.message }}</p>
            @if (config()?.confirmationInput) {
              <div class="confirmation-input">
                <p class="input-hint">
                  Type <strong>{{ config()?.confirmationInput }}</strong> to confirm:
                </p>
                <input
                  type="text"
                  [attr.aria-label]="'Type ' + config()?.confirmationInput + ' to confirm'"
                  [value]="inputValue()"
                  (input)="onInputChange($event)"
                  (keydown.enter)="onConfirm()"
                  #confirmInput
                />
              </div>
            }
          </div>

          <footer class="dialog-footer">
            <button mat-stroked-button (click)="cancel()">
              {{ config()?.cancelText || 'Cancel' }}
            </button>
            <button
              mat-flat-button
              [class]="'btn-' + (config()?.type || 'info')"
              [disabled]="confirmDisabled()"
              (click)="onConfirm()"
            >
              {{ config()?.confirmText || 'Confirm' }}
            </button>
          </footer>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        z-index: 2000;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.15s ease;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .dialog-container {
        background-color: var(--bg-secondary);
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-primary);
        box-shadow: var(--shadow-lg);
        width: 400px;
        max-width: 90vw;
        animation: slideIn 0.2s ease;
      }

      @keyframes slideIn {
        from {
          transform: scale(0.95);
          opacity: 0;
        }
        to {
          transform: scale(1);
          opacity: 1;
        }
      }

      .dialog-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--border-primary);

        mat-icon {
          font-size: 24px;
          width: 24px;
          height: 24px;

          &.icon-info {
            color: var(--status-info);
          }
          &.icon-warning {
            color: var(--status-warning);
          }
          &.icon-danger {
            color: var(--status-error);
          }
        }

        h3 {
          margin: 0;
          font-size: var(--font-size-lg);
          font-weight: 600;
          color: var(--text-primary);
        }
      }

      .dialog-body {
        padding: var(--spacing-md);

        p {
          margin: 0;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .confirmation-input {
          margin-top: var(--spacing-md);

          .input-hint {
            font-size: var(--font-size-sm);
            margin-bottom: var(--spacing-xs);
          }

          input {
            width: 100%;
            padding: var(--spacing-sm) var(--spacing-md);
            border: 1px solid var(--border-primary);
            border-radius: var(--radius-md);
            background-color: var(--bg-primary);
            color: var(--text-primary);
            font-size: var(--font-size-md);
            font-family: var(--font-mono);

            &:focus {
              outline: none;
              border-color: var(--border-focus);
            }
          }
        }
      }

      .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);
        border-radius: 0 0 var(--radius-lg) var(--radius-lg);

        button {
          min-width: 80px;
        }

        .btn-danger {
          background-color: var(--status-error);
          color: white;

          &:hover:not(:disabled) {
            filter: brightness(0.85);
          }

          &:disabled {
            opacity: 0.5;
          }
        }

        .btn-warning {
          background-color: var(--status-warning);
          color: #000;

          &:hover:not(:disabled) {
            filter: brightness(0.85);
          }
        }

        .btn-info {
          background-color: var(--status-info);
          color: white;

          &:hover:not(:disabled) {
            filter: brightness(0.85);
          }
        }
      }
    `,
  ],
})
export class ConfirmDialogComponent {
  private readonly _isOpen = signal(false);
  private readonly _config = signal<ConfirmDialogConfig | null>(null);
  readonly inputValue = signal('');

  readonly isOpen = this._isOpen.asReadonly();
  readonly config = this._config.asReadonly();

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this._isOpen()) {
      this.cancel();
    }
  }

  confirmDisabled(): boolean {
    const cfg = this._config();
    if (!cfg?.confirmationInput) return false;
    return this.inputValue() !== cfg.confirmationInput;
  }

  open(config: ConfirmDialogConfig): void {
    this._config.set(config);
    this.inputValue.set('');
    this._isOpen.set(true);
  }

  close(): void {
    this._isOpen.set(false);
    this._config.set(null);
    this.inputValue.set('');
  }

  onInputChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.inputValue.set(target.value);
  }

  onConfirm(): void {
    if (this.confirmDisabled()) return;
    this.confirmed.emit();
    this.close();
  }

  cancel(): void {
    this.cancelled.emit();
    this.close();
  }
}
