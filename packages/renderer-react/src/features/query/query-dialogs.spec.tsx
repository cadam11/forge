/**
 * The two dialogs that replace the Angular query component's `document.createElement` + `innerHTML` modals
 * (`query.component.ts:1555-1626` and `:1663-1777`).
 *
 * What these tests are really for: the replaced modals had no focus trap, no focus return, no accessible
 * name, an Escape listener that leaked when dismissed any other way, and — in the placeholder one — an
 * HTML-interpolated value escaped for exactly one character. Radix supplies the first four, and the
 * assertions below are about the behaviour the ORIGINALS had that must not be lost: the remembered
 * pre-fill, Enter-to-submit, the "don't ask again" tick, and cancelling meaning "do not run".
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmExecuteDialog } from './confirm-execute-dialog';
import { PlaceholderDialog } from './placeholder-dialog';

/**
 * The required props, defaulted so each test overrides only the one it asserts. `gate: 'ctrl-e'` is the
 * one-time shortcut confirmation, which is what this block is about; the setting's `always` gate has its
 * own block below.
 */
const confirmProps = () => ({
  gate: 'ctrl-e' as const,
  sql: 'SELECT 1;',
  onCancel: () => undefined,
  onConfirm: () => undefined,
  onReturnFocus: () => undefined,
});

