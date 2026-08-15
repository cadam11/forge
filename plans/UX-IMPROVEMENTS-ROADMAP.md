# Joinery: World-Class UX & Feature Improvements Roadmap

## Executive Summary

This document outlines prioritized improvements to transform Joinery from a solid v1.0 MVP into an indispensable tool that Mac developers will love.

> **Note (April 2025):** This roadmap was written when Joinery was SQL Server-only. Joinery now supports **PostgreSQL** and **MySQL** as well. SQL Server-specific references below reflect the original v1.0 scope.

### Current State (v1.0 MVP - Complete)

| Feature               | Status       | Quality                                   |
| --------------------- | ------------ | ----------------------------------------- |
| Connection Management | ✅ Complete  | Excellent - Keychain integration, pooling |
| Query Editor          | ✅ Complete  | Great - Monaco, F5, history, export       |
| Object Explorer       | ✅ Complete  | Solid - Lazy load, context menus          |
| Results Grid          | ✅ Complete  | Good - ag-grid, multiple result sets      |
| Backup/Restore        | ✅ Complete  | Excellent - Progress streaming, wizards   |
| Docker Integration    | ✅ Complete  | Great - Auto-detection, volume mapping    |
| Table Properties      | ✅ Complete  | Comprehensive - All metadata types        |
| Theming               | ✅ CSS Ready | Dark applied, light defined but no toggle |

---

## Tier 1: Quick Wins (1-2 days each)

These leverage existing infrastructure for maximum impact with minimal effort.

### 1.1 Theme Toggle (Hours)

**Status:** CSS is already perfect. Just need the UI toggle.

**Implementation:**

```typescript
// Add to settings-panel.component.ts or status-bar.component.ts
toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  this.settingsService.set('theme', next);
}
```

**UI:** Add 🌙/☀️ toggle to status bar or settings menu.

---

### 1.2 SQL Formatting (Hours)

**Status:** Button exists at line 119 in query.component.ts. Just wire it up.

**Dependencies:**

```bash
npm install sql-formatter
```

**Implementation:**

```typescript
import { format } from 'sql-formatter';

formatSql(): void {
  if (!this.editor) return;
  const sql = this.editor.getValue();
  const formatted = format(sql, { language: 'tsql' });
  this.editor.setValue(formatted);
  this.notification.success('SQL formatted');
}
```

---

### 1.3 Actual Query Cancellation (Hours)

**Status:** QueryExecutor has structure but doesn't actually cancel running queries.

**Implementation:**

```typescript
// In packages/main/src/services/sql/query-executor.ts
private activeRequests = new Map<string, mssql.Request>();

async execute(options: QueryOptions): Promise<QueryResult> {
  const request = pool.request();
  this.activeRequests.set(options.queryId, request);

  try {
    const result = await request.query(options.sql);
    // ... existing logic
  } finally {
    this.activeRequests.delete(options.queryId);
  }
}

cancel(queryId: string): boolean {
  const request = this.activeRequests.get(queryId);
  if (request) {
    request.cancel();
    this.activeRequests.delete(queryId);
    return true;
  }
  return false;
}
```

---

### 1.4 State Persistence (Half Day)

**Status:** App state not saved across restarts. Critical for UX.

**Implementation:**

```typescript
// Add to main process - packages/main/src/services/config/app-state.ts
interface AppState {
  windowBounds: { x: number; y: number; width: number; height: number };
  lastConnectionId: string | null;
  lastDatabase: string | null;
  editorHeight: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  recentQueries: string[]; // Last 10
  openTabs: TabState[];
}

// Save on window close via 'before-quit' event
// Restore on startup in window.ts
```

**What to persist:**

- Window size and position
- Last active connection
- Last selected database
- Editor/results pane split ratio
- Sidebar width
- Open query tabs with content

---

### 1.5 Enhanced Docker Container Management (Half Day)

**Status:** Basic Docker detection exists. Need better UX for container lifecycle.

**Current State:**

- ✅ Docker container detection works
- ✅ Volume mapping extraction works
- ✅ Basic start/stop IPC handlers exist
- ❌ No clear UI indicator when container is stopped
- ❌ No easy way to start container from connection failure
- ❌ No container status in connection list

**Enhanced UX:**

**1. Connection List - Show Container Status**

```
┌─────────────────────────────────────────────────────────┐
│ Connections                                              │
├─────────────────────────────────────────────────────────┤
│  ● Production SQL          Connected                    │
│  ● local-docker     🐳     Connected                    │
│  ○ test-docker      🐳⏸️   Container Stopped  [▶ Start] │
│  ○ staging                 Not connected                │
└─────────────────────────────────────────────────────────┘
```

**2. Connection Failure - Offer to Start Container**

```
┌─────────────────────────────────────────────────────────┐
│ ⚠️ Connection Failed                                    │
├─────────────────────────────────────────────────────────┤
│ Could not connect to "local-docker"                     │
│                                                         │
│ 🐳 Docker container "mssql-dev" is not running.        │
│                                                         │
│ [Start Container]  [Open Docker Desktop]  [Cancel]      │
└─────────────────────────────────────────────────────────┘
```

**3. Welcome Screen - Docker Section Enhanced**

```
┌─────────────────────────────────────────────────────────┐
│ 🐳 SQL Server Containers                                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  mssql-dev       2022   :1433   ● Running    [Stop]     │
│  mssql-test      2019   :1434   ○ Stopped    [Start]    │
│                                                         │
│  [+ Create New Container]                               │
└─────────────────────────────────────────────────────────┘
```

**4. Status Bar - Docker Indicator**

```
┌─────────────────────────────────────────────────────────┐
│ ● local-docker │ OrdersDB │ 🐳 mssql-dev (running)      │
└─────────────────────────────────────────────────────────┘
```

**5. Auto-Detection & Notifications**

- Poll container status every 30 seconds when connected to Docker
- Show notification if container stops unexpectedly
- Offer to restart with one click

**Implementation:**

