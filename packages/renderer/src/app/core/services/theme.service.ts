import { Injectable, inject } from '@angular/core';
import { SettingsService } from './settings.service';
import type { ThemePreference } from '@joinery/shared';

export type ThemeMode = ThemePreference;

/**
 * Thin adapter around SettingsService for theme operations.
 * The canonical theme state lives in SettingsService, which handles
 * Electron nativeTheme IPC, localStorage persistence, and DOM updates.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly settings = inject(SettingsService);

  /** The user's theme preference: 'dark' | 'light' | 'system' */
  readonly theme = this.settings.theme;

  /** The resolved theme actually applied: 'dark' | 'light' */
  readonly effectiveTheme = this.settings.effectiveTheme;

  setTheme(mode: ThemeMode): void {
    this.settings.updateTheme(mode);
  }

  toggle(): void {
    const current = this.settings.theme();
    const next: ThemeMode = current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark';
    this.setTheme(next);
  }
}
