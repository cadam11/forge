/**
 * The chat feature. Three entry points, and nothing else needs to be reached from outside:
 *
 *  - `ChatSurface` — the conversation UI, mounted by `shell/chat-side-panel.tsx` with the panel's
 *    store instance;
 *  - `ChatTabPanel` — the same surface as a Dockview panel, mounted by `shell/workspace/workspace.tsx`;
 *  - `ChatCommands` — the two command handlers, mounted once by the shell.
 *
 * The store-per-tab registry is deliberately not re-exported: `ChatTabPanel` is its only caller, and a
 * second one would be a second lifetime for the same subscription.
 */

export { ChatCommands } from './chat-commands';
export { ChatSurface, type ChatSurfaceMode, type ChatSurfaceProps } from './chat-surface';
export { ChatTabPanel } from './chat-tab-panel';