```typescript
// Enhanced Docker status in connection state
interface ConnectionWithDocker extends ConnectionProfile {
  dockerStatus?: 'running' | 'stopped' | 'not-found' | 'error';
  dockerContainerName?: string;
}

// Add to sidebar.component.ts
async checkDockerStatus(profile: ConnectionProfile): Promise<void> {
  if (profile.isDocker && profile.dockerContainerId) {
    const status = await this.ipc.getDockerContainerStatus(profile.dockerContainerId);
    this.connectionState.updateDockerStatus(profile.id, status);
  }
}

// Add IPC handler in docker.ipc.ts
ipcMain.handle(IPC.DOCKER.GET_STATUS, async (_, containerId: string) => {
  const docker = DockerDetector.getInstance();
  const container = await docker.getContainer(containerId);
  const info = await container.inspect();
  return info.State.Running ? 'running' : 'stopped';
});

// Add start container with connection retry
async startContainerAndConnect(profile: ConnectionProfile): Promise<void> {
  const spinner = this.notification.loading('Starting container...');
  await this.ipc.startDockerContainer(profile.dockerContainerId);

  // Wait for SQL Server to be ready (can take 10-30 seconds)
  spinner.message = 'Waiting for SQL Server...';
  await this.waitForSqlReady(profile, { maxAttempts: 30, delayMs: 1000 });

  spinner.success('Container started');
  await this.connect(profile);
}
```

**UI Components to Modify:**

- `sidebar.component.ts` - Add container status indicator and start/stop buttons
- `welcome.component.ts` - Enhance Docker containers section
- `status-bar.component.ts` - Add Docker indicator
- `connections.component.ts` - Add Docker status to connection form

---

## Tier 2: High-Impact Features (1-2 weeks each)

### 2.1 ⌘K Command Palette

**Impact:** 🔥🔥🔥🔥🔥 - The single most impactful UX feature for power users.

**Design:**

```
┌─────────────────────────────────────────────────────────┐
│ ⌘K                                                      │
├─────────────────────────────────────────────────────────┤
│  > backup                                               │
├─────────────────────────────────────────────────────────┤
│  🗄️ Backup Database...              Backup current DB   │
│  📋 Backup history                  View past backups   │
│  ─────────────────────────────────────────────────────  │
│  Recent                                                 │
│  🔌 Connect to Production                               │
│  📊 SELECT * FROM Users             2 min ago           │
└─────────────────────────────────────────────────────────┘
```

**Implementation Approach:**

1. Create `CommandPaletteComponent` as modal overlay
2. Register commands from all features via `CommandRegistry` service
3. Fuzzy search with fuse.js library
4. Recent items weighted from query history
5. Keyboard navigation (↑↓ Enter Esc)

**Commands to Register:**

- All menu actions (New Query, Backup, Restore, etc.)
- Recent connections (Connect to X)
- Recent queries (with preview)
- Object search (table/view/proc names)
- Database switch (Use database X)
- Theme toggle
- Settings
- Keyboard shortcuts help

**Files to Create:**

- `packages/renderer/src/app/shared/components/command-palette/command-palette.component.ts`
- `packages/renderer/src/app/core/services/command-registry.service.ts`

---

### 2.2 Instant Object Search

**Impact:** 🔥🔥🔥🔥 - Finding objects in large databases is painful. Make it instant.

**Design:**

```
┌──────────────────────────────────────────────────────┐
│ 🔍 Find object...                         ⌘⇧O        │
├──────────────────────────────────────────────────────┤
│  usr                                                 │
├──────────────────────────────────────────────────────┤
│  📋 dbo.Users                     Table   OrdersDB   │
│  📋 dbo.UserRoles                 Table   OrdersDB   │
│  🔧 dbo.sp_GetUserById            Proc    OrdersDB   │
│  📋 auth.UserSessions             Table   AuthDB     │
└──────────────────────────────────────────────────────┘
```

**Implementation:**

1. Index all objects from MetadataService cache after connection
2. Background indexing triggered on database change
3. Fuse.js for fuzzy matching with configurable threshold
4. Reuse object type icons from tree-view component
5. Click result → navigate to object in explorer + open properties tab

**Performance Target:** Sub-50ms search across 10,000+ objects

---

### 2.3 Intelligent Error Messages

**Impact:** 🔥🔥🔥🔥 - SQL errors are cryptic. Help developers fix them.

**Design:**

