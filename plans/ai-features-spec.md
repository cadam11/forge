# Joinery AI Features — Full Specification

## Executive Summary

Transform Joinery from a great database management tool into an AI-powered database assistant. Three pillars:

1. **AI Chat Agent** — Conversational DB assistant with tool calling
2. **Smart Autocomplete** — LLM-enhanced IntelliSense for SQL
3. **Onboarding Experience** — AppCues-style guided discovery

The existing AI infrastructure (5 providers, tab rename, analysis, SQL generation) provides a solid foundation. This spec extends it with chat persistence, tool calling, and a polished UX.

---

## 1. AI Chat Agent

### Overview

A slide-out panel (or dockable tab) where users chat with an AI assistant. The assistant can execute database operations via tool calls, using the same service layer the UI uses.

### Architecture

```
User Message
    ↓
ChatService (renderer)
    ↓ IPC
AIChatService (main process)
    ↓
AIService.generateCompletion() — with tool definitions
    ↓ Tool call response
ToolExecutor (main process) — maps tool names to existing services
    ↓ Result
AIChatService — feeds result back to LLM
    ↓
ChatService (renderer) — displays response
```

### Tool Calling Design

Tools map 1:1 to existing IPC handlers/services:

| Tool Name               | Maps To                                  | Description                         |
| ----------------------- | ---------------------------------------- | ----------------------------------- |
| `list_databases`        | `database.list()`                        | List all databases on server        |
| `create_database`       | `database.create()`                      | Create a new database               |
| `rename_database`       | `database.rename()`                      | Rename a database                   |
| `delete_database`       | `database.delete()`                      | Drop a database (with confirmation) |
| `list_tables`           | `explorer.getChildren(db, 'tables')`     | List tables in a database           |
| `list_views`            | `explorer.getChildren(db, 'views')`      | List views                          |
| `list_procedures`       | `explorer.getChildren(db, 'procedures')` | List stored procedures              |
| `get_table_columns`     | `explorer.getTableColumns()`             | Get column schema for a table       |
| `get_table_indexes`     | `explorer.getTableIndexes()`             | Get indexes for a table             |
| `get_foreign_keys`      | `explorer.getTableKeys()`                | Get foreign key relationships       |
| `execute_query`         | `query.execute()`                        | Run a SQL query                     |
| `get_object_definition` | `explorer.getDefinition()`               | Get CREATE script for object        |
| `backup_database`       | `backup.backup()`                        | Backup a database                   |
| `restore_database`      | `backup.restore()`                       | Restore a database                  |
| `generate_erd`          | Opens ERD tab                            | Show ERD for a table                |
| `open_query_tab`        | Opens query tab with SQL                 | Create and populate a query tab     |

#### Tool Abstraction Layer

Create a `ToolRegistry` in the main process:

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema; // OpenAI-style function calling schema
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
  requiresConfirmation?: boolean; // For destructive operations
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  display?: 'table' | 'text' | 'code'; // How to render in chat
}
```

Destructive tools (`delete_database`, `execute_query` with DDL) require user confirmation before execution. The chat UI shows a confirmation card.

### Chat Persistence

```typescript
interface ChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  connectionId?: string;
  databaseName?: string;
  messages: ChatMessage[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}
