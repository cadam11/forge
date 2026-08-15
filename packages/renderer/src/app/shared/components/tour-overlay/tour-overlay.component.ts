/**
 * Tour Overlay Component
 * AppCues-style spotlight highlight with tooltip for onboarding tours
 */

import { Component, inject, computed, effect, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { OnboardingService } from '../../../core/services/onboarding.service';

@Component({
  selector: 'app-tour-overlay',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (onboarding.visible()) {
      <div class="tour-backdrop" (click)="onBackdropClick($event)">
        <!-- Spotlight cutout is done via CSS box-shadow -->
        <div class="tour-spotlight" [style]="spotlightStyle()"></div>

        <!-- Tooltip -->
        <div class="tour-tooltip" [style]="tooltipStyle()" [class]="'placement-' + currentPlacement()">
          <div class="tooltip-arrow"></div>
          <div class="tooltip-header">
            <h3>{{ onboarding.currentStep()?.title }}</h3>
            <button class="tooltip-close" (click)="dismiss()">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <p class="tooltip-body">{{ onboarding.currentStep()?.description }}</p>
          <div class="tooltip-footer">
            <span class="step-indicator">
              {{ onboarding.currentStepIndex() + 1 }} of {{ onboarding.totalSteps() }}
            </span>
            <div class="tooltip-actions">
              @if (!onboarding.isFirstStep()) {
                <button mat-button (click)="previous()">Back</button>
              }
              @if (onboarding.isLastStep()) {
                <button mat-flat-button color="primary" (click)="finish()">Done</button>
              } @else {
                <button mat-flat-button color="primary" (click)="next()">Next</button>
              }
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .tour-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 10000;
      pointer-events: all;
    }

    .tour-spotlight {
      position: absolute;
      border-radius: 8px;
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
      pointer-events: none;
      transition: all 0.3s ease;
      z-index: 10001;
    }

    .tour-tooltip {
      position: absolute;
      width: 320px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 12px;
      padding: 0;
      z-index: 10002;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      animation: tooltipFadeIn 0.2s ease;
    }

    @keyframes tooltipFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .tooltip-arrow {
      position: absolute;
      width: 12px;
      height: 12px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      transform: rotate(45deg);
    }

    .placement-top .tooltip-arrow {
      bottom: -7px;
      left: 24px;
      border-top: none;
      border-left: none;
    }
    .placement-bottom .tooltip-arrow {
      top: -7px;
      left: 24px;
      border-bottom: none;
      border-right: none;
    }
    .placement-left .tooltip-arrow {
      right: -7px;
      top: 20px;
      border-bottom: none;
      border-left: none;
    }
    .placement-right .tooltip-arrow {
      left: -7px;
      top: 20px;
      border-top: none;
      border-right: none;
    }

    .tooltip-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 16px 0;
    }

    .tooltip-header h3 {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0;
    }

    .tooltip-close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      padding: 2px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
      &:hover { color: var(--text-primary); background: var(--bg-hover); }
    }

    .tooltip-body {
      padding: 8px 16px 12px;
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.5;
      margin: 0;
    }

    .tooltip-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-top: 1px solid var(--border-primary);
    }

    .step-indicator {
      font-size: 12px;
      color: var(--text-muted);
    }

    .tooltip-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
  `],
})
export class TourOverlayComponent {
  readonly onboarding = inject(OnboardingService);

  private targetRect = { top: 0, left: 0, width: 0, height: 0 };

  constructor() {
    // Recompute target position when step changes
    effect(() => {
      const step = this.onboarding.currentStep();
      if (step && this.onboarding.visible()) {
        // Wait a tick for DOM to settle
        requestAnimationFrame(() => this.updateTargetRect());
      }
    });
  }

  readonly currentPlacement = computed(() => this.onboarding.currentStep()?.placement ?? 'bottom');

  readonly spotlightStyle = computed(() => {
    const r = this.targetRect;
    const padding = 8;
    return {
      top: `${r.top - padding}px`,
      left: `${r.left - padding}px`,
      width: `${r.width + padding * 2}px`,
      height: `${r.height + padding * 2}px`,
    };
  });

  readonly tooltipStyle = computed(() => {
    const r = this.targetRect;
    const placement = this.currentPlacement();
    const gap = 16;
    const tooltipWidth = 320;
    const tooltipHeight = 180;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

    let top: number;
    let left: number;

    switch (placement) {
      case 'bottom':
        top = r.top + r.height + gap;
        left = r.left;
        break;
      case 'top':
        top = r.top - gap - tooltipHeight;
        left = r.left;
        break;
      case 'right':
        top = r.top;
        left = r.left + r.width + gap;
        break;
      case 'left':
        top = r.top;
        left = r.left - tooltipWidth - gap;
        break;
      default:
        top = r.top + r.height + gap;
        left = r.left;
    }

    // Clamp within viewport
    left = Math.max(16, Math.min(left, vw - tooltipWidth - 16));
    top = Math.max(16, Math.min(top, vh - tooltipHeight - 16));

    return { top: `${top}px`, left: `${left}px` };
  });

  private updateTargetRect(): void {
    const step = this.onboarding.currentStep();
    if (!step) return;

    const el = document.querySelector(step.target);
    if (el) {
      const rect = el.getBoundingClientRect();
      this.targetRect = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    } else {
      // If target not found, center on screen
      this.targetRect = {
        top: window.innerHeight / 2 - 50,
        left: window.innerWidth / 2 - 100,
        width: 200,
        height: 100,
      };
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    if (this.onboarding.visible()) {
      this.updateTargetRect();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.onboarding.visible()) {
      this.dismiss();
    }
  }

  next(): void {
    this.onboarding.nextStep();
  }

  previous(): void {
    this.onboarding.previousStep();
  }

  finish(): void {
    this.onboarding.nextStep(); // Will complete the tour
  }

  dismiss(): void {
    this.onboarding.dismissTour();
  }

  onBackdropClick(event: MouseEvent): void {
    // Only dismiss if clicking the backdrop itself, not the tooltip
    if ((event.target as HTMLElement).classList.contains('tour-backdrop')) {
      this.dismiss();
    }
  }
}
