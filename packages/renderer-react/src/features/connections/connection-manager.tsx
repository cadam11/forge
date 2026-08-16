/**
 * The connection manager: the saved profiles, and the five things you can do to one.
 *
 * Ported from `shared/components/connection-manager-dialog/connection-manager-dialog.component.ts`
 * (348 LOC). PLAN.md §2.9 settles what it is for — "connection *management* stays a dialog too; its
 * only job is to launch the editor" — so this file holds a list, a two-step delete, and the two
 * entry points into `ConnectionEditor`. Everything about a profile's *contents* is the editor's.
 *
 * ── Three properties worth naming ────────────────────────────────────────────────────────────
 *
 *  - **Every action carries its own profile id.** No row resolves "the active connection", which is
 *    the bug class `tests/e2e-react/multi-connection-disconnect.spec.ts` exists to pin at the
 *    sidebar level and which a list of rows is the easiest place to reintroduce.
 *  - **Delete is two-step, in place.** The Angular version swapped the trash icon for a tick and a
 *    cross on the row itself rather than opening a nested confirm dialog, and that is kept: a modal
 *    over a modal to delete one list row is disproportionate. What is added is the `aria-label`
 *    naming the profile, so the confirm step is unambiguous to a screen reader.
 *  - **The editor replaces this dialog and hands control back.** `ConnectionDialogs` owns that
 *    sequencing; this component only says which profile to open. Two stacked Radix modals would
 *    double the scrim and leave the manager's focus trap underneath the editor's.
 */

import { useState, type CSSProperties } from 'react';
import { Check, Database, Pencil, Plug, Plus, Trash2, Unplug, X } from 'lucide-react';
import { ENGINE_LABELS, type ConnectionProfile } from '@joinery/shared';

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Icon,
  Tooltip,
  cn,
} from '../../ui';
import { connectionStore, useConnectionStore } from '../../state/connection';
import { connectProfile, disconnectConnection } from '../../shell/sidebar/node-actions';

export interface ConnectionManagerProps {
  readonly onDismiss: () => void;
  /** Open the editor on this profile, or on a blank form when the id is `null`. */
  readonly onEdit: (profileId: string | null) => void;
}

