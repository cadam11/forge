# Forge - SQL Database Manager for Mac

## Project Overview

Forge is a native macOS desktop application providing database management workflows for **SQL Server**, **PostgreSQL**, and **MySQL**. Built with Electron + Angular + Node.js.

## Tech Stack

- **Desktop Shell**: Electron
- **UI Framework**: Angular 18+ (standalone components)
- **Main Process**: Node.js with TypeScript
- **SQL Connectivity**: node-mssql (SQL Server), pg (PostgreSQL), mysql2 (MySQL)
- **State Management**: Angular signals + RxJS
- **UI Components**: Angular Material or PrimeNG
- **Build Tools**: electron-builder, Angular CLI

## Project Structure

```
forge/
├── packages/
│   ├── main/                 # Electron main process
│   │   └── src/
│   │       ├── index.ts      # Main entry point
│   │       ├── ipc/          # IPC handlers
│   │       ├── services/
│   │       │   ├── ai/       # AI service, chat, tool registry, LLM providers
│   │       │   ├── sql/      # Database operations (providers, dialects, metadata)
│   │       │   ├── docker/   # Docker detection
│   │       │   ├── keychain/ # Credential storage
│   │       │   └── config/   # App state persistence
│   │       └── utils/        # Logger, singleton
│   ├── renderer/             # Angular application
│   │   └── src/app/
│   │       ├── core/         # Singleton services, state (signals)
│   │       ├── shared/       # Shared components (settings, dialogs)
│   │       ├── features/     # Feature modules (chat, erd, query, etc.)
│   │       └── layout/       # Shell, sidebar, panels
│   ├── shared/               # Shared types between main/renderer
│   │   └── src/
│   │       ├── types/        # TypeScript interfaces
│   │       └── config/       # ai-vendors.json
│   └── preload/              # Electron preload scripts
├── plans/                    # Planning documents
├── scripts/                  # Build/dev scripts
└── resources/                # App icons, native resources
```

## Development Rules

### General Principles

1. **Type Safety First**: Use strict TypeScript throughout. No `any` types unless absolutely necessary with explicit justification.

2. **IPC Boundary**: All communication between renderer and main process MUST go through typed IPC channels. Never expose Node APIs directly to renderer.

3. **Security by Default**:
   - Credentials stored ONLY in macOS Keychain
   - No sensitive data in logs or error messages
   - Validate all user inputs before SQL execution
   - Use parameterized queries where possible

4. **Error Handling**: Every async operation must have proper error handling with user-friendly messages and detailed logs for debugging.

### Electron-Specific Rules

1. **Context Isolation**: Always enabled. Use preload scripts for IPC bridge.

2. **Node Integration**: Disabled in renderer. All Node operations happen in main process.

3. **IPC Pattern**:

   ```typescript
   // Define channels in shared/constants/ipc-channels.ts
   // Use invoke/handle for request-response
   // Use send/on for one-way or streaming
   ```

4. **Window Management**: Single window for v1. All state managed within Angular.

### Angular-Specific Rules

1. **Standalone Components**: Use standalone components exclusively. No NgModules for new code.

2. **Signals**: Prefer Angular signals over BehaviorSubject for component state.

3. **Smart/Dumb Pattern**:
   - Container components handle data/logic
   - Presentational components receive inputs, emit outputs

4. **Lazy Loading**: Feature areas should be lazy-loaded routes.

5. **Change Detection**: Use OnPush strategy for all components.

### SQL Operations Rules

1. **Connection Pooling**: Reuse connections via connection pool. Don't create new connections per query. MSSQL uses a single pool per profile; PostgreSQL and MySQL use separate pools per database.

2. **Timeout Handling**: All SQL operations must have configurable timeouts.

3. **Transaction Safety**: Wrap multi-statement operations in transactions where appropriate.

4. **Streaming**: For backup/restore, stream progress via IPC events.

5. **SQL Transparency**: Store and display the actual SQL being executed for user reference.

6. **Multi-Engine Architecture**: All database operations go through an abstraction layer:
   - **Dialects** (`sql/dialect/`): Engine-specific SQL generation (MSSQL, PostgreSQL, MySQL). Use `getDialect(engine)` — never write raw engine-specific SQL in services.
   - **Providers** (`sql/provider/`): Engine-specific connection/execution (`DatabaseProvider` base class, with `PgProvider`, `MySQLProvider` implementations; MSSQL uses the legacy `mssql` pool directly).
   - **Pool routing**: `ConnectionPoolManager` routes to the correct pool type via `getEngineForProfile()`.
   - **Metadata/AI tools**: Use dialect-generated SQL — they work identically across all engines.

### Code Style

1. **File Naming**:
   - Angular: `kebab-case.component.ts`, `kebab-case.service.ts`
   - Main process: `kebab-case.ts` or `PascalCase.ts` for classes
   - Types/Interfaces: `PascalCase`

2. **Imports**: Use path aliases (`@main/`, `@renderer/`, `@shared/`)

3. **Comments**: Comment the "why", not the "what". Self-documenting code preferred.

4. **Testing**:
   - Unit tests for services and utilities
   - Integration tests for IPC handlers
   - E2E tests for critical user journeys

