/**
 * Platform detection + UI helpers.
 *
 * Joinery ships on macOS and Windows. Many keyboard hints (tooltips, context-menu shortcuts,
 * body-text references) need to render the Mac Command symbol on Mac and "Ctrl+" elsewhere.
 * This module is the single source for that decision so the formatting stays consistent across
 * components.
 *
 * Use `keyHint()` for anything that needs a finished string. The values are computed once at
 * module load — `navigator.platform` is stable for the life of the renderer.
 *
 * Ported verbatim from `packages/renderer/src/app/core/utils/platform.ts` (PLAN.md §1.6 lists
 * it as a move, not a rewrite). No Angular, no IPC, no state.
 */

// `navigator.userAgent` is non-deprecated and includes "Mac" on macOS hosts.
// `navigator.platform` would also work but is officially deprecated in modern web standards.
export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

/** The Ctrl/Cmd modifier label for the host platform: "⌘" on Mac, "Ctrl" elsewhere. */
export const CTRL_LABEL = IS_MAC ? '⌘' : 'Ctrl';

/**
 * Format a single keyboard shortcut for display. Joins the modifier and key with a "+" on
 * non-Mac and concatenates them flush on Mac, matching platform conventions ("⌘N" vs "Ctrl+N").
 */
export function keyHint(key: string): string {
  return IS_MAC ? `${CTRL_LABEL}${key}` : `${CTRL_LABEL}+${key}`;
}
