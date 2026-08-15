# Joinery Iterative Improvement Loop

## Core Process (REPEAT UNTIL WORLD-CLASS)

1. **Finish current work chunk** — implement features/fixes
2. **Build** — `npm run build` must succeed
3. **Test with Playwright** — run `npx playwright test e2e/feature-test.spec.ts --reporter=list` to verify
4. **Commit & Push** — descriptive commit messages, push to remote as backup
5. **Full Evaluation** — examine the app holistically:
   - Find bugs
   - Tighten UX (small stuff matters)
   - List improvements for world-class DBA tool / Mac app
6. **Build all identified features** — implement everything from the evaluation
7. **Test 100%** with Playwright — every feature must work
8. **Repeat** the cycle

## Quality Bar

The app should be so good that Jony Ive, Steve Jobs and other visionaries would be WOW'd by it. This means:

- Every feature is 100% functional
- UX is polished, consistent, and delightful
- No dead buttons, empty handlers, or stub implementations
- Error states are handled gracefully
- Performance is excellent
- The app feels like a world-class native Mac app

## User's Additional Request (2026-03-21)

Test the backup/restore flow specifically:

- Do NOT restore over an existing DB
- Restore a DB as a NEW database, OR create a new database
- Add some tables via the UI
- Backup the database
- Delete a table
- Restore the backup and verify the table is back

Also: keep this plan file so the loop instructions survive context compaction.

## Resolved Issues (from previous audits)

- ✅ SETTINGS IPC handlers registered
- ✅ WORKSPACE handlers registered in index.ts
- ✅ 103/103 IPC handlers now use safeHandle wrapper with try/catch error handling
- ✅ GET_OBJECT_DETAILS, REFRESH_NODE, GET_VOLUMES implemented
- ✅ Missing LIST_SCHEMAS IPC handler added
- ✅ Empty /features/database/ directories removed
- ✅ Loading states added to sidebar (database selector spinner)
- ✅ Shortcut conflicts resolved (⌘H → ⌘⌥F for Find & Replace)
- ✅ Shortcuts dialog matches actual keybindings
- ✅ CLI listViews/listProcedures stubs replaced with real implementations
- ✅ Error logging added to 7 silent MJ metadata catch blocks
- ✅ Docker container count bug fixed (status → state)
- ✅ Welcome page docs link fixed (→ /wiki)
- ✅ Notification snackbar styles (success/error/warning/info colors)
- ✅ Tab-bar newQueryTab uses connection context
- ✅ Unsaved changes warning on window close
- ✅ ERD theme-aware colors
- ✅ Hardcoded colors replaced with CSS variables
- ✅ Accessibility: ARIA roles, labels, keyboard nav, focus-visible
- ✅ Production logging: Created log-level service, replaced 77 console.* calls across 13 files
- ✅ Password logging removed from connection-pool (security fix)
- ✅ SQL injection fix: CLI database name escaping (] → ]])
- ✅ ERD double-click opens SELECT query (replaces stub notification)
- ✅ Welcome page action cards: keyboard accessible (tabindex, role, Enter/Space)
- ✅ Connections page: keyboard accessible connection items
- ✅ Result history & AI analysis panels: keyboard accessible headers
- ✅ Confirm dialog: role="dialog", aria-modal, aria-labelledby, input aria-label
- ✅ CLI port validation (1-65535 range check in options and interactive)
- ✅ CLI interactive connect: respects --no-encrypt, sets default on save
- ✅ CLI getConnectionInfo null guard
- ✅ CLI pool close error handling
- ✅ Deprecated .toPromise() replaced with firstValueFrom() (39 occurrences, 13 files)
- ✅ Welcome component: document.querySelector replaced with ViewChild

## Remaining Improvement Opportunities

### High Priority

- Playwright e2e tests for backup/restore flow
- Playwright e2e tests for core UX flows (connect, query, export)

### Medium Priority

- Drag-and-drop table names from sidebar to query editor
- Tab reordering via drag-and-drop
- Query auto-completion (IntelliSense)
- Multiple selection in results grid for batch copy

### Lower Priority

- Light theme polish pass (verify all components look good in light mode)
- Keyboard shortcuts for switching between result tabs
