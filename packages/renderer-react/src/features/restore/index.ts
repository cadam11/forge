/**
 * The restore feature's public surface. Import from `../restore`, never from a file inside it — the
 * same discoverability rule `src/ui/index.ts` and `features/backup/index.ts` state.
 *
 * `RestoreDialogs` is what the shell mounts. Everything else is exported for the specs and for the
 * gate script; nothing else in the app reaches the wizard except through the command bus.
 *
 * Four pieces are **not** here because they are Task 12's and are imported from `../backup` rather
 * than reimplemented: `ServerFileBrowser` (in `mode="open"`, as a body swap in this dialog's own
 * frame), `MissingCliTools`, the probe phase machine (`derivePhase` / `phaseForToolsResult`), and
 * `progressPercent` / `formatBytes` / the `server-path` helpers. The in-flight run record is neither
 * feature's: it lives in `state/db-operations.ts`, shared, so a restore into a database that is
 * mid-dump is refused.
 */

export { RestoreDialog, type RestoreDialogProps } from './restore-dialog';
export { RestoreDialogs } from './restore-dialogs';
export {
  applyRestoreProgress,
  bindRestoreRunId,
  changedRelocations,
  confirmationRequired,
  confirmationSatisfied,
  defaultRestoreValues,
  engineRestoreOptions,
  planFor,
  restoreOperationId,
  restoreProblem,
  restoreProgressLabel,
  restoreTsql,
  sourceIsServerSide,
  suggestedRelocations,
  suggestedTargetName,
  targetCreatedBy,
  targetKindFor,
  targetNameProblem,
  type EngineRestoreOptions,
  type Relocation,
  type RestoreFormValues,
  type RestorePhase,
  type RestorePlan,
  type TargetCreator,
  type TargetKind,
} from './restore-model';
