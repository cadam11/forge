---
title: Databases
description: Creating and renaming a database — the name rule, the recovery model, what refreshes afterwards, and why Delete… does nothing yet.
sidebar:
  order: 13
---

Joinery can create and rename databases on a server that supports it. Both go through the same small
dialog, and both surface the exact statement the server ran.

## Creating one

| Where                                             |
| ------------------------------------------------- |
| A server's right-click menu ▸ **New Database…**   |
| The sidebar's database picker ▸ **New Database…** |
| The menu bar ▸ Database ▸ **New Database...**     |
| ⌘K ▸ **New database**                             |

The menu bar and palette entries carry no server, so they resolve the most recent connection. The
sidebar's entry names the server you clicked.

The dialog is **New database**: one **Name** field, and — on SQL Server only — a **Recovery model**
picker:

- **Simple — no log backups**, the default
- **Full — point-in-time recovery**
- **Bulk-logged**

The picker is not rendered at all on PostgreSQL and MySQL, because a recovery model is a SQL Server
concept and the field would change nothing on the other two.

## Renaming one

A database's right-click menu ▸ **Rename…**. The dialog shows the current name as context, pre-fills
the field with it, and refuses it as an answer — _That is already its name._

Its description states the side effect up front: **open connections to that database are closed** so
the server will allow the rename.

A rename does not throw your work away. Every tab bound to the old name follows it to the new one,
rather than being closed or left pointing at a name the server no longer knows — the SQL in a query
tab did not change just because the database was renamed.

## The name rule

Names must be **letters, numbers and underscores, starting with a letter or an underscore**, at most
**128 characters**.

That is stricter than any of the three engines. It is a portability rule, not a safety one: every
dialect quotes the identifier before it goes to the server, so an odd name would be harmless — but
an unquoted identifier is folded to lower case by PostgreSQL and left alone by SQL Server, and a name
containing a dot, a dash or a space forces every future reference to be quoted, including the ones
someone types by hand later.

The dialog tells you which rule you broke rather than greying the button in silence:

| Situation                    | What it says                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| Empty                        | _Give the database a name._                                                           |
| Over 128 characters          | _Names are at most 128 characters._                                                   |
| Illegal characters           | _Use letters, numbers and underscores only, starting with a letter or an underscore._ |
| The name it already has      | _That is already its name._                                                           |
| A name already on the server | _This server already has a database called …_                                         |

The collision check is **case-insensitive**, because SQL Server and MySQL treat database names that
way by default — and it is checked against the names Joinery has loaded for that server, so you are
told before the round trip rather than after it.

An untouched empty field is not scolded; the reason appears once you have typed something or pressed
the button.

## When the server refuses

The server's own message is shown in a band above the buttons, and the field's reason clears as soon
as you edit the name. A failure with no message at all reads _The server refused the change and gave
no reason_, and the underlying cause is written to the output panel rather than dropped.

## What happens after it works

A success does four things, and it does them before the dialog closes so the sidebar behind it is
already right:

1. announces itself, and writes **the statement the main process ran** into the output panel — a
   `CREATE DATABASE` is not the one write in this app whose SQL you cannot read;
2. drops the main process's cached metadata for that connection, then re-reads the database list and
   the server's node from the server itself;
3. drops any cached [ERD](../erd/) of that name — in **both** directions on a rename, because the old
   name's diagram describes a database that has gone and the new name's may be a previous tenant of
   it;
4. on a rename, re-points every tab bound to the old name.

> **Note** — that fan-out is driven by **this window acting**. A `CREATE DATABASE` you type into a
> query tab is an ordinary thing to do and produces no signal at all, so the picker and the tree will
> not notice it until something else refreshes them. Use the explorer's Refresh after DDL you ran
> yourself.

## Where it is not offered

On a server that does not support database management, **New Database…**, **Rename…** and
**Delete…** are all greyed out in the explorer's menus, and the palette and menu-bar entries refuse
with _… does not support creating or renaming databases._

**Rename…** and **Delete…** are also greyed out on a **system database**, whatever the engine says.

## Delete

> **Note** — **Delete…** has not shipped. The item is in the database's right-click menu, it is
> enabled on a manageable, non-system database, and clicking it does nothing at all: no handler is
> subscribed to the command it dispatches. There is no confirmation, and no database is dropped.
> Drop a database with a `DROP DATABASE` statement in a query tab until the surface lands.

