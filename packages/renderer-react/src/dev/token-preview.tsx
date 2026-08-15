/**
 * The Task 2 gate artifact: every brand, derived and semantic token, both type scales,
 * the spacing / radius / icon ladders, live contrast measurements and font-load proof —
 * in whichever theme is applied.
 *
 * Dev-only. Task 7 replaces this as the app root with the real shell; until then it is
 * the whole renderer, which is also what makes it screenshot-able without an app.
 */

import { ContrastTable } from './contrast-table';
import { FontStatus } from './font-status';
import { cssVars, Eyebrow, Section, Swatch, SwatchGrid } from './preview-parts';
import { ThemeSwitch } from './theme-switch';
import {
  ACCENT_TOKENS,
  ALL_TOKENS,
  BRAND_PAIRS,
  BRAND_TOKENS,
  DERIVED_TOKENS,
  DISPLAY_SCALE,
  ICON_RUNGS,
  RADIUS_RUNGS,
  SEMANTIC_PAIRS,
  SPACING_LADDER,
  SURFACE_TOKENS,
  TEXT_TOKENS,
  TYPE_SCALE,
} from './token-data';
import { usePreviewTheme } from './use-preview-theme';
import { useResolvedTokens } from './use-resolved-tokens';

function ScaleRowLabel({ utility, px, note }: { utility: string; px: string; note: string }) {
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <p className="font-mono text-xs text-fg">{utility}</p>
      <p className="font-mono text-2xs text-fg-subtle">
        {px} · {note}
      </p>
    </div>
  );
}

function TypeScale() {
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {TYPE_SCALE.map(row => (
        <li key={row.utility} className="flex items-baseline gap-6 py-2.5">
          <ScaleRowLabel {...row} />
          <p className={`${row.utility} min-w-0 truncate text-fg`}>
            Verify before anything changes.
          </p>
        </li>
      ))}
    </ul>
  );
}

function DisplayScale() {
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {DISPLAY_SCALE.map(row => (
        <li key={row.utility} className="flex items-baseline gap-6 py-4">
          <ScaleRowLabel {...row} />
          <p className={`${row.utility} font-display min-w-0 truncate text-fg`}>Fitted</p>
        </li>
      ))}
    </ul>
  );
}

function SpacingLadder() {
  return (
    <ul className="flex flex-col gap-1.5">
      {SPACING_LADDER.map(rung => (
        <li key={rung.utility} className="flex items-center gap-4">
          <p className="w-20 shrink-0 font-mono text-2xs text-fg-subtle">{rung.px}</p>
          <div className={`${rung.widthClass} h-3 shrink-0 bg-accent`} />
          <p className="font-mono text-2xs text-fg-muted">{rung.utility}</p>
        </li>
      ))}
    </ul>
  );
}

function RadiusAndIcons() {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-8 @2xl:grid-cols-2">
        <ul className="flex flex-col gap-3">
          {RADIUS_RUNGS.map(rung => (
            <li key={rung.utility} className="flex items-center gap-4">
              <div
                className={`${rung.utility} size-10 shrink-0 border border-rule-strong bg-chrome`}
              />
              <ScaleRowLabel {...rung} />
            </li>
          ))}
        </ul>
        {/* Boxes, not icons: PROPOSAL §2.4 sets the icon *scale*, and the icon set
            itself arrives with the primitives in Task 6. Inventing SVG art here would
            break the icons guideline and pre-empt that decision. */}
        <ul className="flex flex-col gap-3">
          {ICON_RUNGS.map(({ token, ...rung }) => (
            <li key={token} className="flex h-10 items-center gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center">
                <div
                  style={cssVars({ '--rung': `var(${token})` })}
                  className="size-(--rung) border border-accent"
                />
              </div>
              <ScaleRowLabel {...rung} utility={`${token} · ${rung.utility}`} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SurfaceStack() {
  return (
    <div className="bg-canvas p-4">
      <div className="border border-rule bg-surface p-4">
        <Eyebrow>surface · rails and wells</Eyebrow>
        <div className="mt-3 border border-rule bg-chrome p-4">
          <Eyebrow>chrome · toolbars and status bar</Eyebrow>
          <div className="mt-3 border border-rule-strong bg-elevated p-4 shadow-overlay">
            <Eyebrow>elevated · dialogs and menus</Eyebrow>
            <p className="mt-2 text-base text-fg">
              Rules separate surfaces. Shadows are for true overlays, and under ink there are none.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="inline-flex h-7 items-center rounded-sm bg-accent-strong px-3 text-base text-accent-fill-fg">
                Connect
              </span>
              <span className="inline-flex h-7 items-center rounded-sm border border-rule-strong px-3 text-base text-fg">
                Cancel
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono text-2xs tracking-eyebrow text-fg-muted uppercase">
                <span className="size-2 rounded-full bg-success" aria-hidden="true" />
                verified
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TokenPreview() {
  const { preference, resolved, setPreference } = usePreviewTheme();
  const resolvedTokens = useResolvedTokens(ALL_TOKENS, resolved);

  const swatches = (specs: typeof BRAND_TOKENS) => (
    <SwatchGrid>
      {specs.map(spec => (
        <Swatch key={spec.token} spec={spec} resolved={resolvedTokens.values[spec.token]} />
      ))}
    </SwatchGrid>
  );

  return (
    <div
      data-testid="renderer-react-root"
      className="isolate min-h-dvh bg-canvas text-base text-fg"
    >
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule-strong px-6 py-5">
        <div>
          <Eyebrow>joinery · design tokens</Eyebrow>
          <h1 className="font-display text-display-sm text-fg">Theme preview</h1>
        </div>
        <ThemeSwitch preference={preference} resolved={resolved} onChange={setPreference} />
      </header>

      <main className="flex flex-col gap-10 px-6 py-8">
        <Section eyebrow="layer 1 · never themed" title="Brand palette">
          {swatches(BRAND_TOKENS)}
        </Section>
        <Section eyebrow="layer 1 · contrast-driven" title="Derived colours">
          {swatches(DERIVED_TOKENS)}
        </Section>
        <Section eyebrow="layer 2 · themed" title="Surfaces">
          {swatches(SURFACE_TOKENS)}
          <SurfaceStack />
        </Section>
        <Section eyebrow="layer 2 · themed" title="Text and rules">
          {swatches(TEXT_TOKENS)}
        </Section>
        <Section eyebrow="layer 2 · themed" title="Accent and status">
          {swatches(ACCENT_TOKENS)}
        </Section>
        <Section eyebrow="measured in the browser" title="Contrast">
          <ContrastTable
            caption="Brand constants — identical in both themes (PROPOSAL §2.3)."
            pairs={BRAND_PAIRS}
            themeKey={resolved}
          />
          <ContrastTable
            caption={`Semantic layer as resolved right now (${resolved}).`}
            pairs={SEMANTIC_PAIRS}
            themeKey={resolved}
          />
        </Section>
        <Section eyebrow="instrument sans · 12px floor" title="Type scale">
          <TypeScale />
        </Section>
        <Section eyebrow="archivo · wdth 75 · wght 800" title="Display scale">
          <DisplayScale />
        </Section>
        <Section eyebrow="2 – 32px" title="Spacing ladder">
          <SpacingLadder />
        </Section>
        <Section eyebrow="2 / 4 / 6px · 14 / 16 / 20px" title="Radius and icon scale">
          <RadiusAndIcons />
        </Section>
        <Section eyebrow="document.fonts.check()" title="Faces">
          <FontStatus />
        </Section>
      </main>
    </div>
  );
}
