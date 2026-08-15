import { Component, EventEmitter, Output, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

export interface InputDialogConfig {
  title: string;
  message?: string;
  inputLabel: string;
  inputValue?: string;
  inputPlaceholder?: string;
  confirmText?: string;
  cancelText?: string;
  /** Validation function - return error message or null if valid */
  validate?: (value: string) => string | null;
}

@Component({
  selector: 'app-input-dialog',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  template: `
    @if (isOpen()) {
      <div class="dialog-overlay" (click)="cancel()">
        <div class="dialog-container" (click)="$event.stopPropagation()">
          <header class="dialog-header">
            <mat-icon>edit</mat-icon>
            <h3>{{ config()?.title }}</h3>
          </header>

          <div class="dialog-body">
            @if (config()?.message) {
              <p class="message">{{ config()?.message }}</p>
            }
            <div class="input-group">
              <label>{{ config()?.inputLabel }}</label>
              <input
                #inputEl
                type="text"
                [value]="inputValue()"
                [placeholder]="config()?.inputPlaceholder || ''"
                (input)="onInputChange($event)"
                (keydown.enter)="onConfirm()"
                (keydown.escape)="cancel()"
              />
              @if (validationError()) {
                <span class="error">{{ validationError() }}</span>
              }
            </div>
          </div>

          <footer class="dialog-footer">
            <button mat-stroked-button (click)="cancel()">
              {{ config()?.cancelText || 'Cancel' }}
            </button>
            <button mat-flat-button color="primary" [disabled]="!isValid()" (click)="onConfirm()">
              {{ config()?.confirmText || 'OK' }}
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
          color: var(--status-info);
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

        .message {
          margin: 0 0 var(--spacing-md);
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .input-group {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-xs);

          label {
            font-size: var(--font-size-sm);
            font-weight: 500;
            color: var(--text-secondary);
          }

          input {
            width: 100%;
            padding: var(--spacing-sm) var(--spacing-md);
            border: 1px solid var(--border-primary);
            border-radius: var(--radius-md);
            background-color: var(--bg-primary);
            color: var(--text-primary);
            font-size: var(--font-size-md);

            &:focus {
              outline: none;
              border-color: var(--border-focus);
            }
          }

          .error {
            font-size: var(--font-size-xs);
            color: var(--status-error);
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
      }
    `,
  ],
})
export class InputDialogComponent {
  @ViewChild('inputEl') inputEl?: ElementRef<HTMLInputElement>;

  private readonly _isOpen = signal(false);
  private readonly _config = signal<InputDialogConfig | null>(null);
  readonly inputValue = signal('');
  readonly validationError = signal<string | null>(null);

  readonly isOpen = this._isOpen.asReadonly();
  readonly config = this._config.asReadonly();

  @Output() confirmed = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  isValid(): boolean {
    const value = this.inputValue();
    if (!value.trim()) return false;

    const cfg = this._config();
    if (cfg?.validate) {
      const error = cfg.validate(value);
      return error === null;
    }
    return true;
  }

  open(config: InputDialogConfig): void {
    this._config.set(config);
    this.inputValue.set(config.inputValue || '');
    this.validationError.set(null);
    this._isOpen.set(true);

    // Focus input after dialog opens
    setTimeout(() => {
      this.inputEl?.nativeElement?.focus();
      this.inputEl?.nativeElement?.select();
    }, 50);
  }

  close(): void {
    this._isOpen.set(false);
    this._config.set(null);
    this.inputValue.set('');
    this.validationError.set(null);
  }

  onInputChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = target.value;
    this.inputValue.set(value);

    // Validate on change
    const cfg = this._config();
    if (cfg?.validate) {
      this.validationError.set(cfg.validate(value));
    }
  }

  onConfirm(): void {
    if (!this.isValid()) return;
    this.confirmed.emit(this.inputValue());
    this.close();
  }

  cancel(): void {
    this.cancelled.emit();
    this.close();
  }
}
