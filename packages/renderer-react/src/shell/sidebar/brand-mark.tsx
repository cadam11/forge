/**
 * The Joinery mark: three descending fitted bars, inline.
 *
 * Replaces `sidebar.component.ts:397-428` — three absolutely-positioned `<span>`s with
 * `transform: skewX(-24deg)`, off-grid `top`/`width`/`left` values, and **three hardcoded
 * hexes**, one of which (`#f2efe7`, the middle bar) was ivory-on-ivory in light mode and
 * therefore invisible. That defect is the second half of FOLLOW-UPS 12 / **J-32** ("Adopt or
 * delete the unreferenced assets/icons/logo.png (and fix the sidebar mark stripe)"); this
 * component closes it for the React renderer. The other half of J-32 — the unreferenced
 * `packages/renderer/src/assets/icons/logo.png` — belongs to the Angular renderer and its
 * disposal is a cutover decision, so the ticket stays open.
 *
 * ── Why one SVG rather than two, and why no `dark:` variant ──────────────────────────────
 *
 * `docs/brand/assets/mark-on-dark.svg` and `mark-on-light.svg` are byte-identical except for
 * the middle bar: `#F2EFE7` (drafting ivory) on dark, `#171817` (Joinery ink) on light. Those
 * are exactly the two values `--color-fg` resolves to — `theme.css:166` points it at
 * `--color-j-ivory` under ink and `:309` at `--color-j-ink` under ivory — so `fill-fg`
 * reproduces both assets to the hex with no theme-conditional class at all. That is the
 * arrangement HOUSE-RULES §3 asks for ("a `dark:`/`light:` variant in a component is a signal
 * that a token is missing"; here the token already existed).
 *
 * The outer bars are deliberately theme-invariant and come from Layer 1 (`fill-j-oxide`,
 * `fill-j-chartreuse`) — HOUSE-RULES §5 reserves Layer 1 for exactly this: the brand mark.
 *
 * ── Decorative, on purpose ──────────────────────────────────────────────────────────────
 *
 * `aria-hidden`, unlike the source assets' `role="img"` + `aria-labelledby`. The titlebar one
 * row above renders the "Joinery" wordmark as real text (`shell/titlebar.tsx:66`), so a
 * labelled mark here would make a screen reader say the product name twice — and the assets'
 * `id="title"`/`id="desc"` would be duplicate ids in the document.
 */

import { cn } from '../../ui';

/** 20px — the `--icon-lg` rung. The Angular mark was 27px, which is off HOUSE-RULES §6's ladder. */
const DEFAULT_CLASS = 'size-5 shrink-0';

export function BrandMark({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      data-testid="sidebar-brand-mark"
      className={cn(DEFAULT_CLASS, className)}
    >
      <path d="M14 8H56L51 19H9Z" className="fill-j-oxide" />
      <path d="M14 26H46L41 37H9Z" className="fill-fg" data-testid="sidebar-brand-mark-mid" />
      <path d="M14 44H37L32 55H9Z" className="fill-j-chartreuse" />
    </svg>
  );
}
