/**
 * The ERD feature. Two entry points:
 *
 *  - `ErdPanel` — the tab, mounted by `shell/workspace/workspace.tsx`;
 *  - `ErdCommands` — the `open-erd` handler, mounted once by the shell.
 *
 * Everything else is internal on purpose. The pure modules (`erd-adapter`, `erd-layout`,
 * `erd-model`, `erd-viewport`) are imported by their own specs by path, which is what keeps this
 * barrel a statement about the feature's surface rather than a re-export of its contents.
 */

export { ErdCommands } from './erd-commands';
export { ErdPanel, ErdSurface } from './erd-panel';
