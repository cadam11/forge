---
title: Features
description: One guide per shipped surface — the editor, the grid, the explorer, diagrams, backups, containers and the assistant.
---

A guide per shipped surface, one for each of the seventeen. Every claim on these pages is checked
against the app's own source, and each page carries its citations at the bottom.

## Writing and running SQL

- **[Query editor](./query-editor/)** — the query tab, the three execute keystrokes and their
  confirmations, statement scope, format, placeholders, and `.sql` files.
- **[Results grid](./results-grid/)** — the row cap, sorting and filtering, copy and export, the row
  inspector, foreign-key lookups, and saved results.
- **[Execution plans](./execution-plans/)** — how each engine is asked for a plan, why SQL Server's
  runs your statement, and how to read the pane.
- **[SQL dialect conversion](./sql-dialect-conversion/)** — rewriting the editor for another engine,
  what it needs installed, and what failure looks like.

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

## Understanding a schema

- **[ERD](./erd/)** — the diagram, how one is built, what a box shows, and the details rail.
- **[Schema diff](./schema-diff/)** — comparing two databases on one server, and why PostgreSQL is
  refused.

## Looking after a database

- **[Backup and restore](./backup-and-restore/)** — what each engine actually runs, the host tools
  it needs, and the confirmation that guards a restore.
- **[Databases](./databases/)** — creating and renaming, the name rule, and what refreshes
  afterwards.
- **[Docker containers](./docker-containers/)** — the status-bar pip, starting and stopping
  containers, and creating one.

## The assistant

- **[AI assistant](./ai-assistant/)** — the chat panel and chat tabs, what the assistant is told
  about your database, and how tool calls are confirmed.
- **[AI setup](./ai-setup/)** — providers, where the API key is kept, the model picker, and the
  auto-router cost tier.

---

Two prerequisites some of these features depend on — the PostgreSQL and MySQL backup CLIs, and
Python with sqlglot for dialect conversion — are documented in full on
[Prerequisites](../getting-started/prerequisites/).