describe('the ⌃E confirmation', () => {
  it('is closed when `open` is false', () => {
    render(<ConfirmExecuteDialog open={false} {...confirmProps()} />);
    expect(screen.queryByTestId('query-confirm-execute')).toBeNull();
  });

  it('names the shortcut it is explaining, and is labelled for a screen reader', () => {
    render(<ConfirmExecuteDialog open {...confirmProps()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch(/(⌘E|Ctrl\+E)/);
    // The `innerHTML` modal had no accessible name at all.
    expect(screen.getByText('Execute query?')).toBeTruthy();
  });

  it('focuses Execute rather than the close button', async () => {
    render(<ConfirmExecuteDialog open {...confirmProps()} />);
    // Radix's default would be the first tabbable node in the content — the header's ✕.
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('query-confirm-execute-run'))
    );
  });

  it('confirms without remembering by default', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmExecuteDialog open {...confirmProps()} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByTestId('query-confirm-execute-run'));

    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('confirms WITH remembering once the box is ticked', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmExecuteDialog open {...confirmProps()} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByTestId('query-confirm-execute-remember'));
    await userEvent.click(screen.getByTestId('query-confirm-execute-run'));

    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('opens unticked again after a tick was cancelled', async () => {
    // The component is mounted for the tab's lifetime and only `open` changes, so the tick was surviving
    // a cancel: tick, Cancel, ⌃E again, and the box was still ticked — a user who deliberately backed out
    // of "don't ask me again" was one Execute away from it taking effect anyway.
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmExecuteDialog open {...confirmProps()} onConfirm={onConfirm} />
    );
    await userEvent.click(screen.getByTestId('query-confirm-execute-remember'));
    await userEvent.click(screen.getByTestId('query-confirm-execute-cancel'));

    rerender(<ConfirmExecuteDialog open={false} {...confirmProps()} onConfirm={onConfirm} />);
    rerender(<ConfirmExecuteDialog open {...confirmProps()} onConfirm={onConfirm} />);

    const tick = (await screen.findByTestId('query-confirm-execute-remember')) as HTMLInputElement;
    expect(tick.checked).toBe(false);
    await userEvent.click(screen.getByTestId('query-confirm-execute-run'));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('keeps a tick made during the open it was made in', async () => {
    // The reset is on the transition into open, not on every render: a re-render while the dialog is up
    // (the parent's state changes under it) must not un-tick a box the user just ticked.
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmExecuteDialog open {...confirmProps()} onConfirm={onConfirm} />
    );
    await userEvent.click(screen.getByTestId('query-confirm-execute-remember'));

    rerender(<ConfirmExecuteDialog open {...confirmProps()} onConfirm={onConfirm} />);

    expect((screen.getByTestId('query-confirm-execute-remember') as HTMLInputElement).checked).toBe(
      true
    );
    await userEvent.click(screen.getByTestId('query-confirm-execute-run'));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('cancels from the button and from Escape', async () => {
    const onCancel = vi.fn();
    render(<ConfirmExecuteDialog open {...confirmProps()} onCancel={onCancel} />);

    await userEvent.click(screen.getByTestId('query-confirm-execute-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();

    await userEvent.keyboard('{Escape}');
    // The original's Escape listener was removed only on Escape, so cancelling any other way leaked it.
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

/*
 * The second gate: `QuerySettings.confirmBeforeExecute`, which Task 15 wired and which the Angular panel
 * wrote while nothing read it. Same dialog, and these assertions are the two things that MUST differ —
 * otherwise a permanent confirmation would offer a hidden second way to turn a setting off.
 */
describe('the confirm-before-every-execute gate', () => {
  const alwaysProps = () => ({ ...confirmProps(), gate: 'always' as const });

  it('offers no "don’t ask me again" tick, and says where the switch is instead', () => {
    render(<ConfirmExecuteDialog open {...alwaysProps()} />);

    expect(screen.queryByTestId('query-confirm-execute-remember')).toBeNull();
    expect(screen.getByRole('dialog').textContent).toContain('Settings');
  });

  it('cannot carry a tick over from a ⌃E confirmation that was cancelled', async () => {
    // The component is not remounted between opens, so `remember` survives a cancel. It must not reach
    // a confirmation raised by the setting, which offers no such choice.
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmExecuteDialog open {...confirmProps()} onConfirm={onConfirm} />
    );
    await userEvent.click(screen.getByTestId('query-confirm-execute-remember'));

    rerender(<ConfirmExecuteDialog open {...alwaysProps()} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByTestId('query-confirm-execute-run'));

    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('names which gate it is, for the suites', () => {
    render(<ConfirmExecuteDialog open {...alwaysProps()} />);
    expect(screen.getByTestId('query-confirm-execute').getAttribute('data-gate')).toBe('always');
  });
});

/*
 * The third gate: an MSSQL execution plan RUNS the statement.
 *
 * What these assert beyond the copy is the statement being ON SCREEN. This gate can be raised from the
 * command palette, and what it runs is whatever the caret or the selection resolved to — so without the
 * preview a user could consent to a `DELETE` two screens up from the one they were reading. Consent to
 * "run this" requires being shown what "this" is.
 */
describe('the actual-plan gate', () => {
  const planProps = (sql: string) => ({
    ...confirmProps(),
    gate: 'actual-plan' as const,
    sql,
  });

  it('says SQL Server has to run the statement, and offers no "don’t ask again"', () => {
    render(<ConfirmExecuteDialog open {...planProps('DELETE FROM orders WHERE id = 4;')} />);

    const dialog = screen.getByTestId('query-confirm-execute');
    expect(dialog.getAttribute('data-gate')).toBe('actual-plan');
    expect(dialog.textContent).toContain('SQL Server');
    expect(screen.getByTestId('query-confirm-execute-run').textContent).toBe('Run and show plan');
    // The consequence is per-statement: "show me the plan for this DELETE" has to be a decision each time.
    expect(screen.queryByTestId('query-confirm-execute-remember')).toBeNull();
  });

  it('shows the statement it is about to run', () => {
    render(<ConfirmExecuteDialog open {...planProps('DELETE FROM orders WHERE id = 4;')} />);

    expect(screen.getByTestId('query-confirm-execute-sql').textContent).toBe(
      'DELETE FROM orders WHERE id = 4;'
    );
    // Nothing is elided when there is nothing to elide.
    expect(screen.queryByTestId('query-confirm-execute-sql-more')).toBeNull();
  });

  it('truncates a long statement and COUNTS what it left out', () => {
    const sql = [
      'DELETE FROM orders',
      'WHERE id IN (',
      '  SELECT order_id',
      '  FROM refunds',
      ')',
    ].join('\n');
    render(<ConfirmExecuteDialog open {...planProps(sql)} />);

    const shown = screen.getByTestId('query-confirm-execute-sql').textContent ?? '';
    expect(shown).toBe('DELETE FROM orders\nWHERE id IN (\n  SELECT order_id');
    expect(shown).not.toContain('FROM refunds');
    // Elided, not hidden: five lines, three shown, and the dialog says so.
    expect(screen.getByTestId('query-confirm-execute-sql-more').textContent).toContain(
      '2 more lines'
    );
  });

  it('counts one leftover line in the singular', () => {
    render(
      <ConfirmExecuteDialog open {...planProps('SELECT 1\nUNION ALL\nSELECT 2\nORDER BY 1')} />
    );
    expect(screen.getByTestId('query-confirm-execute-sql-more').textContent).toContain(
      '1 more line'
    );
  });

  it('shows no statement on the other two gates', () => {
    // Both are raised by the user's own Execute, a keystroke from the editor they typed it into — and the
    // ⌃E dialog's job is explaining a SHORTCUT, which a wall of SQL would bury.
    render(<ConfirmExecuteDialog open {...confirmProps()} />);
    expect(screen.queryByTestId('query-confirm-execute-sql')).toBeNull();
  });
});

describe('the placeholder prompt', () => {
  const props = {
    placeholders: ['schema', 'suffix'],
    remembered: { schema: 'public' },
    onCancel: () => undefined,
    onSubmit: () => undefined,
    onReturnFocus: () => undefined,
    attention: 0,
  };

  it('labels each field with the token it will replace', () => {
    render(<PlaceholderDialog {...props} />);
    expect(screen.getByLabelText('${schema}')).toBeTruthy();
    expect(screen.getByLabelText('${suffix}')).toBeTruthy();
  });

  it('pre-fills from the remembered values and leaves the rest empty', () => {
    render(<PlaceholderDialog {...props} />);
    expect((screen.getByLabelText('${schema}') as HTMLInputElement).value).toBe('public');
    expect((screen.getByLabelText('${suffix}') as HTMLInputElement).value).toBe('');
  });

  it('counts the fields still empty', async () => {
    render(<PlaceholderDialog {...props} />);
    expect(screen.getByTestId('query-placeholders-blank').textContent).toBe(
      '1 value is still empty'
    );

    await userEvent.type(screen.getByLabelText('${suffix}'), '_v2');

    expect(screen.queryByTestId('query-placeholders-blank')).toBeNull();
  });

  it('submits what was typed', async () => {
    const onSubmit = vi.fn();
    render(<PlaceholderDialog {...props} onSubmit={onSubmit} />);

    await userEvent.clear(screen.getByLabelText('${schema}'));
    await userEvent.type(screen.getByLabelText('${schema}'), 'reporting');
    await userEvent.type(screen.getByLabelText('${suffix}'), '_v2');
    await userEvent.click(screen.getByTestId('query-placeholders-run'));

    expect(onSubmit).toHaveBeenCalledWith({ schema: 'reporting', suffix: '_v2' });
  });

  it('submits on Enter from inside a field', async () => {
    const onSubmit = vi.fn();
    render(<PlaceholderDialog {...props} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText('${suffix}'), 'x{Enter}');

    // A real `<form>`, so this is the platform's behaviour rather than a per-input keydown listener
    // attached in a loop with no cleanup, which is what the original did.
    expect(onSubmit).toHaveBeenCalledWith({ schema: 'public', suffix: 'x' });
  });

  it('submits an empty value rather than refusing, because a placeholder may be blank', async () => {
    const onSubmit = vi.fn();
    render(<PlaceholderDialog {...props} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByTestId('query-placeholders-run'));
    expect(onSubmit).toHaveBeenCalledWith({ schema: 'public', suffix: '' });
  });

  it('cancels from the button and from Escape, and never submits', async () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(<PlaceholderDialog {...props} onCancel={onCancel} onSubmit={onSubmit} />);

    await userEvent.click(screen.getByTestId('query-placeholders-cancel'));
    await userEvent.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  /**
   * The visible half of "a second execute during an open prompt is abandoned".
   *
   * `useRunQuery` refuses the second run and logs it; the log is invisible to a user, who sees a menu
   * item that appeared to do nothing. Every bump of `attention` pulls the caret back into the first
   * field, which says what is blocking the run in the place they are already looking.
   */
  it('re-focuses the first field each time an execute is refused', async () => {
    const { rerender } = render(<PlaceholderDialog {...props} />);
    const first = screen.getByLabelText('${schema}') as HTMLInputElement;
    const second = screen.getByLabelText('${suffix}') as HTMLInputElement;

    // Move focus away, the way a user filling the form does.
    await userEvent.click(second);
    expect(document.activeElement).toBe(second);

    rerender(<PlaceholderDialog {...props} attention={1} />);
    expect(document.activeElement).toBe(first);
    // Selected, not just focused, so typing replaces the remembered value instead of appending to it.
    expect(first.selectionStart).toBe(0);
    expect(first.selectionEnd).toBe('public'.length);

    // And again for a THIRD execute — a counter rather than a boolean is what makes the second refusal
    // do something too.
    await userEvent.click(second);
    rerender(<PlaceholderDialog {...props} attention={2} />);
    expect(document.activeElement).toBe(first);
  });

  it('does not touch focus while nothing has been refused', async () => {
    const { rerender } = render(<PlaceholderDialog {...props} />);
    const second = screen.getByLabelText('${suffix}') as HTMLInputElement;

    await userEvent.click(second);
    // A re-render for any other reason must leave the caret where the user put it — which is why the
    // effect keys on the counter and not on the dialog being open.
    rerender(<PlaceholderDialog {...props} remembered={{ schema: 'public' }} />);

    expect(document.activeElement).toBe(second);
  });

  it('renders a value containing markup as text, not as HTML', () => {
    // The original interpolated the remembered value into an `innerHTML` string with only `"` escaped.
    render(
      <PlaceholderDialog {...props} remembered={{ schema: '"><img src=x onerror=alert(1)>' }} />
    );
    const field = screen.getByLabelText('${schema}') as HTMLInputElement;
    expect(field.value).toBe('"><img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });
});
