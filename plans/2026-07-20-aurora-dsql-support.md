# Aurora DSQL Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MJ Forge usable against Amazon Aurora DSQL clusters by detecting DSQL at connect time and skipping/disabling every background introspection query and UI feature DSQL cannot serve.

**Architecture:** DSQL is detected once per profile via a cached probe (mirroring the existing `isAzureSQL` pattern in `ConnectionPoolManager`). A new `PgDsqlDialect` subclass of `PgDialect` overrides the metadata queries that touch unsupported catalogs. A small set of app-level capability flags flows from the dialect through the `connection:connect` IPC result into a new renderer `CapabilitiesStore`, which gates the explorer tree, backup/database-management UI, autocomplete prefetch, and the AI system prompt. The connection heartbeat switches from `listDatabases` to a new cheap `connection:ping` channel.

**Tech Stack:** Electron main (TypeScript, `pg` driver), Angular 18 renderer (signals), Vitest unit tests, existing docker test harness (`npm run test:full`).

## Global Constraints

- Strict TypeScript; no `any` without justification (repo CLAUDE.md).
- Never commit to `main`. Work on branch `feature/aurora-dsql-support`. Conventional commit messages.
- Craig's commit convention: **batch all work into ONE commit at the end** (overrides frequent-commit habits). Open a PR via `gh pr create`; the PR description must call out unrelated behavior changes (see Task 10).
- `npm run typecheck` and `npm run lint` must be clean for every touched file — warnings are errors.
- No swallowed errors: every catch logs, rethrows, or returns explicitly.
- All renderer↔main communication through typed IPC channels defined in `packages/shared/src/constants/ipc-channels.ts`.
- Never write raw engine-specific SQL in services — SQL strings belong in dialects (`packages/main/src/services/sql/dialect/`). The AI `tool-registry.ts` is the one existing exception; keep its changes inside its existing per-engine branches.
- Unit test command: `npx vitest run <path>` (config `vitest.config.ts` includes `packages/*/src/**/*.spec.ts`). Full gate: `npm run test:full` (requires docker harness: `npm run test:harness:up`).

---

## Design context (the "why" — read before implementing)

### What Aurora DSQL is

PostgreSQL 16-compatible serverless database (standard wire protocol; `psql`/`pg` driver work). Per the AWS docs (`docs.aws.amazon.com/aurora-dsql/latest/userguide/`):

- **One database per cluster**, always named `postgres`. No `CREATE/DROP/ALTER DATABASE`.
- **Supported catalogs** (safe to query): `pg_class`, `pg_namespace`, `pg_attribute`, `pg_index`, `pg_constraint`, `pg_attrdef`, `pg_description`, `pg_type`, `pg_tables`, `pg_views`, `pg_indexes`, `pg_roles`, `pg_user`, `pg_settings`, `pg_stats`, `pg_am`, `pg_collation`.
- **Unsupported catalogs** (queries fail or are absent): `pg_database`, `pg_proc`, `pg_trigger`, `pg_sequence`/`pg_sequences`, `pg_matviews`, `pg_extension`, `pg_available_extensions`, `pg_locks`, `pg_stat_activity`, **all** `pg_stat_*`/`pg_statio_*` statistics views, `pg_prepared_statements`.
- Size/statistics functions tied to those catalogs (`pg_database_size`, `pg_relation_size`) are not available.
- No foreign keys, triggers, PL/pgSQL, temp tables, `TRUNCATE`, extensions. `CREATE INDEX` must be `CREATE INDEX ASYNC`. DDL and DML cannot share a transaction (max 1 DDL per transaction); a transaction modifies at most 3,000 rows; isolation fixed at REPEATABLE READ. Connections are force-closed at 1 hour.
- DSQL-specific: `sys.jobs` view (async DDL status), `sys.dsql_major_version()` function — the latter is our **detection probe** (errors on vanilla PostgreSQL).
- Row counts: AWS recommends `pg_class.reltuples` instead of `COUNT(*)`.

### Why Forge currently breaks on DSQL

`PgDialect.listDatabasesSQL` (`packages/main/src/services/sql/dialect/pg-dialect.ts:74`) queries `pg_database` + `pg_database_size()`. That SQL runs eagerly on every connect (`connection.state.ts:232` → `loadDatabases`) **and** as the renderer's 30-second heartbeat ping (`connection.state.ts:422` `pingConnection`). On DSQL every heartbeat fails, the connection is marked unhealthy, and reconnect loops kick in. Secondary failures: `listTablesSQL` (joins `pg_stat_user_tables`, calls `pg_relation_size`), `listProceduresSQL`/`listFunctionsSQL`/`getObjectDefinitionSQL` (`pg_proc`), `listTriggersSQL` (`pg_trigger`), the AI `get_table_row_count` tool (`pg_stat_user_tables`), and database create/rename/drop.

### Design decisions (locked)

1. **Detection**: async probe `SELECT * FROM sys.dsql_major_version()` once per profile in `ConnectionPoolManager`, cached in a `dsqlCache` map exactly like `azureCache` (`connection-pool.ts:117`, cleared in `closePool` at `:834`). The probe runs in the `connection:connect` IPC handler, so the cache is always warm before any metadata call. Dialect routing stays synchronous via `isDsqlCached()`.
2. **Dialect variant, not a new engine**: `engine` stays `'postgresql'` everywhere (pool routing, Monaco language, SQL conversion untouched). `getDialect(engine, variant?)` returns a `PgDsqlDialect` singleton for `('postgresql', 'dsql')`.
3. **Capability flags are app-level**, computed from the dialect and shipped to the renderer on the `ActiveConnection` returned by `connection:connect`. Renderer defaults to "everything supported" when no capabilities are present, so existing engines behave exactly as before. Note: the existing `dialect.supportsBackupRestore` flag means "backup via SQL" (false for PG/MySQL which use CLI tools), so the app-level flag maps from a **new** `supportsBackupTooling` getter instead — do not conflate them.
4. **Heartbeat**: new `connection:ping` channel running `SELECT 1`, replacing `listDatabases` as the liveness probe **for all engines** (this is a deliberate improvement; call it out in the PR).
5. **Empty-not-error**: DSQL dialect returns empty result sets for procedures/functions/triggers rather than erroring, so callers that can't easily be gated (autocomplete, object search) degrade gracefully.
6. **Out of scope** (explicitly, for Craig to green-light later): IAM token generation/refresh (`@aws-sdk/dsql-signer`), pg pool recycling under the 1-hour connection cap, `EXPLAIN (FORMAT JSON)` verification, ERD polish. Manual verification items are listed in Task 10.

### File map