<details>
<summary>Where this page's facts come from</summary>

| Claim                                                                               | Source                                                                                                            |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The server menu's "New Database…", capability-gated                                 | `packages/renderer/src/shell/sidebar/node-menu.tsx:187-194`                                                       |
| The database picker's "New Database…", capability-gated                             | `packages/renderer/src/shell/sidebar/database-picker.tsx:86-94`                                                   |
| The menu bar's Database ▸ New Database...                                           | `packages/main/src/menu.ts:294-300`                                                                               |
| The palette entry "New database"                                                    | `packages/renderer/src/commands/catalogue.ts:481-488`                                                             |
| Targetless entries resolve the most recent connection; the sidebar names its server | `packages/renderer/src/features/databases/database-dialogs.tsx:100-111`                                           |
| The dialog's title, description and single Name field                               | `packages/renderer/src/features/databases/create-database-dialog.tsx:47-55`, `database-name-dialog.tsx:136-155`   |
| The three recovery models and their labels, with Simple as the default              | `packages/renderer/src/features/databases/create-database-dialog.tsx:18-25`                                       |
| The picker is not rendered off SQL Server, and why                                  | `packages/renderer/src/features/databases/create-database-dialog.tsx:1-10, 56-74`, `database-dialogs.tsx:74-98`   |
| The database menu's "Rename…", capability- and system-gated                         | `packages/renderer/src/shell/sidebar/node-menu.tsx:227-233, 275-282`                                              |
| The rename dialog shows and pre-fills the current name and refuses it               | `packages/renderer/src/features/databases/rename-database-dialog.tsx:31-45`, `database-name.ts:64-66`             |
| Its description states that open connections are closed                             | `packages/renderer/src/features/databases/rename-database-dialog.tsx:35`, `database-dialogs.tsx:143`              |
| Tabs on the old name follow the rename                                              | `packages/renderer/src/features/databases/database-invalidation.ts:82-119`                                        |
| The name rule, its 128-character cap, and that it is portability not safety         | `packages/renderer/src/features/databases/database-name.ts:1-33`                                                  |
| The five refusal sentences, verbatim                                                | `packages/renderer/src/features/databases/database-name.ts:46-74`                                                 |
| The collision check is case-insensitive, against the loaded list                    | `packages/renderer/src/features/databases/database-name.ts:39-45, 76-79`, `database-dialogs.tsx:62-72`            |
| An untouched empty field is not scolded                                             | `packages/renderer/src/features/databases/database-name-dialog.tsx:80-86`                                         |
| The server's message lands in the answer band; editing clears it                    | `packages/renderer/src/features/databases/database-name-dialog.tsx:148-152, 160`, `database-operations.ts:39-46`  |
| A rejection with no message, and that the cause is logged                           | `packages/renderer/src/features/databases/database-name-dialog.tsx:105-111`, `database-operations.ts:48-54`       |
| Success announces itself and writes the statement to the output panel               | `packages/renderer/src/features/databases/database-dialogs.tsx:179-194`                                           |
| Main's caches are dropped first, then the list and the server node re-read          | `packages/renderer/src/features/databases/database-invalidation.ts:121-152`                                       |
| The ERD cache is dropped, in both directions on a rename                            | `packages/renderer/src/features/databases/database-invalidation.ts:61-110`                                        |
| The invalidation is awaited before the dialog closes                                | `packages/renderer/src/features/databases/database-dialogs.tsx:130-137`                                           |
| DDL run in a query tab produces no signal                                           | `packages/renderer/src/features/databases/database-invalidation.ts:31-46`                                         |
| The palette/menu refusal on an engine without database management                   | `packages/renderer/src/features/databases/database-dialogs.tsx:92-96`                                             |
| Rename and Delete are greyed out on a system database                               | `packages/renderer/src/shell/sidebar/node-menu.tsx:230-233`                                                       |
| Delete… dispatches `delete-database`, and nothing is subscribed to it               | `packages/renderer/src/shell/sidebar/node-menu.tsx:283-291`, `packages/renderer/src/commands/registry.ts:471-473` |

</details>
