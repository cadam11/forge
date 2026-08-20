---
title: SQL conversion fails, or Python is not found
description: Why dialect conversion needs Python, what each failure message actually means, and the two cases where the message names the wrong problem.
sidebar:
  order: 4
---

Converting SQL between dialects is the one feature in Joinery that needs something installed on
your machine that Joinery does not ship. Everything else works without Python.

Joinery starts a small local service from `resources/python/sqlglot-server.py` by running
**`python3` from your PATH**, on `127.0.0.1` with an ephemeral port, and asks it to transpile. The
service starts **lazily, on your first conversion**, and stops when the app quits — so a broken
setup only announces itself the first time you use the feature, not at launch.

**The install is on
[Prerequisites](../../getting-started/prerequisites/#python-and-sqlglot-for-sql-dialect-conversion),
and only there.** Four packages: `sqlglot`, `fastapi`, `uvicorn`, `pydantic`.

## What each message means

Every refusal arrives as a message. None of them throws, and none of them touches the SQL in your
editor.

| Message                                                                                                  | What actually happened                                                                                |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| _There is no SQL to convert._                                                                            | The editor — or your selection — is empty                                                             |
| _This tab is already …_                                                                                  | You asked for the engine the tab is already on                                                        |
| _Python 3 is required for SQL conversion. Please install Python 3 and ensure "python3" is on your PATH._ | The service failed to start. **See below** — this is the message you get for several different causes |
| _SQL conversion is unavailable: the sqlglot server script is missing from this build._                   | A packaging fault, not a machine problem                                                              |
| _SQL conversion service timed out. The microservice may still be starting — try again._                  | The service did not come up within 15 seconds, or a conversion took more than 30                      |
| The transpiler's own error text                                                                          | sqlglot ran and could not parse or rewrite your SQL                                                   |

## "Python 3 is required" when Python is installed

This is the sharp edge worth knowing about, and there are two ways into it.

**The packages are not installed.** `python3` is found and spawned, the script hits its first
`import`, and the process exits before it can announce its port. Joinery decides which message to
show by looking for the text `python` anywhere in the failure — and the failure carries the
script's own path, which contains a folder called `python`. So a `ModuleNotFoundError` for
`fastapi` is reported as _Python 3 is required_, naming the wrong half of the problem.

If you have Python and still get that message, run the install line from Prerequisites and try
again. To confirm the diagnosis first, run the four imports yourself:

```bash
python3 -c "import sqlglot, fastapi, uvicorn, pydantic"
```

**The interpreter is not called `python3`.** Joinery spawns the interpreter by that exact name. On
Windows, where the launcher is usually `python` or `py`, the name may not resolve at all and the
spawn fails with `ENOENT` — which produces the same sentence, and the sentence names a fix that
may be exactly the thing your machine does not have. There is no setting for the interpreter path.
This is a known rough edge, tracked as **J-29**, and
[Prerequisites](../../getting-started/prerequisites/#python-and-sqlglot-for-sql-dialect-conversion)
says so too.

> **Careful** — Joinery inherits its PATH from the process that launched it. If you installed
> Python after starting the app, restart it. On macOS, an app launched from the Dock does not
> read your shell profile, so a `python3` that only exists on a PATH set in `~/.zshrc` is not
> visible to it.

## It converted, but the SQL is wrong

sqlglot's **warnings are not shown to you.** The bridge between the two halves of Joinery carries
success, the SQL and an error — nothing else — so a conversion that succeeded with caveats looks
identical to one that was clean. The transpiler is asked to run at its `WARN` error level, which
means it keeps going past constructs it is unsure about.

Read the converted SQL before you run it. Nothing is executed by a conversion, and the result
replaces the whole document, so **⌘Z** puts your original back.

## Other things that are not failures

**There is no setup-instructions view.** Unlike the backup wizards, a failed conversion is a
message and nothing else. The fix is on the Prerequisites page.

**The whole document was converted when you wanted one statement.** Conversion uses your
selection if there is one and the whole document otherwise. The editor's _execute scope_ setting
is deliberately not consulted — that setting is about what runs.

**The first conversion is slow.** The service is started on demand and gets 15 seconds to come
up. Subsequent conversions reuse it for the life of the app.

The feature itself is documented under
[SQL dialect conversion](../../features/sql-dialect-conversion/).

<details>
<summary>Where this page's facts come from</summary>

| Claim                                                                               | Source                                                                                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| The service is spawned as `python3` against `resources/python/sqlglot-server.py`    | `packages/main/src/services/sql/sql-converter.ts:26, 94-103`, `sqlglot/sqlglot-client.ts:56, 98`     |
| It binds loopback on an ephemeral port and imports the four packages                | `resources/python/sqlglot-server.py:1-12`                                                            |
| It starts on the first conversion and stops at shutdown                             | `packages/main/src/services/sql/sql-converter.ts:105-127, 195-207`                                   |
| 15-second startup and 30-second request timeouts                                    | `packages/main/src/services/sql/sql-converter.ts:96-100`                                             |
| "There is no SQL to convert." and the already-this-engine refusal                   | `packages/renderer/src/features/query/sql-convert.ts:20-25, 63-68`                                   |
| The three main-process failure sentences, and the order they are matched in         | `packages/main/src/services/sql/sql-converter.ts:163-176`                                            |
| The Python message is chosen by `errorMsg.includes('python')`                       | `packages/main/src/services/sql/sql-converter.ts:170-172`                                            |
| A startup failure's text carries the script path, and that path contains `python`   | `packages/main/src/services/sql/sqlglot/sqlglot-client.ts:140-148`, `sql-converter.ts:26`            |
| A missing module therefore exits the process before it announces its port           | `packages/main/src/services/sql/sqlglot/sqlglot-client.ts:126-129, 140-148`                          |
| A missing script is matched first, precisely because that path contains `python`    | `packages/main/src/services/sql/sql-converter.ts:165-169`                                            |
| The transpiler's own errors are returned as the error                               | `packages/main/src/services/sql/sql-converter.ts:150-158`                                            |
| Warnings never reach the window — the bridge carries three fields                   | `packages/preload/src/index.ts:249-253`, `packages/renderer/src/features/query/sql-convert.ts:74-81` |
| The transpiler runs at the `WARN` error level, pretty-printed                       | `packages/main/src/services/sql/sql-converter.ts:139-144`                                            |
| Nothing is executed; the result replaces the whole document, so it is one undo away | `packages/renderer/src/features/query/query-panel.tsx:260-264, 278-279`                              |
| The selection is converted when there is one, else the whole document               | `packages/renderer/src/features/query/query-panel.tsx:247-270`                                       |
| The execute-scope setting is deliberately not read                                  | `packages/renderer/src/features/query/query-panel.tsx:254-259`                                       |
| A failed conversion is a message, not a setup view                                  | `packages/renderer/src/features/query/query-panel.tsx:272-280`                                       |
| Nothing in main sets or extends PATH before spawning                                | `packages/main/src/services/sql/sqlglot/sqlglot-client.ts:98-101` (`env: { ...process.env }`)        |

</details>
