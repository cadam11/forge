import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Button } from './button';
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import { Input } from './input';

/**
 * Radix is the answer to "who owns the focus trap", and PLAN §Decision A says so explicitly:
 * hand-rolling would mean hand-rolling focus traps and `aria-*` wiring six times. That is only
 * a good trade if the trap actually works, so it is asserted here with real key events rather
 * than assumed from the dependency being installed.
 */

const TAB_PRESSES = 8;

function DialogHarness() {
  return (
    <div>
      <button type="button" data-testid="outside">
        Outside
      </button>
      <Dialog>
        <DialogTrigger asChild>
          <Button data-testid="trigger">Restore</Button>
        </DialogTrigger>
        <DialogContent size="md" data-testid="content">
          <DialogHeader>
            <DialogTitle>Restore database</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Input label="Backup file" name="backupFile" />
          </DialogBody>
          <DialogActions>
            <DialogClose asChild>
              <Button variant="ghost" data-testid="cancel">
                Cancel
              </Button>
            </DialogClose>
            <Button variant="primary" data-testid="confirm">
              Restore
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}

async function openDialog(): Promise<HTMLElement> {
  await userEvent.click(screen.getByTestId('trigger'));
  return screen.getByRole('dialog');
}

describe('Dialog — modality', () => {
  it('opens from its trigger and is a modal dialog', async () => {
    render(<DialogHarness />);
    expect(screen.queryByRole('dialog')).toBeNull();

    const dialog = await openDialog();

    // Radix asserts modality by hiding the rest of the document from assistive technology
    // rather than by setting `aria-modal` — which is the stronger of the two, and measured
    // here instead of assumed: an earlier version of this test looked for `aria-modal` and
    // failed against a Radix that had stopped emitting it.
    expect(screen.getByTestId('outside').closest('[aria-hidden="true"]')).not.toBeNull();
    // Radix warns loudly without a title, because a modal with no accessible name is unusable.
    expect(dialog.getAttribute('aria-labelledby')).not.toBeNull();
  });

  it('moves focus into the dialog on open', async () => {
    render(<DialogHarness />);

    const dialog = await openDialog();

    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('traps Tab inside the dialog', async () => {
    render(<DialogHarness />);
    const dialog = await openDialog();

    // Enough presses to walk past the last focusable and wrap. If the trap were missing,
    // focus would land on the "Outside" button or the document body.
    for (let press = 0; press < TAB_PRESSES; press += 1) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('traps Shift+Tab too', async () => {
    render(<DialogHarness />);
    const dialog = await openDialog();

    for (let press = 0; press < TAB_PRESSES; press += 1) {
      await userEvent.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes on Escape', async () => {
    render(<DialogHarness />);
    await openDialog();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('returns focus to the trigger when it closes', async () => {
    render(<DialogHarness />);
    await openDialog();

    await userEvent.keyboard('{Escape}');

    expect(document.activeElement).toBe(screen.getByTestId('trigger'));
  });

  it('closes from a DialogClose in the action row', async () => {
    render(<DialogHarness />);
    await openDialog();

    await userEvent.click(screen.getByTestId('cancel'));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes from the header affordance', async () => {
    render(<DialogHarness />);
    await openDialog();

    await userEvent.click(screen.getByTestId('dialog-close'));

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Dialog — the PLAN §2.9 shape', () => {
  it('spends at most one filled oxide affordance', async () => {
    render(<DialogHarness />);
    const dialog = await openDialog();

    // HOUSE-RULES §5 counts a dialog as its own surface, so this is the budget for the whole
    // overlay — header affordance and action row included.
    const filled = dialog.querySelectorAll('[class*="bg-accent-strong"]');
    expect(filled).toHaveLength(1);
    expect(filled[0]).toBe(screen.getByTestId('confirm'));
  });

  it('rules the header off and makes the body the scrolling region', async () => {
    render(<DialogHarness />);
    const dialog = await openDialog();

    const header = dialog.querySelector('header');
    expect(header?.className).toContain('border-b');
    expect(header?.className).toContain('border-rule');

    const body = screen.getByLabelText('Backup file').closest('div[class*="overflow-y-auto"]');
    expect(body).not.toBeNull();
    // Without min-h-0 the body grows past the dialog instead of scrolling.
    expect(body?.className).toContain('min-h-0');
  });

  it('sizes from the sm|md|lg vocabulary and stays inside the 800px window floor', async () => {
    render(<DialogHarness />);
    const dialog = await openDialog();

    expect(dialog.className).toContain('max-w-[32rem]');
    // 46rem = 736px, the widest rung, which still fits the 800px minimum window.
    expect(dialog.className).not.toContain('max-w-[46rem]');
  });

  it('is no rounder than 6px, dialogs included', async () => {
    render(<DialogHarness />);
    const dialog = await openDialog();

    expect(dialog.className).toContain('rounded-md');
  });
});