```

Storage: SQLite file in app data directory (or JSON files, simpler).

### Chat UI Components

1. **Chat Panel** — Slide-out from right edge (like Copilot in VS Code)
   - Toggle button in status bar or toolbar
   - Keyboard shortcut: `⌘+Shift+I` (AI)
   - Can be docked as a tab in the main area

2. **Message List** — Scrollable conversation
   - User messages (right-aligned, blue bubble)
   - Assistant messages (left-aligned, rendered markdown)
   - Tool call cards (collapsible, show what was executed)
   - Tool results (tables rendered inline, code blocks for SQL)

3. **Input Area** — Bottom of panel
   - Multi-line text input with auto-resize
   - Send button + Enter to send (Shift+Enter for newline)
   - Attachment: drag a table name from sidebar to auto-add context

4. **Conversation Sidebar** — Left column within panel
   - New Chat button
   - List of saved conversations (grouped by date)
   - Search conversations
   - Delete conversation (with confirmation)

5. **Context Indicator** — Shows current connection/database
   - Auto-attaches connection context to messages
   - Schema context included when relevant

### First-Time Experience

When the user first opens the chat panel:

1. If no AI provider is configured → prompt to set up
2. If configured → show a welcome message with example prompts:
   - "List all tables in this database"
   - "Create a table for tracking orders"
   - "Show me the ERD for the Customer table"
   - "What indexes exist on the Orders table?"

---

## 2. Smart Autocomplete (Two-Tier Architecture)

### Design Philosophy

Autocomplete has two distinct layers:

1. **Tier 1: Deterministic / AST-based** — Fast, free, always-on. Uses `@memberjunction/sql-parser` for real scope narrowing.
2. **Tier 2: AI-powered ghost text** — Async overlay for creative suggestions (Copilot-style). Optional, requires API key.

### Tier 1: AST-Powered IntelliSense (No AI Required)

#### Current Problem

The existing `SqlIntellisenseService` uses simple regex matching (`isAfterFrom`, `isAfterDot`) which fails badly:

- `SELECT * FROM __mj.Entity WHERE ` → suggests all tables/keywords instead of Entity columns
- `__mj.` → doesn't scope to tables/views in the `__mj` schema
- Aliases aren't resolved: `SELECT e. FROM __mj.Entity e` → can't suggest Entity columns
- Subqueries, CTEs, JOINs with ON conditions aren't understood

#### Solution: `@memberjunction/sql-parser`

MemberJunction's `SQLParser.Parse()` returns a structured AST with:

- **`Tables[]`**: Every table/view reference with `SchemaName`, `TableName`, `Alias`
- **`Columns[]`**: Every column reference with `ColumnName`, `TableQualifier`
- Works with CTEs, subqueries, UNIONs, JOINs
- TransactSQL dialect support (brackets, schema-qualified names)
- Regex fallback when AST parsing fails (incomplete SQL)

#### Implementation Plan

Replace the regex-based context detection with AST parsing:

```typescript
// On every keystroke (debounced 50ms), parse the current SQL
const parseResult = SQLParser.Parse(currentSql, 'TransactSQL');

// Build scope context from AST
interface QueryScope {
  tables: SQLTableReference[]; // Tables in scope (FROM, JOIN)
  aliasMap: Map<string, TableInfo>; // alias → table metadata
  currentClause: 'SELECT' | 'FROM' | 'WHERE' | 'JOIN' | 'ON' | 'GROUP_BY' | 'ORDER_BY' | null;
  schemaPrefix: string | null; // e.g. "__mj" when user typed "__mj."
  tablePrefix: string | null; // e.g. "e" when user typed "e."
}
```

#### Scope-Narrowed Completions

| User types                         | Current behavior          | AST-powered behavior                                       |
| ---------------------------------- | ------------------------- | ---------------------------------------------------------- |
| `SELECT * FROM __mj.Entity WHERE ` | All keywords + all tables | Only `Entity` columns (resolved via schema + table lookup) |
| `__mj.`                            | Nothing useful            | All tables/views in `__mj` schema                          |
| `SELECT e. FROM __mj.Entity e`     | Nothing                   | Entity columns (alias `e` → `__mj.Entity`)                 |
| `JOIN dbo.Orders o ON o.`          | Nothing                   | Orders columns                                             |
| `WHERE e.Name = 'foo' AND e.`      | Random suggestions        | Entity columns (re-parsed scope)                           |

#### Handling Incomplete SQL

Users are typing — the SQL is often syntactically invalid. Strategy:

1. Try `SQLParser.Parse()` on the full text → if it works, use the AST result
2. If AST fails, parse just the text up to the cursor (often a valid prefix)
3. If that also fails, fall back to enhanced regex (current approach, improved)
4. The parser already has a regex fallback built in (`UsedASTParsing: false`)

#### Schema-Qualified Object Completion

When the user types `schema_name.`:

1. Detect the schema prefix from cursor position
2. Filter cached tables/views by that schema
3. Show only objects in that schema

```typescript
// Detect: user typed "__mj."
if (textBeforeCursor.match(/(\[?\w+\]?)\.\s*$/)) {
  const schema = extractSchemaName(textBeforeCursor);
  // Filter tables cache by schema
  return tables.filter(t => t.schema === schema);
}
```

#### Alias Resolution

The AST gives us `SQLTableReference.Alias`. Build a lookup:

```typescript
// parseResult.Tables = [{ TableName: "Entity", SchemaName: "__mj", Alias: "e" }]
// When user types "e." → look up alias "e" → find __mj.Entity → suggest its columns
const aliasMap = new Map(parseResult.Tables.map(t => [t.Alias, t]));
```

#### Package Integration

`@memberjunction/sql-parser` depends on `node-sql-parser`. Since AST parsing is CPU-bound and we want it fast:

- **Option A**: Run in main process via IPC (simple, adds ~5ms latency)
- **Option B**: Bundle for renderer (parser is ~300KB, runs in browser via WASM) — `node-sql-parser` works in browser
- **Recommended**: Option B for zero-latency, since `node-sql-parser` has browser support

### Tier 2: AI Ghost Text (Copilot-Style)

This is the async, optional layer. Only active when an AI provider is configured.

#### Trigger Conditions

AI suggestions appear when:

1. User has been idle for 500ms+ after typing
2. The cursor is at the end of a line (not mid-edit)
3. The line contains a SQL comment hint, e.g.:
   ```sql
   -- query the latest additions to the __mj.Entity table
   ```
4. OR the user is at a natural completion point (after FROM, WHERE, ORDER BY, etc.)

AI suggestions do NOT appear:

- While the user is actively typing (debounced)
- When deterministic completions from Tier 1 are sufficient
- When no AI provider is configured

#### How It Works

```
User pauses typing (500ms)
    ↓
