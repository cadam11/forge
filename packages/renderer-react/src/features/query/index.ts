/**
 * The query tab's public surface.
 *
 * `QueryPanel` is what the dock mounts; `QueryCommands` is exported separately because
 * `commands/bus.spec.tsx`'s ownership test mounts it on its own (the panel is a Monaco host and cannot
 * be rendered in jsdom — see that component's header). The stores and pure helpers are exported for
 * their tests and for Task 11/14, which read the same result.
 */

export { QueryPanel } from './query-panel';
export { QueryCommands, type QueryCommandHandlers } from './query-commands';
export { detectPlaceholders, substitutePlaceholders } from './placeholders';
export { FILE_PATH_METADATA_KEY, rememberedFilePath } from './query-files';