```
┌─────────────────────────────────────────────────────────────┐
│ ❌ Conversion Error                                         │
├─────────────────────────────────────────────────────────────┤
│ Error converting data type varchar to int                   │
│                                                             │
│ 📍 Location: Line 3, Column "CustomerAge"                   │
│                                                             │
│ 💡 This usually happens when:                               │
│    • Column contains non-numeric text like "N/A" or ""      │
│    • There are NULL values being converted                  │
│                                                             │
│ 🔧 Quick Fixes:                                             │
│    ┌─────────────────────────────────────────────────────┐  │
│    │ TRY_CAST(CustomerAge AS INT)                        │  │
│    │ -- Returns NULL instead of error for bad values     │  │
│    └─────────────────────────────────────────────────────┘  │
│    [Apply Fix]  [Show Bad Data]  [Learn More]               │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**

1. Create error code → explanation mapping for top 50 SQL Server errors
2. Parse error message to extract context (line number, column name, object name)
3. Generate suggested fixes with one-click apply to editor
4. "Show Bad Data" generates diagnostic query
5. "Learn More" links to Microsoft docs

**Error Codes to Map First:**

- 208: Invalid object name
- 207: Invalid column name
- 245: Conversion failed
- 515: Cannot insert NULL
- 547: Constraint violation
- 1205: Deadlock victim
- 2627: Duplicate key
- 4060: Cannot open database
- 18456: Login failed

---

### 2.4 Monaco IntelliSense

**Impact:** 🔥🔥🔥🔥🔥 - Table/column autocomplete is expected in modern tools.

**Implementation:**

```typescript
// In query.component.ts after Monaco initialization
monaco.languages.registerCompletionItemProvider('sql', {
  triggerCharacters: ['.', ' ', '['],
  provideCompletionItems: async (model, position) => {
    const tables = await this.metadataService.getTablesForDatabase(this.selectedDatabase);
    const word = model.getWordUntilPosition(position);

    // Context-aware: after FROM/JOIN suggest tables, after table. suggest columns
    const lineContent = model.getLineContent(position.lineNumber);
    const isAfterTable = this.detectTableContext(lineContent, position);

    if (isAfterTable) {
      const columns = await this.metadataService.getColumnsForTable(tableName);
      return {
        suggestions: columns.map(c => ({
          label: c.name,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: `[${c.name}]`,
          detail: `${c.dataType}${c.isNullable ? '' : ' NOT NULL'}`,
          documentation: c.description || undefined,
        })),
      };
    }

    return {
      suggestions: [
        ...tables.map(t => ({
          label: t.name,
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: `[${t.schema}].[${t.name}]`,
          detail: `Table (${t.rowCount?.toLocaleString() || '?'} rows)`,
        })),
        ...SQL_KEYWORDS.map(kw => ({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
        })),
      ],
    };
  },
});
```

**Features:**

- Table name completion after FROM, JOIN, UPDATE, INSERT INTO
- Column name completion after table alias or table name with dot
- SQL keyword completion
- Stored procedure completion after EXEC
- Schema-aware (shows schema prefix)
- Row count hints for tables

---

### 2.5 Workspace / Folder Support (VS Code-style)

**Impact:** 🔥🔥🔥🔥🔥 - Essential for developers with SQL script projects.

**Concept:** Like VS Code's "Open Folder", allow users to open a directory and work with multiple .sql files as a project.

**Design:**

```
┌─────────────────────────────────────────────────────────────┐
│ Joinery - ~/Projects/ecommerce-db                    ─ □ x │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────┬─────────────────────────────────────────┤
│ │ EXPLORER        │ migrations/002-add-indexes.sql          │
│ │ ─────────────── │ ─────────────────────────────────────── │
│ │ 📁 ecommerce-db │ CREATE INDEX IX_Orders_CustomerID       │
│ │  ├─📁 migrations│ ON Orders(CustomerID)                   │
│ │  │ ├─📄 001-init│ INCLUDE (OrderDate, TotalAmount);       │
│ │  │ ├─📄 002-idx │                                         │
│ │  │ └─📄 003-fks │ CREATE INDEX IX_Orders_Date             │
│ │  ├─📁 queries   │ ON Orders(OrderDate DESC);              │
│ │  │ ├─📄 reports │                                         │
│ │  │ └─📄 cleanup │                                         │
│ │  ├─📁 procedures│                                         │
│ │  └─📄 README.md │                                         │
│ │                 │                                         │
│ │ ─────────────── │─────────────────────────────────────────│
│ │ DB EXPLORER     │ Results                                 │
│ │ 📊 Production   │ (execute to see results)                │
│ │  └─📁 Tables    │                                         │
│ └─────────────────┴─────────────────────────────────────────┘
```

**Core Features:**

1. **Open Folder (⌘O)**
   - Open any directory as workspace
   - Show .sql files in file explorer panel
   - Nested folder support
   - File icons by type (.sql, .md, .json)

2. **File Explorer Panel**
   - Tree view of folder contents
   - Filter to show only .sql files (optional)
   - Create new file/folder
   - Rename/delete files
   - Drag to reorder (optional)

3. **File Operations**
   - New File (⌘N) → creates .sql in workspace
   - Save (⌘S) → saves to file
   - Save As (⌘⇧S) → save with new name
   - Rename (Enter on selected file)
   - Delete (⌘⌫ with confirmation)
   - Duplicate file

4. **Tab Integration**
   - Tab shows filename instead of "Query 1"
   - Dirty indicator (●) for unsaved changes
   - Click file in explorer → opens in tab
   - Close tab prompts to save if dirty

5. **Workspace Settings (.joinery/settings.json)**

   ```json
   {
     "defaultConnection": "production-server",
     "defaultDatabase": "OrdersDB",
     "executeOnOpen": false,
     "formatting": {
       "keywordCase": "upper",
       "indentSize": 2
     }
   }
   ```

6. **Recent Workspaces**
   - File menu → Recent Workspaces
   - Welcome screen shows recent workspaces
   - Quick switch via command palette

**Implementation:**

**IPC Channels to Add:**

```typescript
// packages/shared/src/constants/ipc-channels.ts
WORKSPACE: {
  OPEN_FOLDER: 'workspace:open-folder',
  GET_FILES: 'workspace:get-files',
  READ_FILE: 'workspace:read-file',
  WRITE_FILE: 'workspace:write-file',
  CREATE_FILE: 'workspace:create-file',
  DELETE_FILE: 'workspace:delete-file',
  RENAME_FILE: 'workspace:rename-file',
  WATCH: 'workspace:watch',           // File system watcher
  UNWATCH: 'workspace:unwatch',
  FILE_CHANGED: 'workspace:file-changed', // Event from watcher
}
```

**Main Process Service:**

```typescript
// packages/main/src/services/workspace/workspace-manager.ts
class WorkspaceManager {
  private currentWorkspace: string | null = null;
  private watcher: FSWatcher | null = null;

  async openFolder(path: string): Promise<WorkspaceInfo> {
    this.currentWorkspace = path;
    const files = await this.scanDirectory(path);
    this.startWatching(path);
    return { path, files, settings: await this.loadSettings(path) };
  }

  async getFiles(path: string): Promise<FileTreeNode[]> {
    // Recursively scan directory
    // Filter by extension (.sql, .md, etc.)
    // Return tree structure
  }

  async readFile(filePath: string): Promise<string> {
    return fs.promises.readFile(filePath, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.promises.writeFile(filePath, content, 'utf-8');
  }

  private startWatching(path: string): void {
    this.watcher = chokidar.watch(path, {
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
      persistent: true,
    });
    this.watcher.on('change', filePath => {
      mainWindow?.webContents.send(IPC.WORKSPACE.FILE_CHANGED, { filePath, event: 'change' });
    });
  }
}
```

**Renderer State:**

```typescript
// packages/renderer/src/app/core/state/workspace.state.ts
@Injectable({ providedIn: 'root' })
export class WorkspaceStateService {
  private _currentWorkspace = signal<WorkspaceInfo | null>(null);
  private _files = signal<FileTreeNode[]>([]);
  private _openFiles = signal<Map<string, OpenFile>>(new Map());