Build context:
  - Text before/after cursor
  - AST parse result (tables, columns in scope) ← from Tier 1!
  - Current database schema (narrowed to relevant tables)
  - SQL comment hints above cursor
    ↓
Send to fast LLM (Gemini Flash Lite / Groq)
    ↓
Display as ghost text (gray, after cursor)
    ↓
Tab = accept, Esc = dismiss, any keystroke = dismiss
```

#### Context for LLM

The Tier 1 AST parse gives us exactly the context the LLM needs — no need to send the entire schema:

```typescript
interface AIAutocompleteContext {
  textBeforeCursor: string;
  textAfterCursor: string;
  // From AST: only the tables already referenced in the query
  tablesInScope: Array<{ schema: string; name: string; columns: ColumnInfo[] }>;
  database: string;
  // Comment hints (lines starting with --)
  commentHints?: string[];
}
```

This means the LLM prompt is small and focused — we send only 3-5 table schemas, not the entire database.

#### Multi-Line Ghost Text

For comment-driven suggestions, the AI can return multi-line completions:

```sql
-- get top customers by revenue this quarter
SELECT c.Name, SUM(o.Total) AS Revenue   ← ghost text
FROM dbo.Customers c                       ← ghost text
JOIN dbo.Orders o ON c.ID = o.CustomerID   ← ghost text
WHERE o.OrderDate >= DATEADD(q, -1, GETDATE())  ← ghost text
GROUP BY c.Name                            ← ghost text
ORDER BY Revenue DESC                      ← ghost text
```

#### Performance

- Use fastest/cheapest model: Gemini 2.0 Flash Lite or Groq Llama
- Debounce 500ms after last keystroke
- Cancel in-flight requests on new keystrokes (AbortController)
- Max 150 tokens per request
- Cache results keyed by (textBeforeCursor hash + tables in scope)

### Migration Path

1. **Phase 1**: Install `@memberjunction/sql-parser`, integrate AST parsing into IntelliSense
2. **Phase 2**: Add schema-qualified completion and alias resolution
3. **Phase 3**: Add AI ghost text layer on top
4. **Ongoing**: As the MJ team improves the parser, we get better completions for free

---

## 3. Onboarding Experience (AppCues-style)

### Overview

Guided tooltips/popovers that appear on first launch to teach users about non-obvious features.

### Implementation: Tour System

```typescript
interface TourStep {
  id: string;
  target: string; // CSS selector for the element to highlight
  title: string;
  content: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
  action?: 'click' | 'hover'; // What the user should do
  condition?: () => boolean; // Only show if condition is met
}
```

### Tour: "Welcome to Joinery" (first launch)

| Step | Target            | Message                                                                         |
| ---- | ----------------- | ------------------------------------------------------------------------------- |
| 1    | Connection button | **Connect to SQL Server** — Click here to add your first database connection    |
| 2    | Database dropdown | **Select a Database** — Choose which database to explore                        |
| 3    | Explorer tree     | **Object Explorer** — Browse tables, views, procedures. Right-click for options |
| 4    | New Query button  | **Write Queries** — Open a SQL editor with ⌘N. Execute with ⌘↵                  |
| 5    | Sidebar actions   | **ERD Diagrams** — Right-click any table → "Show Relationships" for visual ERD  |
| 6    | AI chat button    | **AI Assistant** — Ask questions about your database in natural language        |
| 7    | Status bar        | **Quick Access** — Docker status, theme toggle, and more                        |

### Tour: "AI Features" (after configuring API key)

| Step | Target         | Message                                                                    |
| ---- | -------------- | -------------------------------------------------------------------------- |
| 1    | Chat panel     | **AI Chat** — Ask the AI to create tables, write queries, or explain data  |
| 2    | Autocomplete   | **Smart Autocomplete** — AI suggests completions as you type SQL           |
| 3    | Analysis panel | **Result Analysis** — Click the sparkle icon to get AI insights on results |

### Persistence

- Store completed tours in localStorage: `joinery:tours:completed`
- Allow re-running tours from Help > "Show Tour"
- Don't show tours on subsequent launches

---

## 4. API Key Setup Flow

### First Launch (Welcome Screen Enhancement)

Add a new section to the Welcome page between Quick Actions and Getting Started:

```
┌─────────────────────────────────────┐
│  ✨ Enable AI Features              │
│                                     │
│  Supercharge your workflow with     │
│  AI-powered autocomplete, chat      │
│  assistant, and query analysis.     │
│                                     │
│  [Set Up AI →]    [Maybe Later]     │
└─────────────────────────────────────┘
```

### AI Setup Dialog

Step-by-step wizard:

1. **Choose Provider** — Cards for each vendor (Google, OpenAI, Anthropic, Groq, Cerebras)
   - Show cost tier, recommended models
   - Link to get API key

2. **Enter API Key** — Secure input field
   - "Validate" button to test the key
   - Success/error indicator
   - Keys stored in macOS Keychain

3. **Choose Default Model** — Dropdown of available models for the selected vendor
   - Show power rank, cost tier, speed
   - Default suggestion: Gemini Flash (fast + cheap for autocomplete)

4. **Done** — Confirmation with feature overview
   - "Try it: open the AI chat and ask something"

### Settings Page

Full AI settings panel:

- Master toggle: Enable/Disable AI
- Per-vendor cards:
  - API key status (configured / not configured)
  - Change / Remove key
  - Enable/disable toggle
  - Priority drag handle
- Per-feature toggles:
  - Auto tab rename (on/off + model selector)
  - Smart autocomplete (on/off + model selector)
  - Result analysis (on/off + model selector)
  - Chat agent (on/off + model selector)

---

## 5. Implementation Plan

### Phase 1: Chat Agent Core (2-3 days)

1. Create `ToolRegistry` with all tool definitions
2. Add `AIChatService` in main process
3. Add chat IPC channels
4. Build chat panel component
5. Implement streaming responses
6. Chat persistence (JSON files)

### Phase 2: Chat UX Polish (1-2 days)

1. Conversation management (new, delete, rename, search)
2. Tool call confirmation cards
3. Inline result rendering (tables, SQL blocks)
4. Context attachment (drag table names)

### Phase 3: Smart Autocomplete (1-2 days)

1. Build autocomplete context builder
2. Integrate with Monaco's inline completion provider
3. Ghost text rendering
4. Request debouncing and cancellation

### Phase 4: Onboarding (1 day)

1. Tour system with highlight overlay
2. Welcome tour steps
3. AI features tour
4. Persistence + Help menu re-trigger

### Phase 5: API Key Setup & Settings (1 day)

1. Welcome page AI setup card
2. AI setup wizard dialog
3. Settings page AI panel
4. First-run detection

---

## 6. Technical Notes

### LLM Tool Calling Format

Use OpenAI-compatible tool calling format (works with Anthropic, Google, Groq, Cerebras too):

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "list_tables",
        "description": "List all tables in the current database",
        "parameters": {
          "type": "object",
          "properties": {
            "database": { "type": "string", "description": "Database name" },
            "schema": { "type": "string", "description": "Schema filter" }
          },
          "required": ["database"]
        }
      }
    }
  ]
}
```

### Service Abstraction

The existing `AIService` uses raw `fetch` for each provider. For tool calling, we need provider-specific handling:

- **OpenAI/Groq/Cerebras**: Native `tool_choice` parameter
- **Anthropic**: `tools` array in request
- **Google**: `functionDeclarations` in tools config

Add a `chatWithTools()` method to each provider that handles tool call parsing.

### Security

- All LLM calls happen in main process (never expose API keys to renderer)
- Destructive tool calls require user confirmation
- Rate limiting: max 10 requests/minute per provider
- Tool calls logged for audit trail

### Default Model Recommendation

- **Autocomplete**: Gemini 2.0 Flash Lite or Groq Llama 3.3 (fast, cheap)
- **Chat Agent**: Gemini 2.0 Flash or Claude Haiku (balanced)
- **Analysis**: Claude Sonnet or GPT-4o (higher quality)
