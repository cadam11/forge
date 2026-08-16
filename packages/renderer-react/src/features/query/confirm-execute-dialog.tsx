/**
 * The ⌃E / ⌘E first-time confirmation.
 *
 * **This replaces the first of the two `document.createElement` + `innerHTML` modals**
 * (`query.component.ts:1555-1626`) that PLAN.md §1.2 says die with the query component. What that one
 * was: a hand-built overlay with 27 inline `style=` attributes, an interpolated `innerHTML` string, an
 * `#id`-based `querySelector` per button, a document-level Escape listener it removed only on Escape
 * (so cancelling by clicking the backdrop leaked it), no focus trap, no focus return, no accessible
 * name, and `setTimeout(…, 50)` to focus its primary button.
 *
 * All of that is the `Dialog` primitive's job — Radix supplies the trap, the return of focus, Escape,
 * the scroll lock and the modality (`ui/dialog.tsx`) — and the initial focus is a ref plus Radix's
 * `onOpenAutoFocus` rather than a 50ms timer racing the mount.
 *
 * ── Why the gate exists at all ─────────────────────────────────────────────────────────────
 *
 * ⌃E is the SSMS execute shortcut and Monaco binds ⌘E/⌃E to "Expand Line Selection" by default, so a
 * user who has never used SSMS presses it expecting something harmless and runs a query against a
 * live database instead. The gate is shown once, and "Don't ask me again" persists through
 * `editor-prefs.ts` — which is the migrated `joinery-ctrl-e-execute-confirmed` localStorage key
 * (PLAN.md 0.5), read through hydrated state rather than from `localStorage`.
 *
 * ── The second gate: `QuerySettings.confirmBeforeExecute` (Task 15) ────────────────────────
 *
 * That setting is a *permanent* confirm on every execute, and it was the third of the three query
 * settings the Angular panel wrote while nothing read them — a live-looking toggle that changed nothing
 * (J-44's class of defect). Task 15 wired it, and it lands in this dialog rather than a second one:
 * both gates ask the identical question about the identical SQL, and two dialogs would be two chances to
 * word it differently.
 *
 * `gate` is what differs. The ⌃E gate is a **one-time** confirmation, so it offers "Don't ask me again";
 * the setting's gate is one the user switched on deliberately and can only switch off in Settings, so it
 * offers no checkbox and says where the switch is instead. A "don't ask again" tick on the permanent
 * gate would be a second, hidden way to turn a setting off — the state would then disagree with the
 * switch that is still showing "on".
 */

import { keyHint } from '../../utils/platform';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../ui';
import { useRef, useState } from 'react';

/**
 * Which gate raised this dialog. `ctrl-e` is the one-time shortcut confirmation; `always` is
 * `QuerySettings.confirmBeforeExecute`. See the file header for why one dialog serves both.
 */
export type ExecuteGate = 'ctrl-e' | 'always';

export interface ConfirmExecuteDialogProps {
  readonly open: boolean;
  /** Which confirmation this is. Decides the copy and whether "Don't ask me again" is offered. */
  readonly gate: ExecuteGate;
  /** Closed without executing — backdrop, Escape, or Cancel. */
  readonly onCancel: () => void;
  /**
   * Execute. `remember` is the "Don't ask me again" tick, which the caller persists — and it is always
   * `false` for the `always` gate, which offers no such tick.
   */
  readonly onConfirm: (remember: boolean) => void;
  /**
   * Where focus goes when this closes, and it is REQUIRED rather than optional.
   *
   * A dialog normally returns focus to the element that opened it, and Radix does that for free. This
   * one is opened by a KEYSTROKE, so there is no trigger and Radix's default lands focus on `<body>` —
   * after which the next ⌃E reaches nothing at all and the gate appears broken. Measured in the e2e
   * run, which is also why this is a prop instead of a comment: the caller owns the editor.
   */
  readonly onReturnFocus: () => void;
}

export function ConfirmExecuteDialog({
  open,
  gate,
  onCancel,
  onConfirm,
  onReturnFocus,
}: ConfirmExecuteDialogProps) {
  const [remember, setRemember] = useState(false);
  const executeButton = useRef<HTMLButtonElement | null>(null);
  const shortcut = keyHint('E');
  const oneTime = gate === 'ctrl-e';

  return (
    <Dialog open={open} onOpenChange={next => (next ? undefined : onCancel())}>
      <DialogContent
        size="sm"
        data-testid="query-confirm-execute"
        // Which gate this is, for the suites: the two confirmations are otherwise the same dialog.
        data-gate={gate}
        // The primary action, not the close button Radix would otherwise focus as the first tabbable
        // node. The Angular original did this with `setTimeout(…, 50)`; a ref plus Radix's own
        // open-autofocus hook needs no timer and cannot race the mount.
        onOpenAutoFocus={event => {
          event.preventDefault();
          executeButton.current?.focus();
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Execute query?</DialogTitle>
          <DialogDescription>
            {oneTime
              ? `${shortcut} runs the current query against the connected database. This matches the familiar SSMS shortcut.`
              : 'This runs against the connected database. Settings ▸ Query is where to stop being asked.'}
          </DialogDescription>
        </DialogHeader>
        {oneTime ? (
          <DialogBody>
            <Checkbox
              name="query-confirm-execute-remember"
              label="Don't ask me again"
              data-testid="query-confirm-execute-remember"
              checked={remember}
              onChange={event => setRemember(event.target.checked)}
            />
          </DialogBody>
        ) : null}
        <DialogActions>
          <DialogClose asChild>
            <Button variant="outline" data-testid="query-confirm-execute-cancel">
              Cancel
            </Button>
          </DialogClose>
          {/* The one filled oxide affordance in this dialog — HOUSE-RULES §5. */}
          <Button
            ref={executeButton}
            variant="primary"
            data-testid="query-confirm-execute-run"
            // `oneTime &&`: the tick is only offered by the ⌃E gate, and this component is not
            // remounted between opens — so a tick made and then cancelled must not leak into a later
            // confirmation raised by the setting.
            onClick={() => onConfirm(oneTime && remember)}
          >
            Execute
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
