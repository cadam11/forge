# Joinery Session: Fixes and Features

**Date**: January 26, 2026
**Branch**: `an-bc/fixes-and-features`

## Overview

This session addressed several bug fixes, feature additions, and architectural improvements to Joinery. The work focused on improving the query editor experience, adding SSMS-style keyboard shortcuts, and introducing MemberJunction database awareness.

---

## 1. Golden Layout Tab SQL State Isolation Bug Fix

### Problem

When multiple query tabs were open, modifying SQL in one tab could affect other tabs' content. This occurred because:

- The `onDidChangeModelContent` listener used `this.tabState.activeTab()` to determine which tab to update
- This reactive call could return a different tab if the user switched tabs quickly
- The `effect()` watching for active tab changes ran in ALL QueryComponents, not just the active one

### Root Cause Analysis

Each `QueryComponent` instance has its own Monaco editor, but the change listener was writing to whichever tab was currently active globally, not the tab this specific component was created for.

**Problematic Code Path**:

```
Tab A content changes → change listener fires → calls activeTab()
→ If user switched to Tab B, returns Tab B → writes Tab A's content to Tab B's state
```

### Solution

**File**: `packages/renderer/src/app/features/query/query.component.ts`

1. **Added `tabId` property** (line 807):

   ```typescript
   /**
    * The tab ID this component instance is bound to.
    * Set by GoldenLayoutContainer when creating the component.
    * This is the KEY to tab isolation - each component only manages its own tab.
    */
   tabId: string | null = null;
   ```

2. **Fixed the change listener** (line 993-998):

   ```typescript
   this.editor.onDidChangeModelContent(() => {
     const content = this.editor?.getValue() || '';
     // Use the fixed tabId this component was created for
     if (this.tabId) {
       this.tabState.setTabContent(this.tabId, content);
     }
   });
   ```

3. **Updated the effect** to only act when THIS component's tab is active (line 826-870):

   ```typescript
   effect(() => {
     const activeTab = this.tabState.activeTab();
     // Only act if this component's tab is now active
     if (activeTab?.type === 'query' && this.tabId && activeTab.id === this.tabId) {
       // ... sync editor content
     }
   });
   ```

4. **Added fallback path** for legacy component creation without `tabId`

5. **Updated template** to use `tabId` instead of `tabState.activeTab()?.id` for result history panel

### Files Changed

- `packages/renderer/src/app/features/query/query.component.ts`

---

## 2. Control+E Keyboard Shortcut for Query Execution

### Requirement

Add `Ctrl+E` as an SSMS-style shortcut to execute the current query (in addition to existing F5 and Cmd+Enter).

### Implementation

**File**: `packages/renderer/src/app/features/query/query.component.ts`

Added to `handleKeydown` method (line 900-905):

```typescript
// Ctrl+E - Execute query (SSMS-style shortcut)
// Note: Uses ctrlKey specifically, not metaKey, to match SSMS behavior
if (event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'e') {
  event.preventDefault();
  this.executeQuery();
}
```

**File**: `packages/renderer/src/app/shared/components/shortcuts-dialog/shortcuts-dialog.component.ts`

Updated shortcuts display (line 192):

```typescript
{ keys: 'F5 / Ctrl+E / ⌘+Enter', description: 'Execute Query' },
```

Updated execute button tooltip to show new shortcut:

```html
matTooltip="Execute (F5 or Ctrl+E)"
```

### Files Changed

- `packages/renderer/src/app/features/query/query.component.ts`
- `packages/renderer/src/app/shared/components/shortcuts-dialog/shortcuts-dialog.component.ts`

---

## 3. Create Database Context Menu (Verification)

### Finding

The "Create Database" option was **already implemented**. When right-clicking a server node in the explorer tree, the context menu includes:

```
- New Query
- New Database...  ← Already exists
- [Divider]
- Refresh
- [Divider]
- Disconnect
```

### Implementation Details (Existing)

