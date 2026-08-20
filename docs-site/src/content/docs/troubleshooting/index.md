---
title: Troubleshooting
description: The five things that go wrong most often — Docker detection, the keychain, the backup command-line tools, Python for SQL conversion, and connections that fail or drop.
---

Five pages, each one a symptom rather than a subsystem. Start with whichever sentence the app
showed you.

| Page                                                                         | Start here when                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Docker is not detected](./docker-not-detected/)                             | The container pip says _not available_ or _not running_, or the list is empty   |
| [Credential and keychain problems](./credentials-and-keychain/)              | Passwords do not stick, or you see _password not found in Keychain_             |
| [A required command-line tool is missing](./missing-cli-tools/)              | A backup or restore shows setup instructions instead of a form                  |
| [SQL conversion fails, or Python is not found](./sql-conversion-and-python/) | A dialect conversion refuses, or asks for Python you already have               |
| [Connection failures and dropped tunnels](./connections-and-tunnels/)        | A connection will not open, drops mid-session, or rides an SSH tunnel that dies |

## Two things worth knowing first

**Install commands live on one page.** The PostgreSQL and MySQL backup tools, and Python with
sqlglot, are both installed from
[Prerequisites](../getting-started/prerequisites/). Nothing here repeats those commands — two
copies of an install command is one copy that will be wrong. Restart Joinery after installing
anything: the app inherits its PATH from the process that launched it.

**The output panel has the real error.** **⌘J** opens it. It is a single timeline of what the
main process and the window logged, and it is the only place the engine-specific error fields
survive — a SQL Server error number, a PostgreSQL `hint`, a driver's stack — because the message
is all that crosses to the window. It has an errors-only filter, per-entry copy, and a toolbar
button that reveals the log file on disk.

If a page here does not solve it, that log file is what to attach to a
[bug report](https://github.com/cadam11/joinery/issues).

<details>
<summary>Where this page's facts come from</summary>

| Claim                                                                         | Source                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ⌘J toggles the output panel                                                   | `packages/renderer/src/commands/catalogue.ts:559-566`                          |
| One timeline of main-process and window entries, with an errors-only filter   | `packages/renderer/src/shell/workspace/output-panel.tsx:1-3, 180-229, 236-241` |
| Per-entry copy, and a toolbar button that reveals the log file                | `packages/renderer/src/shell/workspace/output-panel.tsx:207-217, 253-264`      |
| Engine-specific error fields are logged rather than sent over IPC             | `packages/main/src/ipc/safe-handle.ts:14-46`                                   |
| Install instructions tell you to restart Joinery so the new PATH is picked up | `packages/shared/src/config/cli-install-instructions.ts:38, 65, 90, 118`       |

</details>
