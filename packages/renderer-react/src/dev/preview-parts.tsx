/**
 * Presentational scaffolding for the token preview page. Not primitives — Task 6 owns
 * those. These are deliberately plain and local to src/dev/.
 */

import type { CSSProperties, ReactNode } from 'react';

/**
 * Custom properties are not part of React's CSSProperties surface, and the guideline is
 * to drive dynamic values through a CSS variable rather than a direct style property.
 * One cast, one place, instead of one per call site.
 */
export function cssVars(vars: Readonly<Record<string, string>>): CSSProperties {
  return vars as unknown as CSSProperties;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono text-2xs tracking-eyebrow text-fg-subtle uppercase">{children}</p>;
}

export function Section({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 border-b border-rule pb-2">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="text-xl text-fg">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export interface TokenSpec {
  /** The registered theme variable, e.g. `--color-j-oxide`. */
  readonly token: string;
  /** How the token is spelled at a call site, e.g. `bg-j-oxide`. */
  readonly utility: string;
  readonly note?: string;
}

/**
 * One colour chip. The chip paints through a CSS variable rather than an inline
 * background so the value stays a token all the way to the paint.
 */
export function Swatch({ spec, resolved }: { spec: TokenSpec; resolved: string | undefined }) {
  return (
    <div
      data-testid="token-swatch"
      data-token={spec.token}
      data-resolved={resolved ?? ''}
      className="flex min-w-0 flex-col gap-2"
    >
      <div
        aria-hidden="true"
        style={cssVars({ '--swatch': `var(${spec.token})` })}
        className="h-12 rounded-xs border border-rule-strong bg-(--swatch)"
      />
      <div className="flex min-w-0 flex-col">
        <p className="truncate font-mono text-xs text-fg">{spec.utility}</p>
        <p className="truncate font-mono text-2xs text-fg-subtle">{resolved ?? '…'}</p>
        {spec.note === undefined ? null : <p className="text-2xs text-fg-muted">{spec.note}</p>}
      </div>
    </div>
  );
}

export function SwatchGrid({ children }: { children: ReactNode }) {
  // @container, never sm:/md:/lg: — see docs/design/HOUSE-RULES.md. The grid adapts to
  // the panel it is dropped into, which in a dock layout has nothing to do with the
  // window width.
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-4 @md:grid-cols-4 @3xl:grid-cols-6">{children}</div>
    </div>
  );
}
