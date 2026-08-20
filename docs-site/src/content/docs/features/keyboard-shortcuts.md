---
title: Keyboard shortcuts
description: The in-app cheat sheet (⇧⌘/), what its Menu / App / Editor column means, and which keys differ on Windows.
sidebar:
  order: 7
---

**⇧⌘/** — or **Help ▸ Keyboard Shortcuts** — opens a sheet listing every binding Joinery has. The
[command palette](../command-palette/) has an entry for it too.

The sheet is not written by hand. Every row comes from the same table the palette and the
application menus are built from, and a test compares the keystrokes in that table against what the
Electron menus actually register — so a binding that changes in the app changes here, and one that
disagrees fails the build.

## What it shows

**28 rows** — the 27 commands that carry a keystroke, plus the palette's own opener, which belongs
to no command. They are grouped the same eight ways the palette groups its entries, and empty groups
are not drawn.

Each row is the command's name, a **source** column, and every binding that reaches it — not just
the primary one, which is all a palette row has room for. _New connection_ has two: **⇧⌘N** (File ▸
New Connection) and **⇧⌘C** (Server ▸ Connect…).

## The source column

It answers "why does this key work here but not there?".

| Source     | Bound by                                                                 | Consequence                                                                                        |
| ---------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **Menu**   | An Electron menu item (23 commands)                                      | The keystroke never reaches the page at all — the menu fires and sends the command                 |
| **App**    | A key listener in the window (3 commands, plus the palette's own opener) | ⌘J, ⌘P and ⌥⌘S, and ⌘K / ⇧⌘P. These must avoid every registered menu accelerator, or the menu wins |
| **Editor** | Monaco itself (1 command)                                                | ⌘E. The menu shows it but deliberately does not bind it, so the editor can                         |

Those are command counts, not keystroke counts: the 23 menu commands carry **24** bindings, because
_New connection_ has two. The palette's opener is a fourth **App** row even though it belongs to no
command.

The Menu-beats-App rule is why the [snippet library](../snippets/) is on ⌥⌘S and not ⇧⌘S: ⇧⌘S is
File ▸ Save Query As, so a window-level listener on it would never have run.

## On Windows

Most bindings swap ⌘ for Ctrl and are otherwise the same. **Six are genuinely different keys:**

| Command           | macOS | Elsewhere      |
| ----------------- | ----- | -------------- |
| Find and replace  | ⌥⌘F   | Ctrl+H         |
| Execute selection | ⇧⌘↩   | Ctrl+Shift+E   |
| Cancel query      | ⌘.    | Alt+Break      |
| Next tab          | ⇧⌘]   | Ctrl+Tab       |
| Previous tab      | ⇧⌘[   | Ctrl+Shift+Tab |
| Snippet library   | ⌥⌘S   | Ctrl+Alt+S     |

The sheet always shows the bindings for the platform you are running on, with macOS glyphs on macOS
and `Ctrl+Shift+E`-style words elsewhere. Modifiers are printed in the macOS order — ⌃ ⌥ ⇧ ⌘ — no
matter how the binding was written.

> **Note** — a printable [reference table](../../reference/) of every shortcut is generated from the
> same source and is the next piece of work on this site. Until it lands, ⇧⌘/ is the complete list.

<details>
<summary>Where this page's facts come from</summary>

| Claim                                                                            | Source                                                                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ⇧⌘/ opens the sheet, from the menu and from the palette                          | `packages/renderer/src/commands/catalogue.ts:614-622`, `features/shortcuts-dialog/shortcuts-dialog.tsx:117-125`                      |
| Every row is derived from the command table plus the surface-shortcut list       | `packages/renderer/src/features/shortcuts-dialog/shortcuts-dialog.tsx:69-108`                                                        |
| A test compares those accelerators with what `menu.ts` registers                 | `packages/renderer/src/commands/catalogue.ts:31-45`, `commands/catalogue.spec.ts`                                                    |
| 27 commands carry a binding, and the palette opener adds one row                 | `packages/renderer/src/commands/catalogue.ts:272-803`, `features/command-palette/palette-actions.ts:112-121`                         |
| Rows are grouped the same eight ways, and empty groups are not drawn             | `packages/renderer/src/features/shortcuts-dialog/shortcuts-dialog.tsx:110-115`                                                       |
| Every binding is shown, not just the primary                                     | `packages/renderer/src/features/shortcuts-dialog/shortcuts-dialog.tsx:79-93`, `commands/catalogue.ts:886-896`                        |
| New connection is ⇧⌘N and ⇧⌘C                                                    | `packages/renderer/src/commands/catalogue.ts:274-283`, `packages/main/src/menu.ts:58, 254`                                           |
| The three sources and their meanings                                             | `packages/renderer/src/commands/catalogue.ts:144-157`                                                                                |
| 23 menu-sourced commands, 3 renderer-sourced, 1 editor-sourced                   | `packages/renderer/src/commands/catalogue.ts:239-242, 272-803`                                                                       |
| Those 23 commands carry 24 bindings, because New connection has an alternate     | `packages/renderer/src/commands/catalogue.ts:274-283`, `features/shortcuts-dialog/shortcuts-dialog.tsx:79-93`                        |
| The renderer-sourced three are ⌘J, ⌘P and ⌥⌘S                                    | `packages/renderer/src/commands/catalogue.ts:559-568, 623-631, 632-642`                                                              |
| The palette's opener is rendered under App as well, as a fourth row              | `packages/renderer/src/features/shortcuts-dialog/shortcuts-dialog.tsx:95-105`, `features/command-palette/palette-actions.ts:112-121` |
| ⌘E is declared in the menu with `registerAccelerator: false` and bound by Monaco | `packages/main/src/menu.ts:210-213`, `packages/renderer/src/editor/sql-editor.tsx:345-349`                                           |
| ⌥⌘S rather than ⇧⌘S, because ⇧⌘S is Save Query As                                | `packages/renderer/src/commands/catalogue.ts:637-639`, `packages/main/src/menu.ts:101`                                               |
| The six commands with a genuinely different non-macOS binding                    | `packages/renderer/src/commands/catalogue.ts:349, 413, 421, 574, 582, 639`                                                           |
| Accelerators are formatted for the running platform, with macOS modifier order   | `packages/renderer/src/commands/catalogue.ts:849-884`                                                                                |

</details>
