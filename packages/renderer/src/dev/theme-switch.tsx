/**
 * The three-state theme control on the two dev pages.
 *
 * ── Task 7 removed the duplicate ──────────────────────────────────────────────────────────
 *
 * Until this task there were two writers of `[data-theme]`: the settings store (the real one) and
 * `dev/use-preview-theme.ts`, a local hook the preview pages used because Task 2 predated the store.
 * That hook is **deleted**, and this component reads and writes the settings store instead. The
 * settings store is now the only `[data-theme]` writer anywhere in the package — which is the
 * property that makes "the theme is settled in one place" checkable by grepping for
 * `setAttribute('data-theme'`.
 *
 * The three `data-testid`s and the `data-resolved` attribute are unchanged, because the Task 2 and
 * Task 6 gate scripts drive this control and read that attribute; rewiring the internals must not
 * invalidate their evidence.
 */

import type { ThemePreference } from '@joinery/shared';

import {
  settingsStore,
  selectEffectiveTheme,
  selectTheme,
  useSettingsStore,
} from '../state/settings';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export function ThemeSwitch() {
  const preference = useSettingsStore(selectTheme);
  const resolved = useSettingsStore(selectEffectiveTheme);

  return (
    <div className="flex items-center gap-3">
      <p
        data-testid="resolved-theme"
        data-resolved={resolved}
        className="flex items-center gap-1.5 font-mono text-2xs tracking-eyebrow text-fg-subtle uppercase"
      >
        {/* Probe for the two @custom-variants. Chartreuse under ink, oxide-deep under
            ivory; if it paints fg-subtle grey then neither variant matched and the theme
            selectors are broken. It is the only place in the renderer that needs a
            dark:/light: variant — everything else follows the semantic tokens. */}
        <span
          aria-hidden="true"
          data-testid="variant-probe"
          className="size-2 rounded-full bg-fg-subtle dark:bg-j-chartreuse light:bg-j-oxide-deep"
        />
        resolved · {resolved}
      </p>
      <div
        role="group"
        aria-label="Theme"
        className="flex overflow-hidden rounded-sm border border-rule-strong"
      >
        {THEME_PREFERENCES.map(value => (
          <button
            key={value}
            type="button"
            data-testid={`theme-${value}`}
            aria-pressed={preference === value}
            onClick={() => settingsStore.getState().updateTheme(value)}
            className="h-7 px-3 font-mono text-2xs tracking-eyebrow text-fg-muted uppercase not-last:border-r not-last:border-rule-strong hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus aria-pressed:bg-accent-subtle aria-pressed:text-fg"
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}
