#!/usr/bin/env node
/**
 * Write — or verify — the generated pages of the Reference section.
 *
 *   node scripts/generate-reference.mjs           writes the pages
 *   node scripts/generate-reference.mjs --check   fails if what is committed has drifted
 *
 * `pnpm run check` and `pnpm run build` both run the `--check` form first, so a change to the
 * app's command catalogue or vendor configuration that has not been regenerated fails the docs
 * build rather than shipping a page that quietly disagrees with the app
 * (plans/docs-site/PROPOSAL.md §5.3, §7 Phase 2).
 *
 * The check hangs off those two scripts, not off Astro: `npx astro build` or `astro dev` invoked
 * directly bypasses it, and so would a CI step that called Astro rather than the package script.
 * `.github/workflows/docs.yml` runs `pnpm run check` and `pnpm run build`, which is why it is
 * covered.
 *
 * ── Two things this deliberately does not do ────────────────────────────────────────────────
 *
 * It does not import the renderer: see `lib/app-source.mjs` for the isolated loader and why.
 *
 * It does not emit into a gitignored directory. §5.3 sketched a `prebuild` writing into
 * `reference/_generated/`; the pages are committed instead, so the tables are reviewable in a pull
 * request diff and a reader of this repository sees what the site serves. The staleness protection
 * that arrangement needs is the `--check` mode above, which is stricter than regeneration: a
 * regenerating build cannot fail, and therefore cannot tell anyone that the app moved.
 *
 * ── The gap this cannot close from inside docs-site ─────────────────────────────────────────
 *
 * `.github/workflows/docs.yml` is path-filtered to `docs-site/**`, so a commit that changes ONLY
 * `packages/renderer/src/commands/catalogue.ts` does not run this check at all. That workflow's own
 * header records the fix — add the generator's input files to the two path filters — and it is a
 * change to a file outside this directory.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import prettier from 'prettier';

import { loadCommandSources, RENDERER_SRC } from './lib/app-source.mjs';
import { buildPages } from './lib/pages.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = resolve(HERE, '..');
const CONTENT_ROOT = join(DOCS_ROOT, 'src/content/docs');
const VENDOR_CONFIG = resolve(DOCS_ROOT, '../packages/shared/src/config/ai-vendors.json');

/** Read the vendor configuration, asserting the shape the AI reference page renders. */
async function readVendorConfig() {
  const raw = await readFile(VENDOR_CONFIG, 'utf8').catch(cause => {
    throw new Error(`The reference generator cannot read ${VENDOR_CONFIG}: ${cause.message}`);
  });
  const config = JSON.parse(raw);
  const wellFormed =
    typeof config.version === 'string' &&
    typeof config.lastUpdated === 'string' &&
    Array.isArray(config.vendors) &&
    config.vendors.length > 0 &&
    config.vendors.every(vendor => Array.isArray(vendor.models) && vendor.models.length > 0);
  if (!wellFormed) {
    throw new Error(
      `${VENDOR_CONFIG} no longer has the { version, lastUpdated, vendors[].models[] } shape the ` +
        'AI provider reference is generated from.'
    );
  }
  return config;
}

/**
 * Format exactly as the repository does. The root `.prettierrc` covers `docs-site/**\/*.md`
 * (`package.json`'s `format:check` glob), so a generated page that is not Prettier-clean fails a
 * gate somewhere else. `resolveConfig` reads that same file rather than restating its options.
 *
 * The OPTIONS come from the root config; the FORMATTER is docs-site's own dependency, pinned to
 * `3.9.6` — the version the root lockfile resolves today, while the root manifest floats on
 * `^3.3.1`. A root Prettier bump that changes Markdown output would put the two gates in
 * disagreement: this generator would emit the old shape and the root `format:check` would want
 * the new one. If that happens, move this pin to the new version and regenerate.
 */
async function formatMarkdown(markdown, filePath) {
  const options = await prettier.resolveConfig(filePath);
  return prettier.format(markdown, { ...options, filepath: filePath, parser: 'markdown' });
}

/** Every generated page, formatted, with its absolute destination. */
async function renderPages() {
  const sources = loadCommandSources();
  const vendorConfig = await readVendorConfig();

  return Promise.all(
    buildPages({ sources, vendorConfig }).map(async page => {
      const file = join(CONTENT_ROOT, page.path);
      return { path: page.path, file, markdown: await formatMarkdown(page.markdown, file) };
    })
  );
}

/** Write mode: overwrite each page and say so. */
async function writePages(pages) {
  for (const page of pages) {
    await writeFile(page.file, page.markdown, 'utf8');
    console.log(`generated  ${page.path}`);
  }
}

/** The first line that differs, so a failure names a row rather than a file. */
function firstDifference(expected, actual) {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const limit = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < limit; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return [
        `  line ${index + 1}`,
        `    committed: ${JSON.stringify(actualLines[index] ?? '<end of file>')}`,
        `    generated: ${JSON.stringify(expectedLines[index] ?? '<end of file>')}`,
      ].join('\n');
    }
  }
  return '  (the files differ only in trailing content)';
}

/** Check mode: return the pages that have drifted, described. */
async function driftedPages(pages) {
  const drifted = [];
  for (const page of pages) {
    const committed = await readFile(page.file, 'utf8').catch(() => null);
    if (committed === null) {
      drifted.push(`${page.path}\n  is missing`);
      continue;
    }
    if (committed !== page.markdown) {
      drifted.push(`${page.path}\n${firstDifference(page.markdown, committed)}`);
    }
  }
  return drifted;
}

async function main() {
  const check = process.argv.includes('--check');
  const pages = await renderPages();

  if (!check) {
    await writePages(pages);
    return;
  }

  const drifted = await driftedPages(pages);
  if (drifted.length === 0) {
    console.log(
      `reference pages match ${RENDERER_SRC.replace(/.*\/packages/, 'packages')} (${pages.length} pages)`
    );
    return;
  }

  console.error(
    [
      '',
      'The generated reference pages no longer match the app:',
      '',
      ...drifted,
      '',
      'The app is the source of truth. Run `pnpm run generate:reference` from docs-site/ and',
      'commit the result — do not edit the generated pages by hand.',
      '',
    ].join('\n')
  );
  process.exitCode = 1;
}

await main();