| File                                                              | Action | Responsibility                                                                        |
| ----------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `packages/shared/src/types/connection.types.ts`                   | Modify | `EngineVariant`, `EngineCapabilities`, `FULL_CAPABILITIES`, extend `ActiveConnection` |
| `packages/shared/src/constants/ipc-channels.ts`                   | Modify | Add `CONNECTION.PING`                                                                 |
| `packages/shared/src/types/chat.types.ts`                         | Modify | Add `engineVariant` to `ChatRequest`                                                  |
| `packages/main/src/services/sql/dialect/sql-dialect.ts`           | Modify | Defaulted capability getters + `variant`                                              |
| `packages/main/src/services/sql/dialect/pg-dialect.ts`            | Modify | Widen `label` type annotation                                                         |
| `packages/main/src/services/sql/dialect/pg-dsql-dialect.ts`       | Create | DSQL SQL overrides + capability overrides                                             |
| `packages/main/src/services/sql/dialect/index.ts`                 | Modify | Variant-aware factory + `capabilitiesForDialect`                                      |
| `packages/main/src/services/sql/dialect/dialect.spec.ts`          | Modify | Tests for all of the above                                                            |
| `packages/main/src/services/sql/connection-pool.ts`               | Modify | `dsqlCache`, `detectDsql`, `isDsqlCached`, `pingConnection`, dialect routing          |
| `packages/main/src/ipc/connection.ipc.ts`                         | Modify | Probe on connect, capabilities in result, PING handler                                |
| `packages/main/src/services/ai/tool-registry.ts`                  | Modify | DSQL-safe row count + server info                                                     |
| `packages/main/src/services/ai/chat-service.ts`                   | Modify | DSQL block in system prompt                                                           |
| `packages/preload/src/index.ts`                                   | Modify | `connection.ping`, fix `connect` return type                                          |
| `packages/renderer/src/app/core/services/ipc.service.ts`          | Modify | `pingConnection`, `connect` typing                                                    |
| `packages/renderer/src/app/core/state/capabilities.state.ts`      | Create | Signal store for per-connection capabilities                                          |
| `packages/renderer/src/app/core/state/capabilities.state.spec.ts` | Create | Store tests                                                                           |
| `packages/renderer/src/app/core/state/connection.state.ts`        | Modify | Store capabilities on connect, ping heartbeat, cleanup                                |
| `packages/renderer/src/app/core/state/explorer-folders.ts`        | Create | Pure folder-list helpers                                                              |
| `packages/renderer/src/app/core/state/explorer-folders.spec.ts`   | Create | Helper tests                                                                          |
| `packages/renderer/src/app/core/state/explorer.state.ts`          | Modify | Use folder helpers with capabilities                                                  |
| `packages/renderer/src/app/layout/sidebar/sidebar.component.ts`   | Modify | Guards for backup/restore/create-database                                             |
| `packages/renderer/src/app/layout/shell/shell.component.ts`       | Modify | Guard native-menu New Database                                                        |
| `packages/renderer/src/app/features/query/query.component.ts`     | Modify | Capability-aware autocomplete prefetch                                                |
| `packages/renderer/src/app/core/state/chat.state.ts`              | Modify | Thread `engineVariant` into chat requests                                             |
| `packages/renderer/src/app/core/state/chat-instance.state.ts`     | Modify | Same                                                                                  |

---

### Task 1: Shared types and IPC channel

**Files:**

- Modify: `packages/shared/src/types/connection.types.ts`
- Modify: `packages/shared/src/constants/ipc-channels.ts`
- Modify: `packages/shared/src/types/chat.types.ts`
- Test: `packages/shared/src/types/connection.types.spec.ts`

**Interfaces:**

- Consumes: nothing (leaf task).
- Produces: `EngineVariant` (`'dsql'`), `EngineCapabilities` (5 booleans), `FULL_CAPABILITIES: EngineCapabilities`, `ActiveConnection.capabilities?: EngineCapabilities`, `ActiveConnection.engineVariant?: EngineVariant`, `IPC_CHANNELS.CONNECTION.PING = 'connection:ping'`, `ChatRequest.engineVariant?: 'dsql'`. Every later task imports these from `@mj-forge/shared`.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/types/connection.types.spec.ts` (follow the file's existing style):

```typescript
import { FULL_CAPABILITIES } from './connection.types';
import type { EngineCapabilities, EngineVariant, ActiveConnection } from './connection.types';

describe('EngineCapabilities', () => {
  it('FULL_CAPABILITIES has every capability enabled', () => {
    const values = Object.values(FULL_CAPABILITIES);
    expect(values.length).toBe(5);
    expect(values.every(v => v === true)).toBe(true);
  });

  it('ActiveConnection accepts capabilities and engineVariant', () => {
    const variant: EngineVariant = 'dsql';
    const caps: EngineCapabilities = {
      supportsMultipleDatabases: false,
      supportsDatabaseManagement: false,
      supportsStoredProcedures: false,
      supportsTriggers: false,
      supportsBackupRestore: false,
    };
    const conn: Partial<ActiveConnection> = { capabilities: caps, engineVariant: variant };
    expect(conn.capabilities?.supportsTriggers).toBe(false);
  });
});
```

Note: the file already imports `describe/it/expect` from vitest — reuse its import block rather than duplicating.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/shared/src/types/connection.types.spec.ts`
Expected: FAIL — `FULL_CAPABILITIES` is not exported.

- [ ] **Step 3: Implement the types**

In `packages/shared/src/types/connection.types.ts`, after the `ENGINE_LABELS` const (line 21), add:

```typescript
/** Engine sub-variant detected at connect time (e.g. Aurora DSQL for postgresql) */
export type EngineVariant = 'dsql';

/**
 * App-level feature support for a live connection. Computed main-side from
 * the resolved dialect and shipped to the renderer on ActiveConnection.
 * Absence of capabilities means "assume everything is supported".
 */
export interface EngineCapabilities {
  /** Server hosts multiple user databases that can be enumerated/switched */
  supportsMultipleDatabases: boolean;
  /** CREATE/RENAME/DROP DATABASE are meaningful on this server */
  supportsDatabaseManagement: boolean;
  supportsStoredProcedures: boolean;
  supportsTriggers: boolean;
  /** Backup/restore is available via SQL or CLI tooling */
  supportsBackupRestore: boolean;
}

export const FULL_CAPABILITIES: EngineCapabilities = {
  supportsMultipleDatabases: true,
  supportsDatabaseManagement: true,
  supportsStoredProcedures: true,
  supportsTriggers: true,
  supportsBackupRestore: true,
};
```

In the `ActiveConnection` interface (line 82), add after `currentDatabase?: string;`:

```typescript
  /** Present when the engine has a detected sub-variant (e.g. Aurora DSQL) */
  engineVariant?: EngineVariant;
  /** App-level feature support; absent means all features supported */
  capabilities?: EngineCapabilities;
```

In `packages/shared/src/constants/ipc-channels.ts`, in the `CONNECTION` block (line 6), add after `DISCONNECT`:

```typescript
    PING: 'connection:ping',
```

In `packages/shared/src/types/chat.types.ts`, in the `ChatRequest` interface (line 75), after the `databaseEngine` field, add:

```typescript
  /** Engine sub-variant for dialect-aware prompts (e.g. Aurora DSQL) */
  engineVariant?: 'dsql';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/shared/src/types/connection.types.spec.ts`
Expected: PASS.

---

### Task 2: `PgDsqlDialect`, capability getters, variant-aware factory

**Files:**

- Modify: `packages/main/src/services/sql/dialect/sql-dialect.ts`
- Modify: `packages/main/src/services/sql/dialect/pg-dialect.ts:17`
- Create: `packages/main/src/services/sql/dialect/pg-dsql-dialect.ts`
- Modify: `packages/main/src/services/sql/dialect/index.ts`
- Test: `packages/main/src/services/sql/dialect/dialect.spec.ts`

**Interfaces:**

- Consumes: `EngineVariant`, `EngineCapabilities` from Task 1.
- Produces: `SQLDialect` getters `variant` (`EngineVariant | undefined`), `supportsMultipleDatabases`, `supportsDatabaseManagement`, `supportsStoredProcedures`, `supportsTriggers`, `supportsBackupTooling` (all `boolean`, default `true`); `class PgDsqlDialect extends PgDialect`; `getDialect(engine: DatabaseEngine, variant?: EngineVariant): SQLDialect`; `capabilitiesForDialect(dialect: SQLDialect): EngineCapabilities`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/main/src/services/sql/dialect/dialect.spec.ts`:

```typescript
import { PgDsqlDialect } from './pg-dsql-dialect';
import { capabilitiesForDialect } from './index';