  readonly currentWorkspace = this._currentWorkspace.asReadonly();
  readonly files = this._files.asReadonly();
  readonly hasWorkspace = computed(() => this._currentWorkspace() !== null);

  async openFolder(): Promise<void> {
    const result = await this.ipc.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (result.filePaths[0]) {
      const workspace = await this.ipc.openWorkspace(result.filePaths[0]);
      this._currentWorkspace.set(workspace);
      this._files.set(workspace.files);
    }
  }

  async saveFile(filePath: string, content: string): Promise<void> {
    await this.ipc.writeFile(filePath, content);
    // Update open file state to mark as clean
  }
}
```

**UI Components to Create:**

- `packages/renderer/src/app/shared/components/file-explorer/file-explorer.component.ts`
- `packages/renderer/src/app/shared/components/file-explorer/file-tree-node.component.ts`

**Sidebar Modification:**

```typescript
// Sidebar gets a toggle between "DB Explorer" and "File Explorer"
// Or split panel showing both
┌─────────────────┐
│ [📁 Files] [📊 DB] │  ← Toggle buttons
├─────────────────┤
│ File tree or    │
│ DB explorer     │
│ based on toggle │
└─────────────────┘
```

**Menu Additions:**

```
File
├── New File                 ⌘N
├── New Query (in memory)    ⌘⇧N
├── Open File...             ⌘O
├── Open Folder...           ⌘⇧O
├── ──────────────
├── Save                     ⌘S
├── Save As...               ⌘⇧S
├── Save All                 ⌘⌥S
├── ──────────────
├── Recent Files             →
├── Recent Workspaces        →
├── ──────────────
├── Close File               ⌘W
├── Close Folder
└── ──────────────
```

**Use Cases This Enables:**

1. **Migration Scripts Project**

   ```
   migrations/
   ├── 001-initial-schema.sql
   ├── 002-add-indexes.sql
   ├── 003-add-foreign-keys.sql
   └── rollback/
       ├── 001-rollback.sql
       └── 002-rollback.sql
   ```

2. **Stored Procedures Development**

   ```
   procedures/
   ├── customers/
   │   ├── sp_GetCustomer.sql
   │   └── sp_UpdateCustomer.sql
   └── orders/
       ├── sp_CreateOrder.sql
       └── sp_GetOrderHistory.sql
   ```

3. **Report Queries**

   ```
   reports/
   ├── daily-sales.sql
   ├── monthly-revenue.sql
   └── customer-analytics.sql
   ```

4. **Team Shared Queries**
   ```
   team-queries/              ← Git repository
   ├── .joinery/
   │   └── settings.json     ← Shared connection config
   ├── troubleshooting/
   │   ├── find-blocking.sql
   │   └── check-indexes.sql
   └── maintenance/
       ├── cleanup-logs.sql
       └── rebuild-indexes.sql
   ```

**Git Integration (Future Enhancement):**

- Show git status indicators on files (modified, added, etc.)
- Commit changes from within app
- Diff view for changed files

---

### 2.6 Joinery CLI (`joinery`)

**Impact:** 🔥🔥🔥🔥🔥 - Essential for automation, CI/CD, and terminal-first developers.

**Philosophy:** This is NOT another sqlcmd. It's a **higher-order CLI** that leverages Joinery's unique capabilities:

- Named connections (no connection strings to remember)
- Keychain integration (no passwords in scripts or env vars)
- Docker path intelligence (automatic volume mapping)
- Workspace awareness (run queries from project folders)

**Installation:**

```bash
# Installed alongside Joinery.app, symlinked to /usr/local/bin
$ joinery --version
Joinery CLI v1.0.0

# Or via npm for CI environments
$ npm install -g @joinery/cli
```

---

**Core Commands:**

**1. Connection Management**

```bash
# List all saved connections
$ joinery connections
  NAME              HOST                    STATUS
  production        sql.company.com:1433    ● Connected
  staging           staging-sql:1433        ○ Disconnected
  local-docker      localhost:1433          ● Connected (Docker)

# Test a connection
$ joinery test production
✓ Connected to production (sql.company.com:1433)
  SQL Server 2022 | 12 databases | Latency: 45ms

# Add a new connection (interactive, password goes to Keychain)
$ joinery connections add
  Connection name: new-server
  Host: sql.newserver.com
  Port [1433]:
  Username: sa
  Password: ••••••••
  ✓ Connection saved and tested successfully

# Connect (establishes pool for subsequent commands)
$ joinery connect production
✓ Connected to production
```

**2. Database Operations**

```bash
# List databases
$ joinery databases --connection production
  NAME              SIZE        STATE     LAST BACKUP
  OrdersDB          2.4 GB      Online    2 hours ago
  CustomersDB       890 MB      Online    2 hours ago
  Analytics         12.1 GB     Online    1 day ago

# Use a specific database for subsequent commands
$ joinery use OrdersDB --connection production
✓ Now using OrdersDB on production
```

**3. Backup (The Killer Feature)**

```bash
# Simple backup - uses intelligent defaults
$ joinery backup OrdersDB --connection production
✓ Backing up OrdersDB...
  Progress: [████████████████████] 100%
  Completed in 2m 34s
  Output: /var/opt/mssql/backup/OrdersDB_20250124_143022.bak (2.1 GB)

# Backup with options
$ joinery backup OrdersDB \
  --connection production \
  --output ~/backups/orders.bak \
  --compression \
  --copy-only \
  --verify
✓ Backup completed and verified

# Backup to local path (Docker-aware - auto maps volumes!)
$ joinery backup OrdersDB --connection local-docker --output ~/backups/orders.bak
  ℹ Docker detected: Mapping ~/backups → /var/opt/mssql/backups
✓ Backup saved to ~/backups/orders.bak

# Differential backup
$ joinery backup OrdersDB --connection production --differential

# Transaction log backup
$ joinery backup OrdersDB --connection production --log
```

**4. Restore**

```bash
# Restore with same name
$ joinery restore ~/backups/orders.bak --connection local-docker
✓ Restoring to OrdersDB...
  Progress: [████████████████████] 100%
  Completed in 1m 45s

# Restore with different name
$ joinery restore ~/backups/orders.bak \
  --connection local-docker \
  --database OrdersDB_Test \
  --replace
✓ Restored as OrdersDB_Test

# Restore with file relocation (for different paths)
$ joinery restore ~/backups/orders.bak \
  --connection staging \
  --relocate-data /var/opt/mssql/data/ \
  --relocate-log /var/opt/mssql/log/

# Preview restore (show what would happen)
$ joinery restore ~/backups/orders.bak --connection staging --dry-run
  Would restore:
    Database: OrdersDB
    Data file: OrdersDB.mdf → /var/opt/mssql/data/OrdersDB.mdf
    Log file:  OrdersDB_log.ldf → /var/opt/mssql/log/OrdersDB_log.ldf
  Use --replace to overwrite existing database
```

**5. Query Execution**

```bash
# Run inline query
$ joinery query "SELECT COUNT(*) FROM Users" --connection production --database OrdersDB
  COUNT
  ─────
  15234

# Run query from file
$ joinery run ./queries/daily-report.sql --connection production
  [Results displayed in table format]

# Run query from workspace with workspace connection
$ cd ~/projects/ecommerce-db
$ joinery run migrations/002-add-indexes.sql
  ℹ Using workspace connection: production (from .joinery/settings.json)
  ✓ Query executed successfully (2 statements, 0 rows affected)

# Output formats
$ joinery query "SELECT * FROM Users LIMIT 10" -c production -d OrdersDB --format json
$ joinery query "SELECT * FROM Users LIMIT 10" -c production -d OrdersDB --format csv
$ joinery query "SELECT * FROM Users LIMIT 10" -c production -d OrdersDB --format table

# Save results to file
$ joinery query "SELECT * FROM Users" -c production -d OrdersDB -o users.csv --format csv
```

**6. Status & Monitoring**

```bash
# Connection pool status
$ joinery status
  PRODUCTION (sql.company.com)
    Pool: 3/10 active connections
    Uptime: 4h 23m
    Queries today: 847

