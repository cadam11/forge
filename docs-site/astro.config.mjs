// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

/**
 * Joinery's user documentation site.
 *
 * `site` + `base` are the GitHub Pages project-page pair (plans/docs-site/PROPOSAL.md §3.2).
 * Everything the site serves therefore lives under `/joinery/`, which is the single most
 * likely way this site ships broken: a hand-written root-absolute link such as
 * `[Install](/getting-started/install/)` resolves to `cadam11.github.io/getting-started/…`
 * and 404s. `starlight-links-validator` below is the guard — `errorOnRelativeLinks: false`
 * because relative links between docs pages are exactly what authors are told to write, and
 * the validator resolves them against `base` before checking.
 */
export default defineConfig({
  site: 'https://cadam11.github.io',
  base: '/joinery',
  // Emit `/joinery/getting-started/install/index.html`, so a link written as
  // `../install/` resolves the same way in `astro preview` as it does on Pages.
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [
    starlight({
      title: 'Joinery',
      description:
        'User documentation for Joinery — a desktop database workbench for SQL Server, PostgreSQL and MySQL.',
      // The three-bar mark, in its light-surface and dark-surface variants. Copied into
      // src/assets/ rather than referenced across the repo boundary: `docs-site/` builds
      // from its own directory and must not reach up into the app's tree.
      logo: {
        light: './src/assets/lockup-on-light.svg',
        dark: './src/assets/lockup-on-dark.svg',
        replacesTitle: true,
      },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/brand.css'],
      // The Starlight internals this site depends on (PROPOSAL §2.2): the ink-first default
      // from plans/ui-overhaul/PROPOSAL.md D2. Both files are needed, not just the provider —
      // their headers explain why. If a Starlight major breaks them, the documented fallback
      // is to delete both and accept Starlight's `auto`.
      components: {
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      social: [
        {
          icon: 'github',
          label: 'Joinery on GitHub',
          href: 'https://github.com/cadam11/joinery',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/cadam11/joinery/edit/main/docs-site/',
      },
      lastUpdated: true,
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { slug: 'getting-started/install' },
            { slug: 'getting-started/prerequisites' },
            { slug: 'getting-started/first-run' },
            { slug: 'getting-started/connect-sql-server' },
            { slug: 'getting-started/connect-postgresql' },
            { slug: 'getting-started/connect-mysql' },
            { slug: 'getting-started/connect-ssh' },
            { slug: 'getting-started/workspace-tour' },
          ],
        },
        // Single links, not groups: each of these sections holds exactly one page today, and a
        // group whose only child repeats its own label reads as a bug. Phase 2 turns the first
        // three back into groups as their pages land.
        { slug: 'features' },
        { slug: 'reference' },
        { slug: 'troubleshooting' },
        { slug: 'about' },
      ],
      plugins: [
        starlightLinksValidator({
          errorOnRelativeLinks: false,
          errorOnInvalidHashes: true,
          errorOnLocalLinks: true,
        }),
      ],
    }),
  ],
});
