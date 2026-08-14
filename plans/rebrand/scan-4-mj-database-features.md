# Scan 4 — MemberJunction-Product-Specific Database Features

**Scope:** functional coupling to MemberJunction *as a product* — the behaviour that activates
when Forge detects a MemberJunction database (`__mj` schema, `__mj.Entity` metadata tables,
`__mj_CreatedAt` audit columns). Branding strings, package names (`@memberjunction/*`,
`@mj-forge/*`), README/docs, app IDs and repo URLs are **out of scope** for this scan and belong
to the branding scan — except where they are load-bearing for a feature described here.

**Date:** 2026-08-14 · **Repo:** `/Users/cadam/code/forge` @ `1c5b21b` · **Read-only scan, no edits made.**

---

## Executive summary

There is exactly **one** MemberJunction product feature, implemented as a vertical slice through
every layer: **"MJ Metadata Awareness"**. It splits cleanly into **six user-visible sub-features**
plus a large **dead-code tail**.

Total surface: **~1,150 lines** of MJ-specific code across 8 files, 10 IPC channels,
11 shared type interfaces, 9 tree-node types, 2 test fixture files and 1 e2e spec.

Key findings you should know before deciding anything:

1. **Zero AI coupling.** No system prompt, tool description, or tool in
   `packages/main/src/services/ai/` mentions MemberJunction, `__mj`, entity metadata, or MJ
   codegen conventions. This is the single most reassuring finding — the AI layer is clean.
2. **Six of the ten MJ IPC endpoints are dead code** — wired through main → preload → ipc.service
   and never called by any component.
3. **Half the MJ metadata service is MSSQL-only** and silently returns `[]` on PostgreSQL/MySQL
   (hardcoded `USE [db]`, `SELECT TOP`, bracket quoting).
4. **Two MJ menu items leak onto every table on every engine** (see Feature 5) — this is an
   active defect for non-MJ users today, not just latent coupling.
5. **The ERD unconditionally queries `__mj.Entity` on every ERD open**, on every database,
   MJ or not (see Feature 4) — one guaranteed-failing round-trip + error log per ERD load on
   non-MJ databases.
6. **There is effectively no test coverage of any MJ feature.** The one e2e spec that looks like
   coverage (`tests/e2e/mj-schema.spec.ts`) does *not* exercise MJ detection at all — see the
   "Test coverage reality check" section. It is a plain query test against a schema that happens
   to be named `__mj`.
7. **`mj.config.cjs` at the repo root is a tracked file containing a plaintext SQL Server `sa`
   password** and is referenced by **no code whatsoever**. See "Secrets & fixtures".

---

## Detection mechanism (one mechanism, used two ways)

**Canonical detection** — `MetadataService.detectMJDatabase()`,
`packages/main/src/services/sql/metadata.ts:1217-1342`.

Three-stage probe, per engine (MSSQL / PostgreSQL / MySQL variants at `:1229-1261`):

| Stage | Test | Line |
|---|---|---|
| 1 | `__mj` schema exists **AND** `__mj.Entity` table exists → otherwise bail with `{isMJEnabled:false}` | `:1273-1275` |
| 2 | `COUNT(*)` of `__mj.Entity` and `__mj.Application` → `entityCount`, `applicationCount` | `:1280-1301` |
| 3 | Optional `SELECT MJVersion FROM __mj.VersionInstallation ORDER BY InstalledAt DESC` → `version` (try/catch, older MJ lacks it) | `:1304-1327` |

Also probes for `__mj.User`, `__mj.AuditLog`, `__mj.Application` presence → `hasUsers`,
`hasAuditLog` flags. Wrapped in a top-level try/catch that logs and returns
`{isMJEnabled:false}` (`:1338-1341`).

The schema name is a **parameter with default `'__mj'`** on every MJ method — so it is already
"configurable", but nothing in the UI or settings ever passes a non-default value. It is a
default in ten places, not a setting.

**Detection call site #1 (gated, correct):** `explorer.state.ts:642-653`. On schema expansion,
if any returned schema is literally named `__mj`, call `detectMJDatabase`. Otherwise skip
entirely. Failure is swallowed (`catch {}` at `:650-652` — note this violates the repo's
"never swallow errors" rule).

**Detection call site #2 (ungated, wrong):** `erd.component.ts:671` calls `loadMJEntities()`
unconditionally on every ERD load, which issues `SELECT ... FROM __mj.Entity` against any
database. On a non-MJ DB this always throws, is caught at `:802-805`, and caches `[]`.

