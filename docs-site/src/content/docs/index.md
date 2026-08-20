---
title: Joinery
description: A desktop database workbench for SQL Server, PostgreSQL and MySQL, with an assistant that reads your schema and shows its work.
template: splash
# Starlight builds every page's `<title>` as "<frontmatter title> <delimiter> <site title>", which
# on this page — whose title IS the site title — renders "Joinery | Joinery". A `title` entry in a
# page's `head` replaces that default outright rather than adding a second one: `getHead` merges
# the frontmatter head last, and its `hasTag` treats any `title` as matching any other, so the
# default is filtered out (`@astrojs/starlight/utils/head.ts`, `createHead` / `mergeHead` /
# `hasTag`). Verified against the built `dist/index.html`. `og:title` is unaffected — it is built
# from the frontmatter title, and "Joinery" is the right value there.
head:
  - tag: title
    content: Joinery — a desktop database workbench
hero:
  tagline: Your database, fitted to the way you work.
  actions:
    - text: Install Joinery
      link: ./getting-started/install/
      icon: right-arrow
      variant: primary
    - text: What you need first
      link: ./getting-started/prerequisites/
      variant: minimal
    - text: A tour of the workspace
      link: ./getting-started/workspace-tour/
      variant: minimal
---

Joinery is a desktop workbench for three relational engines — **SQL Server**, **PostgreSQL**
and **MySQL** — with one set of workflows across all three. Connect directly or through an SSH
tunnel, read the schema, write and run SQL, and see the exact statement behind every operation
the app performs on your behalf.

## Start here

- **[Install](./getting-started/install/)** — build from source. There are no packaged
  installers yet; they arrive with v1.
- **[Prerequisites](./getting-started/prerequisites/)** — supported operating systems and engine
  versions, plus the two host-side prerequisites that are easy to miss: the PostgreSQL/MySQL
  backup CLIs, and Python + sqlglot for dialect conversion.
- **[First run](./getting-started/first-run/)** — the welcome tab and the guided tour.
- **Connect** — [SQL Server](./getting-started/connect-sql-server/),
  [PostgreSQL](./getting-started/connect-postgresql/),
  [MySQL](./getting-started/connect-mysql/), or
  [over an SSH tunnel](./getting-started/connect-ssh/).

## Then keep going

- **[Features](./features/)** — a guide per shipped surface: the editor, the results grid, the
  explorer, diagrams, schema comparison, backup and restore, containers, and the assistant.
- **[Reference](./reference/)** — the tables the guides link to rather than repeat: every
  [keyboard shortcut](./reference/keyboard-shortcuts/) and [command](./reference/commands/),
  generated from the app's own source, plus settings, supported engines, AI providers, and where
  Joinery keeps your data.

## When something goes wrong

- **[Troubleshooting](./troubleshooting/)** — Docker detection, the keychain, the backup
  command-line tools, Python for SQL conversion, and connections that fail or drop. Each page
  starts from the sentence the app showed you.

## Open source

Joinery is open source under the **MIT license**. The source is on
[GitHub](https://github.com/cadam11/joinery).
