Run the Playwright UI regression test suite against the Forge Electron app.

## Steps

1. **Build the project** first with `npx turbo build --force` to ensure latest code is compiled
2. **Run the full audit**: `npx playwright test e2e/full-audit.spec.ts --reporter=list`
3. **Analyze the output** for any failures, issues, or regressions
4. **Check screenshots** in `e2e/screenshots/audit4/` for visual issues
5. **Report findings** with:
   - Total pass/fail count
   - Any new issues discovered
   - Screenshot observations (tab readability, text contrast, layout issues)
   - Query execution results (AG Grid visible, row counts)

## Key things to watch for

- **Query results**: AG Grid should be visible with real data rows from MJ_5_14_0
- **Tab readability**: Tab text should be clearly readable in both light and dark themes
- **Sidebar text**: Connection/database labels should have good contrast
- **Theme switching**: Dark/light themes should both render correctly
- **Error handling**: Query errors should display clearly

## If issues are found

- Fix the underlying code (not just the test)
- Rebuild with `npx turbo build --force`
- Re-run the affected tests to verify
- Commit with conventional commit format
- Push to the current branch

## Reference

See `tests/regression-suite.md` for full test documentation.
