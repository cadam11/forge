---
title: Object explorer
description: The sidebar tree — what it loads and when, the keyboard model, the right-click menus, and what Refresh actually re-reads.
sidebar:
  order: 4
---

The sidebar is titled **Explorer** and holds four things stacked: a connection picker, a database
picker, the tree, and a strip of actions along the bottom. ⌘\ hides and shows the whole pane.

## The tree

Nodes nest in this order:

```
server
└── database
    └── schema
        ├── Tables
        │   └── table
        │       ├── Columns
        │       ├── Indexes
        │       ├── Keys
        │       ├── Constraints
        │       └── Triggers
        ├── Views
        ├── Stored Procedures
        └── Functions
```

**Stored Procedures**, **Functions** and **Triggers** are only offered on engines that have them —
the folder list is built from the connection's reported capabilities, not assumed.

**Children load when you expand, and not before.** A folder that has not been fetched still shows
its twisty, because the server said it has children long before Joinery pays to list them; a
spinner replaces the twisty while a fetch is in flight. Folders show their loaded child count
beside the name; tables and views do not, because a number next to a table name would read as a
row count.

Primary-key and foreign-key columns get their own glyph, which is what the eye is looking for in a
list of forty columns.

The tree is virtualised — only the rows in view exist in the page — so a server with hundreds of
databases costs the same as one with two.

### Clicking and typing

| Input            | Effect                                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| Click            | Selects the row                                                         |
| Click the twisty | Expands or collapses                                                    |
| Double-click     | Opens a table, view, procedure or function; expands anything structural |
| Right-click      | Opens that row's menu, and selects the row it opened on                 |
| ↑ / ↓            | Moves focus                                                             |
| Home / End       | First and last row                                                      |
| →                | Expands; if already expanded, steps into the first child                |
| ←                | Collapses; if already collapsed, jumps to the parent                    |
| Enter            | Selects and activates — the same as a double-click                      |
| Space            | Selects only                                                            |

Focus and selection are separate on purpose: arrow-keying through the tree does not open or select
anything until you press Enter or Space.

Double-clicking a **table** opens its object tab, not just its twisty. That tab has Columns,
Indexes and Keys sections; views, procedures and functions get a **Definition** section instead of
(or as well as) those. A table has no definition to fetch — _Script Table as CREATE_ is how you get
its DDL.

## The right-click menus

Seven node types have a menu — server, database, folder, table, view, procedure, function. Columns,
indexes and keys have none.

An action the engine cannot do is **disabled with the reason**, not hidden and not offered-then-
refused: on a server that hosts one fixed database, _New Database…_ is greyed out, and the keyboard
path refuses it too.

| Node      | Menu                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Server    | New Query · New Database… · Restore Database… · Refresh · Edit Connection… · Disconnect                                          |
| Database  | New Query · Backup Database… · Restore Database… · Compare Schemas… · Refresh · Rename… · Delete…                                |
| Folder    | Refresh                                                                                                                          |
| Table     | Select Top 1000 Rows · Edit Top 200 Rows · Script Table as CREATE / SELECT / INSERT · Show Relationships · Properties… · Refresh |
| View      | Select Top 1000 Rows · Edit Top 200 Rows · Script View as CREATE / ALTER / SELECT · Properties… · Refresh                        |
| Procedure | Execute Stored Procedure… · Script Procedure as CREATE / ALTER · Properties… · Refresh                                           |
| Function  | Script Function as CREATE / ALTER · Properties… · Refresh                                                                        |

**Only _Select Top 1000 Rows_ runs on open.** _Edit Top 200 Rows_, every _Script as…_ item and
_Execute Stored Procedure…_ all open a query tab with the statement in it and leave running it to
you — `Execute Stored Procedure…` writes the call, it does not make it.

The generated SQL is per engine: quoting, the row-limit syntax and the default schema all follow the
connection, and MySQL — which has no schema layer between database and table — gets an unqualified
name rather than an invented one.

A menu action always names **its own** node's connection and database. Acting on a node under one
server while a tab on another has focus cannot route the operation to the wrong server. Opening a
query from a database node also moves the database picker to that database, so the footer's actions
follow.

> **Note** — **Properties…**, on all four object menus, and **Delete…** on a database, dispatch to
> surfaces that have not shipped. They are visible and clickable and nothing happens. The command
> palette is honest about the same gap: _Server properties_, _Database properties_ and their
> siblings render greyed out there, naming what owns them.

## Refresh

There are three refreshes and they are not the same:

- **A menu's Refresh** drops the main process's metadata caches for that node's connection, then
  re-reads that node.
- **The footer's refresh button** re-reads the focused connection's database list and then the
  selected node — "refresh what I am looking at".
- **⌘R / Server ▸ Refresh** additionally refreshes the server node itself.

Dropping the caches first is what makes a Refresh mean something: the main process holds list
metadata for 60 seconds, and without the drop a Refresh would hand back the rows you were already
looking at.

## The footer

Five actions: **New query**, **Refresh the explorer**, **Back up a database**, **Restore a
database**, and a toggle for the assistant. The first four need an open connection; backup and
restore additionally need an engine that supports them, and backup needs a database selected.

New query resolves the database the same way ⌘N does — your last selection, then the profile's
configured default if it still exists, then the first database the server returned.

## Revealing an object

[Find a database object](../find-a-database-object/) can expand the tree down to an object and
scroll to it, even when the sidebar is collapsed at the time — the pane opens, the ancestors expand
one round trip at a time, and the row takes keyboard focus so the arrow keys carry on from there.
If an ancestor is not there — a server that is not connected, a schema you cannot see — the walk
stops and says so.

