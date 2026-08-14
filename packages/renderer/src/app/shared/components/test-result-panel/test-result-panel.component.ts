/**
 * Inline failure panel for a connection Test: the error headline plus every
 * guidance line the main process returned. Renders nothing for null or
 * successful results, so hosts can bind their result signal directly. The
 * guidance list is height-capped and scrolls so a long list can never push
 * the host's action buttons off-screen.
 */

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { TestConnectionResult } from '@forgedb/shared';

@Component({
  selector: 'app-test-result-panel',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (failure(); as result) {
      <div class="test-result-error" role="alert">
        <div class="test-result-header">
          <mat-icon>error_outline</mat-icon>
          <span>{{ result.error || 'Connection failed' }}</span>
        </div>
        @if (result.guidance?.length) {
          <ul>
            @for (g of result.guidance; track $index) {
              <li>{{ g }}</li>
            }
          </ul>
        }
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

      .test-result-error {
        padding: 10px 12px;
        background: var(--error-bg, rgba(244, 67, 54, 0.1));
        border-left: 3px solid var(--status-error, #f44336);
        border-radius: 2px;
        font-size: 13px;
        line-height: 1.45;
        color: var(--text-primary);
        max-height: 200px;
        overflow-y: auto;

        .test-result-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;

          mat-icon {
            color: var(--status-error, #f44336);
            font-size: 18px;
            width: 18px;
            height: 18px;
            flex-shrink: 0;
          }
        }

        ul {
          margin: 6px 0 0;
          padding-left: 26px;
          color: var(--text-secondary);
          font-weight: 400;
        }
      }
    `,
  ],
})
export class TestResultPanelComponent {
  readonly result = input<TestConnectionResult | null>(null);

  readonly failure = computed(() => {
    const r = this.result();
    return r && !r.success ? r : null;
  });
}