  LOCAL-DOCKER (localhost:1433)
    Pool: 1/10 active connections
    Container: mssql-dev (running)
    Uptime: 2d 5h

# Database status
$ joinery status OrdersDB --connection production
  Database: OrdersDB
  State: Online
  Size: 2.4 GB (Data: 2.1 GB, Log: 300 MB)
  Recovery Model: Full
  Last Full Backup: 2 hours ago
  Last Log Backup: 15 minutes ago
  Active Connections: 12
```

**7. Docker Integration**

```bash
# List SQL Server containers
$ joinery docker list
  NAME          IMAGE                    STATUS     PORT
  mssql-dev     mssql/server:2022        Running    1433
  mssql-test    mssql/server:2019        Stopped    1434

# Start/stop containers
$ joinery docker start mssql-test
$ joinery docker stop mssql-dev

# Create new container (uses same wizard defaults as GUI)
$ joinery docker create \
  --name dev-sql \
  --version 2022 \
  --port 1433 \
  --password "SecurePass123!" \
  --persist ~/Docker/sqlserver
✓ Container created and started
✓ Connection profile 'dev-sql' added
```

**8. Scripting & Export**

```bash
# Script table as CREATE
$ joinery script Users --connection production --database OrdersDB
  CREATE TABLE [dbo].[Users] (
    [UserID] INT IDENTITY(1,1) NOT NULL,
    [Email] NVARCHAR(255) NOT NULL,
    ...
  )

# Script entire database schema
$ joinery script --all --connection production --database OrdersDB > schema.sql

# Export table data
$ joinery export Users --connection production --database OrdersDB --format csv > users.csv
$ joinery export Users --connection production --database OrdersDB --format sql > users-inserts.sql
```

---

**CLI Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                     joinery CLI                                │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Command Parser (commander.js / yargs)              │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Shared Services (reused from main process)         │    │
│  │  • ConnectionPoolManager                            │    │
│  │  • CredentialStore (Keychain)                       │    │
│  │  • BackupRestoreService                             │    │
│  │  • DockerDetector                                   │    │
│  │  • VolumeMapper                                     │    │
│  │  • TsqlBuilder                                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Config Store                                        │    │
│  │  • Same connection profiles as GUI                  │    │
│  │  • ~/.joinery/config.json                           │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**Key Design Decisions:**

1. **Shared Codebase with GUI**
   - CLI imports same services from `@joinery/main`
   - Connection profiles stored in same location
   - Keychain passwords shared between GUI and CLI
   - No duplication of SQL logic

2. **No Passwords in Commands**

   ```bash
   # ❌ Bad (like sqlcmd)
   $ sqlcmd -S server -U user -P password -Q "..."

   # ✅ Good (Joinery way)
   $ joinery query "..." --connection production
   # Password retrieved from Keychain automatically
   ```

3. **Workspace Awareness**

   ```bash
   $ cd ~/projects/mydb
   $ cat .joinery/settings.json
   { "defaultConnection": "production", "defaultDatabase": "MyDB" }

   $ joinery query "SELECT 1"  # Uses production.MyDB automatically
   ```

4. **Docker Intelligence Built-in**
   - Auto-detects when connection is to Docker container
   - Automatically maps local paths to container paths
   - No manual volume mapping needed

5. **Human-Friendly Output by Default**

   ```bash
   $ joinery databases -c production
   # Pretty table output for humans

