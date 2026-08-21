/**
 * The declared documentation shot set: every PNG that belongs in
 * `docs-site/src/assets/screenshots/`, what surface it is, and which docs pages want it.
 *
 * ── Why a catalogue at all ────────────────────────────────────────────────────────────────────
 *
 * `plans/docs-site/PROPOSAL.md` §6.3 accepts that screenshots rot silently and asks for one cheap
 * guard: a manifest sidecar, plus a test that every screenshot a docs page references exists. A
 * manifest assembled purely from "whatever files the run happened to write" cannot make that
 * promise — a spec that silently stopped capturing would produce a smaller manifest and no error.
 *
 * So the set is DECLARED here and checked from both ends:
 *
 *  - `capture()` refuses a name/theme pair this file does not declare, so a typo in a spec fails at
 *    the moment it would have written a stray PNG;
 *  - the manifest step (`tests/docs-shots-manifest/`) fails if any declared file is missing from
 *    the run, so a spec that stopped capturing fails the run rather than shrinking the manifest.
 *
 * ── Theme policy, which is the proposal's and not this file's ────────────────────────────────
 *
 * §6.3: "**Both themes for hero shots only.** Ink and ivory for the handful of hero images (swapped
 * via `[data-theme]`), ink alone for the rest. Capturing 40 pages twice doubles the churn for very
 * little." So `HERO_THEMES` is the pair and `PAGE_THEMES` is ink alone, and which one an entry gets
 * is the one editorial decision in this file: a hero is an image the landing page, the README or a
 * section index shows at size, where the docs site's own theme toggle is visible right next to it.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────────────────────────
 *
 * **The Docker panel.** It lists every database container on the host — the detector filters by
 * image name, not by compose project — so a committed shot of it would publish one laptop's
 * container inventory, and Docker's own "Up 44 minutes (healthy)" status prose changes every
 * minute. The visual tier captured it, inspected it and pulled it for the same reasons
 * (`tests/e2e-react-visual/overlays.spec.ts` header). `troubleshooting/docker-not-detected.md`
 * therefore gets no picture until `docker.detect` has a deterministic container source behind it.
 *
 * **Anything that needs an LLM.** No tier in this repo calls one (`tests/helpers/react/chat.ts`
 * states the rule), so the assistant is documented in the two states that are real without a key.
 * A streamed-transcript shot belongs with whatever task builds a provider fake.
 */

/** The two canvases. Named after `[data-theme]`; the UI calls them Ink and Ivory. */
export type DocsTheme = 'dark' | 'light';

/**
 * Hero images: shown at size, next to the docs site's own theme toggle.
 *
 * Exported so a spec loops over the same list the catalogue entry declares, rather than repeating
 * `['dark', 'light']` and drifting from it. `capture()` still checks the pair it is handed against
 * the entry, so a spec that looped over the wrong list fails rather than writing a stray file.
 */
export const HERO_THEMES: readonly DocsTheme[] = ['dark', 'light'];

/** Everything else: ink alone, per §6.3. */
export const PAGE_THEMES: readonly DocsTheme[] = ['dark'];

export interface DocsShot {
  /** The file stem. Lowercase kebab; the theme is appended by `shotFileName`. */
  readonly name: string;
  /** What the picture is of, in one phrase. Ends up in the manifest. */
  readonly surface: string;
  /** Which themes this shot is captured in. */
  readonly themes: readonly DocsTheme[];
  /**
   * The docs pages this shot was captured for, as content-collection slugs (plus `README` and
   * `landing` for the two surfaces outside the collection). Page integration is a separate task —
   * this records the intent so that task is a lookup rather than a re-derivation.
   */
  readonly pages: readonly string[];
}

/** `<name>-<theme>.png`, lowercase kebab, per the brief's naming rule. */
export function shotFileName(name: string, theme: DocsTheme): string {
  return `${name}-${theme}.png`;
}

/** Every file in the declared set, flattened over themes. */
export function declaredFiles(): readonly string[] {
  return DOCS_SHOTS.flatMap(shot => shot.themes.map(theme => shotFileName(shot.name, theme)));
}

