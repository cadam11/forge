/**
 * The command palette's public surface. Import from `../command-palette`, never from a file inside it.
 *
 * `CommandPalette` is what the shell mounts; it opens itself on ⌘K / ⇧⌘P and needs no props.
 *
 * The rest is exported because two other surfaces read it: the cheatsheet needs `SURFACE_SHORTCUTS`
 * (the keystrokes that belong to no command), and the specs need the model and the action table to
 * walk them.
 */

export { CommandPalette } from './command-palette';
export {
  PALETTE_ACTIONS,
  PALETTE_ACTION_IDS,
  SURFACE_SHORTCUTS,
  type PaletteAction,
  type PaletteActionId,
  type SurfaceShortcut,
} from './palette-actions';
export {
  buildPaletteEntries,
  ownerSummary,
  summarizeSql,
  type PaletteContext,
  type PaletteEntry,
  type PaletteEntryState,
} from './palette-model';