   $ joinery databases -c production --json
   # JSON output for scripting
   ```

---

**Implementation:**

**Package Structure:**

```
packages/
├── cli/                          # NEW PACKAGE
│   ├── package.json
│   ├── src/
│   │   ├── index.ts              # Entry point
│   │   ├── commands/
│   │   │   ├── backup.ts
│   │   │   ├── restore.ts
│   │   │   ├── query.ts
│   │   │   ├── connections.ts
│   │   │   ├── databases.ts
│   │   │   ├── docker.ts
│   │   │   ├── status.ts
│   │   │   └── script.ts
│   │   ├── utils/
│   │   │   ├── output.ts         # Table/JSON/CSV formatters
│   │   │   ├── progress.ts       # Progress bars
│   │   │   └── prompts.ts        # Interactive prompts
│   │   └── config.ts             # Config file handling
│   └── bin/
│       └── joinery                 # Executable entry
├── main/                         # Existing - services reused
├── shared/                       # Existing - types reused
```

**Dependencies:**

```json
{
  "dependencies": {
    "@joinery/main": "workspace:*",
    "@joinery/shared": "workspace:*",
    "commander": "^12.0.0",
    "chalk": "^5.0.0",
    "ora": "^8.0.0",
    "cli-table3": "^0.6.0",
    "inquirer": "^9.0.0"
  },
  "bin": {
    "joinery": "./bin/joinery"
  }
}
```

**Example Command Implementation:**

```typescript
// packages/cli/src/commands/backup.ts
import { Command } from 'commander';
import ora from 'ora';
import { ConnectionPoolManager } from '@joinery/main/services/sql/connection-pool';
import { BackupRestoreService } from '@joinery/main/services/sql/backup-restore';
import { CredentialStore } from '@joinery/main/services/keychain/credential-store';
import { VolumeMapper } from '@joinery/main/services/docker/volume-mapper';

export const backupCommand = new Command('backup')
  .description('Backup a database')
  .argument('<database>', 'Database name to backup')
  .option('-c, --connection <name>', 'Connection profile name')
  .option('-o, --output <path>', 'Output file path')
  .option('--compression', 'Enable backup compression')
  .option('--copy-only', 'Create copy-only backup')
  .option('--differential', 'Create differential backup')
  .option('--log', 'Backup transaction log')
  .option('--verify', 'Verify backup after completion')
  .action(async (database, options) => {
    const spinner = ora('Preparing backup...').start();

    try {
      // Get connection profile
      const profile = await getConnectionProfile(options.connection);

      // Get password from Keychain
      const password = await CredentialStore.getInstance().getPassword(profile.id);

      // Handle Docker path mapping
      let outputPath = options.output;
      if (profile.isDocker && outputPath) {
        const mapper = VolumeMapper.getInstance();
        outputPath = await mapper.mapToContainerPath(outputPath, profile.dockerContainerId!);
        spinner.info(`Docker detected: Mapping to ${outputPath}`);
      }

      // Get connection pool
      const pool = await ConnectionPoolManager.getInstance().getPool(profile, password);

      // Execute backup with progress
      const backupService = BackupRestoreService.getInstance();

      spinner.text = 'Backing up...';

      await backupService.backup({
        pool,
        database,
        outputPath,
        compression: options.compression,
        copyOnly: options.copyOnly,
        type: options.log ? 'log' : options.differential ? 'differential' : 'full',
        onProgress: percent => {
          spinner.text = `Backing up... ${percent}%`;
        },
      });

      spinner.succeed(`Backup completed: ${outputPath}`);

      if (options.verify) {
        spinner.start('Verifying backup...');
        await backupService.verify(pool, outputPath);
        spinner.succeed('Backup verified');
      }
    } catch (error) {
      spinner.fail(`Backup failed: ${error.message}`);
      process.exit(1);
    }
  });
```

---

**CI/CD Integration Examples:**

**GitHub Actions:**

```yaml
name: Database Backup
on:
  schedule:
    - cron: '0 2 * * *' # Daily at 2 AM

jobs:
  backup:
    runs-on: macos-latest
    steps:
      - name: Install Joinery CLI
        run: npm install -g @joinery/cli

      - name: Import connection (uses GitHub secrets for one-time setup)
        run: |
          joinery connections add \
            --name production \
            --host ${{ secrets.DB_HOST }} \
            --user ${{ secrets.DB_USER }} \
            --password ${{ secrets.DB_PASSWORD }}

      - name: Backup database
        run: |
          joinery backup OrdersDB \
            --connection production \
            --output ./backups/orders-$(date +%Y%m%d).bak \
            --compression \
            --verify

      - name: Upload backup artifact
        uses: actions/upload-artifact@v3
        with:
          name: database-backup
          path: ./backups/*.bak
```

**Local Automation Script:**

```bash
#!/bin/bash
# backup-all.sh - Backup all production databases

BACKUP_DIR=~/backups/$(date +%Y-%m-%d)
mkdir -p $BACKUP_DIR

for db in OrdersDB CustomersDB Analytics; do
  echo "Backing up $db..."
  joinery backup $db \
    --connection production \
    --output "$BACKUP_DIR/${db}.bak" \
    --compression \
    --verify
done

# Cleanup old backups (keep 7 days)
find ~/backups -type d -mtime +7 -exec rm -rf {} +

echo "All backups complete!"
```

**Restore to Dev Environment:**

```bash
#!/bin/bash
# refresh-dev.sh - Restore latest production backup to dev

LATEST=$(ls -t ~/backups/*/OrdersDB.bak | head -1)

echo "Restoring $LATEST to dev environment..."
joinery restore "$LATEST" \
  --connection local-docker \
  --database OrdersDB_Dev \
  --replace

echo "Dev database refreshed!"
```

---

**Why This Is Different from sqlcmd:**

| Feature           | sqlcmd                     | joinery CLI                |
| ----------------- | -------------------------- | -------------------------- |
| Connection        | Inline credentials         | Named profiles + Keychain  |
| Passwords         | Visible in command/scripts | Secure in Keychain         |
| Docker support    | Manual path mapping        | Automatic volume detection |
| Backup/Restore    | Raw T-SQL                  | One command with progress  |
| Output formatting | Basic                      | Tables, JSON, CSV          |
| Workspace context | None                       | .joinery/settings.json     |
| Learning curve    | High                       | Low                        |

**The key insight:** `joinery` is for **operations**, not raw SQL. It's what you use when you want to backup a database, not when you want to run arbitrary queries (though it can do that too).

---

## Tier 3: Differentiating Features (2-4 weeks each)

### 3.1 Visual Execution Plan

**Impact:** 🔥🔥🔥 - Essential for query optimization.

**Design:**

```
┌─────────────────────────────────────────────────────────────┐
│ Execution Plan                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐      ┌─────────────┐      ┌──────────┐        │
│  │ SELECT  │──────│ Hash Match  │──────│ Table    │        │
│  │  100%   │      │ Inner Join  │      │ Scan     │        │
│  │         │      │    45%      │      │ Orders   │        │
│  └─────────┘      └─────────────┘      │   55%    │        │
│                          │             └──────────┘        │
│                   ┌──────┴──────┐                          │
│                   │ Index Seek  │                          │
│                   │ Customers   │                          │
│                   │    <1%      │                          │
│                   └─────────────┘                          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ ⚠️ Warning: Table Scan on Orders (500K rows)               │
│ 💡 Consider adding index on OrderDate column               │
│ [Create Index Script]                                       │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**

