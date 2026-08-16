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

describe('the ⌃E confirmation', () => {
  it('is closed when `open` is false', () => {
    render(
      <ConfirmExecuteDialog open={false} onCancel={() => undefined} onConfirm={() => undefined} />
    );
    expect(screen.queryByTestId('query-confirm-execute')).toBeNull();
  });

  it('names the shortcut it is explaining, and is labelled for a screen reader', () => {
    render(<ConfirmExecuteDialog open onCancel={() => undefined} onConfirm={() => undefined} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch(/(⌘E|Ctrl\+E)/);
    // The `innerHTML` modal had no accessible name at all.
    expect(screen.getByText('Execute query?')).toBeTruthy();
  });

  it('focuses Execute rather than the close button', async () => {
    render(<ConfirmExecuteDialog open onCancel={() => undefined} onConfirm={() => undefined} />);
    // Radix's default would be the first tabbable node in the content — the header's ✕.
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('query-confirm-execute-run'))
    );
  });

  it('confirms without remembering by default', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmExecuteDialog open onCancel={() => undefined} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByTestId('query-confirm-execute-run'));

    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('confirms WITH remembering once the box is ticked', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmExecuteDialog open onCancel={() => undefined} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByTestId('query-confirm-execute-remember'));
    await userEvent.click(screen.getByTestId('query-confirm-execute-run'));

    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('cancels from the button and from Escape', async () => {
    const onCancel = vi.fn();
    render(<ConfirmExecuteDialog open onCancel={onCancel} onConfirm={() => undefined} />);

    await userEvent.click(screen.getByTestId('query-confirm-execute-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();

    await userEvent.keyboard('{Escape}');
    // The original's Escape listener was removed only on Escape, so cancelling any other way leaked it.
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

describe('the placeholder prompt', () => {
  const props = {
    placeholders: ['schema', 'suffix'],
    remembered: { schema: 'public' },
    onCancel: () => undefined,
    onSubmit: () => undefined,
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