<details>
<summary>Where this page's facts come from</summary>

| Claim                                                                                    | Source                                                                                                     |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| The sidebar is headed "Explorer" and holds picker, picker, tree, action strip            | `packages/renderer/src/shell/sidebar/sidebar.tsx:105-138`                                                  |
| ⌘\ toggles the sidebar                                                                   | `packages/renderer/src/commands/catalogue.ts:525-532`                                                      |
| Node hierarchy server → database → schema → folder → object → column/index/key           | `packages/renderer/src/state/explorer.ts:2, 486-517`                                                       |
| Table sub-folders: Columns, Indexes, Keys, Constraints, Triggers                         | `packages/renderer/src/state/explorer-folders.ts:37-48`                                                    |
| Procedures, Functions and Triggers folders are capability-gated                          | `packages/renderer/src/state/explorer-folders.ts:25-48`                                                    |
| Children load on expand; `hasChildren` and unfetched children are separate facts         | `packages/renderer/src/shell/sidebar/explorer-tree.tsx:9-16, 141-177`, `ui/tree.tsx:16-22`                 |
| A spinner replaces the twisty while a fetch is in flight                                 | `packages/renderer/src/ui/tree.tsx:20-22`, `shell/sidebar/explorer-tree.tsx:148-149`                       |
| Folder-ish nodes show a child count; tables deliberately do not                          | `packages/renderer/src/shell/sidebar/explorer-tree.tsx:88-100, 163-168`                                    |
| Key columns get their own glyph                                                          | `packages/renderer/src/shell/sidebar/explorer-tree.tsx:102-113`                                            |
| The tree is virtualised                                                                  | `packages/renderer/src/ui/tree.tsx:23-27`                                                                  |
| Click selects, twisty or double-click expands, Enter activates                           | `packages/renderer/src/shell/sidebar/explorer-tree.tsx:17-23, 202-227`                                     |
| Arrow / Home / End / Enter / Space behaviour, including "step into" and "jump to parent" | `packages/renderer/src/ui/tree.tsx:396-449`                                                                |
| Focus and selection are separate                                                         | `packages/renderer/src/ui/tree.tsx:32-37`                                                                  |
| Right-click selects the row it opened on                                                 | `packages/renderer/src/shell/sidebar/node-menu.tsx:17-21, 115-130`                                         |
| Double-clicking a table opens its object tab                                             | `packages/renderer/src/shell/sidebar/explorer-tree.tsx:206-227`, `node-actions.ts:218-231`                 |
| The object tab's sections, and that a table has no Definition section                    | `packages/renderer/src/features/object-detail/object-panel.tsx:23-29, 106-116, 253-274`                    |
| Seven node types have a menu; columns, indexes and keys have none                        | `packages/renderer/src/shell/sidebar/node-menu.tsx:79-100`                                                 |
| Unsupported actions are disabled with a reason rather than refused after the click       | `packages/renderer/src/shell/sidebar/node-menu.tsx:8-15, 187-194`                                          |
| The seven menus' items                                                                   | `packages/renderer/src/shell/sidebar/node-menu.tsx:159-470`                                                |
| Only "Select Top 1000 Rows" auto-executes                                                | `packages/renderer/src/shell/sidebar/node-actions.ts:11-18, 45-47, 131-135`                                |
| "Execute Stored Procedure…" writes the call and does not run it                          | `packages/renderer/src/shell/sidebar/node-actions.ts:146-153`                                              |
| Generated SQL is per engine, including MySQL's missing schema layer                      | `packages/renderer/src/shell/sidebar/node-actions.ts:56-95`, `features/object-search/object-model.ts:5-16` |
| A menu action carries its own node's target rather than "the focused connection"         | `packages/renderer/src/shell/sidebar/node-menu.tsx:15-20`                                                  |
| Opening a query from a database node moves the database picker                           | `packages/renderer/src/shell/sidebar/node-actions.ts:96-111`                                               |
| Properties… on all four object menus dispatches to an unowned command                    | `packages/renderer/src/shell/sidebar/node-actions.ts:241-250`, `commands/registry.ts:237-243`              |
| No handler is subscribed to the properties or delete-database commands                   | `packages/renderer/src/commands/registry.ts:387, 404, 471-473`                                             |
| The palette shows an unowned command greyed out, naming its owner                        | `packages/renderer/src/features/command-palette/palette-model.ts:17-25, 144-154`                           |
| A menu Refresh drops main's caches first, then re-reads the node                         | `packages/renderer/src/shell/sidebar/node-actions.ts:290-315`                                              |
| The footer's refresh re-reads the database list and the selected node                    | `packages/renderer/src/shell/sidebar/node-actions.ts:357-377`                                              |
| ⌘R also refreshes the server node                                                        | `packages/renderer/src/commands/catalogue.ts:453-461`, `shell/sidebar/node-actions.ts:358-363`             |
| Main's list metadata is cached for 60 seconds, which is why the drop comes first         | `packages/renderer/src/shell/sidebar/node-actions.ts:290-300`                                              |
| The footer's five actions and their disabled conditions                                  | `packages/renderer/src/shell/sidebar/sidebar.tsx:146-228`                                                  |
| New query resolves the database in three stages                                          | `packages/renderer/src/shell/sidebar/node-actions.ts:113-129`                                              |
| Reveal expands ancestors one at a time, focuses the row, and reports a missing ancestor  | `packages/renderer/src/shell/sidebar/node-actions.ts:252-288`, `shell/sidebar/sidebar.tsx:68-88`           |

</details>