1. Execute query with `SET SHOWPLAN_XML ON` prefix
2. Parse XML execution plan response
3. Render as interactive tree/graph using D3.js or custom SVG
4. Color-code by cost percentage (green < 10%, yellow < 30%, red > 30%)
5. Click node for detailed statistics
6. Highlight expensive operations with warnings
7. Generate index recommendations for table scans

**Files to Create:**

- `packages/renderer/src/app/shared/components/execution-plan/execution-plan.component.ts`
- `packages/renderer/src/app/shared/components/execution-plan/plan-node.component.ts`
- `packages/main/src/services/sql/execution-plan-parser.ts`

---

### 3.2 One-Click Docker SQL Server

**Impact:** 🔥🔥🔥🔥 - Own the Mac + Docker experience completely.

**Design:**

```
┌─────────────────────────────────────────────────────────────┐
│ 🐳 New SQL Server Container                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Name:        [dev-sqlserver           ]                    │
│  Version:     [SQL Server 2022 ▼       ]                    │
│               • SQL Server 2022 (mcr.microsoft.com/mssql/server:2022-latest)
│               • SQL Server 2019 (mcr.microsoft.com/mssql/server:2019-latest)
│               • SQL Server 2017 (mcr.microsoft.com/mssql/server:2017-latest)
│                                                             │
│  SA Password: [••••••••••••  ] 🎲 Generate                  │
│  Port:        [1433                    ]                    │
│                                                             │
│  ☑️ Persist data to ~/Docker/sqlserver                      │
│  ☑️ Auto-connect after creation                             │
│  ☐ Include sample database (AdventureWorks)                 │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  [Create Container]                        [Cancel]         │
│                                                             │
│  ℹ️ Requires Docker Desktop running (~1.5GB download)       │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**

1. Add IPC channel `docker:create-container` in docker.ipc.ts
2. Use dockerode to:
   - Pull image if not present (with progress)
   - Create container with proper config
   - Set up volume mounts for data persistence
   - Configure port mapping
3. Auto-create connection profile on success
4. Optional: restore AdventureWorks from embedded .bak file

**Docker Configuration:**

```typescript
const containerConfig = {
  Image: 'mcr.microsoft.com/mssql/server:2022-latest',
  name: containerName,
  Env: ['ACCEPT_EULA=Y', `MSSQL_SA_PASSWORD=${password}`],
  HostConfig: {
    PortBindings: { '1433/tcp': [{ HostPort: port.toString() }] },
    Binds: persistData ? [`${dataPath}:/var/opt/mssql`] : [],
  },
};
```

---

### 3.3 Natural Language to SQL

**Impact:** 🔥🔥🔥 - AI assistance that's genuinely useful.

**Design:**

```
┌─────────────────────────────────────────────────────────────┐
│ 💬 Ask about your data...                         ⌘⇧A      │
├─────────────────────────────────────────────────────────────┤
│  "show me customers who ordered more than $1000 last month" │
│                                                             │
│  Generated SQL:                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ SELECT c.CustomerName, SUM(o.TotalAmount) AS Total     │ │
│  │ FROM Customers c                                       │ │
│  │ JOIN Orders o ON c.CustomerID = o.CustomerID           │ │
│  │ WHERE o.OrderDate >= DATEADD(MONTH, -1, GETDATE())     │ │
│  │ GROUP BY c.CustomerName                                │ │
│  │ HAVING SUM(o.TotalAmount) > 1000                       │ │
│  │ ORDER BY Total DESC                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  [Run Query]  [Edit in Editor]  [Explain]                   │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**

1. Integrate Claude API via Anthropic SDK
2. Store API key in macOS Keychain (like connection passwords)
3. Build schema context from metadata cache
4. Prompt engineering for T-SQL generation
5. Always show generated SQL (transparency principle)
6. "Explain" mode: describe what query does in plain English
7. Optional: Local LLM support via Ollama for sensitive data

**Prompt Template:**

```
You are a SQL Server expert. Given the following schema:
{schema_json}

Generate a T-SQL query for: {user_request}

Rules:
- Use proper T-SQL syntax
- Include appropriate JOINs
- Use meaningful aliases
- Add ORDER BY when relevant
- Return only the SQL, no explanation
```

---

## Tier 4: Polish & Delight

### 4.1 Keyboard Shortcuts System

**Current Status:**

| Action        | Shortcut | Status         |
| ------------- | -------- | -------------- |
| Execute query | F5       | ✅ Implemented |

**Shortcuts to Add:**

