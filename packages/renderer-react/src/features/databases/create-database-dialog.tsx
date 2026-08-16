/**
 * New database. Replaces `create-database-dialog.component.ts` (193).
 *
 * Everything shared with the rename dialog is `DatabaseNameDialog`; what this file adds is the recovery
 * model, and the one decision in it: **the select is not rendered at all off SQL Server**, rather than
 * rendered and ignored. `CreateDatabaseOptions.recoveryModel` is a T-SQL concept
 * (`ALTER DATABASE … SET RECOVERY`); PostgreSQL and MySQL have no equivalent and main drops the field.
 * The Angular dialog made the same branch, and it is worth keeping deliberately: a control that persists
 * and changes nothing is the J-44 defect, and PLAN.md counted nine of them in the settings panel alone.
 */

import { useState } from 'react';
import type { RecoveryModel } from '@joinery/shared';

import { Select, SelectItem } from '../../ui';
import { DatabaseNameDialog } from './database-name-dialog';

/** The three T-SQL recovery models, with what choosing one costs the user. */
const RECOVERY_MODELS: readonly { readonly id: RecoveryModel; readonly label: string }[] = [
  { id: 'simple', label: 'Simple — no log backups' },
  { id: 'full', label: 'Full — point-in-time recovery' },
  { id: 'bulk_logged', label: 'Bulk-logged' },
];

const DEFAULT_RECOVERY_MODEL: RecoveryModel = 'simple';

export interface CreateDatabaseDialogProps {
  /** True on SQL Server. False hides the select entirely — see the file header. */
  readonly recoveryModels: boolean;
  readonly taken: readonly string[];
  /** `undefined` for `recoveryModel` off SQL Server, so the field never reaches the bridge there. */
  readonly onSubmit: (
    name: string,
    recoveryModel: RecoveryModel | undefined
  ) => Promise<string | null>;
  readonly onDismiss: () => void;
}

export function CreateDatabaseDialog({
  recoveryModels,
  taken,
  onSubmit,
  onDismiss,
}: CreateDatabaseDialogProps) {
  const [recoveryModel, setRecoveryModel] = useState<RecoveryModel>(DEFAULT_RECOVERY_MODEL);

  return (
    <DatabaseNameDialog
      testId="create-database-dialog"
      title="New database"
      description="Created on the server this connection points at."
      nameLabel="Name"
      submitLabel="Create"
      busyLabel="Creating…"
      taken={taken}
      extra={
        recoveryModels ? (
          <Select
            name="recovery-model"
            label="Recovery model"
            data-testid="create-database-recovery"
            value={recoveryModel}
            onValueChange={value => setRecoveryModel(value as RecoveryModel)}
            hint="Simple needs no log backups; full allows point-in-time restore."
          >
            {RECOVERY_MODELS.map(model => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </Select>
        ) : undefined
      }
      onSubmit={name => onSubmit(name, recoveryModels ? recoveryModel : undefined)}
      onDismiss={onDismiss}
    />
  );
}