**Behaviour on a NON-MJ database:** every feature below is purely additive and invisible
*except* Feature 4 (wasted failing query per ERD open) and Feature 5 (two broken menu items on
every table). Those two change behaviour for everyone.

---

## Layer map

| Layer | File | MJ lines |
|---|---|---|
| Shared types | `packages/shared/src/types/database.types.ts` | `227-404` (11 interfaces) |
| IPC channel constants | `packages/shared/src/constants/ipc-channels.ts` | `201-213` (10 channels) |
| Main — metadata service | `packages/main/src/services/sql/metadata.ts` | `1209-1827` + imports `22-31` |
| Main — IPC handlers | `packages/main/src/ipc/database.ipc.ts` | `133-277` + imports `14-23` |
| Preload — typed bridge | `packages/preload/src/index.ts` | types `400-459`, impl `871-937` |
| Renderer — IPC service | `packages/renderer/src/app/core/services/ipc.service.ts` | `1006-1126` + types `~75` |
| Renderer — explorer state | `packages/renderer/src/app/core/state/explorer.state.ts` | `36-46, 68-69, 120-129, 367-370, 415-436, 642-668, 690-843` |
| Renderer — sidebar | `packages/renderer/src/app/layout/sidebar/sidebar.component.ts` | `284-291, 602-…(css), 872-890, 1061-1071, 1392-1448, 1771-1985` |
| Renderer — ERD | `packages/renderer/src/app/features/erd/erd.component.ts` | `15, 19, 88-94, 142-…, 319-…(css), 595-596, 670-671, 684-685, 739-790, 795-820` |
| Renderer — explorer detail pane | `packages/renderer/src/app/features/explorer/explorer.component.ts` | `362, 374, 435-437` |
| Tests / fixtures | `tests/fixtures/postgres/mj-schema.sql`, `mj-seed.sql`, `tests/helpers/forge-actions.ts:33-41,58-65`, `tests/e2e/mj-schema.spec.ts` | whole files |
| Orphan config | `mj.config.cjs` | whole file, referenced nowhere |

---

# Feature cards

---

## Feature 1 — MJ database detection + badge

**Entry point:** `packages/main/src/services/sql/metadata.ts:1217` (`detectMJDatabase`)
**Renderer trigger:** `packages/renderer/src/app/core/state/explorer.state.ts:642-653`
**Badge UI:** `packages/renderer/src/app/layout/sidebar/sidebar.component.ts:284-291`

### What it does
When the explorer expands a database's schema list and one of the schemas is named `__mj`, it
runs the three-stage probe above. If MJ is detected, the `mjInfo: MJDatabaseInfo` object is
attached **only to the `__mj` schema node** (`explorer.state.ts:668`). The sidebar then renders
an `<img class="mj-icon" src="assets/icons/mj-logo.png">` next to that node with the tooltip
`MemberJunction (N entities)`.

Note `assets/icons/mj-logo.png` is **dual-purpose**: it is also the app's own header icon at
`sidebar.component.ts:67`. Removing the badge does not orphan the asset.

### Detection
Explicit `__mj` schema-name string match, then the `detectMJDatabase` probe. Fully gated —
a non-MJ database never runs the probe.

### Blast radius if removed
Near zero. `mjInfo` on `TreeNode` is consumed by exactly three things: the badge, the
MJ-folder branch (Feature 2), and the entity count in the folder label. Nothing in general
explorer/query/backup/ERD depends on it.

### Test coverage
**None.** No unit, integration, e2e, or visual test asserts the badge or `detectMJDatabase`.
The visual baseline `sidebar-with-populated-explorer-tree.png` captures the sidebar *before*
schema expansion (`tests/e2e/visual/connected.spec.ts:28-37`), so it does not contain the badge
and would not change.

### Options
- **(a) KEEP AS-IS, strip branding** — retitle tooltip to e.g. "Metadata framework (N entities)",
  replace `mj-logo.png` badge with a neutral Material icon. Behaviour-preserving. ~15 lines touched.
- **(b) GENERICISE** — introduce a small `FrameworkDetector` registry keyed on a schema-name +
  probe-table pair, so `__mj` becomes one entry in a table of "known metadata frameworks". Behaviour
  preserving for MJ DBs, opens the door to others. Cost: a new abstraction layer for one member,
  which the repo's own "one layer of magic" rule argues against.
