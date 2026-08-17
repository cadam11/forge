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
 * ── The third gate: an MSSQL plan runs the statement (Task 19b) ────────────────────────────
 *
 * Same dialog again, and for the same reason: the question is "may I run this against your database?",
 * and asking it in a third dialog with third wording is how a user learns that two of the three are
 * lying about something. What differs is that this one is not a preference — there is no "don't ask me
 * again", because the consequence is per-statement and the answer to "show me the plan for this DELETE"
 * must be a decision every time.
 *
 * `gate` is what differs. The ⌃E gate is a **one-time** confirmation, so it offers "Don't ask me again";
 * the setting's gate is one the user switched on deliberately and can only switch off in Settings, so it
 * offers no checkbox and says where the switch is instead. A "don't ask again" tick on the permanent
 * gate would be a second, hidden way to turn a setting off — the state would then disagree with the
 * switch that is still showing "on". The plan gate offers no tick either, for the reason above.
 *
 * ── The plan gate SHOWS the statement, and the other two do not ─────────────────────────────
 *
 * The plan gate can be raised by the command palette, and the statement it will run is whatever the
 * caret or the selection resolved to — which on a whole-buffer fallback is not necessarily the line the
 * user is looking at. Consenting to "run this" without being shown what "this" is is not consent, so the
 * plan gate prints the statement (first `PLAN_SQL_PREVIEW_LINES` lines, with the rest counted rather than
 * hidden). The ⌃E and `always` gates do not, and deliberately: both are raised by the user's own Execute,
 * a keystroke or a click away from the editor they just typed it into.
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
 * Which gate raised this dialog.
 *
 * - `ctrl-e` — the one-time shortcut confirmation;
 * - `always` — `QuerySettings.confirmBeforeExecute`;
 * - `actual-plan` — Task 19b. SQL Server cannot report a plan for a statement it has not run (`SET
 *   SHOWPLAN_*` may not share a batch with the statement it explains, so the only plan reachable through
 *   `query.execute` is `SET STATISTICS PROFILE`'s — see `execution-plan.ts`). "Show execution plan" on a
 *   `DELETE` therefore deletes rows, and the user has to be told BEFORE that happens rather than after.
 *
 * See the file header for why one dialog serves all three.
 */
export type ExecuteGate = 'ctrl-e' | 'always' | 'actual-plan';

/**
 * How many lines of the statement the plan gate prints before it counts the remainder.
 *
 * Three is enough to recognise a statement by — the verb, its target, and the start of its predicate —
 * without turning a modal into a scrolling editor. The count of what is left is what stops the preview
 * from being a lie by omission.
 */
export const PLAN_SQL_PREVIEW_LINES = 3;

export interface ConfirmExecuteDialogProps {
  readonly open: boolean;
  /** Which confirmation this is. Decides the copy and whether "Don't ask me again" is offered. */
  readonly gate: ExecuteGate;
  /**
   * The statement being consented to. Rendered by the `actual-plan` gate and by no other — see the file
   * header. Required rather than optional so a caller cannot forget it on the one gate that shows it.
   */
  readonly sql: string;
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

/**
 * The first few lines of a statement, and how many were left out. Pure, so the truncation is testable
 * without a render.
 */
export function planSqlPreview(sql: string): { readonly text: string; readonly moreLines: number } {
  const lines = sql.trim().split('\n');
  if (lines.length <= PLAN_SQL_PREVIEW_LINES) {
    return { text: lines.join('\n'), moreLines: 0 };
  }
  return {
    text: lines.slice(0, PLAN_SQL_PREVIEW_LINES).join('\n'),
    moreLines: lines.length - PLAN_SQL_PREVIEW_LINES,
  };
}

export function ConfirmExecuteDialog({
  open,
  gate,
  sql,
  onCancel,
  onConfirm,
  onReturnFocus,
}: ConfirmExecuteDialogProps) {
  const [remember, setRemember] = useState(false);
  // Cleared on the way IN to each open, because this component lives for the tab's lifetime and only
  // `open` changes: without this, ticking "don't ask me again", cancelling, and pressing ⌃E again showed
  // the box still ticked — one Execute away from a choice the user had explicitly backed out of. Adjusted
  // during render rather than in an effect, which is React's documented way to react to a changed prop
  // (and `react-hooks/set-state-in-effect` rejects the effect version); bounded, because the branch stores
  // the value it reacted to. Only the false→true edge resets, so a re-render mid-dialog leaves a live tick
  // alone.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setRemember(false);
  }
  const executeButton = useRef<HTMLButtonElement | null>(null);
  const shortcut = keyHint('E');
  const oneTime = gate === 'ctrl-e';
  const forPlan = gate === 'actual-plan';
  const preview = planSqlPreview(sql);

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
          <DialogTitle>{forPlan ? 'Run the query to get its plan?' : 'Execute query?'}</DialogTitle>
          <DialogDescription>
            {forPlan
              ? 'SQL Server only reports a plan for a statement it has run, so this executes the ' +
                'statement against the connected database. On PostgreSQL and MySQL a plan costs nothing; ' +
                'here it does not.'
              : oneTime
                ? `${shortcut} runs the current query against the connected database. This matches the familiar SSMS shortcut.`
                : 'This runs against the connected database. Settings ▸ Query is where to stop being asked.'}
          </DialogDescription>
        </DialogHeader>
        {forPlan ? (
          <DialogBody>
            <pre
              data-testid="query-confirm-execute-sql"
              className={
                'max-h-32 overflow-auto rounded-sm border border-rule bg-canvas p-2 font-mono ' +
                'text-sm whitespace-pre-wrap text-fg'
              }
            >
              {preview.text}
            </pre>
            {preview.moreLines === 0 ? null : (
              <p
                data-testid="query-confirm-execute-sql-more"
                className="mt-1 text-sm text-fg-subtle"
              >
                … {preview.moreLines} more {preview.moreLines === 1 ? 'line' : 'lines'}
              </p>
            )}
          </DialogBody>
        ) : null}
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
            {forPlan ? 'Run and show plan' : 'Execute'}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