export function ConnectionManager({ onDismiss, onEdit }: ConnectionManagerProps) {
  const profiles = useConnectionStore(state => state.profiles);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={open => (open ? undefined : onDismiss())}>
      <DialogContent size="md" data-testid="connection-manager">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <Icon icon={Database} size="sm" className="stroke-fg-muted" />
              Manage connections
            </span>
          </DialogTitle>
          <DialogDescription>
            {profiles.length === 1 ? '1 saved connection' : `${profiles.length} saved connections`}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {profiles.length === 0 ? (
            <EmptyState
              size="sm"
              icon={Database}
              title="No saved connections"
              description="A profile keeps a server, its credentials and its options together so you can reconnect in one click."
              data-testid="connection-manager-empty"
              action={
                <Button
                  size="sm"
                  leadingIcon={Plus}
                  data-testid="connection-manager-empty-new"
                  onClick={() => onEdit(null)}
                >
                  New connection
                </Button>
              }
            />
          ) : (
            // Hairline-separated rows straight on the dialog surface, per `tables.md`'s look: no
            // card, no vertical rules, no outer border.
            <ul
              className="flex flex-col divide-y divide-rule"
              data-testid="connection-manager-list"
            >
              {profiles.map(profile => (
                <ProfileRow
                  key={profile.id}
                  profile={profile}
                  confirmingDelete={confirmingDeleteId === profile.id}
                  onConfirmDelete={setConfirmingDeleteId}
                  onEdit={onEdit}
                />
              ))}
            </ul>
          )}
        </DialogBody>

        <DialogActions>
          <DialogClose asChild>
            <Button variant="ghost" data-testid="connection-manager-close">
              Close
            </Button>
          </DialogClose>
          <Button
            variant="primary"
            leadingIcon={Plus}
            data-testid="connection-manager-new"
            onClick={() => onEdit(null)}
          >
            New connection
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

function ProfileRow({
  profile,
  confirmingDelete,
  onConfirmDelete,
  onEdit,
}: {
  readonly profile: ConnectionProfile;
  readonly confirmingDelete: boolean;
  readonly onConfirmDelete: (profileId: string | null) => void;
  readonly onEdit: (profileId: string) => void;
}) {
  const connected = useConnectionStore(state => state.connectedProfileIds.has(profile.id));

  return (
    <li
      data-testid="connection-manager-row"
      data-connected={connected ? 'true' : 'false'}
      className={cn('flex items-center gap-3 px-1 py-2', connected && 'bg-accent-subtle')}
    >
      {profile.color === undefined ? null : (
        <span
          aria-hidden
          data-testid="connection-manager-row-color"
          className="size-2 shrink-0 rounded-full bg-(--profile-color)"
          style={{ '--profile-color': profile.color } as CSSProperties}
        />
      )}
      <div className="flex min-w-0 grow flex-col">
        <span className="min-w-0 truncate text-base text-fg">{profile.name}</span>
        <span className="min-w-0 truncate font-mono text-xs text-fg-muted tabular-nums">
          {ENGINE_LABELS[profile.engine]} · {profile.server}:{profile.port}
        </span>
      </div>

      {connected ? (
        // Deliberately NOT chartreuse. HOUSE-RULES §5 caps chartreuse at two visible instances per
        // surface, and this is a list — three open connections would break the cap on their own. An
        // oxide wash on the row plus a muted label is the compliant reading, and "selected-row wash"
        // is one of the jobs the same rule lists for oxide.
        <span
          data-testid="connection-manager-row-connected"
          className="shrink-0 font-mono text-2xs tracking-eyebrow text-fg-muted uppercase"
        >
          Connected
        </span>
      ) : null}

      <div className="flex shrink-0 items-center gap-1">
        {connected ? (
          <RowAction
            icon={Unplug}
            label={`Disconnect ${profile.name}`}
            testId="connection-manager-disconnect"
            onClick={() => disconnectConnection(profile.id)}
          />
        ) : (
          <RowAction
            icon={Plug}
            label={`Connect ${profile.name}`}
            testId="connection-manager-connect"
            onClick={() => void connectProfile(profile.id)}
          />
        )}
        <RowAction
          icon={Pencil}
          label={`Edit ${profile.name}`}
          testId="connection-manager-edit"
          onClick={() => onEdit(profile.id)}
        />

        {confirmingDelete ? (
          <>
            <RowAction
              icon={Check}
              label={`Confirm deleting ${profile.name}`}
              testId="connection-manager-delete-confirm"
              className="text-danger"
              onClick={() => {
                onConfirmDelete(null);
                void connectionStore.getState().deleteProfile(profile.id);
              }}
            />
            <RowAction
              icon={X}
              label={`Keep ${profile.name}`}
              testId="connection-manager-delete-cancel"
              onClick={() => onConfirmDelete(null)}
            />
          </>
        ) : (
          <RowAction
            icon={Trash2}
            label={`Delete ${profile.name}`}
            testId="connection-manager-delete"
            onClick={() => onConfirmDelete(profile.id)}
          />
        )}
      </div>
    </li>
  );
}

/** One icon-only row action. `sm` so four of them fit a 34px row without crowding. */
function RowAction({
  icon,
  label,
  testId,
  className,
  onClick,
}: {
  readonly icon: typeof Plug;
  readonly label: string;
  readonly testId: string;
  readonly className?: string;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip content={label}>
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        leadingIcon={icon}
        aria-label={label}
        data-testid={testId}
        className={cn(className)}
        onClick={onClick}
      />
    </Tooltip>
  );
}