- **(c) DELETE** — remove `detectMJDatabase` (`metadata.ts:1213-1342`), `MJDatabaseInfo`
  (`database.types.ts:227-247`), `IPC_CHANNELS.MJ.DETECT`, its handler
  (`database.ipc.ts:136-147`), the preload `mj.detect` entry, `ipc.service.ts:1010-1023`,
  `TreeNode.mjInfo` (`explorer.state.ts:68-69`), the detection block (`:642-668` → collapse to
  a plain `schemas.map`), and the badge + `.mj-icon` CSS.

**RECOMMENDATION: (c) DELETE**, but only as part of the Feature 2 decision — the badge is the
signpost for the folders, and keeping one without the other is incoherent. If Craig wants to keep
Feature 2, take **(a)** here.

---

## Feature 2 — MJ-specific explorer tree (six extra folders under `__mj`)

**Entry point:** `packages/renderer/src/app/core/state/explorer.state.ts:367-370` → `:693`
(`getMJSchemaFolders`)

### What it does
When the `__mj` schema node is expanded **and** `mjInfo.isMJEnabled`, Forge replaces the normal
schema folder list with a bespoke one (`:693-753`):

| Folder | Node type | Loader | Backing IPC |
|---|---|---|---|
| `Entities (N)` | `mj_entities_folder` | `loadMJEntities` `:758` | `mj:get-entities` |
| `Saved Queries` | `mj_queries_folder` | `loadMJQueries` `:789` | `mj:get-saved-queries` |
| `Applications` | `mj_applications_folder` | `loadMJApplications` `:819` | `mj:get-applications` |
| `Change History` | `mj_changes_folder` | none — context menu only | (SQL text) |
| `Audit Logs` | `mj_audit_folder` | none — context menu only | (SQL text) |
| `Error Logs` | `mj_errors_folder` | none — context menu only | (SQL text) |

…plus Tables / Views / Stored Procedures re-appended manually at `:726-733`. **This hand-rolled
re-append is a maintenance trap**: it bypasses `schemaFolderDefs(capabilities)` (`:673`), so the
`__mj` schema does not get engine-capability-aware folders (no Functions, no engine filtering)
the way every other schema does. Any future folder added to `explorer-folders.ts` silently
misses the `__mj` schema.

Leaf nodes get types `mj_entity`, `mj_query`, `mj_application`, all declared in the `NodeType`
union at `explorer.state.ts:36-46` with icons at `:120-129` (duplicated in
`explorer.component.ts:435-437`).

`mj_entity` nodes are treated as tables by the detail pane (`explorer.component.ts:362, 374`)
and open `SELECT TOP 1000` from `entity.baseTable` in `entity.schemaName`
(`sidebar.component.ts:872-880`). `mj_query` nodes open their stored SQL directly
(`sidebar.component.ts:883-890`).

### Detection
`node.schema === '__mj' && node.mjInfo?.isMJEnabled` (`:368`). Hard string literal.

### Blast radius if removed
Contained but non-trivial. Removal touches the `NodeType` union (9 members), the icon maps in two
files, the `loadChildren` dispatcher (`:415-436`), three loader methods, `getMJSchemaFolders`,
and the `mj_entity`/`mj_query` branches of `explorer.component.ts` and
`sidebar.component.ts:872-890`. **After removal, the `__mj` schema still appears in the tree and
still expands normally** via `getSchemaFolders` — it just looks like any other schema. That is a
strictly better outcome than the current hand-rolled list.

### Test coverage
**None.** `explorer-folders.spec.ts` tests only the generic capability-driven folder defs; it has
zero MJ references. `tests/e2e/explorer.spec.ts:40-41` explicitly declines to assert schema/table
names.

### Options
- **(a) KEEP AS-IS, strip branding** — rename node types `mj_*` → e.g. `meta_*`, retitle the
  tooltip. Behaviour-preserving, but keeps the folder-list maintenance trap and 400+ lines.
- **(b) GENERICISE** — reframe as a data-driven "framework profile": a declarative descriptor
  `{schemaName, folders:[{label, table, columns}]}` that the explorer consumes generically, with
  MJ shipped as one optional profile (or none at all, user-supplied). Preserves behaviour for MJ
  DBs; roughly the same LOC but with a real seam. Only worth it if Craig actually wants a second
  profile.
- **(c) DELETE** — delete `explorer.state.ts:36-46` (9 union members), `:120-129` (icons),
  `:367-370`, `:415-436`, `:690-843` (`getMJSchemaFolders` + 3 loaders); `explorer.component.ts`
  `mj_entity`/`mj_query`/`mj_application` from `:362, :374, :435-437`;
  `sidebar.component.ts:872-890`, `:1061-1071` (context-menu dispatch), `:1771-1985`
  (five MJ context-menu builders). No tests come out — there are none.

