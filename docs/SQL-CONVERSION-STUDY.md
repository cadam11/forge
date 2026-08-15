# SQL Dialect Conversion — Design Study

## Vision

Allow users to convert SQL queries between dialects directly in the Forge query editor. A DBA working in a mixed SQL Server + PostgreSQL environment should be able to:

1. Write a query in T-SQL and convert it to PostgreSQL (or vice versa)
2. Paste SQL from one system and convert it for another
3. Use the conversion as a learning tool to understand dialect differences

## Library Candidates

### 1. `sqlglot-ts` (Recommended)

- **npm**: `sqlglot-ts`
- **Type**: TypeScript port of Python's [sqlglot](https://sqlglot.com)
- **API**: `parse()`, `parseOne()`, `transpileOne(sql, fromDialect, toDialect)`
- **Dialects**: DuckDB fully tested, others functional (T-SQL, PostgreSQL, MySQL, etc.)
- **Pros**: Zero runtime deps, browser-compatible, pure TS
- **Cons**: Not all dialects fully tested; may need edge case handling

### 2. `@polyglot-sql/sdk`

- **Type**: Rust/WebAssembly SQL transpiler
- **Dialects**: 30+ SQL dialects
- **Pros**: Very broad dialect support, fast (Wasm)
- **Cons**: Wasm bundle size, less TypeScript-native

## Proposed UI

### Option A: Conversion Panel (Recommended)

Add a "Convert SQL" button to the query editor toolbar:

```
┌─────────────────────────────────────────────────────────┐
│ [Execute] [Format] [Convert ▾]  ← dropdown              │
│                    ┌────────────────────┐               │
│                    │ To PostgreSQL      │               │
│                    │ To SQL Server      │               │
│                    │ To MySQL           │               │
│                    └────────────────────┘               │
├─────────────────────────────────────────────────────────┤
│ SELECT TOP 10 *                                         │
│ FROM [dbo].[Users]                                      │
│ WHERE [Name] LIKE '%John%'                              │
│ AND [CreatedAt] > GETDATE() - 30                        │
└─────────────────────────────────────────────────────────┘
```

When clicked, the converted SQL replaces the editor content (with undo support) or opens in a new tab:

```
┌─────────────────────────────────────────────────────────┐
│ SELECT *                                                │
│ FROM "public"."Users"                                   │
│ WHERE "Name" LIKE '%John%'                              │
│ AND "CreatedAt" > NOW() - INTERVAL '30 days'            │
│ LIMIT 10                                                │
└─────────────────────────────────────────────────────────┘
```

### Option B: Side-by-Side Comparison

Split the editor into two panes showing source and converted SQL:

```
┌──────────────────────┬──────────────────────┐
│ T-SQL (source)       │ PostgreSQL (converted)│
├──────────────────────┼──────────────────────┤
│ SELECT TOP 10 *      │ SELECT *             │
│ FROM [dbo].[Users]   │ FROM "public"."Users"│
│ WHERE GETDATE() ...  │ WHERE NOW() ...      │
│                      │ LIMIT 10             │
└──────────────────────┴──────────────────────┘
```

### Option C: AI-Powered Conversion

Use the existing AI integration to convert SQL with context:

- Send the query + source dialect + target dialect to the LLM
- LLM understands intent and can handle complex cases (stored procedures, etc.)
- Hybrid: use sqlglot-ts for simple conversions, AI for complex ones

## Implementation Plan

### Phase 1: Library Integration

1. Install `sqlglot-ts`: `pnpm add sqlglot-ts`
2. Create `packages/main/src/services/sql/sql-converter.ts`
3. Add IPC channel `query:convert-sql`
4. Wire up basic conversion: `transpileOne(sql, source, target)`

### Phase 2: UI Integration

1. Add "Convert" dropdown to query editor toolbar
2. Auto-detect source dialect from active connection's engine
3. Show conversion result (replace editor or new tab)
4. Add undo support when replacing editor content

### Phase 3: Smart Conversion

1. Handle conversion errors gracefully (show what couldn't be converted)
2. Add diff view showing what changed
3. Integrate with AI for complex cases (procedures, functions, DDL)
4. Support batch conversion of multiple files in a workspace

## Key Dialect Differences to Handle

| Feature        | T-SQL                    | PostgreSQL                     | MySQL                 |
| -------------- | ------------------------ | ------------------------------ | --------------------- |
| Top N rows     | `SELECT TOP N`           | `LIMIT N`                      | `LIMIT N`             |
| Identity       | `IDENTITY(1,1)`          | `GENERATED ALWAYS AS IDENTITY` | `AUTO_INCREMENT`      |
| String concat  | `+`                      | `\|\|`                         | `CONCAT()`            |
| Date functions | `GETDATE()`, `DATEADD()` | `NOW()`, `+ INTERVAL`          | `NOW()`, `DATE_ADD()` |
| Boolean        | `BIT (1/0)`              | `BOOLEAN`                      | `TINYINT(1)`          |
| Quoting        | `[brackets]`             | `"double quotes"`              | `` `backticks` ``     |
| UUID           | `NEWID()`                | `gen_random_uuid()`            | `UUID()`              |
| Temp tables    | `#temp`                  | `TEMP TABLE`                   | `TEMPORARY TABLE`     |
| CTEs           | `WITH ... AS`            | `WITH ... AS`                  | `WITH ... AS` (8.0+)  |
| IF/ELSE        | `IF ... BEGIN END`       | `DO $$ ... $$`                 | `IF ... END IF`       |
| Stored procs   | `CREATE PROCEDURE`       | `CREATE FUNCTION`              | `CREATE PROCEDURE`    |

## Risk Assessment

- **sqlglot-ts maturity**: DuckDB dialect is well-tested; T-SQL/PG may have edge cases
- **Complex SQL**: Stored procedures, triggers, and advanced DDL may not convert cleanly
- **Mitigation**: Show clear warnings for unsupported constructs; offer AI fallback