### Git Workflow

1. **NEVER commit directly to `main`.** Always create a feature branch and open a PR. This is a hard rule — no exceptions.

2. **Branch naming**: `feature/`, `fix/`, `refactor/` prefixes (e.g. `feature/model-picker`, `fix/ctrl-e-shortcut`)

3. **Commits**: Conventional commits format
   - `feat:` new features
   - `fix:` bug fixes
   - `refactor:` code changes without feature/fix
   - `docs:` documentation
   - `test:` test additions/changes
   - `chore:` build/tooling changes

4. **PR flow**: Create branch → commit work → push → open PR via `gh pr create` → merge after review

### Performance Guidelines

1. **Query Results**: Virtualize large result sets (>1000 rows)
2. **Explorer**: Lazy-load tree nodes on expand
3. **Memory**: Monitor and limit result set caching
4. **Startup**: Defer non-critical initialization

### AI Integration Rules

1. **Never make direct LLM API calls.** All AI interactions MUST go through the multi-provider abstraction layer in `packages/main/src/services/ai/llm-providers.ts`. This ensures provider-agnostic code that works with Google, Anthropic, OpenAI, Groq, and Cerebras.

2. **Use `<app-markdown>`** (`packages/renderer/src/app/shared/markdown/`) for rendering any AI-generated content or markdown in the renderer. It parses with `marked` and sanitizes with DOMPurify before binding. Never hand-roll markdown-to-HTML conversion, and never bind an unsanitized string to `[innerHTML]`.

3. **Streaming is required** for all chat/conversational AI features. Use the `StreamCallbacks` interface from `llm-providers.ts`.

4. **Model/vendor configuration** is stored in `ai-vendors.json` (shared package) and user settings. The chat service auto-selects based on user preferences.

5. **Tool calling** is handled through the `ToolRegistry` with provider-specific format conversion happening inside each LLM provider implementation.

6. For simple AI features (tab rename, analysis) that don't need tool calling, the existing provider implementations in `ai-service.ts` are fine. For chat with tool calling, always use `llm-providers.ts`.

### Forbidden Patterns

- `eval()` or `new Function()` in any context
- Dynamic `require()` or `import()` (use static imports)
- Storing credentials in localStorage, files, or memory longer than necessary
- Direct DOM manipulation in Angular components
- Synchronous IPC calls (`ipcRenderer.sendSync`)
- Console.log in production code (use proper logging service)
- Direct HTTP calls to LLM APIs (use the provider abstraction layer)

## Common Commands

```bash
# Development
pnpm run dev              # Start in dev mode (hot reload)
pnpm run dev:main         # Start main process only
pnpm run dev:renderer     # Start renderer only

# Building
pnpm run build            # Build for production
pnpm run package          # Package as .app
pnpm run package:dmg      # Create distributable DMG

# Testing
pnpm run test             # Run all tests
pnpm run test:unit        # Unit tests only
pnpm run test:e2e         # E2E tests only

# Utilities
pnpm run lint             # Lint all code
pnpm run typecheck        # TypeScript check without emit
```

## Environment Setup

1. **Node.js**: v20 LTS or later
2. **pnpm**: v11+ (`corepack enable pnpm`)
3. **Xcode CLI Tools**: Required for native modules
4. **Docker** (optional): For local database testing (SQL Server, PostgreSQL, MySQL containers auto-detected)
5. **Host CLI tools for PG/MySQL backup/restore** (only if you use those features or run the backup integration/e2e tests):
   - macOS: `brew install postgresql@16 mysql-client`, then add `/opt/homebrew/opt/mysql-client/bin` to your shell PATH (mysql-client is keg-only).
   - Windows: install the PostgreSQL and MySQL client tools from the official installers; ensure `pg_dump`, `pg_restore`, `mysqldump`, and `mysql` are on PATH.
   - Forge's PG/MySQL backup services shell out to these binaries at runtime — they are not bundled with the app. The Backup / Restore dialogs render a setup-instructions view (with platform-specific commands) when the binaries aren't found, so end users get a guided fix rather than a cryptic spawn ENOENT.

## Key Dependencies

- `electron`: Desktop shell
- `@angular/*`: UI framework
- `mssql`: SQL Server connectivity
- `pg`: PostgreSQL connectivity
- `mysql2`: MySQL connectivity
- `keytar`: macOS Keychain access
- `dockerode`: Docker API client (for container detection)
- `monaco-editor`: Query editor (or CodeMirror)

## Resources

- [Electron Docs](https://www.electronjs.org/docs)
- [Angular Docs](https://angular.dev)
- [node-mssql Docs](https://github.com/tediousjs/node-mssql)
- [node-postgres Docs](https://node-postgres.com)
- [mysql2 Docs](https://sidorares.github.io/node-mysql2/docs)
- [SQL Server T-SQL Reference](https://docs.microsoft.com/en-us/sql/t-sql/language-reference)
- [PostgreSQL Docs](https://www.postgresql.org/docs/current/)
- [MySQL Reference Manual](https://dev.mysql.com/doc/refman/en/)
