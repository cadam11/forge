/**
 * The cheatsheet's public surface. Import from `../shortcuts-dialog`, never from a file inside it.
 *
 * `ShortcutsDialog` is what the shell mounts; it opens on the `show-shortcuts` command, which Help ▸
 * Keyboard Shortcuts (⇧⌘/) and the palette both send. `shortcutRows` is exported for the spec that
 * proves the content is derived from the command catalogue rather than authored.
 */

export { ShortcutsDialog, shortcutRows, type ShortcutRow } from './shortcuts-dialog';