describe('getDialect factory — variants', () => {
  it('returns PgDsqlDialect for postgresql + dsql variant', () => {
    const dialect = getDialect('postgresql', 'dsql');
    expect(dialect).toBeInstanceOf(PgDsqlDialect);
    expect(dialect.engine).toBe('postgresql');
    expect(dialect.variant).toBe('dsql');
  });

  it('returns standard PgDialect when variant is omitted', () => {
    const dialect = getDialect('postgresql');
    expect(dialect).toBeInstanceOf(PgDialect);
    expect(dialect.variant).toBeUndefined();
  });

  it('ignores dsql variant for non-postgresql engines', () => {
    expect(getDialect('mssql', 'dsql')).toBeInstanceOf(MSSQLDialect);
    expect(getDialect('mysql', 'dsql')).toBeInstanceOf(MySQLDialect);
  });
});

describe('capability defaults on existing dialects', () => {
  it.each([
    ['mssql', new MSSQLDialect()],
    ['postgresql', new PgDialect()],
    ['mysql', new MySQLDialect()],
  ])('%s supports everything by default', (_label, dialect) => {
    expect(dialect.supportsMultipleDatabases).toBe(true);
    expect(dialect.supportsDatabaseManagement).toBe(true);
    expect(dialect.supportsStoredProcedures).toBe(true);
    expect(dialect.supportsTriggers).toBe(true);
    expect(dialect.supportsBackupTooling).toBe(true);
    expect(dialect.variant).toBeUndefined();
  });
});

describe('PgDsqlDialect', () => {
  const dialect = new PgDsqlDialect();

  it('has DSQL label and postgresql engine', () => {
    expect(dialect.label).toBe('Aurora DSQL');
    expect(dialect.engine).toBe('postgresql');
    expect(dialect.variant).toBe('dsql');
  });

  it('disables unsupported capabilities', () => {
    expect(dialect.supportsMultipleDatabases).toBe(false);
    expect(dialect.supportsDatabaseManagement).toBe(false);
    expect(dialect.supportsStoredProcedures).toBe(false);
    expect(dialect.supportsTriggers).toBe(false);
    expect(dialect.supportsBackupTooling).toBe(false);
  });

  it('listDatabasesSQL avoids pg_database and returns the current database', () => {
    const sql = dialect.listDatabasesSQL();
    expect(sql).not.toContain('pg_database');
    expect(sql).toContain('current_database()');
    expect(sql).toContain('"isSystemDb"');
  });

  it('listTablesSQL avoids pg_stat_user_tables and pg_relation_size', () => {
    const sql = dialect.listTablesSQL('postgres', 'public');
    expect(sql).not.toContain('pg_stat_user_tables');
    expect(sql).not.toContain('pg_relation_size');
    expect(sql).toContain('reltuples');
    expect(sql).toContain("t.schemaname = 'public'");
  });

  it('listProceduresSQL / listFunctionsSQL / listTriggersSQL return empty-set queries', () => {
    for (const sql of [
      dialect.listProceduresSQL('postgres'),
      dialect.listFunctionsSQL('postgres'),
      dialect.listTriggersSQL('postgres', 'public', 't'),
    ]) {
      expect(sql).toContain('WHERE false');
      expect(sql).not.toContain('pg_proc');
      expect(sql).not.toContain('pg_trigger');
    }
  });

  it('getObjectDefinitionSQL only consults pg_views', () => {
    const sql = dialect.getObjectDefinitionSQL('postgres', 'public', 'v');
    expect(sql).toContain('pg_views');
    expect(sql).not.toContain('pg_proc');
  });

  it('database DDL generators throw with a clear message', () => {
    expect(() => dialect.createDatabaseSQL({ name: 'x' })).toThrow(/single database/i);
    expect(() => dialect.renameDatabaseSQL({ currentName: 'a', newName: 'b' })).toThrow(
      /single database/i
    );
    expect(() => dialect.dropDatabaseSQL({ name: 'x' })).toThrow(/single database/i);
  });

  it('inherits working PG SQL for schemas, views, indexes and comments', () => {
    expect(dialect.listSchemasSQL('postgres')).toContain('pg_namespace');
    expect(dialect.listViewsSQL('postgres')).toContain('pg_views');
    expect(dialect.listIndexesSQL('postgres', 'public', 't')).toContain('pg_index');
  });
});

describe('capabilitiesForDialect', () => {
  it('maps a fully-capable dialect to FULL capabilities', () => {
    const caps = capabilitiesForDialect(new MSSQLDialect());
    expect(caps).toEqual({
      supportsMultipleDatabases: true,
      supportsDatabaseManagement: true,
      supportsStoredProcedures: true,
      supportsTriggers: true,
      supportsBackupRestore: true,
    });
  });

  it('maps PgDsqlDialect to all-false capabilities', () => {
    const caps = capabilitiesForDialect(new PgDsqlDialect());
    expect(Object.values(caps).every(v => v === false)).toBe(true);
  });
});
```

Adjust the `createDatabaseSQL`/`renameDatabaseSQL`/`dropDatabaseSQL` argument literals to satisfy the option types (`CreateDatabaseOptions` etc.) — check `packages/shared/src/types` for required fields and add them with dummy values if the literals above don't compile.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/main/src/services/sql/dialect/dialect.spec.ts`
Expected: FAIL — module `./pg-dsql-dialect` not found.

- [ ] **Step 3: Add base-class getters**

In `packages/main/src/services/sql/dialect/sql-dialect.ts`, add `EngineVariant` to the type import from `@mj-forge/shared`, then add at the end of the class body (after `supportsServerFileBrowsing`, line 116):

```typescript
  // ── App-level capabilities (overridden by engine variants) ──

  /** Engine sub-variant, when this dialect represents one (e.g. Aurora DSQL) */
  get variant(): EngineVariant | undefined {
    return undefined;
  }

  /** Whether the server hosts multiple enumerable/switchable databases */
  get supportsMultipleDatabases(): boolean {
    return true;
  }

  /** Whether CREATE/RENAME/DROP DATABASE are meaningful on this server */
  get supportsDatabaseManagement(): boolean {
    return true;
  }

  get supportsStoredProcedures(): boolean {
    return true;
  }

  get supportsTriggers(): boolean {
    return true;
  }

  /**
   * Whether backup/restore is available at all (via SQL or CLI tooling).
   * Distinct from supportsBackupRestore, which means "backup via SQL" and is
   * false for PG/MySQL even though their CLI-based backup features work.
   */
  get supportsBackupTooling(): boolean {
    return true;
  }
```

- [ ] **Step 4: Widen `PgDialect.label` so the subclass can override it**

In `packages/main/src/services/sql/dialect/pg-dialect.ts:17` change:

```typescript
  readonly label = 'PostgreSQL';
```

to:

```typescript
  readonly label: string = 'PostgreSQL';
```

