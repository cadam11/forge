/**
 * Advisory warning banner for copy/paste artifacts in a secret input field
 * (leading/trailing whitespace, line breaks, smart quotes, invisible spaces).
 * Non-blocking: the value is never mutated or rejected — the banner surfaces
 * what the analyzer sees so the user can decide. Renders nothing when the
 * value is empty or clean. The generic 'non-ascii' bucket is omitted so a
 * typed international password (ö, é, …) is not branded a paste artifact;
 * the post-failure diagnostic in the main process keeps it.
 */

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { describePasswordHygiene } from '@mj-forge/shared';

@Component({
  selector: 'app-password-hygiene-warning',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (warnings().length > 0) {
      <div class="password-warning" role="status">
        <mat-icon>warning_amber</mat-icon>
        <div class="password-warning-body">
          <strong>This password may contain copy/paste artifacts.</strong>
          <ul>
            @for (w of warnings(); track w) {
              <li>{{ w }}</li>
            }
          </ul>
          <span class="password-warning-note">
            Special characters are fine — but invisible/look-alike characters cause "Login failed".
            If you didn't intend these, retype the password instead of pasting.
          </span>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* When nothing renders (@if leaves only its comment anchor), collapse
         the host entirely so host-applied margins don't reserve blank space. */
      :host:empty {
        display: none;
      }

      .password-warning {
        display: flex;
        gap: 10px;
        padding: 10px 12px;
        background: var(--warning-bg, rgba(255, 193, 7, 0.12));
        border-left: 3px solid var(--status-warning, #f2a900);
        border-radius: 2px;

        mat-icon {
          color: var(--status-warning, #f2a900);
          font-size: 18px;
          width: 18px;
          height: 18px;
          flex-shrink: 0;
          margin-top: 1px;
        }
      }

      .password-warning-body {
        font-size: 12px;
        line-height: 1.45;
        color: var(--text-primary);

        ul {
          margin: 4px 0;
          padding-left: 18px;
        }

        .password-warning-note {
          color: var(--text-secondary);
          display: block;
          margin-top: 4px;
        }
      }
    `,
  ],
})
export class PasswordHygieneWarningComponent {
  /** The secret value to analyze. Empty or clean values render nothing. */
  readonly value = input<string | undefined>('');

  readonly warnings = computed(() =>
    describePasswordHygiene(this.value() ?? '', { omit: ['non-ascii'] })
  );
}
