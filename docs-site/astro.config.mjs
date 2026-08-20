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
  /*
   * NO container directives on this site — no `:::note`, no `:::caution`. Callouts are written
   * as blockquotes with a bold lead word, and `src/styles/brand.css` styles them. The reason is
   * measured, not stylistic:
   *
   * Astro 7's default Markdown processor is Sätteri, which disables container directives by
   * default; Starlight switches the feature on by mutating
   * `config.markdown.processor.options.features` from its `astro:config:setup` hook. On this
   * machine that flag does not take effect. `pnpm run build` emitted zero `starlight-aside`
   * elements and shipped the literal text ":::note … :::" into the HTML, while Starlight's other
   * transforms from the same plugin set (the `sl-anchor-link` heading anchors) rendered fine.
   * Declaring `markdown.processor: satteri({ features: { directive: true } })` here did not fix
   * it either — a probe plugin proved the declared processor WAS in use (161 paragraph visits)
   * while `containerDirective` never fired once.
   *
   * The likely cause is a platform split rather than a config error: the lockfile carries
   * `@bruits/satteri-darwin-arm64` at 0.9.5 only, so satteri 0.10.4 — the version
   * `@astrojs/markdown-satteri` resolves — has no native binding for Apple Silicon and runs a
   * fallback path here. CI is linux-x64, which DOES have the 0.10.4 binding, so asides might
   * well work there. "Might well work on the machine I cannot see" is not a standard these docs
   * are held to, and a callout that silently degrades to `:::note` in body text is worse than no
   * callout at all. Blockquotes render identically on every platform and every processor.
   *
   * Tracked for a follow-up: if the upstream flag becomes reliable, asides can come back.
   */
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
      /*
       * Fenced code blocks. Starlight already routes Expressive Code's frame chrome through
       * `--sl-color-gray-*` and `--sl-color-accent`, which `src/styles/brand.css` themes — but
       * the code canvas itself and the frame border are hard-coded by the bundled syntax
       * themes, and ship as #23262F (dark) and #F6F7F9 (light). Both are blue-slate, which
       * plans/ui-overhaul/PROPOSAL.md §2.5 bans outright.
       *
       * Canvas and border only. Retheming the six syntax roles against the app's Monaco palette
       * is Phase 3; the stock token colours clear AA on both canvases below (measured), so this
       * is the whole of the brand defect.
       */
      expressiveCode: {
        styleOverrides: {
          // One themed custom property rather than a per-theme function: the two values live
          // beside every other colour decision in brand.css. See that file for each one.
          codeBackground: 'var(--j-code-bg)',
          borderColor: 'var(--sl-color-hairline)',
        },
      },
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
