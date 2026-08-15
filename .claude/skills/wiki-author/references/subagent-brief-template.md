# Subagent brief template

Copy this into the `prompt` field of an `Agent` tool call when dispatching a page-author subagent. Fill in every `<…>`. Self-contained briefs produce sharp pages; vague briefs produce filler.

````text
You are writing a single page of a GitHub Wiki for <project name>: <one-sentence project description>.

# What the project is

<2–4 sentences of substantive context. Tech stack, target user, primary value.>

# Authoritative sources

Read these before writing. Do not invent features that aren't documented or visible in the code.

- <absolute path to README.md>
- <absolute path to CLAUDE.md>
- <relevant docs/<file>.md paths>
- <relevant packages/<...>/src/ paths if the page documents specific behaviour>

# Page scope

This page covers: <crisp scope>.

This page does NOT cover: <list of adjacent topics owned by other pages>. Link to those via `[[Page Name]]` instead of duplicating.

# Target file

Write the page to: <absolute path to wiki clone>/<Filename>.md

The filename will become the page URL slug, so peer pages link to this page as `[[<Page Title With Spaces>]]`.

# Style

- User-facing, task-oriented. Imperative voice in steps.
- Short paragraphs (3–4 sentences max).
- No marketing language. No "powerful", "seamless", "blazing fast".
- Concrete: real menu names, real button labels, real shortcuts.
- Code blocks with language hints (```sql, ```bash, ```typescript).
- Cross-link to peer pages with [[Page Name]] syntax.
- Length target: <150–500> lines.

# Screenshots available

You may embed any of these via raw GitHub URLs. Caption each one.

- <raw url> — <what it shows>
- <raw url> — <what it shows>

(If no screenshots are available for this page, write without them — don't invent paths.)

# Cross-links to include

Wire this page into the wiki by linking to at least these peer pages where contextually appropriate:

- [[<Peer Page 1>]]
- [[<Peer Page 2>]]
- [[<Peer Page 3>]]

# Output

Write the complete Markdown file to the target path. Then reply with:
1. One sentence summary of what you wrote.
2. Any features you weren't sure about (so I can verify before publishing).
3. Any cross-links you wanted to make but didn't have a target page for.
````

## How to use this brief well

- **Cap the page list before you dispatch.** If you don't know the full set of peer pages, the cross-link list will be wrong and pages will end up isolated.
- **Don't paste the entire SKILL.md into every brief.** Inline only the style bullets the agent needs. Pointing at a path also works if the agent has filesystem access.
- **Send all subagent calls in a single message** so they run in parallel. Sequential dispatch wastes wall-clock time.
- **Verify after.** Subagent summaries are aspirational. Read the actual file each one wrote.
