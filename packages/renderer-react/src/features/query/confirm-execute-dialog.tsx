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
 * It is deliberately NOT `QuerySettings.confirmBeforeExecute`: that setting is a *permanent* confirm
 * on every execute, it is unread by anything in the Angular renderer, and Task 15 owns its panel.
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

export interface ConfirmExecuteDialogProps {
  readonly open: boolean;
  /** Closed without executing — backdrop, Escape, or Cancel. */
  readonly onCancel: () => void;
  /** Execute. `remember` is the "Don't ask me again" tick, which the caller persists. */
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
  onCancel,
  onConfirm,
  onReturnFocus,
}: ConfirmExecuteDialogProps) {
  const [remember, setRemember] = useState(false);
  const executeButton = useRef<HTMLButtonElement | null>(null);
  const shortcut = keyHint('E');

  return (
    <Dialog open={open} onOpenChange={next => (next ? undefined : onCancel())}>
      <DialogContent
        size="sm"
        data-testid="query-confirm-execute"
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
            {shortcut} runs the current query against the connected database. This matches the
            familiar SSMS shortcut.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Checkbox
            name="query-confirm-execute-remember"
            label="Don't ask me again"
            data-testid="query-confirm-execute-remember"
            checked={remember}
            onChange={event => setRemember(event.target.checked)}
          />
        </DialogBody>
        <DialogActions>
          <DialogClose asChild>
            <Button variant="outline" data-testid="query-confirm-execute-cancel">
              Cancel
            </Button>
          </DialogClose>
          {/* The one filled oxide affordance in this dialog — HOUSE-RULES §5. */}
          <Button
            ref={executeButton}
            data-testid="query-confirm-execute-run"
            onClick={() => onConfirm(remember)}
          >
            Execute
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
