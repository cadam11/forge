/**
 * The backup feature's public surface. Import from `../backup`, never from a file inside it — the same
 * discoverability rule `src/ui/index.ts` and `features/query/index.ts` state.
 *
 * `BackupDialogs` is what the shell mounts; everything else is exported for Task 13's restore wizard,
 * which shares three of the four pieces:
 *
 *  - **`ServerFileBrowser`** in `mode="open"`, to pick the archive to restore, rendered as a body swap
 *    in its own dialog exactly as `backup-dialog.tsx` does (see that component's header for why it is
 *    not a nested modal). `ServerFilePick` is its result type.
 *  - **`MissingCliTools`**, unchanged: `pg_restore` and the `mysql` client are probed by the same
 *    `backup.checkTools` channel, so the restore dialog's tools branch is this view with a different
 *    host.
 *  - **`cliEngineFor` / `destinationIsServerSide` / `derivePhase` / `phaseForToolsResult` /
 *    `progressPercent` / `progressLabel` / `formatBytes`** — the engine rules and the phase machine,
 *    which are the same for a restore. `RestoreProgress` is structurally identical to `BackupProgress`,
 *    so `progressPercent`/`progressLabel` take what they need rather than the whole event.
 *  - the `server-path.ts` helpers, for the browser's path arithmetic.
 *
 * `BackupDialog` itself is exported for its spec and for nothing else — the app reaches it only through
 * the command bus. `BackupRunCoordination` comes with it (the spec has to hand it one).
 *
 * The in-flight record is **not** here: Task 13 took the reuse this header used to ask for, and it now
 * lives in `state/db-operations.ts`, shared by both wizards and keyed with no operation kind in it, so
 * a restore into a database that is mid-dump collides with that dump. `resetDbOperationsForTests` comes
 * from there.
 */

export { BackupDialog, type BackupDialogProps, type BackupRunCoordination } from './backup-dialog';
export { BackupDialogs } from './backup-dialogs';
export { MissingCliTools, type MissingCliToolsProps } from './missing-cli-tools';
export {
  ServerFileBrowser,
  type ServerFileBrowserProps,
  type ServerFilePick,
} from './server-file-browser';
export {
  applyProgress,
  backupTsql,
  bindRunId,
  BACKUP_TYPES,
  cliEngineFor,
  defaultBackupValues,
  derivePhase,
  destinationIsServerSide,
  engineBackupOptions,
  fileStamp,
  formatBytes,
  phaseForToolsResult,
  progressLabel,
  progressPercent,
  suggestedFileName,
  type BackupFormValues,
  type BackupPhase,
  type EngineBackupOptions,
  type PercentReadout,
  type ProbePhase,
  type ToolsProbe,
} from './backup-model';
export {
  directoryOf,
  driveRootPath,
  fileNameOf,
  filterEntries,
  isDriveRoot,
  joinServerPath,
  parentServerPath,
  separatorOf,
  sortEntries,
  trimTrailingSeparator,
  type PathSeparator,
} from './server-path';
