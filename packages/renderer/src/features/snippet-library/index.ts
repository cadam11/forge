/**
 * The snippet library's public surface. Import from `../snippet-library`, never from a file inside it.
 *
 * `SnippetLibrary` is what the shell mounts; it opens itself on ⌥⌘S and on the `open-snippets`
 * command. The data lives in `state/snippets.ts` — this feature owns the surface, not the store.
 */

export { SnippetLibrary } from './snippet-library';
export {
  formatSnippetDate,
  formatTags,
  parseTags,
  previewSql,
  ROW_PREVIEW_LENGTH,
  snippetName,
} from './snippet-model';
