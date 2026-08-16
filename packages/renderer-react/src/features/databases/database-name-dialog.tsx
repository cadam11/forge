/**
 * The shape both database-name dialogs take: one field, a live reason when the name is not usable, and
 * a submit that reports its own failure inline.
 *
 * ── One component for two dialogs, and what each of them adds ───────────────────────────────
 *
 * `create-database-dialog.component.ts` (193) and `rename-database-dialog.component.ts` (208) were
 * near-duplicates: the same regex, the same disabled button, the same `error()` signal, the same
 * `.error-message` block with its own hardcoded `rgba(244, 67, 54, 0.1)`. The two differences are a
 * read-only "current name" line and a recovery-model select, both of which are props here — so the
 * validation, the busy state, the failure rendering and the Enter-submits behaviour exist once.
 *
 * Extra controls come in as `extra` and sit inside the body's `<fieldset>`, which is what disables them
 * while a submit is in flight. A `fieldset[disabled]` rather than a `disabled` prop threaded through
 * every child: it is native, it cannot miss one, and it does not reach the action row (the submit button
 * needs to stay reachable to show that it is working).
 */

import { useState, type FormEvent, type ReactNode } from 'react';

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
  Input,
  Spinner,
} from '../../ui';
import { FormAnswerBand } from '../forms';
import { validateDatabaseName } from './database-name';

export interface DatabaseNameDialogProps {
  readonly testId: string;
  readonly title: string;
  readonly description: string;
  /** The label on the field. "Name" for a create, "New name" for a rename. */
  readonly nameLabel: string;
  readonly submitLabel: string;
  /** What the button says while the server is working. */
  readonly busyLabel: string;
  readonly initialName?: string;
  /** The name being replaced. Rendered as context, and refused as an answer. */
  readonly currentName?: string;
  /** Names already on this server, so a collision is reported before the round trip. */
  readonly taken: readonly string[];
  readonly extra?: ReactNode;
  /**
   * Perform the operation. Resolves `null` on success — which is what closes the dialog — or the
   * message to show in the answer band. A rejected promise is reported as an unnamed failure rather
   * than swallowed.
   */
  readonly onSubmit: (name: string) => Promise<string | null>;
  readonly onDismiss: () => void;
}

export function DatabaseNameDialog({
  testId,
  title,
  description,
  nameLabel,
  submitLabel,
  busyLabel,
  initialName = '',
  currentName,
  taken,
  extra,
  onSubmit,
  onDismiss,
}: DatabaseNameDialogProps) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  /** What the server said, or what the last submit could not do. Cleared as soon as the name changes. */
  const [failure, setFailure] = useState<string | null>(null);
  /** False until the first submit, so an untouched field is not scolded for being empty. */
  const [attempted, setAttempted] = useState(false);

  const problem = validateDatabaseName(name, { taken, currentName });
  // Shown once the user has tried, or as soon as they have typed something wrong — never on an empty
  // field they have not touched.
  const showProblem = problem !== null && (attempted || name.trim() !== '');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setAttempted(true);
    if (problem !== null || busy) return;

    setBusy(true);
    setFailure(null);
    void onSubmit(name.trim())
      .then(message => {
        // Success closes the dialog, and it is the submit that does it rather than the host: the host
        // cannot see that the promise resolved without threading a second callback for the one case.
        if (message === null) {
          onDismiss();
          return;
        }
        setFailure(message);
      })
      .catch(() => setFailure('The server refused the change and gave no reason.'))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open onOpenChange={next => (next ? undefined : onDismiss())}>
      <DialogContent size="sm" data-testid={testId}>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <DialogBody className="p-0">
            {/* No border, no padding of its own: the fieldset is a disabling wrapper, not a group. */}
            <fieldset disabled={busy} className="flex flex-col gap-3 p-4">
              {currentName === undefined ? null : (
                <p className="text-sm text-fg-muted">
                  Renaming{' '}
                  <span data-testid="database-current-name" className="font-mono text-fg">
                    {currentName}
                  </span>
                </p>
              )}

              <Input
                name="database-name"
                label={nameLabel}
                data-testid="database-name-input"
                value={name}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                error={showProblem ? problem.message : undefined}
                hint={
                  showProblem
                    ? undefined
                    : 'Letters, numbers and underscores. It has to be unique on this server.'
                }
                onChange={event => {
                  setName(event.target.value);
                  setFailure(null);
                }}
              />

              {extra}
            </fieldset>
          </DialogBody>

          {/* The server's own message, in the band both wizards use for the same job. */}
          <FormAnswerBand hint={failure ?? undefined} hintTestId="database-operation-error" />

          <DialogActions>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy} data-testid="database-dialog-cancel">
                Cancel
              </Button>
            </DialogClose>
            {/* The one filled oxide affordance in this dialog — HOUSE-RULES §5. */}
            <Button
              variant="primary"
              type="submit"
              disabled={busy || problem !== null}
              data-testid="database-dialog-submit"
            >
              {busy ? <Spinner size="sm" /> : null}
              {busy ? busyLabel : submitLabel}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
