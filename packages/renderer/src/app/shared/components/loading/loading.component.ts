import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type LoadingSize = 'small' | 'medium' | 'large';
export type LoadingAnimation = 'pulse';

const DEFAULT_SIZE: LoadingSize = 'medium';
const DEFAULT_ANIMATION: LoadingAnimation = 'pulse';

/** Maps a `size` input to its CSS class. Keyed loosely (`Record<string, string>`)
 *  so an out-of-vocabulary value at runtime falls back instead of producing `undefined`. */
const SIZE_CLASSES: Record<string, string> = {
  small: 'loading-size-small',
  medium: 'loading-size-medium',
  large: 'loading-size-large',
};

/** Maps an `animation` input to its CSS class. Same loose-key rationale as SIZE_CLASSES. */
const ANIMATION_CLASSES: Record<string, string> = {
  pulse: 'loading-animation-pulse',
};

/**
 * App-owned loading indicator, replacing the previous third-party loading component.
 * Same input names/vocabulary as before so call sites are a pure tag rename.
 * Pure/presentational: no lifecycle hooks, no I/O, no outputs, nothing that can fail.
 */
@Component({
  selector: 'app-loading',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="loading-root" [ngClass]="sizeClass">
      <div class="loading-mark" [ngClass]="animationClass">
        <svg viewBox="0 0 24 24" class="loading-mark-svg" aria-hidden="true">
          <circle class="loading-mark-ring" cx="12" cy="12" r="9" fill="none" stroke-width="2.5" />
        </svg>
      </div>
      @if (text) {
        <span class="loading-text">{{ text }}</span>
      }
    </div>
  `,
  styles: [
    `
      .loading-root {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .loading-mark {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .loading-mark-svg {
        width: 100%;
        height: 100%;
      }

      .loading-mark-ring {
        stroke: var(--accent);
      }

      .loading-text {
        color: var(--text-secondary);
        font-size: var(--font-size-sm, 13px);
        text-align: center;
      }

      /* Size presets, matching the previous loading component's dimensions. */
      .loading-size-small {
        .loading-mark {
          width: 40px;
          height: 22px;
        }
      }

      .loading-size-medium {
        .loading-mark {
          width: 80px;
          height: 45px;
        }
      }

      .loading-size-large {
        .loading-mark {
          width: 120px;
          height: 67px;
        }
      }

      /* Pulse animation: opacity 1 -> 0.4 -> 1, scale 1 -> 0.96 -> 1, 1.5s loop. */
      .loading-animation-pulse {
        animation: loading-pulse 1.5s ease-in-out infinite;
      }

      @keyframes loading-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.4;
          transform: scale(0.96);
        }
      }
    `,
  ],
})
export class LoadingComponent {
  @Input() text = '';
  @Input() size: LoadingSize = DEFAULT_SIZE;
  @Input() animation: LoadingAnimation = DEFAULT_ANIMATION;

  get sizeClass(): string {
    return SIZE_CLASSES[this.size] ?? SIZE_CLASSES[DEFAULT_SIZE];
  }

  get animationClass(): string {
    return ANIMATION_CLASSES[this.animation] ?? ANIMATION_CLASSES[DEFAULT_ANIMATION];
  }
}