| Action           | Shortcut | Priority |
| ---------------- | -------- | -------- |
| New query tab    | ⌘N       | High     |
| Close tab        | ⌘W       | High     |
| Command palette  | ⌘K       | High     |
| Object search    | ⌘⇧O      | High     |
| Format SQL       | ⌘⇧F      | High     |
| Toggle history   | ⌘H       | Medium   |
| Next tab         | ⌘⇧]      | Medium   |
| Previous tab     | ⌘⇧[      | Medium   |
| Focus editor     | ⌘1       | Medium   |
| Focus results    | ⌘2       | Medium   |
| Backup database  | ⌘B       | Low      |
| Restore database | ⌘R       | Low      |
| Toggle sidebar   | ⌘\       | Low      |
| Settings         | ⌘,       | Low      |

**Shortcut Cheatsheet Feature:**

- Hold ⌘ for 1.5 seconds → Show overlay with all shortcuts
- Or access via Help menu / ⌘?

---

### 4.2 Results Grid Enhancements

**Current:** Basic ag-grid with toolbar.

**Enhancements:**

- **Column resize** with double-click header edge to auto-fit
- **Column hide/show** via right-click on header
- **Quick filter** per column (input in header row)
- **Copy options** via ⌘C context menu:
  - Copy cell value
  - Copy row as JSON
  - Copy row as INSERT statement
  - Copy column values
- **JSON/XML formatting** for text cells (detect and pretty-print)
- **NULL highlighting** with distinct gray italic style
- **Numeric formatting** with thousand separators
- **Date formatting** with locale-aware display
- **Row stripe** alternating background for readability

---

### 4.3 Connection Health Indicator

**Current:** Simple connected/disconnected icon.

**Enhanced Status Bar:**

```
┌──────────────────────────────────────────────────────────────┐
│ ● Production SQL │ OrdersDB │ Pool: 3/10 │ 12ms │ 🐳        │
└──────────────────────────────────────────────────────────────┘
```

**Components:**

- Connection status indicator (●/○)
- Server name (click to switch)
- Database name (click to switch)
- Pool status (active/max connections)
- Latency (periodic ping)
- Docker indicator if container

---

### 4.4 Query Tab Improvements

**Current:** Basic tabs with generic names.

**Enhancements:**

- Tab title shows first 20 chars of query or filename
- Dirty indicator (● before name) for unsaved changes
- Right-click context menu:
  - Close
  - Close Others
  - Close All
  - Close to the Right
- Drag tabs to reorder
- Double-click tab to rename
- Middle-click to close
- Tab overflow menu when too many tabs

---

### 4.5 Microinteractions & Feedback

**Add subtle animations for delight:**

- **Connection success:** Green pulse on status indicator
- **Query running:** Pulsing blue spinner + elapsed timer in status bar
- **Query complete:** Brief green flash on results tab
- **Export complete:** Checkmark animation on button
- **Error:** Gentle shake on error panel
- **Copy:** "Copied!" tooltip at cursor position (fade after 1s)
- **Long operation:** Progress ring with ETA

---

## Priority Roadmap Summary

### Phase 1: Quick Wins (Week 1)

| Feature                        | Effort  | Impact |
| ------------------------------ | ------- | ------ |
| Theme toggle                   | 2 hours | High   |
| SQL formatting                 | 2 hours | High   |
| Query cancellation fix         | 4 hours | Medium |
| State persistence              | 1 day   | High   |
| Docker container management UX | 4 hours | High   |

### Phase 2: Core UX (Weeks 2-6)

| Feature                   | Effort    | Impact    |
| ------------------------- | --------- | --------- |
| ⌘K Command palette        | 1 week    | Very High |
| Workspace/Folder support  | 1.5 weeks | Very High |
| `joinery` CLI tool        | 1.5 weeks | Very High |
| Instant object search     | 3 days    | High      |
| Keyboard shortcuts        | 2 days    | High      |
| Results grid enhancements | 3 days    | Medium    |

### Phase 3: Intelligence (Weeks 5-8)

| Feature                    | Effort    | Impact    |
| -------------------------- | --------- | --------- |
| Intelligent error messages | 1 week    | High      |
| Monaco IntelliSense        | 1.5 weeks | Very High |
| Visual execution plan      | 2 weeks   | Medium    |

### Phase 4: Differentiation (Weeks 9-12)

| Feature                     | Effort    | Impact |
| --------------------------- | --------- | ------ |
| One-click Docker SQL Server | 1 week    | High   |
| Natural language to SQL     | 1.5 weeks | Medium |
| Table data editing          | 2 weeks   | Medium |

---

## Success Metrics

### User Experience

- Time to first query: < 60 seconds (new user)
- Object search latency: < 50ms
- Command palette response: < 100ms
- Query execution feedback: Immediate (< 16ms to show spinner)

### Adoption

- Daily active usage: 5+ sessions/week for retained users
- Feature discovery: 80% use command palette within first week
- Error recovery: 70% of errors resolved without external search

### Quality

- Crash rate: < 0.1%
- Query success rate: > 99% (when SQL is valid)
- Connection reliability: > 99.5%

---

## Appendix: Competitive Analysis

### vs. SSMS (Windows only)

| Feature         | SSMS         | Joinery    |
| --------------- | ------------ | ---------- |
| Mac support     | ❌           | ✅         |
| Startup time    | Slow (~10s)  | Fast (<3s) |
| IntelliSense    | ✅ Excellent | 🔄 Planned |
| Execution plans | ✅ Excellent | 🔄 Planned |
| Modern UI       | ❌ Dated     | ✅ Modern  |

### vs. Azure Data Studio

| Feature            | ADS        | Joinery            |
| ------------------ | ---------- | ------------------ |
| Mac support        | ✅         | ✅                 |
| Startup time       | Slow (~8s) | Fast (<3s)         |
| Resource usage     | Heavy      | Light              |
| Backup/Restore     | Basic      | ✅ Full wizards    |
| Docker integration | ❌         | ✅ Native          |
| Focus              | Multi-DB   | SQL Server focused |

### vs. TablePlus

| Feature            | TablePlus | Joinery         |
| ------------------ | --------- | --------------- |
| SQL Server depth   | Generic   | ✅ Deep         |
| Backup/Restore     | ❌        | ✅ Full         |
| Docker awareness   | ❌        | ✅ Native       |
| T-SQL transparency | ❌        | ✅ Always shown |
| Price              | $99/year  | Free            |

---

## Document History

| Version | Date       | Author | Changes                                                |
| ------- | ---------- | ------ | ------------------------------------------------------ |
| 1.0     | 2025-01-24 | Claude | Initial roadmap based on v1.0 analysis                 |
| 1.1     | 2025-01-24 | Claude | Added Workspace/Folder support feature (VS Code-style) |
| 1.2     | 2025-01-24 | Claude | Added `joinery` CLI tool with full command reference   |
| 1.3     | 2025-01-24 | Claude | Added Enhanced Docker Container Management UX          |