(Without the annotation the property's inferred type is the literal `'PostgreSQL'` and the subclass override will not typecheck.)

- [ ] **Step 5: Create `pg-dsql-dialect.ts`**

Create `packages/main/src/services/sql/dialect/pg-dsql-dialect.ts`:

```typescript
/**
 * Aurora DSQL Dialect (PostgreSQL 16-compatible variant)
 *
 * DSQL hosts a single database named `postgres` and omits many system
 * catalogs (pg_database, pg_proc, pg_trigger, all pg_stat_* views) and
 * size functions. This dialect overrides exactly the queries that touch
 * unsupported surfaces; everything else inherits from PgDialect.
 * Reference: AWS "System tables and commands in Aurora DSQL".
 */

import type {
  CreateDatabaseOptions,
  RenameDatabaseOptions,
  DeleteDatabaseOptions,
  EngineVariant,
} from '@mj-forge/shared';
import { PgDialect } from './pg-dialect';

export class PgDsqlDialect extends PgDialect {
  override readonly label: string = 'Aurora DSQL';

  override get variant(): EngineVariant {
    return 'dsql';
  }

  override get supportsMultipleDatabases(): boolean {
    return false;
  }

  override get supportsDatabaseManagement(): boolean {
    return false;
  }

  override get supportsStoredProcedures(): boolean {
    return false;
  }

  override get supportsTriggers(): boolean {
    return false;
  }

  override get supportsBackupTooling(): boolean {
    return false;
  }

  // ── Database DDL: a DSQL cluster hosts exactly one database ──

  override createDatabaseSQL(_options: CreateDatabaseOptions): string {
    throw new Error(
      'Aurora DSQL clusters host a single database; CREATE DATABASE is not supported.'
    );
  }

  override renameDatabaseSQL(_options: RenameDatabaseOptions): string {
    throw new Error('Aurora DSQL clusters host a single database; renaming is not supported.');
  }

  override dropDatabaseSQL(_options: DeleteDatabaseOptions): string {
    throw new Error('Aurora DSQL clusters host a single database; DROP DATABASE is not supported.');
  }

  // ── Metadata queries ─────────────────────────────────────────

  /** pg_database is unsupported; the only database is the current one. */
  override listDatabasesSQL(_isAzure?: boolean): string {
    return `
SELECT
  current_database() AS name,
  NULL AS "databaseId",
  NULL AS "sizeBytes",
  'online' AS state,
  'C' AS collation,
  false AS "isSystemDb",
  NULL AS "createdAt";`;
  }

  /** pg_stat_user_tables and pg_relation_size are unsupported; use reltuples. */
  override listTablesSQL(_database: string, schema?: string): string {
    const schemaFilter = schema
      ? `AND t.schemaname = '${this.escapeString(schema)}'`
      : `AND t.schemaname NOT IN ('pg_catalog', 'information_schema')`;
    return `
SELECT
  t.schemaname AS schema,
  t.tablename AS name,
  COALESCE(c.reltuples, 0)::bigint AS "rowCount",
  NULL AS "sizeKb",
  NULL AS "createdAt"
FROM pg_tables t
LEFT JOIN pg_class c ON c.relname = t.tablename
  AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = t.schemaname)
WHERE true
  ${schemaFilter}
ORDER BY t.schemaname, t.tablename;`;
  }

  /** pg_proc is unsupported — return an empty, correctly-shaped result. */
  override listProceduresSQL(_database: string, _schema?: string): string {
    return `
SELECT NULL::text AS schema, NULL::text AS name,
  NULL::text AS "createdAt", NULL::text AS "modifiedAt"
WHERE false;`;
  }

  override listFunctionsSQL(_database: string, _schema?: string): string {
    return `
SELECT NULL::text AS schema, NULL::text AS name, NULL::text AS type,
  NULL::text AS "createdAt", NULL::text AS "modifiedAt"
WHERE false;`;
  }

  /** pg_trigger is unsupported and DSQL has no triggers. */
  override listTriggersSQL(_database: string, _schema: string, _table: string): string {
    return `
SELECT NULL::text AS name, NULL::boolean AS "isDisabled",
  NULL::text AS "triggerType", NULL::text AS "createdAt"
WHERE false;`;
  }

  /** pg_get_functiondef/pg_proc are unsupported — resolve views only. */
  override getObjectDefinitionSQL(_database: string, schema: string, name: string): string {
    return `
SELECT (
  SELECT definition FROM pg_views
  WHERE schemaname = '${this.escapeString(schema)}'
    AND viewname = '${this.escapeString(name)}'
) AS definition;`;
  }
}
```

- [ ] **Step 6: Update the factory and add `capabilitiesForDialect`**

Replace the body of `packages/main/src/services/sql/dialect/index.ts` below the imports with:

```typescript
import type { DatabaseEngine, EngineCapabilities, EngineVariant } from '@mj-forge/shared';
import { SQLDialect } from './sql-dialect';
import { MSSQLDialect } from './mssql-dialect';
import { PgDialect } from './pg-dialect';
import { PgDsqlDialect } from './pg-dsql-dialect';
import { MySQLDialect } from './mysql-dialect';

export { SQLDialect } from './sql-dialect';
export { MSSQLDialect } from './mssql-dialect';
export { PgDialect } from './pg-dialect';
export { PgDsqlDialect } from './pg-dsql-dialect';
export { MySQLDialect } from './mysql-dialect';

const dialects: Record<DatabaseEngine, SQLDialect> = {
  mssql: new MSSQLDialect(),
  postgresql: new PgDialect(),
  mysql: new MySQLDialect(),
};

const pgDsqlDialect = new PgDsqlDialect();

/** Get the dialect instance for a given database engine (and optional variant) */
export function getDialect(engine: DatabaseEngine, variant?: EngineVariant): SQLDialect {
  if (engine === 'postgresql' && variant === 'dsql') {
    return pgDsqlDialect;
  }
  return dialects[engine];
}

/** App-level capabilities derived from a dialect, shipped to the renderer. */
export function capabilitiesForDialect(dialect: SQLDialect): EngineCapabilities {
  return {
    supportsMultipleDatabases: dialect.supportsMultipleDatabases,
    supportsDatabaseManagement: dialect.supportsDatabaseManagement,
    supportsStoredProcedures: dialect.supportsStoredProcedures,
    supportsTriggers: dialect.supportsTriggers,
    supportsBackupRestore: dialect.supportsBackupTooling,
  };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run packages/main/src/services/sql/dialect/dialect.spec.ts`
Expected: PASS (all pre-existing dialect tests must also still pass).

---

### Task 3: DSQL detection and ping in `ConnectionPoolManager` + connect handler

**Files:**

- Modify: `packages/main/src/services/sql/connection-pool.ts` (fields at ~:117, `getDialectForProfile` at :227, `closePool` at :834)
- Modify: `packages/main/src/ipc/connection.ipc.ts` (CONNECT handler at :77; new PING handler)

**Interfaces:**

- Consumes: `getDialect(engine, variant)`, `capabilitiesForDialect` (Task 2); `IPC_CHANNELS.CONNECTION.PING`, `ActiveConnection.capabilities/engineVariant` (Task 1).
- Produces: `ConnectionPoolManager.detectDsql(profileId: string): Promise<boolean>`, `ConnectionPoolManager.isDsqlCached(profileId: string): boolean`, `ConnectionPoolManager.pingConnection(profileId: string): Promise<boolean>`. The `connection:connect` result now carries `capabilities` and `engineVariant`. The `connection:ping` channel answers `boolean`.

There is no unit test for this task — `ConnectionPoolManager` is a driver-heavy singleton with no existing spec, and the probe logic is a thin try/catch over `getDialect`/`capabilitiesForDialect`, which Task 2 covers. Verification is `npm run typecheck` + the full harness in Task 10.

- [ ] **Step 1: Add the cache field**

In `packages/main/src/services/sql/connection-pool.ts`, next to `azureCache` (line 117), add:

```typescript
  // Cache: profileId → is Aurora DSQL (postgresql variant). Cleared on disconnect.
  private dsqlCache: Map<string, boolean> = new Map();
```

- [ ] **Step 2: Add `detectDsql` and `isDsqlCached`**

Directly after the existing `isAzureSQL` method (ends line 275), add:

