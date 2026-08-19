/**
 * Rename a database. Replaces `rename-database-dialog.component.ts` (208).
 *
 * Two things it adds to the shared dialog:
 *
 *  - the **current name**, as read-only context and as a refused answer (`validateDatabaseName`'s
 *    `currentName`), so "Rename" cannot be pressed on the name it already has;
 *  - the field is **pre-filled** with that name, as Angular did, because a rename is usually an edit
 *    rather than a fresh answer.
 *
 * The `closeConnections: true` on the bridge call lives in the host (`database-dialogs.tsx`) with the
 * rest of the operation, not here: it is what makes the rename possible at all on SQL Server, and it is
 * not a choice this dialog offers.
 */

import { DatabaseNameDialog } from './database-name-dialog';

export interface RenameDatabaseDialogProps {
  readonly currentName: string;
  readonly taken: readonly string[];
  readonly onSubmit: (newName: string) => Promise<string | null>;
  readonly onDismiss: () => void;
}

export function RenameDatabaseDialog({
  currentName,
  taken,
  onSubmit,
  onDismiss,
}: RenameDatabaseDialogProps) {
  return (
    <DatabaseNameDialog
      testId="rename-database-dialog"
      title="Rename database"
      description="Open connections to this database are closed so the server will allow the rename."
      nameLabel="New name"
      submitLabel="Rename"
      busyLabel="Renaming…"
      initialName={currentName}
      currentName={currentName}
      taken={taken}
      onSubmit={onSubmit}
      onDismiss={onDismiss}
    />
  );
}
