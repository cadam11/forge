---
title: Features
description: One guide per shipped surface — the query editor, the results grid, the explorer, search, the palette, snippets and history.
---

A guide per shipped surface. Nine are written; the rest are listed at the bottom of this page and
are on their way. Every claim on these pages is checked against the app's own source, and each page
carries its citations at the bottom.

## Writing and running SQL

- **[Query editor](./query-editor/)** — the query tab, the three execute keystrokes and their
  confirmations, statement scope, format, placeholders, and `.sql` files.
- **[Results grid](./results-grid/)** — the row cap, sorting and filtering, copy and export, the row
  inspector, foreign-key lookups, and saved results.
- **[Execution plans](./execution-plans/)** — how each engine is asked for a plan, why SQL Server's
  runs your statement, and how to read the pane.

## Finding things

- **[Object explorer](./object-explorer/)** — the sidebar tree, its keyboard model, the right-click
  menus, and what Refresh actually re-reads.
- **[Find a database object](./find-a-database-object/)** — ⌘P, fuzzy search across one database's
  tables, views, procedures and functions.
- **[Command palette](./command-palette/)** — ⌘K, every command by name, and why some rows are
  greyed out.
- **[Keyboard shortcuts](./keyboard-shortcuts/)** — the ⇧⌘/ cheat sheet, and which keys differ on
  Windows.

## Reusing your work

- **[Snippets](./snippets/)** — ⌥⌘S, the snippet library, and how inserting works.
- **[Query history](./query-history/)** — ⇧⌘H, what is kept, and where a re-opened query lands.

## Still to come

Guides for the ERD, schema comparison, backup and restore, database operations, Docker containers,
SQL dialect conversion, the AI assistant and AI setup are being written. Until they arrive, the
[README's feature list](https://github.com/cadam11/joinery#features) is the overview, and **⌘K**
inside the app lists every command with its description and its binding.

Two prerequisites some of those features depend on — the PostgreSQL and MySQL backup CLIs, and
Python with sqlglot for dialect conversion — are documented in full on
[Prerequisites](../getting-started/prerequisites/).
