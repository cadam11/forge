/**
 * The ERD feature. Two entry points:
 *
 *  - `ErdPanel` — the tab, mounted by `shell/workspace/workspace.tsx`;
 *  - `ErdCommands` — the `open-erd` handler, mounted once by the shell.
 *
 * Everything else is internal on purpose. The pure modules (`erd-adapter`, `erd-layout`,
 * `erd-model`, `erd-viewport`) are imported by their own specs by path, which is what keeps this
 * barrel a statement about the feature's surface rather than a re-export of its contents.
 *
 * The one exception is `forgetErdForDatabase`, and it is exported because the ERD is not the only
 * feature that can invalidate a diagram: creating or renaming a database makes every cached diagram of
 * that name wrong, and Task 19a's fan-out (`features/databases/database-invalidation.ts`) is what says
 * so. The cache's other members stay internal — a caller outside the feature has no business writing
 * one.
 */

export { ErdCommands } from './erd-commands';
export { forgetErdForDatabase } from './erd-cache';
export { ErdPanel, ErdSurface } from './erd-panel';
