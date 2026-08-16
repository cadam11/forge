/**
 * The Flyway `${placeholder}` prompt.
 *
 * **This replaces the second of the two `document.createElement` + `innerHTML` modals**
 * (`query.component.ts:1663-1777`), and that one was worse than the first: it interpolated the
 * remembered values into an HTML string —
 *
 *     value="${val.replace(/"/g, '&quot;')}"
 *
 * — which escapes exactly one character. A remembered value containing `>` or `<script` was written
 * straight into the document, and the values come from a JSON blob on disk. It also built its inputs
 * with `data-placeholder` attributes and read them back with `querySelectorAll`, so the form had no
 * React state, no labels associated with anything, and its per-input keydown listeners were attached
 * in a loop with no cleanup.
 *
 * Here the values are React state, the inputs are the `Input` primitive (real `<label for>`, which is
 * what makes the e2e helper's `getByLabel` work — `ui/field.tsx`), and nothing is interpolated into
 * markup at all. `dangerouslySetInnerHTML` is banned outside `src/markdown/` by ESLint, so this class
 * of defect cannot be reintroduced.
 *
 * ── Behaviour kept from the original ───────────────────────────────────────────────────────
 *
 *  - fields are pre-filled from remembered values (`editor-prefs.ts`, the migrated
 *    `joinery-flyway-placeholder-values` key);
 *  - Enter in any field submits, Escape cancels — here because it is a `<form>` and a `Dialog`,
 *    rather than through a listener per input;
 *  - submitting merges the collected values over the remembered ones and substitutes ALL occurrences;
 *  - cancelling resolves to nothing and the query does not run.
 *
 * One thing deliberately changed: an empty value is allowed to be submitted, exactly as before, but
 * the primary button says how many placeholders are still blank so "Execute" is not a silent
 * `WHERE id = `.
 */

import { useState, type FormEvent } from 'react';

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
} from '../../ui';

export interface PlaceholderDialogProps {
  /** The placeholder names to prompt for, in first-appearance order. Empty means "not open". */
  readonly placeholders: readonly string[];
  /** Values remembered from previous prompts, used to pre-fill. */
  readonly remembered: Readonly<Record<string, string>>;
  readonly onCancel: () => void;
  readonly onSubmit: (values: Readonly<Record<string, string>>) => void;
  /** Where focus goes when this closes. See `ConfirmExecuteDialog` — same reason, same shape. */
  readonly onReturnFocus: () => void;
}

export function PlaceholderDialog({
  placeholders,
  remembered,
  onCancel,
  onSubmit,
  onReturnFocus,
}: PlaceholderDialogProps) {
  /**
   * Keyed by placeholder name, seeded from the remembered values.
   *
   * `key` on the dialog content below is what resets this between prompts: a second query with
   * different placeholders gets a fresh state object rather than the previous query's answers, and
   * that is React's own remount mechanism rather than an effect that syncs props into state.
   */
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(placeholders.map(name => [name, remembered[name] ?? '']))
  );

  const blankCount = placeholders.filter(name => (values[name] ?? '').trim() === '').length;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onSubmit(values);
  };

  return (
    <Dialog open onOpenChange={next => (next ? undefined : onCancel())}>
      <DialogContent
        size="md"
        data-testid="query-placeholders"
        onCloseAutoFocus={event => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Placeholder values</DialogTitle>
            <DialogDescription>
              This SQL contains {placeholders.length}{' '}
              {placeholders.length === 1 ? 'placeholder' : 'placeholders'}. Values are substituted
              before the query runs, and remembered for next time.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {placeholders.map(name => (
              <Input
                key={name}
                name={`placeholder-${name}`}
                // The label IS the token, mono, so it reads as the thing it will replace.
                label={`\${${name}}`}
                data-testid="query-placeholder-input"
                value={values[name] ?? ''}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
                onChange={event =>
                  setValues(current => ({ ...current, [name]: event.target.value }))
                }
              />
            ))}
          </DialogBody>
          <DialogActions>
            {blankCount > 0 ? (
              <p data-testid="query-placeholders-blank" className="mr-auto text-md text-fg-muted">
                {blankCount} {blankCount === 1 ? 'value is' : 'values are'} still empty
              </p>
            ) : null}
            <DialogClose asChild>
              <Button variant="outline" data-testid="query-placeholders-cancel">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" data-testid="query-placeholders-run">
              Execute
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