export const DOCS_SHOTS: readonly DocsShot[] = [
  // ── Heroes: both themes ────────────────────────────────────────────────────────────────────
  {
    name: 'hero-welcome',
    surface: 'The welcome panel on first run',
    themes: HERO_THEMES,
    pages: ['getting-started/first-run', 'README'],
  },
  {
    name: 'hero-workspace',
    surface: 'The whole window, connected: explorer, query editor and results in one frame',
    themes: HERO_THEMES,
    pages: ['landing', 'getting-started/workspace-tour', 'README'],
  },
  {
    name: 'hero-query-results',
    surface: 'The query tab: editor above a populated results grid',
    themes: HERO_THEMES,
    pages: ['features/query-editor', 'features/results-grid', 'README'],
  },
  {
    name: 'hero-erd',
    surface: 'The relationship diagram for a focused table',
    themes: HERO_THEMES,
    pages: ['features/erd', 'README'],
  },
  {
    name: 'hero-ai-assistant',
    surface: 'The AI assistant panel with a conversation and the conversation list open',
    themes: HERO_THEMES,
    pages: ['features/ai-assistant', 'README'],
  },

  // ── Getting started: the four connection paths ─────────────────────────────────────────────
  {
    name: 'connect-postgresql',
    surface: 'The connection editor filled for a PostgreSQL server',
    themes: PAGE_THEMES,
    pages: ['getting-started/connect-postgresql'],
  },
  {
    name: 'connect-mysql',
    surface: 'The connection editor filled for a MySQL server',
    themes: PAGE_THEMES,
    pages: ['getting-started/connect-mysql'],
  },
  {
    name: 'connect-sql-server',
    surface: 'The connection editor filled for a SQL Server instance',
    themes: PAGE_THEMES,
    pages: ['getting-started/connect-sql-server'],
  },
  {
    name: 'connect-ssh',
    surface: 'The connection editor with the SSH tunnel section filled in',
    themes: PAGE_THEMES,
    pages: ['getting-started/connect-ssh', 'troubleshooting/connections-and-tunnels'],
  },

  // ── Features ───────────────────────────────────────────────────────────────────────────────
  {
    name: 'object-explorer',
    surface: 'The sidebar tree expanded to a table list',
    themes: PAGE_THEMES,
    pages: ['features/object-explorer'],
  },
  {
    name: 'object-detail',
    surface: "A table's object-detail panel, columns section",
    themes: PAGE_THEMES,
    pages: ['features/object-explorer', 'features/databases'],
  },
  {
    name: 'query-completions',
    surface: "The editor's completion widget mid-statement",
    themes: PAGE_THEMES,
    pages: ['features/query-editor'],
  },
  {
    name: 'row-detail',
    surface: 'The row-detail panel for one result row',
    themes: PAGE_THEMES,
    pages: ['features/results-grid'],
  },
  {
    name: 'execution-plan',
    surface: 'The execution plan tree for a joined SELECT',
    themes: PAGE_THEMES,
    pages: ['features/execution-plans'],
  },
  {
    name: 'query-history',
    surface: 'The query history dialog after a few statements have run',
    themes: PAGE_THEMES,
    pages: ['features/query-history'],
  },
  {
    name: 'command-palette',
    surface: 'The command palette over a connected app',
    themes: PAGE_THEMES,
    pages: ['features/command-palette'],
  },
  {
    name: 'object-search',
    surface: 'The object search overlay listing the loaded schema',
    themes: PAGE_THEMES,
    pages: ['features/find-a-database-object'],
  },
  {
    name: 'snippets',
    surface: 'The snippet library with a saved snippet',
    themes: PAGE_THEMES,
    pages: ['features/snippets'],
  },
  {
    name: 'keyboard-shortcuts',
    surface: 'The keyboard cheatsheet',
    themes: PAGE_THEMES,
    pages: ['features/keyboard-shortcuts', 'reference/keyboard-shortcuts'],
  },
  {
    name: 'schema-diff',
    surface: 'The schema comparison dialog with both sides chosen',
    themes: PAGE_THEMES,
    pages: ['features/schema-diff'],
  },
  {
    name: 'backup-wizard',
    surface: 'The backup wizard, ready to run',
    themes: PAGE_THEMES,
    pages: ['features/backup-and-restore'],
  },
  {
    name: 'restore-wizard',
    surface: 'The restore wizard at its overwrite confirmation',
    themes: PAGE_THEMES,
    pages: ['features/backup-and-restore'],
  },
  {
    name: 'ai-setup',
    surface: 'The AI setup dialog, provider list',
    themes: PAGE_THEMES,
    pages: ['features/ai-setup', 'reference/ai-providers'],
  },

  // ── Reference ──────────────────────────────────────────────────────────────────────────────
  {
    name: 'settings-appearance',
    surface: 'The settings panel, appearance group',
    themes: PAGE_THEMES,
    pages: ['reference/settings'],
  },
];
