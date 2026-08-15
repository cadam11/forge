/**
 * Onboarding Tour Service
 * AppCues-style guided discovery with highlight overlays
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { SettingsService } from './settings.service';

export interface TourStep {
  /** CSS selector for the target element to highlight */
  target: string;
  /** Title of the step */
  title: string;
  /** Description text */
  description: string;
  /** Position of the tooltip relative to the target */
  placement: 'top' | 'bottom' | 'left' | 'right';
  /** Optional action to perform when this step is shown */
  onShow?: () => void;
}

export interface Tour {
  id: string;
  name: string;
  steps: TourStep[];
}

const STORAGE_KEY = 'joinery:completed-tours';

@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private readonly settings = inject(SettingsService);

  private readonly _activeTour = signal<Tour | null>(null);
  private readonly _currentStepIndex = signal(0);
  private readonly _visible = signal(false);

  readonly activeTour = this._activeTour.asReadonly();
  readonly currentStepIndex = this._currentStepIndex.asReadonly();
  readonly visible = this._visible.asReadonly();

  readonly currentStep = computed(() => {
    const tour = this._activeTour();
    const index = this._currentStepIndex();
    return tour?.steps[index] ?? null;
  });

  readonly totalSteps = computed(() => this._activeTour()?.steps.length ?? 0);
  readonly isLastStep = computed(() => this._currentStepIndex() >= this.totalSteps() - 1);
  readonly isFirstStep = computed(() => this._currentStepIndex() === 0);

  private completedTours: Set<string>;

  constructor() {
    this.completedTours = this.loadCompletedTours();
  }

  /** Pre-defined tours */
  readonly tours: Record<string, Tour> = {
    welcome: {
      id: 'welcome',
      name: 'Welcome Tour',
      steps: [
        {
          target: '.sidebar',
          title: 'Object Explorer',
          description:
            'Browse your databases, tables, views, and stored procedures in the sidebar.',
          placement: 'right',
        },
        {
          target: '.content-area',
          title: 'Query Editor',
          description:
            'Write and execute SQL queries here. Use Cmd+Enter to run, or highlight text and press Cmd+Shift+Enter to run a selection.',
          placement: 'bottom',
        },
        {
          target: '.status-bar',
          title: 'Status Bar',
          description:
            'See your connection status, running queries, theme toggle, and Docker containers at a glance.',
          placement: 'top',
        },
      ],
    },
    ai: {
      id: 'ai',
      name: 'AI Features Tour',
      steps: [
        {
          target: '.ai-toggle',
          title: 'AI Chat Assistant',
          description:
            'Click here to open the AI chat panel. Ask it to write queries, explain data, or manage your databases.',
          placement: 'left',
        },
        {
          target: '.content-area',
          title: 'Smart Autocomplete',
          description:
            'As you type SQL, AI suggests completions. Press Tab to accept, Escape to dismiss.',
          placement: 'bottom',
        },
        {
          target: '.status-bar',
          title: 'Result Analysis',
          description:
            'After running a query, click the sparkle icon on results to get AI-powered insights.',
          placement: 'top',
        },
      ],
    },
  };

  /** Check if a tour has been completed */
  isTourCompleted(tourId: string): boolean {
    return this.completedTours.has(tourId);
  }

  /** Start a tour */
  startTour(tourId: string): void {
    const tour = this.tours[tourId];
    if (!tour) return;

    this._activeTour.set(tour);
    this._currentStepIndex.set(0);
    this._visible.set(true);

    const step = tour.steps[0];
    step.onShow?.();
  }

  /** Move to next step */
  nextStep(): void {
    const tour = this._activeTour();
    if (!tour) return;

    const nextIndex = this._currentStepIndex() + 1;
    if (nextIndex >= tour.steps.length) {
      this.completeTour();
      return;
    }

    this._currentStepIndex.set(nextIndex);
    tour.steps[nextIndex].onShow?.();
  }

  /** Move to previous step */
  previousStep(): void {
    const index = this._currentStepIndex();
    if (index > 0) {
      this._currentStepIndex.set(index - 1);
    }
  }

  /** Skip/dismiss the tour */
  dismissTour(): void {
    const tour = this._activeTour();
    if (tour) {
      this.completedTours.add(tour.id);
      this.saveCompletedTours();
    }
    this._activeTour.set(null);
    this._currentStepIndex.set(0);
    this._visible.set(false);
  }

  /** Complete the tour */
  private completeTour(): void {
    const tour = this._activeTour();
    if (tour) {
      this.completedTours.add(tour.id);
      this.saveCompletedTours();
    }
    this._activeTour.set(null);
    this._currentStepIndex.set(0);
    this._visible.set(false);
  }

  /** Reset a specific tour so it can be shown again */
  resetTour(tourId: string): void {
    this.completedTours.delete(tourId);
    this.saveCompletedTours();
  }

  /** Reset all tours */
  resetAllTours(): void {
    this.completedTours.clear();
    this.saveCompletedTours();
  }

  private loadCompletedTours(): Set<string> {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? new Set(JSON.parse(data)) : new Set();
    } catch {
      return new Set();
    }
  }

  private saveCompletedTours(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.completedTours]));
    } catch {
      // localStorage may not be available
    }
  }
}
