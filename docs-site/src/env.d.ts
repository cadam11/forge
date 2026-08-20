/// <reference types="astro/client" />

/**
 * `window.StarlightThemeProvider`, the global the theme picker's script talks to.
 *
 * Starlight declares this in its own `global.d.ts`, but that file is not part of the package's
 * `exports` map, so a project that overrides `ThemeSelect` — as this one does, see
 * `src/components/ThemeSelect.astro` — cannot reference it and `astro check` reports
 * `Cannot find name 'StarlightThemeProvider'`.
 *
 * The shape below is copied from `@astrojs/starlight/global.d.ts` verbatim. If Starlight ever
 * exports it, delete this block rather than keeping two declarations.
 */
interface StarlightThemeProvider {
  updatePickers(theme?: string): void;
}

declare global {
  var StarlightThemeProvider: StarlightThemeProvider;

  interface Window {
    StarlightThemeProvider: StarlightThemeProvider;
  }
}

export {};
