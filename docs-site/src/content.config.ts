import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

/**
 * The one content collection this site has. Starlight's schema is what makes a page that
 * lies about its frontmatter fail the build rather than render wrong — the reason
 * plans/docs-site/PROPOSAL.md §2.1 chose Starlight over hand-rolled docs chrome.
 */
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
