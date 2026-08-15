import { Injectable, signal, computed, NgZone, inject } from '@angular/core';
import type { AppSettings, ThemePreference } from '@joinery/shared';
import { DEFAULT_SETTINGS } from '@joinery/shared';

const STORAGE_KEY = 'joinery-settings';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly zone = inject(NgZone);
  private readonly _settings = signal<AppSettings>(this.loadSettings());
  private readonly _isOpen = signal(false);

  /**
   * The resolved OS theme ('dark' | 'light') as reported by Electron's nativeTheme.
   * Falls back to matchMedia when running outside Electron (e.g., browser dev).
   */
  private readonly _nativeTheme = signal<'dark' | 'light'>(this.detectInitialNativeTheme());
  private nativeThemeCleanup: (() => void) | null = null;

  // Public readonly signals
  readonly settings = this._settings.asReadonly();
  readonly isOpen = this._isOpen.asReadonly();

  // Computed values for easy access
  readonly theme = computed(() => this._settings().theme);
  readonly editorSettings = computed(() => this._settings().editor);
  readonly querySettings = computed(() => this._settings().query);
  readonly gridSettings = computed(() => this._settings().grid);

  /**
   * The effective theme that is actually rendered: resolves 'system' to 'dark' or 'light'
   * using Electron's nativeTheme.
   */
  readonly effectiveTheme = computed<'dark' | 'light'>(() => {
    const preference = this._settings().theme;
    if (preference === 'system') {
      return this._nativeTheme();
    }
    return preference;
  });

  constructor() {
    // Fetch native theme from Electron main process and listen for changes
    this.initNativeThemeListener();

    // Apply initial theme
    this.applyTheme(this._settings().theme);
  }

  open(): void {
    this._isOpen.set(true);
  }

  close(): void {
    this._isOpen.set(false);
  }

  toggle(): void {
    this._isOpen.update(open => !open);
  }

  updateSettings(partial: Partial<AppSettings>): void {
    this._settings.update(current => {
      const updated = { ...current, ...partial };
      this.saveSettings(updated);
      return updated;
    });
  }

  updateTheme(theme: ThemePreference): void {
    this._settings.update(current => {
      const updated = { ...current, theme };
      this.saveSettings(updated);
      this.applyTheme(theme);
      return updated;
    });
  }

  updateEditorSetting<K extends keyof AppSettings['editor']>(
    key: K,
    value: AppSettings['editor'][K]
  ): void {
    this._settings.update(current => {
      const updated = {
        ...current,
        editor: { ...current.editor, [key]: value },
      };
      this.saveSettings(updated);
      return updated;
    });
  }

  updateQuerySetting<K extends keyof AppSettings['query']>(
    key: K,
    value: AppSettings['query'][K]
  ): void {
    this._settings.update(current => {
      const updated = {
        ...current,
        query: { ...current.query, [key]: value },
      };
      this.saveSettings(updated);
      return updated;
    });
  }

  updateGridSetting<K extends keyof AppSettings['grid']>(
    key: K,
    value: AppSettings['grid'][K]
  ): void {
    this._settings.update(current => {
      const updated = {
        ...current,
        grid: { ...current.grid, [key]: value },
      };
      this.saveSettings(updated);
      return updated;
    });
  }

  resetToDefaults(): void {
    this._settings.set(DEFAULT_SETTINGS);
    this.saveSettings(DEFAULT_SETTINGS);
    this.applyTheme(DEFAULT_SETTINGS.theme);
  }

  private loadSettings(): AppSettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AppSettings>;
        // Merge with defaults to ensure all properties exist
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          editor: { ...DEFAULT_SETTINGS.editor, ...parsed.editor },
          query: { ...DEFAULT_SETTINGS.query, ...parsed.query },
          grid: { ...DEFAULT_SETTINGS.grid, ...parsed.grid },
        };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
    return DEFAULT_SETTINGS;
  }

  private saveSettings(settings: AppSettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  /**
   * Detect initial native theme synchronously for signal initialization.
   * Uses matchMedia as a quick sync fallback; Electron IPC will correct it asynchronously.
   */
  private detectInitialNativeTheme(): 'dark' | 'light' {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /**
   * Initialize native theme detection: query Electron's nativeTheme and listen for changes.
   * Falls back to matchMedia when running outside Electron.
   */
  private initNativeThemeListener(): void {
    const joinery = (
      window as Window & {
        joinery?: {
          theme?: {
            getNative: () => Promise<'dark' | 'light'>;
            onChanged: (cb: (theme: 'dark' | 'light') => void) => () => void;
          };
        };
      }
    ).joinery;

    if (joinery?.theme) {
      // Running inside Electron: use nativeTheme via IPC
      joinery.theme.getNative().then(nativeTheme => {
        this.zone.run(() => {
          this._nativeTheme.set(nativeTheme);
          if (this._settings().theme === 'system') {
            this.applyTheme('system');
          }
        });
      });

      this.nativeThemeCleanup = joinery.theme.onChanged((nativeTheme: 'dark' | 'light') => {
        this.zone.run(() => {
          this._nativeTheme.set(nativeTheme);
          if (this._settings().theme === 'system') {
            this.applyTheme('system');
          }
        });
      });
    } else {
      // Fallback for browser dev: use matchMedia
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        this.zone.run(() => {
          this._nativeTheme.set(e.matches ? 'dark' : 'light');
          if (this._settings().theme === 'system') {
            this.applyTheme('system');
          }
        });
      };
      mediaQuery.addEventListener('change', handler);
      this.nativeThemeCleanup = () => mediaQuery.removeEventListener('change', handler);
    }
  }

  /**
   * Apply the theme to the DOM. When preference is 'system', explicitly resolves
   * to 'dark' or 'light' using Electron's nativeTheme signal, then sets the
   * data-theme attribute. This ensures reliable theme switching in Electron
   * where CSS prefers-color-scheme may not reflect the OS setting.
   */
  private applyTheme(preference: ThemePreference): void {
    const root = document.documentElement;

    if (preference === 'system') {
      // Explicitly resolve system to dark/light and set the attribute.
      // This is more reliable than relying on CSS prefers-color-scheme in Electron.
      const resolved = this._nativeTheme();
      root.setAttribute('data-theme', resolved);
    } else {
      root.setAttribute('data-theme', preference);
    }
  }
}
