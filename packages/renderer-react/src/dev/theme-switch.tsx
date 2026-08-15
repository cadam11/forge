import { THEME_PREFERENCES, type ResolvedTheme, type ThemePreference } from './use-preview-theme';

/**
 * The three-state control the theme depends on (`system` | `light` | `dark`). Not a
 * primitive — Task 6 owns the real button set; this is the minimum needed to prove both
 * canvases render and that the choice survives a reload.
 */
export function ThemeSwitch({
  preference,
  resolved,
  onChange,
}: {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  onChange: (next: ThemePreference) => void;
}) {
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
            onClick={() => onChange(value)}
            className="h-7 px-3 font-mono text-2xs tracking-eyebrow text-fg-muted uppercase not-last:border-r not-last:border-rule-strong hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus aria-pressed:bg-accent-subtle aria-pressed:text-fg"
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}
