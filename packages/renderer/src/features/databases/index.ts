/**
 * Database management: the create and rename dialogs, and the invalidation they trigger.
 *
 * `DatabaseDialogs` is the only entry point the shell mounts. `forgetErdForDatabase` and the two
 * `invalidateAfter*` functions are exported for their specs and for the eventual main-side signal J-64
 * describes, which will want the same fan-out from a different producer.
 */

export { DatabaseDialogs } from './database-dialogs';
export { CreateDatabaseDialog, type CreateDatabaseDialogProps } from './create-database-dialog';
export { RenameDatabaseDialog, type RenameDatabaseDialogProps } from './rename-database-dialog';
export {
  invalidateAfterDatabaseCreate,
  invalidateAfterDatabaseRename,
  type DatabaseCacheInvalidator,
} from './database-invalidation';
export { validateDatabaseName, MAX_DATABASE_NAME_LENGTH, type NameProblem } from './database-name';