- **Dialog**: `packages/renderer/src/app/shared/components/create-database-dialog/`
- **Features**:
  - Database name input with validation (alphanumeric + underscores)
  - Recovery model selection (Simple, Full, Bulk-Logged)
  - Loading state and error handling
- **IPC Handler**: `IPC_CHANNELS.DATABASE.CREATE`

---

## 4. Repository Analysis: Missing Features

### Analysis Performed

Comprehensive exploration of the codebase to identify gaps compared to SSMS functionality.

### Findings

#### Tier 1: Critical Gaps (High Impact)

| Feature                       | Effort   | Impact                              |
| ----------------------------- | -------- | ----------------------------------- |
| Table Designer/Editor UI      | 3-4 days | Can't design schema without T-SQL   |
| Execution Plan Visualization  | 2-3 days | Can't optimize queries visually     |
| Edit Table Data (inline grid) | 1-2 days | Can't modify data inline            |
| Query Statistics Display      | 1 day    | Can't analyze query performance     |
| IntelliSense/Autocomplete     | 2-3 days | Frequent typing errors, slow coding |

#### Tier 2: Important Gaps

| Feature                     | Effort   |
| --------------------------- | -------- |
| Activity Monitor            | 2 days   |
| Index Management            | 2-3 days |
| User/Role Management        | 2 days   |
| Full-Text Search Management | 1 day    |
| Database Properties Editor  | 1 day    |

#### Current Limitations Found

- Execution plan button exists but shows "coming soon" message
- Edit rows button is disabled with "coming soon" tooltip
- AI features require API key configuration
- No T-SQL IntelliSense
- No deadlock/blocking detection

---

## 5. MemberJunction Database Awareness

### Objective

Detect when a database has MemberJunction installed (presence of `__mj` schema with `Entity` table) and enable MJ-specific features.

### Architecture

#### Detection Logic

A database is MJ-enabled if:

1. Schema `__mj` exists
2. Table `__mj.Entity` exists
3. Table `__mj.EntityField` exists

#### New Types

**File**: `packages/shared/src/types/database.types.ts`

```typescript
export interface MJDatabaseInfo {
  isMJEnabled: boolean;
  schemaName?: string;
  version?: string;
  entityCount?: number;
  applicationCount?: number;
  hasUsers?: boolean;
  hasAuditLog?: boolean;
}

export interface MJEntityInfo {
  id: string;
  name: string;
  description?: string;
  baseTable: string;
  baseView?: string;
  schemaName: string;
  isVirtual: boolean;
  trackRecordChanges: boolean;
  // ... API permissions
}

export interface MJEntityFieldInfo {
  id: string;
  entityId: string;
  name: string;
  displayName?: string;
  type: string;
  // ... field metadata
}

export interface MJApplicationInfo {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}
```

#### IPC Channels

**File**: `packages/shared/src/constants/ipc-channels.ts`

```typescript
MJ: {
  DETECT: 'mj:detect',
  GET_ENTITIES: 'mj:get-entities',
  GET_ENTITY_FIELDS: 'mj:get-entity-fields',
  GET_APPLICATIONS: 'mj:get-applications',
},
```

#### Backend Service Methods

**File**: `packages/main/src/services/sql/metadata.ts`

```typescript
// Detect if database has MemberJunction installed
async detectMJDatabase(
  connectionId: string,
  database: string,
  mjSchemaName = '__mj'
): Promise<MJDatabaseInfo>

// Get MJ entities from a database
async getMJEntities(
  connectionId: string,
  database: string,
  mjSchemaName = '__mj'
): Promise<MJEntityInfo[]>

// Get MJ entity fields for a specific entity
async getMJEntityFields(
  connectionId: string,
  database: string,
  entityId: string,
  mjSchemaName = '__mj'
): Promise<MJEntityFieldInfo[]>

// Get MJ applications from a database
async getMJApplications(
  connectionId: string,
  database: string,
  mjSchemaName = '__mj'
): Promise<MJApplicationInfo[]>
```