**RECOMMENDATION: (c) DELETE.** This is the largest MJ surface, it is untested, it is
MSSQL-flavoured (Feature 3), and it makes `__mj` behave *worse* than an ordinary schema by
bypassing the capability-aware folder system. Craig has forked away from MemberJunction; carrying
400 lines of tree code for a schema he will never connect to is pure liability.

---

## Feature 3 — MJ metadata read APIs (main process) + 10 IPC channels

**Entry point:** `packages/main/src/services/sql/metadata.ts:1209-1827` (banner comment to end
of `getMJUserRecordLogs`) — **619 lines, ~33% of the whole metadata service.**

### What it does
Ten methods reading MemberJunction's metadata/audit tables:

| Method | Line | Engines supported | Called from renderer? |
|---|---|---|---|
| `detectMJDatabase` | `1217` | MSSQL / PG / MySQL | ✅ explorer |
| `queryMJ` (private helper) | `1351` | all | (internal) |
| `getMJEntities` | `1371` | MSSQL / PG / MySQL | ✅ explorer + ERD |
| `getMJEntityFields` | `1440` | MSSQL / PG / MySQL | ❌ **dead** |
| `getMJApplications` | `1504` | MSSQL / PG / MySQL | ✅ explorer |
| `getMJEntityRelationships` | `1538` | **MSSQL only** | ❌ **dead** |
| `getMJRecordChanges` | `1588` | **MSSQL only** | ❌ **dead** |
| `getMJAuditLogs` | `1644` | **MSSQL only** | ❌ **dead** |
| `getMJSavedQueries` | `1698` | **MSSQL only** | ✅ explorer |
| `getMJErrorLogs` | `1740` | **MSSQL only** | ❌ **dead** |
| `getMJUserRecordLogs` | `1781` | **MSSQL only** | ❌ **dead** |

Six of ten are **never invoked by any renderer code** — they exist only as
main-handler → preload-type → preload-impl → `ipc.service` wrapper quadruplets. That is
6 channels × 4 layers of pure dead weight.

Six of ten are **MSSQL-only**: they hardcode `USE [${db}]`, `SELECT TOP n`, and `[bracket]`
quoting, then swallow the resulting syntax error via try/catch and return `[]`
(e.g. `:1579-1582`, `:1635-1638`, `:1689-1692`). On a PostgreSQL MJ install, "Saved Queries"
in the explorer silently shows an empty folder. That is a real, undetectable-to-the-user bug.

The MJ block also encodes MemberJunction column conventions directly: `BaseTable`, `BaseView`,
`SchemaName`, `VirtualEntity`, `TrackRecordChanges`, `AuditRecordAccess`, `IncludeInAPI`,
`AllowCreate/Update/DeleteAPI`, and the `__mj_CreatedAt` / `__mj_UpdatedAt` audit columns
(`:1389, :1403-1404, :1418-1419, :1721-1722, :1764, :1767`).

**Security note (secondary, worth flagging):** `getMJEntityFields:1460, :1471, :1487` and every
`options.*` filter in the audit-log methods interpolate caller-supplied strings into SQL via a
hand-rolled `escStr` rather than parameterised queries. This contradicts CLAUDE.md's
"use parameterized queries where possible". Deleting the block removes the exposure; keeping it
means fixing it.

### Detection
None at this layer — these are unconditional readers. The gate lives in the renderer.

### Blast radius if removed
**Zero for general functionality.** Nothing outside the MJ features calls any of these. The MJ
type imports at `metadata.ts:22-31` come out with them. `queryMJ` (`:1351`) is MJ-only.
No shared helper (`escId`, `escStr`, `getDialect`, `queryAny`) is defined inside the block.

### Test coverage
**None.** No spec file references any `getMJ*` method or `mj:` channel.

### Options
- **(a) KEEP AS-IS, strip branding** — rename `MJ*` → e.g. `Meta*`, `mj:` channels →
  `metaframework:`. Behaviour-preserving. Still ships 619 lines of dead + MSSQL-only code.
- **(b) GENERICISE** — impossible in any honest sense. These queries are shaped exactly to
  MemberJunction's table and column names (`EntityID`, `AuditLogTypeID`, `ChangesJSON`,
  `QualityRank`, `MJVersion`). "Genericising" would mean a user-supplied schema mapping, which is
  a whole product feature, not a rebrand.
