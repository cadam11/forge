# Contributing to Forge

Thank you for your interest in contributing to Forge! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [AI Integration Guidelines](#ai-integration-guidelines)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/forge.git`
3. Add the upstream remote: `git remote add upstream https://github.com/cadam11/forge.git`

## Development Setup

### Prerequisites

- **Node.js** 20 or later
- **pnpm** 11 or later (`corepack enable pnpm`)
- **Xcode Command Line Tools** (macOS, for native modules)
- **Docker** (optional, for local SQL Server testing)

### Installation

```bash
pnpm install
pnpm run build       # Build all packages
pnpm run dev         # Development mode with hot reload
```

### Running SQL Server Locally

```bash
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=YourStrong@Passw0rd" \
  -p 1433:1433 --name sql1 -d mcr.microsoft.com/mssql/server:2022-latest
```

### Building Installers

```bash
pnpm run package:mac   # macOS DMG (arm64 + x64)
pnpm run package       # Current platform
```

## Project Structure

```
forge/
├── packages/
│   ├── shared/        # Types, IPC channels, ai-vendors.json
│   ├── preload/       # Electron context bridge
│   ├── main/          # Electron main process
│   │   └── src/
│   │       ├── ipc/       # IPC handler registration
│   │       └── services/
│   │           ├── ai/    # LLM providers, chat service, tool registry
│   │           ├── sql/   # SQL Server operations (mssql)
│   │           ├── docker/# Container detection (dockerode)
│   │           ├── keychain/ # Credential storage (keytar)
│   │           └── config/   # App state persistence (electron-store)
│   └── renderer/      # Angular 18 application
│       └── src/app/
│           ├── core/      # Services, state (signals), IPC service
│           ├── features/  # Chat, ERD, query, explorer, welcome
│           ├── shared/    # Settings dialogs, reusable components
│           └── layout/    # App shell, sidebar, GoldenLayout container
├── .github/workflows/ # CI/CD
├── scripts/           # Build helpers
├── resources/         # App icons
└── plans/             # Design documents
```

### Package Overview

| Package             | Purpose                                                         |
| ------------------- | --------------------------------------------------------------- |
| `@forgedb/shared`   | Type definitions, IPC channel constants, AI vendor config       |
| `@forgedb/preload`  | Electron preload script with typed contextBridge API            |
| `@forgedb/main`     | Main process: SQL, AI, Docker, Keychain services + IPC handlers |
| `@forgedb/renderer` | Angular 18 UI with standalone components, signals, OnPush CD    |

## Making Changes

1. Create a branch from `main`:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make changes following our [code style guidelines](#code-style)

3. Build to check for type errors:

   ```bash
   pnpm run build
   ```

4. Test your changes manually or with tests:
   ```bash
   pnpm test
   ```

## AI Integration Guidelines

If you're working on AI features, follow these rules:

1. **Never make direct LLM API calls.** All AI interactions go through `packages/main/src/services/ai/llm-providers.ts`. This multi-provider abstraction supports Google, Anthropic, OpenAI, Groq, and Cerebras.

2. **Streaming is required** for chat/conversational features. Use the `StreamCallbacks` interface from `llm-providers.ts`.

3. **Tool definitions** go in `packages/main/src/services/ai/tool-registry.ts`. Tools that modify data must set `requiresConfirmation: true`.

4. **Model/vendor config** lives in `packages/shared/src/config/ai-vendors.json`. User preferences are stored in app state.

5. **Use `<app-markdown>`** (`packages/renderer/src/app/shared/markdown/`) for rendering AI-generated content in the renderer. It sanitizes with DOMPurify — never bind an unsanitized string to `[innerHTML]`.

## Commit Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description
```

### Types

| Type       | Description            |
| ---------- | ---------------------- |
| `feat`     | New feature            |
| `fix`      | Bug fix                |
| `docs`     | Documentation          |
| `refactor` | Code restructuring     |
| `test`     | Test additions/changes |
| `chore`    | Build/tooling          |

### Examples

```
feat(chat): add image attachment support
fix(query): handle timeout on large result sets
docs(readme): update AI provider setup instructions
refactor(explorer): migrate to Angular signals
```

## Pull Request Process

1. Ensure the build succeeds: `pnpm run build`
2. Update documentation if your change affects user-facing behavior
3. Create a PR with a clear description of what and why
4. Link related issues

### PR Title Format

Same as commit format: `type(scope): description`

## Code Style

### TypeScript

- Strict mode (`strict: true`) — no `any` without justification
- Use interfaces for object shapes, type guards for narrowing
- Static imports only — no dynamic `require()` or `import()`

### Angular (Renderer)

- **Standalone components** — no NgModules
- **Angular signals** for reactive state
- **OnPush** change detection on all components
- **Smart/dumb pattern** — containers handle logic, presentational components receive inputs

### Electron (Main Process)

- All Node operations in main process — never expose Node APIs to renderer
- IPC channels typed in `@forgedb/shared`
- Use `invoke/handle` for request-response, `send/on` for streaming
- Credentials via Keychain only — never in files or logs

### File Naming

| Type       | Pattern                                   |
| ---------- | ----------------------------------------- |
| Components | `kebab-case.component.ts`                 |
| Services   | `kebab-case.service.ts` / `kebab-case.ts` |
| Types      | `kebab-case.types.ts`                     |
| Tests      | `*.spec.ts`                               |

### Forbidden Patterns

- `eval()` or `new Function()`
- Dynamic `require()` or `import()`
- Storing credentials outside Keychain
- Direct DOM manipulation in Angular
- `console.log` in production (use the logger service)
- Direct HTTP calls to LLM APIs (use the provider abstraction)
- Synchronous IPC (`ipcRenderer.sendSync`)

## Questions?

- **Bugs** — [Open an issue](https://github.com/cadam11/forge/issues)
- **Ideas** — [Start a discussion](https://github.com/cadam11/forge/discussions)

Thank you for contributing!