#### Detection SQL

```sql
SELECT
  CASE WHEN SCHEMA_ID('__mj') IS NOT NULL THEN 1 ELSE 0 END AS hasSchema,
  CASE WHEN OBJECT_ID('__mj.Entity') IS NOT NULL THEN 1 ELSE 0 END AS hasEntityTable,
  CASE WHEN OBJECT_ID('__mj.EntityField') IS NOT NULL THEN 1 ELSE 0 END AS hasEntityFieldTable,
  CASE WHEN OBJECT_ID('__mj.User') IS NOT NULL THEN 1 ELSE 0 END AS hasUsers,
  CASE WHEN OBJECT_ID('__mj.AuditLog') IS NOT NULL THEN 1 ELSE 0 END AS hasAuditLog
```

#### Explorer State Integration

**File**: `packages/renderer/src/app/core/state/explorer.state.ts`

1. Added `mjInfo` property to `TreeNode` interface
2. Modified database loading to detect MJ in parallel:
   ```typescript
   const dbNodes = await Promise.all(
     databases.map(async db => {
       let mjInfo: MJDatabaseInfo | undefined;
       try {
         mjInfo = await firstValueFrom(this.ipc.detectMJDatabase(node.connectionId!, db.name));
       } catch {
         // MJ detection failed - database is not MJ-enabled
       }
       return { ...dbNode, mjInfo: mjInfo?.isMJEnabled ? mjInfo : undefined };
     })
   );
   ```

#### UI Indicator

**File**: `packages/renderer/src/app/layout/sidebar/sidebar.component.ts`

Added purple "MJ" badge for MJ-enabled databases:

```html
@if (node.mjInfo?.isMJEnabled) {
<span
  class="mj-badge"
  matTooltip="MemberJunction Database ({{ node.mjInfo.entityCount }} entities)"
>
  MJ
</span>
}
```

**CSS**:

```css
.mj-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: var(--spacing-xs);
  padding: 1px 5px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
  border-radius: 3px;
  text-transform: uppercase;
  flex-shrink: 0;
}
```

### Files Changed

- `packages/shared/src/types/database.types.ts`
- `packages/shared/src/constants/ipc-channels.ts`
- `packages/main/src/services/sql/metadata.ts`
- `packages/main/src/ipc/database.ipc.ts`
- `packages/preload/src/index.ts`
- `packages/renderer/src/app/core/services/ipc.service.ts`
- `packages/renderer/src/app/core/state/explorer.state.ts`
- `packages/renderer/src/app/layout/sidebar/sidebar.component.ts`

---

## Future MJ Features (Not Implemented)

The MJ awareness infrastructure enables future features:

1. **Entity Explorer** - Browse MJ entities alongside regular tables
2. **Smart CRUD** - Use entity APIs instead of raw SQL
3. **Relationship Visualization** - Show EntityRelationship links
4. **User/Security Context** - Show active users and roles from MJ
5. **Audit Trail Integration** - Display change history from `__mj.AuditLog`
6. **Query/View Library** - Browse saved queries from MJ

---

## Testing Checklist

### Tab Isolation Bug

- [ ] Open 3+ query tabs with different SQL
- [ ] Rapidly switch between tabs while typing
- [ ] Verify each tab maintains its own content
- [ ] Close and reopen tabs, verify content persists

### Ctrl+E Shortcut

- [ ] Press Ctrl+E in query editor - should execute
- [ ] Verify F5 still works
- [ ] Verify Cmd+Enter still works (Mac)
- [ ] Check shortcuts dialog shows updated text

### MJ Detection

- [ ] Connect to an MJ-enabled database
- [ ] Verify purple "MJ" badge appears on database node
- [ ] Hover over badge - should show entity count
- [ ] Connect to non-MJ database - no badge should appear

---

## Build Verification

```bash
npm run typecheck  # All packages pass
```

All TypeScript compilation successful with no errors.