```typescript
  /**
   * Probe whether a postgresql profile is an Aurora DSQL cluster.
   * sys.dsql_major_version() exists only on DSQL; on vanilla PostgreSQL the
   * call errors, which we interpret as "not DSQL". Result is cached per
   * profile and cleared on disconnect. Mirrors the isAzureSQL pattern.
   */
  async detectDsql(profileId: string): Promise<boolean> {
    const cached = this.dsqlCache.get(profileId);
    if (cached !== undefined) return cached;

    if (this.getEngineForProfile(profileId) !== 'postgresql') {
      this.dsqlCache.set(profileId, false);
      return false;
    }

    const pool = await this.getPgPool(profileId);
    let isDsql = false;
    try {
      await pool.query('SELECT * FROM sys.dsql_major_version()');
      isDsql = true;
    } catch (err) {
      // Expected on standard PostgreSQL — the probe function doesn't exist.
      log.debug(`DSQL probe negative for ${profileId}: ${this.errMessage(err)}`);
    }
    this.dsqlCache.set(profileId, isDsql);
    log.info(`DSQL detection for ${profileId}: ${isDsql}`);
    return isDsql;
  }

  /** Synchronous read of the cached DSQL detection (false until detectDsql ran). */
  isDsqlCached(profileId: string): boolean {
    return this.dsqlCache.get(profileId) === true;
  }

  /**
   * Cheap liveness check: SELECT 1 on the profile's pool. Used by the
   * renderer heartbeat via CONNECTION.PING. Throws on failure — the IPC
   * layer surfaces the rejection and the renderer treats it as "unhealthy".
   */
  async pingConnection(profileId: string): Promise<boolean> {
    const engine = this.getEngineForProfile(profileId);
    if (engine === 'postgresql') {
      const pool = await this.getPgPool(profileId);
      await pool.query('SELECT 1');
      return true;
    }
    if (engine === 'mysql') {
      const pool = await this.getMySQLPool(profileId);
      await pool.query('SELECT 1');
      return true;
    }
    await this.query(profileId, 'SELECT 1');
    return true;
  }
```

If `errMessage` is named differently, match the helper used in `closePool` (line 844).

- [ ] **Step 3: Route the dialect through the variant**

Replace `getDialectForProfile` (line 227):

```typescript
  getDialectForProfile(profileId: string): SQLDialect {
    const profile = this.profileStore.getById(profileId);
    const engine = profile?.engine || 'mssql';
    return getDialect(engine, this.isDsqlCached(profileId) ? 'dsql' : undefined);
  }
```

- [ ] **Step 4: Clear the cache on disconnect**

In `closePool` (line 834), next to `this.azureCache.delete(profileId);`, add:

```typescript
this.dsqlCache.delete(profileId);
```

- [ ] **Step 5: Probe on connect and return capabilities**

In `packages/main/src/ipc/connection.ipc.ts`, add to the dialect import (top of file):

```typescript
import { capabilitiesForDialect } from '../services/sql/dialect';
```

In the CONNECT handler (line 77), change the postgresql branch:

```typescript
      if (engine === 'postgresql') {
        await poolManager.getPgPool(id);
        await poolManager.detectDsql(id);
      } else if (engine === 'mysql') {
```

and change the return statement to:

```typescript
const dialect = poolManager.getDialectForProfile(id);
return {
  id,
  profile,
  status: 'connected',
  connectedAt: new Date().toISOString(),
  currentDatabase: defaultDb,
  engineVariant: dialect.variant,
  capabilities: capabilitiesForDialect(dialect),
};
```

- [ ] **Step 6: Register the PING handler**

After the DISCONNECT handler (line 115), add:

```typescript
// Cheap liveness ping used by the renderer heartbeat (SELECT 1)
safeHandle(IPC_CHANNELS.CONNECTION.PING, async (_event, id: string): Promise<boolean> => {
  return poolManager.pingConnection(id);
});
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npx vitest run packages/main`
Expected: clean typecheck; all main-process unit tests pass.

---

### Task 4: Preload + `IpcService` plumbing

**Files:**

- Modify: `packages/preload/src/index.ts` (type at :107, impl at :591)
- Modify: `packages/renderer/src/app/core/services/ipc.service.ts` (`connect` at :559)

**Interfaces:**

- Consumes: `CONNECTION.PING`, `ActiveConnection` (Task 1); PING handler (Task 3).
- Produces: `window.forge.connection.connect(profileId): Promise<ActiveConnection>`, `window.forge.connection.ping(profileId): Promise<boolean>`, `IpcService.connect(profileId): Observable<ActiveConnection>`, `IpcService.pingConnection(connectionId): Observable<boolean>`.

- [ ] **Step 1: Preload types and implementation**

In `packages/preload/src/index.ts`, ensure `ActiveConnection` is in the type imports from `@mj-forge/shared`. Change line 107 and add ping:

```typescript
connect: (profileId: string) => Promise<ActiveConnection>;
disconnect: (profileId: string) => Promise<void>;
ping: (profileId: string) => Promise<boolean>;
```

In the implementation object (line 591):

```typescript
    connect: profileId => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION.CONNECT, profileId),
    disconnect: profileId => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION.DISCONNECT, profileId),
    ping: profileId => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION.PING, profileId),
```

- [ ] **Step 2: IpcService**

In `packages/renderer/src/app/core/services/ipc.service.ts`, add `ActiveConnection` to the `@mj-forge/shared` type imports and replace `connect` (line 559) / add `pingConnection`:

```typescript
  connect(profileId: string): Observable<ActiveConnection> {
    return from(this.api.connection.connect(profileId));
  }

  pingConnection(connectionId: string): Observable<boolean> {
    return from(this.api.connection.ping(connectionId));
  }
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: clean. (`connect`'s previous `Observable<void>` consumers ignore the emitted value, so widening the type is non-breaking; Task 5 starts consuming it.)

---

### Task 5: Renderer `CapabilitiesStore` + connect/heartbeat wiring

**Files:**

- Create: `packages/renderer/src/app/core/state/capabilities.state.ts`
- Create: `packages/renderer/src/app/core/state/capabilities.state.spec.ts`
- Modify: `packages/renderer/src/app/core/state/connection.state.ts` (`connect` at :219, `pingConnection` at :422, `cleanupConnectionState` — find the method invoked at :258)

**Interfaces:**

- Consumes: `EngineCapabilities`, `EngineVariant`, `FULL_CAPABILITIES`, `ActiveConnection` (Task 1); `IpcService.pingConnection` (Task 4).
- Produces: `CapabilitiesStore` with `set(connectionId: string, entry: { capabilities: EngineCapabilities; variant?: EngineVariant }): void`, `clear(connectionId: string): void`, `for(connectionId: string | undefined): EngineCapabilities`, `variantFor(connectionId: string | undefined): EngineVariant | undefined`. Tasks 6–9 read from this store.

- [ ] **Step 1: Write the failing store test**

Create `packages/renderer/src/app/core/state/capabilities.state.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FULL_CAPABILITIES } from '@mj-forge/shared';
import { CapabilitiesStore } from './capabilities.state';

