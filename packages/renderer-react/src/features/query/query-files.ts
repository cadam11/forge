/**
 * Reading and writing `.sql` files through the native dialogs.
 *
 * Ported from `query.component.ts:2306-2357` (`saveQueryToFile` / `openQueryFromFile`), with three
 * things fixed and one thing worked around.
 *
 * ── The workaround: the dialog options are untyped ─────────────────────────────────────────
 *
 * `src/ipc/surface.ts` documents a measured hole in the bridge's types: `app.showOpenDialog`,
 * `app.showSaveDialog` and both of their return types are declared with Electron's global
 * `Electron.*` namespace, which this package's tsconfig deliberately does not load — so
 * `skipLibCheck` swallows the unresolved reference and all three signatures silently degrade to error
 * types that behave like `any`. That note ends with "type the dialog options locally at that call
 * site", and these two interfaces are that. They are the shape `main/src/ipc/app.handlers.ts` actually
 * forwards to Electron, and they exist so a typo in a filter is a compile error here rather than a
 * silently ignored option at runtime.
 *
 * ── The three fixes ────────────────────────────────────────────────────────────────────────
 *
 * 1. **A saved tab stops being dirty.** The Angular version wrote the file, showed "Query saved", and
 *    left `isDirty` set — so the tab kept its unsaved dot forever and the `beforeunload` guard Task 7
 *    built kept warning about work that was on disk. `markClean` is called here on success.
 * 2. **⌘S remembers where the file came from.** Angular bound Save and Save As to the same function,
 *    so every ⌘S opened a dialog. The path is remembered on the tab and reused; Save As always prompts.
 * 3. **A cancelled dialog is not an error.** `result.canceled` is checked before `filePath`, so
 *    dismissing the sheet is silent instead of reaching the failure toast.
 */

import { ipc, isIpcAvailable } from '../../ipc';
import { diagnostics, notify } from '../../state/diagnostics';
import { tabStore } from '../../state/tab';

/** The subset of Electron's `SaveDialogOptions` this app passes. See the header for why it is local. */
interface SaveDialogOptions {
  readonly title: string;
  readonly defaultPath?: string;
  readonly filters: readonly { readonly name: string; readonly extensions: readonly string[] }[];
}

interface OpenDialogOptions extends Omit<SaveDialogOptions, 'defaultPath'> {
  readonly properties: readonly ('openFile' | 'multiSelections')[];
}

/** Both dialogs' returns, as `main` forwards them. */
interface SaveDialogResult {
  readonly canceled: boolean;
  readonly filePath?: string;
}
interface OpenDialogResult {
  readonly canceled: boolean;
  readonly filePaths?: readonly string[];
}

const SQL_FILTERS = [
  { name: 'SQL Files', extensions: ['sql'] },
  { name: 'All Files', extensions: ['*'] },
] as const;

/** Where a tab's SQL was last saved to or opened from, kept on the tab so ⌘S can reuse it. */
export const FILE_PATH_METADATA_KEY = 'filePath';

export function rememberedFilePath(metadata: Record<string, unknown> | undefined): string | null {
  const value = metadata?.[FILE_PATH_METADATA_KEY];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Writes the tab's SQL to disk.
 *
 * `promptForPath` false is ⌘S: it reuses the remembered path when there is one and falls back to the
 * dialog when there is not. True is ⇧⌘S and always asks.
 */
export async function saveQueryToFile(options: {
  readonly tabId: string;
  readonly sql: string;
  readonly promptForPath: boolean;
  readonly rememberedPath: string | null;
}): Promise<void> {
  if (!isIpcAvailable()) return;
  if (options.sql.trim() === '') {
    notify.warning('No query to save');
    return;
  }

  try {
    let filePath = options.promptForPath ? null : options.rememberedPath;

    if (filePath === null) {
      const dialogOptions: SaveDialogOptions = {
        title: 'Save Query',
        defaultPath: options.rememberedPath ?? 'query.sql',
        filters: SQL_FILTERS,
      };
      // The cast is the hole documented in the header: without it the untyped signature would accept
      // anything at all, so the local type is asserted INTO the call rather than inferred from it.
      const result = (await ipc().app.showSaveDialog(dialogOptions)) as SaveDialogResult;
      if (result.canceled || result.filePath === undefined) return;
      filePath = result.filePath;
    }

    await ipc().workspace.writeFile(filePath, options.sql);
    tabStore.getState().updateTab(options.tabId, {
      metadata: {
        ...tabStore.getState().tabs.find(tab => tab.id === options.tabId)?.metadata,
        [FILE_PATH_METADATA_KEY]: filePath,
      },
    });
    // Fix 1: the tab is no longer dirty, and the clean baseline moves to what was written.
    tabStore.getState().markClean(options.tabId);
    notify.success('Query saved');
  } catch (error) {
    notify.error('Failed to save query');
    diagnostics.error('failed to save query to file', error);
  }
}

/** Reads a `.sql` file. Resolves with its contents and path, or `null` when the dialog was dismissed. */
export async function openQueryFile(): Promise<{ path: string; content: string } | null> {
  if (!isIpcAvailable()) return null;
  try {
    const dialogOptions: OpenDialogOptions = {
      title: 'Open Query',
      filters: SQL_FILTERS,
      properties: ['openFile'],
    };
    const result = (await ipc().app.showOpenDialog(dialogOptions)) as OpenDialogResult;
    const path = result.filePaths?.[0];
    if (result.canceled || path === undefined) return null;
    return { path, content: await ipc().workspace.readFile(path) };
  } catch (error) {
    notify.error('Failed to open query file');
    diagnostics.error('failed to open a query file', error);
    return null;
  }
}
