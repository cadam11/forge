# Sidebar example

`_Sidebar.md` shows on every page. Keep it short — long sidebars wrap awkwardly. Group related pages under bold section labels rather than nested lists; nested Markdown lists in the sidebar render cleanly but the indentation is subtle.

## Worked example

```markdown
**Getting Started**

- [[Home]]
- [[Installation]]
- [[Getting Started]]

**Connections**

- [[Connecting to SQL Server]]
- [[Connecting to PostgreSQL]]
- [[Connecting to MySQL]]
- [[SSH Tunneling]]
- [[Azure Entra ID]]

**Working with data**

- [[Query Editor]]
- [[Object Explorer]]
- [[ERD Visualization]]
- [[Execution Plans]]
- [[Backup and Restore]]

**AI Assistant**

- [[AI Assistant Setup]]
- [[Using the AI Assistant]]

**Reference**

- [[Keyboard Shortcuts]]
- [[Settings]]
- [[Troubleshooting]]
- [[Release Notes]]

---

[Edit on GitHub](https://github.com/<owner>/<repo>/wiki) ·
[Report an issue](https://github.com/<owner>/<repo>/issues)
```

## Notes

- The link text inside `[[...]]` must match the page filename (with hyphens converted to spaces, or vice versa). Mismatches render as broken links — verify each one after writing.
- A horizontal rule (`---`) before footer-style links separates navigation from meta-actions.
- Don't put a top-level `# Heading` in `_Sidebar.md`; GitHub renders the file as-is and you don't want competing headings on every page.