describe('CapabilitiesStore', () => {
  const dsqlCaps = {
    supportsMultipleDatabases: false,
    supportsDatabaseManagement: false,
    supportsStoredProcedures: false,
    supportsTriggers: false,
    supportsBackupRestore: false,
  };

  it('defaults to FULL_CAPABILITIES for unknown or undefined connections', () => {
    const store = new CapabilitiesStore();
    expect(store.for('nope')).toEqual(FULL_CAPABILITIES);
    expect(store.for(undefined)).toEqual(FULL_CAPABILITIES);
    expect(store.variantFor('nope')).toBeUndefined();
  });

  it('returns stored capabilities and variant', () => {
    const store = new CapabilitiesStore();
    store.set('c1', { capabilities: dsqlCaps, variant: 'dsql' });
    expect(store.for('c1').supportsTriggers).toBe(false);
    expect(store.variantFor('c1')).toBe('dsql');
  });

  it('clear() reverts a connection to defaults', () => {
    const store = new CapabilitiesStore();
    store.set('c1', { capabilities: dsqlCaps, variant: 'dsql' });
    store.clear('c1');
    expect(store.for('c1')).toEqual(FULL_CAPABILITIES);
    expect(store.variantFor('c1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/renderer/src/app/core/state/capabilities.state.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `packages/renderer/src/app/core/state/capabilities.state.ts`:

```typescript
/**
 * Per-connection engine capabilities, populated from the ActiveConnection
 * returned by connection:connect. Standalone (no service dependencies) so
 * both ConnectionStateService and ExplorerStateService can inject it
 * without a cycle. Absence of an entry means "assume fully capable" —
 * existing engines behave exactly as before this store existed.
 */

import { Injectable, signal } from '@angular/core';
import { FULL_CAPABILITIES } from '@mj-forge/shared';
import type { EngineCapabilities, EngineVariant } from '@mj-forge/shared';

export interface ConnectionCapabilitiesEntry {
  capabilities: EngineCapabilities;
  variant?: EngineVariant;
}

@Injectable({ providedIn: 'root' })
export class CapabilitiesStore {
  private readonly _byConnection = signal<ReadonlyMap<string, ConnectionCapabilitiesEntry>>(
    new Map()
  );

  set(connectionId: string, entry: ConnectionCapabilitiesEntry): void {
    const next = new Map(this._byConnection());
    next.set(connectionId, entry);
    this._byConnection.set(next);
  }

  clear(connectionId: string): void {
    const next = new Map(this._byConnection());
    next.delete(connectionId);
    this._byConnection.set(next);
  }

  for(connectionId: string | undefined): EngineCapabilities {
    if (!connectionId) return FULL_CAPABILITIES;
    return this._byConnection().get(connectionId)?.capabilities ?? FULL_CAPABILITIES;
  }

  variantFor(connectionId: string | undefined): EngineVariant | undefined {
    if (!connectionId) return undefined;
    return this._byConnection().get(connectionId)?.variant;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/renderer/src/app/core/state/capabilities.state.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `ConnectionStateService`**

In `packages/renderer/src/app/core/state/connection.state.ts`:

1. Inject the store following the file's existing injection style (constructor or `inject()`): `private capabilitiesStore = inject(CapabilitiesStore);` with import `import { CapabilitiesStore } from './capabilities.state';` and add `FULL_CAPABILITIES` to the `@mj-forge/shared` imports.

2. In `connect()` (line 228), capture the connect result:

```typescript
const active = await firstValueFrom(this.ipc.connect(profileId));
this.capabilitiesStore.set(profileId, {
  capabilities: active?.capabilities ?? FULL_CAPABILITIES,
  variant: active?.engineVariant,
});
```

3. In `pingConnection()` (line 422), replace the `listDatabases` call:

```typescript
await this.withTimeout(
  firstValueFrom(this.ipc.pingConnection(connectionId)),
  ConnectionStateService.HEARTBEAT_TICK_TIMEOUT_MS,
  `heartbeat ping for ${connectionId}`
);
```

4. In `cleanupConnectionState(connectionId)` (the private method called at line 258), add:

```typescript
this.capabilitiesStore.clear(connectionId);
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npx vitest run packages/renderer`
Expected: clean typecheck; renderer unit tests pass.

---

### Task 6: Explorer tree gating (folders the engine can't serve)

**Files:**

- Create: `packages/renderer/src/app/core/state/explorer-folders.ts`
- Create: `packages/renderer/src/app/core/state/explorer-folders.spec.ts`
- Modify: `packages/renderer/src/app/core/state/explorer.state.ts` (`getSchemaFolders` at :672, `getTableSubFolders` at :438)

**Interfaces:**

- Consumes: `EngineCapabilities` (Task 1), `CapabilitiesStore` (Task 5).
- Produces: `schemaFolderDefs(caps: EngineCapabilities): { name: string; type: string; icon: string }[]` and `tableSubFolderDefs(caps: EngineCapabilities): { name: string; type: string }[]` — pure functions consumed only by `explorer.state.ts`.

- [ ] **Step 1: Write the failing tests**

Create `packages/renderer/src/app/core/state/explorer-folders.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FULL_CAPABILITIES } from '@mj-forge/shared';
import { schemaFolderDefs, tableSubFolderDefs } from './explorer-folders';

const DSQL_CAPS = {
  ...FULL_CAPABILITIES,
  supportsStoredProcedures: false,
  supportsTriggers: false,
};

describe('schemaFolderDefs', () => {
  it('returns all four folders for a fully-capable engine', () => {
    expect(schemaFolderDefs(FULL_CAPABILITIES).map(f => f.name)).toEqual([
      'Tables',
      'Views',
      'Stored Procedures',
      'Functions',
    ]);
  });

  it('omits procedure/function folders when unsupported', () => {
    expect(schemaFolderDefs(DSQL_CAPS).map(f => f.name)).toEqual(['Tables', 'Views']);
  });
});

describe('tableSubFolderDefs', () => {
  it('returns all five sub-folders for a fully-capable engine', () => {
    expect(tableSubFolderDefs(FULL_CAPABILITIES).map(f => f.name)).toEqual([
      'Columns',
      'Indexes',
      'Keys',
      'Constraints',
      'Triggers',
    ]);
  });

  it('omits Triggers when unsupported', () => {
    expect(tableSubFolderDefs(DSQL_CAPS).map(f => f.name)).toEqual([
      'Columns',
      'Indexes',
      'Keys',
      'Constraints',
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/renderer/src/app/core/state/explorer-folders.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure helpers**

Create `packages/renderer/src/app/core/state/explorer-folders.ts`:

```typescript
/**
 * Pure folder-definition helpers for the explorer tree. Which folders a
 * schema/table node shows depends on the connection's engine capabilities
 * (e.g. Aurora DSQL has no stored procedures, functions, or triggers).
 * Kept free of Angular/IPC dependencies so they are trivially testable.
 */

import type { EngineCapabilities } from '@mj-forge/shared';

export interface SchemaFolderDef {
  name: string;
  type: string;
  icon: string;
}

export interface TableSubFolderDef {
  name: string;
  type: string;
}

export function schemaFolderDefs(caps: EngineCapabilities): SchemaFolderDef[] {
  const folders: SchemaFolderDef[] = [
    { name: 'Tables', type: 'tables', icon: 'table_chart' },
    { name: 'Views', type: 'views', icon: 'view_list' },
  ];
  if (caps.supportsStoredProcedures) {
    folders.push({ name: 'Stored Procedures', type: 'procedures', icon: 'functions' });
    folders.push({ name: 'Functions', type: 'functions', icon: 'calculate' });
  }
  return folders;
}

export function tableSubFolderDefs(caps: EngineCapabilities): TableSubFolderDef[] {
  const folders: TableSubFolderDef[] = [
    { name: 'Columns', type: 'columns_folder' },
    { name: 'Indexes', type: 'indexes_folder' },
    { name: 'Keys', type: 'keys_folder' },
    { name: 'Constraints', type: 'constraints_folder' },
  ];
  if (caps.supportsTriggers) {
    folders.push({ name: 'Triggers', type: 'triggers_folder' });
  }
  return folders;
}
```

Note: `Functions` is intentionally coupled to `supportsStoredProcedures` — DSQL's `pg_proc` is unsupported so neither folder can load. Do not add a separate `supportsFunctions` flag (YAGNI).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/renderer/src/app/core/state/explorer-folders.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `explorer.state.ts`**

1. Inject `CapabilitiesStore` (same style as the service's existing injections) and import the helpers:

```typescript
import { CapabilitiesStore } from './capabilities.state';
import { schemaFolderDefs, tableSubFolderDefs } from './explorer-folders';
```

2. Replace the hardcoded array in `getSchemaFolders` (line 672) so it maps over the helper. The existing `folders.map(...)` body stays identical — only the source array changes:

```typescript
  private getSchemaFolders(connectionId: string, databaseName: string, schema: string): TreeNode[] {
    const folders = schemaFolderDefs(this.capabilitiesStore.for(connectionId));

    return folders.map(folder => ({
      id: `folder-${connectionId}-${databaseName}-${schema}-${folder.type}`,
      name: folder.name,
      type: 'folder' as const,
      icon: folder.icon,
      path: folder.type,
      hasChildren: true,
      isExpanded: false,
      isLoading: false,
      connectionId,
      databaseName,
      schema,
    }));
  }
```

3. In `getTableSubFolders` (line 438), replace the hardcoded `folders` array with:

```typescript
const folders = tableSubFolderDefs(this.capabilitiesStore.for(node.connectionId)).map(f => ({
  name: f.name,
  type: f.type as NodeType,
}));
```

keeping the rest of the method unchanged. (Check how the existing array is consumed — if it uses `{ name, type }` object literals directly, this drop-in works; adjust the cast to match the file's `NodeType` import.)

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npx vitest run packages/renderer`
Expected: clean.

---

### Task 7: Guard backup/restore and database management UI

**Files:**

- Modify: `packages/renderer/src/app/layout/sidebar/sidebar.component.ts` (`engineSupports` at :895, `openBackup` at :903, `openRestore` at :942, `_openCreateDatabaseDialog` at :1952)
- Modify: `packages/renderer/src/app/layout/shell/shell.component.ts` (New Database dialog open at :360)

**Interfaces:**

- Consumes: `CapabilitiesStore` (Task 5).
- Produces: user-visible guards only; no new exports.

- [ ] **Step 1: Rewrite `engineSupports` to consult capabilities**

Note: `engineSupports` currently has **zero call sites** (verify with `grep -n "engineSupports" packages/renderer/src/app/layout/sidebar/sidebar.component.ts` — only the definition at :895 should appear). Rewrite it anyway so the helper is truthful, and use it in the guards below. Inject `CapabilitiesStore` into the sidebar component (match existing injection style):

```typescript
  /** Check if the focused connection's engine supports a feature */
  engineSupports(feature: 'backupRestore' | 'serverFileBrowsing' | 'extendedProperties'): boolean {
    const profile = this.focusedProfile();
    if (!profile) return true;
    if (feature === 'backupRestore') {
      return this.capabilitiesStore.for(profile.id).supportsBackupRestore;
    }
    // serverFileBrowsing and extendedProperties remain MSSQL-only.
    return profile.engine === 'mssql';
  }
```

Behavior note: this changes `engineSupports('backupRestore')` for plain PostgreSQL from `false` to `true`. Since the helper is currently dead code this changes nothing user-visible, and `true` matches reality (PG backup via pg_dump exists — see `packages/main/src/services/sql/pg-backup.ts`). Mention it in the PR description.

- [ ] **Step 2: Guard `openBackup` and `openRestore`**

In `openBackup` (line 903), after the `if (!connectionId) { ... return; }` block, add:

```typescript
if (!this.capabilitiesStore.for(connectionId).supportsBackupRestore) {
  this.notification.info('Backup is not supported on this server (Aurora DSQL).');
  return;
}
```

Add the mirror-image guard in `openRestore` (line 942) with the message `'Restore is not supported on this server (Aurora DSQL).'`.

- [ ] **Step 3: Guard database creation (sidebar + native menu)**

In `_openCreateDatabaseDialog` (line 1952), at the top of the method body, add:

```typescript
if (!this.capabilitiesStore.for(connectionId).supportsDatabaseManagement) {
  this.notification.info(
    'This server hosts a single fixed database — creating databases is not supported.'
  );
  return;
}
```

In `packages/renderer/src/app/layout/shell/shell.component.ts`, the native-menu New Database handler opens the dialog at line 360. Inject `CapabilitiesStore` and add the same guard before `this.dialog.open(mod.CreateDatabaseDialogComponent, ...)`, using the shell's focused/most-recent connection id (whatever identifier that handler already resolves for dialog data — read the surrounding ~15 lines and reuse it).

Database rename/delete context-menu actions: `grep -n "renameDatabase\|deleteDatabase" packages/renderer/src/app/layout/sidebar/sidebar.component.ts` and add the same `supportsDatabaseManagement` guard at the top of each handler method found (same notification copy, s/creating/renaming|deleting/). Do **not** try to hide menu items in this task — guards-with-toast is the v1 behavior.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

---

### Task 8: Autocomplete prefetch hardening

**Files:**

- Modify: `packages/renderer/src/app/features/query/query.component.ts` (`loadAutoCompleteObjects` at :1472)

**Interfaces:**

- Consumes: `CapabilitiesStore` (Task 5).
- Produces: none.

- [ ] **Step 1: Make the prefetch capability-aware and partial-failure-tolerant**

The current `Promise.all` (line 1478) is all-or-nothing: one failed fetch (e.g. procedures) discards tables and views too. Inject `CapabilitiesStore` and replace the fetch block:

```typescript
const caps = this.capabilitiesStore.for(connectionId);
const fetchChildren = (kind: string) =>
  firstValueFrom(this.ipc.getExplorerChildren(connectionId, database, kind)).catch(err => {
    console.warn(`Autocomplete prefetch for ${kind} failed:`, err);
    return [];
  });

const [tables, views, procs] = await Promise.all([
  fetchChildren('tables'),
  fetchChildren('views'),
  caps.supportsStoredProcedures ? fetchChildren('procedures') : Promise.resolve([]),
]);
```

Keep the rest of the method (the `objects` mapping at :1484 and `autoCompleteObjects.set`) unchanged, and keep the outer try/catch. TypeScript: `fetchChildren`'s return type should be inferred from `getExplorerChildren`'s element type; if the `[]` literal degrades it to `never[]`, annotate the catch return with the same array type the surrounding code uses.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

---

### Task 9: AI awareness (tools + system prompt)

**Files:**

- Modify: `packages/main/src/services/ai/tool-registry.ts` (`get_server_info` at :287, `get_table_row_count` at :346)
- Modify: `packages/main/src/services/ai/chat-service.ts` (`buildSystemPrompt` at :774)
- Modify: `packages/renderer/src/app/core/state/chat.state.ts` (:265) and `packages/renderer/src/app/core/state/chat-instance.state.ts` (:242)

**Interfaces:**

- Consumes: `isDsqlCached` (Task 3), `ChatRequest.engineVariant` (Task 1), `CapabilitiesStore.variantFor` (Task 5).
- Produces: none (behavioral only).

- [ ] **Step 1: Row-count tool — use `reltuples` for all PostgreSQL**

In `tool-registry.ts` (line 346), replace the postgresql branch of `get_table_row_count`:

```typescript
        } else if (engine === 'postgresql') {
          // pg_class.reltuples works on both standard PostgreSQL and Aurora
          // DSQL (which lacks pg_stat_user_tables), and is the AWS-recommended
          // way to approximate row counts without a full scan.
          sql = `SELECT COALESCE(c.reltuples, 0)::bigint AS row_count
                 FROM pg_class c
                 JOIN pg_namespace n ON c.relnamespace = n.oid
                 WHERE n.nspname = '${safeSchema}' AND c.relname = '${safeTable}' AND c.relkind = 'r'`;
        } else {
```

- [ ] **Step 2: Server-info tool — skip `inet_server_addr()` on DSQL**

In the `get_server_info` handler's postgresql branch (line 291), replace with:

```typescript
if (engine === 'postgresql') {
  const isDsql = ConnectionPoolManager.getInstance().isDsqlCached(connectionId);
  const sql = isDsql
    ? `SELECT version() AS version, current_database() AS database, current_user AS user`
    : `SELECT version() AS version, current_database() AS database,
               current_user AS user, inet_server_addr()::text AS server_address`;
  const rows = await this.queryAny(connectionId, sql);
  return rows[0] || {};
}
```

(`ConnectionPoolManager` is already imported — it is used at line 232.)

No changes needed for `list_databases` / `list_stored_procedures` / `create_database` / `rename_database` / `delete_database`: they route through `getDialect`-generated SQL, which Tasks 2–3 make DSQL-safe (single-row list, empty list, and clear thrown errors respectively — a thrown dialect error surfaces to the model as a failed tool call with the message, which is the desired behavior).

- [ ] **Step 3: System prompt DSQL block**

In `chat-service.ts` `buildSystemPrompt` (line 774), after the initial `let prompt = ...` template (ends line 800), add:

```typescript
if (request.engineVariant === 'dsql') {
  prompt += `

This server is an Amazon Aurora DSQL cluster (PostgreSQL 16-compatible) with hard restrictions you MUST respect:
- The cluster hosts a single database named "postgres" — never CREATE, DROP, or RENAME databases.
- No foreign keys, triggers, PL/pgSQL, temporary tables, TRUNCATE, or extensions. Use LANGUAGE SQL for functions.
- CREATE INDEX must be CREATE INDEX ASYNC (monitor with SELECT * FROM sys.jobs).
- DDL and DML cannot share a transaction; at most one DDL statement per transaction.
- A single transaction can modify at most 3,000 rows — batch large writes.
- Isolation is fixed at REPEATABLE READ; write conflicts surface as serialization errors, so retry idempotently.
- pg_proc, pg_database, pg_stat_* and pg_stat_activity are unavailable; prefer pg_class.reltuples over COUNT(*) for row counts.`;
}
```

- [ ] **Step 4: Thread `engineVariant` from the renderer**

In `chat.state.ts` the object passed to `this.ipc.sendChatMessage({...})` at line 260 already includes a `databaseEngine:` property (line 265). Inject `CapabilitiesStore` into the service and add, directly beside `databaseEngine`:

```typescript
          engineVariant: this.capabilitiesStore.variantFor(connectionId),
```

where `connectionId` is the same value the object already assigns to its `connectionId:` property (read the surrounding object literal and reuse that exact variable/expression). Repeat identically in `chat-instance.state.ts` (object at line 237, `databaseEngine` at line 242).

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run packages/main packages/renderer`
Expected: clean.

---

### Task 10: Full verification, commit, PR

**Files:** none new.

- [ ] **Step 1: Full unit + lint gate**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all clean/green. Fix anything that isn't before proceeding.

- [ ] **Step 2: Full harness**

Run: `npm run test:harness:up` (starts docker MSSQL/PG/MySQL containers), then `npm run test:full`.
Expected: the full tiered suite passes. Known environment quirks (from project memory): the MSSQL container degrades after repeated runs — restart the harness rather than debugging code; the Darwin Electron e2e `<app-root>` issue may pre-exist. **Report any failure verbatim to Craig — do not classify failures as environmental/out-of-scope yourself.**

- [ ] **Step 3: Single batched commit on the feature branch**

```bash
git checkout -b feature/aurora-dsql-support
git add -A
git commit -m "feat(dsql): detect Aurora DSQL and gate unsupported introspection/features

- Probe sys.dsql_major_version() once per profile (isAzureSQL pattern)
- PgDsqlDialect overrides pg_database/pg_proc/pg_trigger/pg_stat_* queries
- Ship EngineCapabilities on connection:connect; renderer CapabilitiesStore
- Heartbeat now pings via connection:ping (SELECT 1) instead of listDatabases
- Explorer hides procedure/function/trigger folders when unsupported
- Guard backup/restore and database create/rename/delete with toasts
- AI: reltuples row counts, DSQL-safe server info, DSQL rules in system prompt"
git push -u origin feature/aurora-dsql-support
```

- [ ] **Step 4: Open the PR**

`gh pr create` against `main`. The description MUST call out, per Craig's review conventions:

1. **Behavior change for ALL engines:** the connection heartbeat now runs `SELECT 1` via `connection:ping` instead of `listDatabases` every 30s (cheaper; also stops implicitly refreshing the database-list cache — the list is still loaded on connect and on explicit refresh).
2. **Dead-code rewrite:** sidebar `engineSupports('backupRestore')` previously returned `false` for PostgreSQL; it now returns `true` (capability-driven). It had no call sites, but reviewers should confirm.
3. **`get_table_row_count` for standard PostgreSQL** switched from `pg_stat_user_tables.n_live_tup` to `pg_class.reltuples` (both approximate; values can differ slightly).
4. **Untested against a live DSQL cluster** unless Step 5 was completed — link the checklist results.

- [ ] **Step 5: Manual live-cluster verification (requires Craig / AWS credentials)**

Connect a saved profile to a real DSQL cluster (host `<cluster>.dsql.<region>.on.aws`, user `admin`, a freshly generated IAM token as password, SSL enabled) and verify — recording actual results for each:

1. Connect succeeds; no "Failed to load databases" toast; sidebar shows the single `postgres` database.
2. Heartbeat stays green for 2+ minutes (no reconnect loop).
3. Explorer: expand schemas → Tables/Views only (no Procedures/Functions folders); table expands to Columns/Indexes/Keys/Constraints (no Triggers); columns/indexes lists populate (this validates the `information_schema`/`pg_index` assumption).
4. Object search and query-tab autocomplete list tables and views.
5. "Show Execution Plan" on a simple SELECT — records whether `EXPLAIN (FORMAT JSON)` works on DSQL (unverified assumption; if it fails, file a follow-up — do not fix in this PR).
6. AI chat: ask for a table row count and to "create an index" — verify reltuples-based count and `CREATE INDEX ASYNC` in the generated SQL.
7. Backup and Create Database entry points show the explanatory toast.
8. Open Table Properties on a DSQL table — row count populates from reltuples, size fields show empty/N-A, no error state (exercises the metadata.ts DSQL branch).

Anything that fails goes back to Craig with the observed output, not a workaround.

---

## Self-review notes (already applied)

- **Spec coverage:** every failure identified in the investigation maps to a task — `listDatabases`/heartbeat (T2/T3/T5), tables list (T2), procedures/functions/triggers (T2/T6), object definition (T2), database DDL (T2/T7), backup (T7), autocomplete (T8), AI tools/prompt (T9). Deliberately out of scope: IAM token signer, pool lifetime recycling, `EXPLAIN (FORMAT JSON)` (recorded in T10 step 5), ERD FK-less polish (works degraded by design).
- **Known judgment calls a reviewer may challenge:** coupling Functions visibility to `supportsStoredProcedures`; guards-with-toast instead of hiding menu items; changing the heartbeat for all engines.
- **Type consistency:** `EngineCapabilities` field names are identical across shared types, `capabilitiesForDialect`, store, and helpers (5 fields, all `supports*`). `variant`/`engineVariant` naming: dialect exposes `variant`, wire/UI types use `engineVariant`.
