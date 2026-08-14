# Forge Regression Test Suite

> **Historical.** This document describes a legacy MSSQL audit suite
> (`full-audit.spec.ts`) that no longer exists in the repo, run against a
> MemberJunction database. It is kept for reference only — the current test
> harness is documented in `tests/README.md`. The `__mj` references below
> describe that old fixture, not anything Forge still ships.

## Overview

Automated Playwright tests for the Forge Electron app. Tests launch the full Electron app, connect to a local SQL Server Docker instance, and exercise every major feature area.

## Prerequisites

- **Node.js 20+** and npm
- **Docker** with SQL Server container running on `localhost:1433`
- **MJ_5_14_0 database** with MemberJunction schema (`__mj` schema)
- **Playwright** installed: `npm install`

## Running Tests

```bash
# Full audit suite (31 tests, ~1.5 min)
npx playwright test e2e/full-audit.spec.ts --reporter=list

# Run specific test by name
npx playwright test e2e/full-audit.spec.ts -g "07 – Execute query"

# Run first N tests
npx playwright test e2e/full-audit.spec.ts -g "01|02|03|04|05"
```

## Test Suite: Full Audit (31 tests)

### Connection & Setup (Tests 1-3)

| #   | Test                  | What it checks                                                     |
| --- | --------------------- | ------------------------------------------------------------------ |
| 01  | Welcome screen        | App launches, Forge branding visible, New Connection button exists |
| 02  | Connect to SQL Server | Connects via saved profile or creates new (localhost:1433, sa)     |
| 03  | Database dropdown     | Sidebar database dropdown works, selects MJ_5_14_0                 |

### Explorer Tree (Tests 4-5)

| #   | Test                  | What it checks                                                 |
| --- | --------------------- | -------------------------------------------------------------- |
| 04  | Explorer tree         | Tree nodes visible, databases listed (master, MJ_5_14_0, etc.) |
| 05  | MJ database expansion | MJ_5_14_0 expands to show `__mj` schema                        |

### Query Editor (Tests 6-13)

| #   | Test                  | What it checks                                                               |
| --- | --------------------- | ---------------------------------------------------------------------------- |
| 06  | New query tab         | Code button opens query tab, Monaco editor loads                             |
| 07  | Execute query         | Types SQL, changes DB to MJ_5_14_0, executes, verifies AG Grid with 10+ rows |
| 08  | Query error handling  | Executes bad SQL, verifies error message displayed                           |
| 09  | Multiple result sets  | Executes two SELECT statements, checks grid instances                        |
| 10  | Query toolbar buttons | Verifies play, stop, history, format, export buttons exist                   |
| 11  | Query history         | History button/panel existence                                               |
| 12  | Format SQL            | Cmd+Shift+F formats SQL in editor                                            |
| 13  | Export results        | Export/download button visibility after query execution                      |

### UI Features (Tests 14-21)

| #   | Test                      | What it checks                                                                                                                        |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | Settings panel            | Cmd+, opens settings, theme/font/tab settings visible                                                                                 |
| 15  | Command palette           | Cmd+Shift+P opens palette, lists commands                                                                                             |
| 16  | Object search (Cmd+P)     | Quick search dialog opens                                                                                                             |
| 17  | Object search with filter | Types search term, checks results                                                                                                     |
| 18  | Shortcuts dialog          | Cmd+Shift+/ opens keyboard shortcuts reference                                                                                        |
| 19  | Docker panel              | Docker status panel accessible                                                                                                        |
| 20  | Backup feature            | Backup dialog opens with options (type, path, compression) — _covered by `tests/e2e/backup-restore.spec.ts` (PG + MySQL round-trip)_  |
| 21  | Restore feature           | Restore dialog opens with file browser and recovery options — _covered by `tests/e2e/backup-restore.spec.ts` (PG + MySQL round-trip)_ |

### MJ Metadata (Tests 22-23)

| #   | Test                 | What it checks                                    |
| --- | -------------------- | ------------------------------------------------- |
| 22  | MJ Entity query      | Queries \_\_mj.Entity with JOIN, expects 20+ rows |
| 23  | MJ Application query | Queries \_\_mj.Application, expects 10+ rows      |

### UI Polish (Tests 24-31)

| #   | Test               | What it checks                                                 |
| --- | ------------------ | -------------------------------------------------------------- |
| 24  | Connection menu    | Connection dropdown menu options                               |
| 25  | Status bar         | Bottom status bar shows connection, database, row count        |
| 26  | Tab management     | Multiple tabs visible, correct titles                          |
| 27  | Sidebar resize     | Sidebar can be resized via drag handle                         |
| 28  | All buttons audit  | Scans ALL buttons, logs position/state/tooltip                 |
| 29  | Theme: before      | Captures light theme screenshot                                |
| 30  | Theme: dark switch | Switches to dark theme via settings, verifies DOM class change |
| 31  | Final state        | Full-page screenshot of final app state                        |

## Screenshots

Test screenshots are saved to `e2e/screenshots/audit4/` with naming:

- `001-welcome.png` through `032-final-state.png`
- `FINAL-full.png` — full-page capture of final state

## Key Test Helpers

### `waitForMonaco(timeoutMs)`

Polls for a VISIBLE Monaco editor (width > 100, height > 100). Multiple Golden Layout tabs create multiple editors — this finds the active one.

### `getMonacoTextarea()`

Finds the textarea inside the VISIBLE Monaco editor (by index based on bounding rect).

### `clickExecuteButton()`

Clicks the play button on the VISIBLE query toolbar. More reliable than F5 keypress across multiple tab instances.

### `dismissOverlays()`

Removes CDK overlay backdrops and dismisses snackbars that block interaction.

## Known Test Limitations

- **Object search returns 0**: The search requires server-side indexing that may not be available in test
- **Command palette not visible**: Palette may be obscured by overlays in certain test states
- **Explorer tree structure**: Tests check for generic tree nodes, not specific Tables/Views folders (tree shows schemas first)
- **ERD button**: Only available in table context, not testable from query view

## Bugs Found & Fixed During Testing

### Round 1

- Context menu z-index too low (behind overlays)
- Keyboard shortcuts not working (event listeners)
- Sidebar UX issues

### Round 2

- **Query execution on wrong database**: `request.query()` uses `sp_executesql` which ignores `USE` — switched to `request.batch()` for raw T-SQL
- **Database selection reverting**: Active-tab effect was resetting `connectionState.selectedDatabase()` to the tab's initial `databaseName`. Fixed by updating tab state when toolbar dropdown changes.
- **Tab text unreadable**: White/light text on light gray background in Golden Layout tabs. Added explicit `color: var(--text-primary)` and Material component CSS variable overrides.
- **Sidebar text contrast**: Connection/database labels in sidebar had low contrast. Added explicit text colors and font weights.
- **Monaco editor targeting**: Multiple GL tabs = multiple editors. Tests must find VISIBLE instances via bounding rect checks.