- **(c) DELETE** — remove `metadata.ts:1209-1827`; MJ imports `metadata.ts:22-31`;
  `database.ipc.ts:133-277` + imports `:14-23`; `ipc-channels.ts:201-213`;
  `preload/src/index.ts:400-459` (types) and `:871-937` (impl) + its MJ type imports (`:74`);
  `ipc.service.ts:1006-1126` + MJ type imports (`~:75`);
  `database.types.ts:227-404` (11 interfaces). **Zero tests come out.**

**RECOMMENDATION: (c) DELETE** if Feature 2 is deleted. If Feature 2 is kept, delete at minimum
the six dead endpoints (`getMJEntityFields`, `getMJEntityRelationships`, `getMJRecordChanges`,
`getMJAuditLogs`, `getMJErrorLogs`, `getMJUserRecordLogs`) and their four-layer plumbing —
that is unambiguously safe and removes ~330 lines with no behaviour change at all.

---

## Feature 4 — ERD "MJ Entity" enrichment

**Entry point:** `packages/renderer/src/app/features/erd/erd.component.ts:671`
(`loadMJEntities`, unconditional) → `:684` (`findMJEntity`) → template `:88-94`, `:142-…`

### What it does
On every ERD tab load, the component fires `getMJEntities(connectionId, database)` and caches the
result (`:795-807`). When a node is selected, it matches by
`entity.baseTable === node.name && entity.schemaName === (node.schemaName || 'dbo')` (`:817-819`).
On a match the detail panel gains:

- a gold "MJ Entity: {name}" badge (`:88-94`, CSS `:319`),
- two extra action buttons — **Change History** and **Audit Log** (`:105-116`), which emit
  hardcoded T-SQL against `[__mj].[RecordChange]` / `[__mj].[AuditLog]` into a new query tab
  (`viewChangeHistory:739-759`, `viewAuditLog:761-790`),
- an "MJ Entity Details" section showing MemberJunction-specific properties: Description,
  Base View, Track Changes, and (further down) the API allow-flags (`:142-…`).

### Detection
**Ungated.** `loadMJEntities` runs for every ERD open on every database. The failure path is a
bare `catch {}` at `:802-805` that sets the cache to `[]` — so on non-MJ databases the user
silently pays one guaranteed-failing SQL round-trip per (connection, database) pair, and the
main process logs an error each time. Purely additive to the *UI*, but not to the *work done*.

Note also the match uses `|| 'dbo'` — an MSSQL default baked into a multi-engine component.

### Blast radius if removed
Zero for the ERD's core function. The `NodePanelInfo.mjEntity` field (`:19`) becomes unused; the
badge, the two buttons, the details section, the cache fields (`:595-596`), and the two SQL
emitters all come out. The ERD's node/relationship rendering never touches `mjEntity`.

### Test coverage
**None.** No ERD spec references MJ. There is no ERD visual baseline.

### Options
- **(a) KEEP AS-IS, strip branding** — retitle badge to "Managed Entity" etc. **Does not fix the
  ungated query.** If you take this, at minimum gate `loadMJEntities` behind the
  `detectMJDatabase` result rather than letting it throw.
- **(b) GENERICISE** — same objection as Feature 3: the panel renders MemberJunction's exact
  entity properties (`trackRecordChanges`, `includeInAPI`, `allowCreateAPI`…). There is no
  generic concept underneath.
- **(c) DELETE** — remove `erd.component.ts:15` (import), `:19` (`mjEntity` field), `:88-94`,
  `:105-116` (two buttons), `:142-…` (details section), `:319-…` (`.mj-entity-badge` CSS),
  `:595-596`, `:670-671`, `:684-685` (collapse `onNodeSelected` to sync), `:739-790`, `:795-820`.
  Note: making `onNodeSelected` synchronous again is a small simplification win.

**RECOMMENDATION: (c) DELETE.** This one has a live cost on non-MJ databases and no test to
protect. It is the easiest clean win in the whole scan.

---

## Feature 5 — "View Change History (MJ)" / "View Audit Log (MJ)" on **every** table

**Entry point:** `packages/renderer/src/app/layout/sidebar/sidebar.component.ts:1392-1448`,
inside `getTableContextMenu` (`:1256`)

### What it does
**Every table node, on every engine, on every database** gets two extra context-menu items
labelled `View Change History (MJ)` and `View Audit Log (MJ)`. Clicking either opens a query tab
containing hand-written T-SQL:

```
SELECT TOP 100 … FROM [__mj].[RecordChange] rc
LEFT JOIN [__mj].[Entity] e ON rc.EntityID = e.ID
…
WHERE e.BaseTable = '<table>' AND e.SchemaName = '<schema>'
```

with the apologetic comment `-- Note: Requires MemberJunction to be installed in this database`
baked into the emitted SQL (`:1401`, `:1430`).

### Detection
**None whatsoever.** There is no `mjInfo` check, no engine check, no schema check. The default
schema falls back to `'dbo'` (`:1398`, `:1427`) even on PostgreSQL and MySQL. On a PG or MySQL
connection these items emit syntactically invalid SQL (`SELECT TOP`, `[brackets]`).

### Blast radius if removed
Zero. Two menu entries plus the divider at `:1391`.

### Test coverage
**None.**

### Options
- **(a) KEEP AS-IS, strip branding** — drop the `(MJ)` suffix from the labels. This makes the
  problem *worse*: the items become indistinguishable from working features while still emitting
  broken T-SQL against a non-existent schema on most connections.
- **(b) GENERICISE** — no coherent generic form exists; the SQL is MJ's audit schema verbatim.
- **(c) DELETE** — remove `sidebar.component.ts:1391-1448` (divider + both items). Renumber
  nothing; `div4` at `:1449` already separates the Refresh entry.

**RECOMMENDATION: (c) DELETE — highest priority, regardless of what Craig decides about
Features 1–4.** This is the only MJ code that actively degrades the product for non-MJ users
today. Even if the whole MJ integration is kept, these two items should be moved behind the
`mjInfo.isMJEnabled` gate or deleted.

---

## Feature 6 — MJ folder context menus (bulk audit/error/change queries)

**Entry point:** `packages/renderer/src/app/layout/sidebar/sidebar.component.ts:1879-1985`
(`getMJChangesFolderContextMenu`, `getMJAuditFolderContextMenu`, `getMJErrorsFolderContextMenu`),
dispatched from `:1066-1071`

### What it does
Right-clicking the `Change History` / `Audit Logs` / `Error Logs` folders (which exist only
inside Feature 2's tree) offers "View All …" items that open a query tab with hardcoded T-SQL
against `[__mj].[RecordChange]`, `[__mj].[AuditLog]`, `[__mj].[ErrorLog]` (including the
`__mj_CreatedAt` column at `:1966, :1969`). Plus `getMJEntityContextMenu:1772-1857` and
`getMJQueryContextMenu:1859-1877`.

### Detection
Reachable only via Feature 2's node types — so implicitly gated by MJ detection. But the SQL
itself is MSSQL-only (`SELECT TOP 200`, brackets), so on a PostgreSQL MJ install these produce
invalid SQL.

### Blast radius if removed
Zero outside Feature 2. Dies automatically with Feature 2.

### Test coverage
**None.**

### Options
- **(a) KEEP AS-IS, strip branding** — nothing user-visible says "MemberJunction"; only the
  method names and the `__mj` in the emitted SQL. Cheapest possible option, changes nothing.
- **(b) GENERICISE** — not meaningful.
- **(c) DELETE** — `sidebar.component.ts:1061-1071` (dispatch cases) and `:1771-1985`
  (five builders).

**RECOMMENDATION: (c) DELETE, coupled to Feature 2.** No independent decision needed — this
feature has no existence outside the MJ tree.

---

# Test coverage reality check

**Short answer: deleting every MJ feature above breaks zero tests.**

The one file that looks like MJ coverage does not test MJ features:

**`tests/e2e/mj-schema.spec.ts`** (2 tests) runs two plain `SELECT` statements against
`__mj.application` and `__mj.entity` in the seeded PostgreSQL container and asserts row-count
badges ("11 rows", "24 rows"). It exercises the query editor and result grid — nothing else.
The fixture tables are **lowercase** (`__mj.entity`, `__mj.application`, `__mj.user` —
`tests/fixtures/postgres/mj-schema.sql:18,25,33`), whereas `detectMJDatabase` probes for
`table_name = 'Entity'` (capital E, `metadata.ts:1233`). In case-sensitive PostgreSQL that probe
**never matches**, so `isMJEnabled` is always `false` against the test fixture. **No test has ever
executed a single line of the MJ detection or metadata code paths.**

That spec would continue to pass unchanged after deleting all six features, because it only
depends on the fixture schema existing — not on Forge understanding it.

Files that would need touching **only if you also delete the fixture**:
- `tests/fixtures/postgres/mj-schema.sql`, `tests/fixtures/postgres/mj-seed.sql`
- `tests/helpers/forge-actions.ts:33-41` (doc comment), `:58-65` (idempotent seed block)
- `tests/e2e/mj-schema.spec.ts` (whole file)

Visual baselines are **unaffected**: `tests/e2e/visual/connected.spec.ts` captures the sidebar
without expanding to the schema level, so neither the `__mj` node nor the badge appears in
`tests/__snapshots__/visual/connected.spec.ts/sidebar-with-populated-explorer-tree.png`.

My recommendation on the fixture: **keep `mj-schema.sql` / `mj-seed.sql` and the spec, rename
them.** They are the only e2e coverage of "query a non-`public` schema" and of the two-table
JOIN path. Rename the schema `__mj` → something neutral (`app_meta`), rename the files, and
retitle the spec to "cross-schema queries". That preserves real coverage at zero risk while
removing the last MemberJunction reference from the test tier. (Rewriting the fixture also means
touching `tests/helpers/forge-actions.ts:58-65` and the row-count assertions if you change the
seed — keep the row counts identical to avoid that.)

---

# AI system prompts and tool descriptions

**Nothing to do here — this is the cleanest part of the codebase.**

Searched `packages/main/src/services/ai/` (`ai-service.ts`, `chat-service.ts`,
`llm-providers.ts`, `tool-registry.ts`) for `MemberJunction`, `__mj`, `Entity`, `BaseTable`,
`CodeName`, `spCreate/spUpdate/spDelete`, `vw` prefixes, `EntityPermission`, `EntityFieldValue`,
`AIModels`. **No matches** other than the local `AIModel` TypeScript interface
(`packages/shared/src/types/ai.types.ts:12`), which is Forge's own LLM-model config type and has
nothing to do with MemberJunction's `AIModels` entity.

The chat system prompt (`chat-service.ts:791-838`) mentions MemberJunction only through the
product name — `"You are Forge AI, a helpful database assistant built into MJ Forge"`. It teaches
the model nothing about MJ conventions. It has engine-specific guidance (T-SQL / PostgreSQL /
MySQL, plus a detailed Aurora DSQL section) and schema context, all generic.

**Action:** a single string edit in `chat-service.ts:791` as part of the branding pass. No
functional change.

---

# MJ-specific SQL, seed data, connection profiles, and fixtures

### 🔴 `mj.config.cjs` — orphan file, tracked, contains a plaintext SA password

```js
// /Users/cadam/code/forge/mj.config.cjs
module.exports = {
  codeGenLogin: 'sa',
  codeGenPassword: '<REDACTED — plaintext sa password, see security note below>',
  codeGenHost: 'localhost',
  codeGenPort: 1433,
  codeGenDatabase: 'MJ_5_14_0',
  trustServerCertificate: true,
  encrypt: false,
};
```

- **Referenced by nothing.** Grepped `*.ts`, `*.js`, `*.cjs`, `*.json`, `*.yml`, `*.md` across
  the repo (excluding `node_modules`): zero consumers. This is MemberJunction **CodeGen**'s
  config file, committed by accident in `a8aaeb2`.
- **Tracked in git** (`git ls-files mj.config.cjs`), **not in `.gitignore`**.
- **Recommendation: DELETE the file.** Then decide separately whether the password warrants a
  history rewrite / rotation — if that SQL Server instance is or ever was reachable beyond
  localhost, treat it as leaked. This is a security item, not a rebranding item, and it should
  not wait on the rebrand.

### Test fixtures
- `tests/fixtures/postgres/mj-schema.sql` — creates schema `__mj` with `user`, `application`,
  `entity` (lowercase, snake_case: `base_table`, `schema_name`, `application_id`). **Note this is
  a synthetic MJ-*shaped* schema, not real MemberJunction DDL** — no `EntityField`,
  `EntityRelationship`, `AuditLog`, no `__mj_CreatedAt` columns, no `VersionInstallation`.
- `tests/fixtures/postgres/mj-seed.sql` — 3 users, 11 applications, 24 entities.
- Wired in at `tests/helpers/forge-actions.ts:58-65` (idempotent, keyed on
  `table_schema='__mj' AND table_name='entity'`).
- **Rename, don't delete** — see "Test coverage reality check".

### Docker fixtures — clean
`tests/docker-compose.test.yml` provisions mssql / postgres / mysql / postgres-private / bastion.
Databases are `forge_test` and `forge_private`. **No MJ database, no MJ image, no MJ seed.**

### Connection profile defaults — clean
No default or sample profile anywhere points at an MJ database. `connection-profiles.spec.ts`
uses `localhost` fixtures with generic names.

### Documentation references to a real MJ database (stale, doc-only)
- `tests/regression-suite.md` — lines 11, 35, 41, 42, 49 reference an `MJ_5_14_0` MSSQL database
  and "MJ database expansion". This is the **legacy 31-test manual suite** description, already
  superseded by the Playwright tiers.
- `.claude/commands/test-ui.md:17` — "real data rows from MJ_5_14_0".
- `docs/ARCHITECTURE.md:97, 245`, `docs/SQL-CONVERSION-STUDY.md:27-29` — attribution/inspiration
  references to MemberJunction patterns and the internal sqlglot package.

None of these are consumed by code. They belong to the docs sweep, but flagging them here because
`MJ_5_14_0` is the only surviving pointer to a real MemberJunction database anywhere in the repo.

---

# Decisions Craig must make before executors can proceed

These are ordered; each later question is only live if the earlier one is answered a certain way.

**D1 — Do you ever expect to connect Forge to a real MemberJunction database again?**
This is the whole scan in one question. If **no**, take DELETE on Features 1-6 and the entire
scan collapses into one mechanical change. If **yes**, the honest answer is (a) strip branding
on Features 1-4 and (c) delete Features 5-6 — because 5 and 6 are broken regardless.

**D2 — If keeping: do you want the framework-detection abstraction (option b), or just
de-branded MJ code (option a)?**
My view: **(a)**. Option (b) builds a plugin seam for exactly one plugin, which the repo's own
"one layer of magic" rule argues against. Revisit if a second framework ever shows up.

**D3 — The six dead IPC endpoints: delete now, independently of D1?**
`getMJEntityFields`, `getMJEntityRelationships`, `getMJRecordChanges`, `getMJAuditLogs`,
`getMJErrorLogs`, `getMJUserRecordLogs`. ~330 lines across 4 layers, zero callers, zero tests.
**Recommend yes, unconditionally** — this is safe under any answer to D1.

**D4 — Feature 5 (MJ items on every table's context menu): delete or gate?**
**Recommend delete, unconditionally.** This is a live defect for PostgreSQL/MySQL users today.
If D1 is "yes", gating it behind `mjInfo.isMJEnabled` is the minimum acceptable fix.

**D5 — Test fixture: rename `__mj` → neutral schema name, or delete outright?**
**Recommend rename.** It is the only e2e coverage of non-`public` schema queries and of a
two-table JOIN. Keep the row counts (11 / 24) identical so the assertions do not move.
If you rename, executors must touch `tests/fixtures/postgres/mj-{schema,seed}.sql`,
`tests/helpers/forge-actions.ts:33-41,58-65`, and `tests/e2e/mj-schema.spec.ts`.

**D6 — `mj.config.cjs`: delete the file (yes/no), and rotate the leaked `sa` password (yes/no)?**
These are two separate decisions. File deletion is trivial and should not wait on the rebrand.
Password rotation depends on whether that instance was ever exposed.

**D7 — Does the `assets/icons/mj-logo.png` badge removal need to coordinate with the app-icon
change?**
Same file serves both the sidebar app header (`sidebar.component.ts:67`) and the MJ badge
(`:287`). Whoever executes the branding scan owns the app icon; this scan's executor should only
remove the `:284-291` badge block and leave the asset in place.

---

## Suggested execution order (if D1 = "no")

1. `mj.config.cjs` — delete (independent, do first).
2. Feature 5 — delete `sidebar.component.ts:1391-1448` (independent, highest user impact).
3. Feature 4 — delete the ERD MJ block (independent, removes a per-ERD failing query).
4. Features 2 + 6 — delete the explorer tree + folder context menus (must go together).
5. Features 1 + 3 — delete detection, the 10 IPC channels, the preload bridge, the
   `ipc.service` wrappers, and the 11 shared types (must go last; everything above depends on them).
6. Test fixture rename (D5).
7. Doc sweep: `tests/regression-suite.md`, `.claude/commands/test-ui.md`, `docs/*.md`,
   `chat-service.ts:791`.

Steps 1-3 are each independently mergeable with no cross-dependency. Steps 4-5 are one change.
Run `npm run typecheck && npm run test:full` after step 5 — the TypeScript compiler will find any
reference I missed, since every MJ type flows from a single `@mj-forge/shared` export site.
