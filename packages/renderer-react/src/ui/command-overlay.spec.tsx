/**
 * The shared search-overlay shell, on its own — the three surfaces that use it (palette, object
 * search, snippet library) each have their own suite, and this one is about the shell's two
 * behaviours that are easy to break from a distance.
 *
 * 1. **The caret lands in the input, and nowhere else.** Radix focuses the first tabbable node on
 *    open, which is a toolbar button whenever a caller supplies one — so `onOpenAutoFocus` is
 *    prevented and the input is focused explicitly. That used to be done by looking the input up with
 *    `document.querySelector('[data-testid="…-input"]')`, i.e. the shell's own focus depended on a
 *    test attribute; it is a forwarded `ref` now, and this test is what would notice either way.
 * 2. **A disabled row is rendered and inert.** The J-44 house rule: a row that vanishes teaches the
 *    user nothing, and a row that looks live and does nothing is worse.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Button } from './button';
import {
  CommandOverlay,
  CommandOverlayEmpty,
  CommandOverlayGroup,
  CommandOverlayRow,
  CommandOverlayRowText,
} from './command-overlay';

function renderOverlay(options: {
  readonly withToolbar?: boolean;
  readonly onSelect?: () => void;
}) {
  return render(
    <CommandOverlay
      open
      onOpenChange={() => undefined}
      label="Test overlay"
      placeholder="Search…"
      value=""
      onValueChange={() => undefined}
      testIdPrefix="probe"
      toolbar={
        options.withToolbar === true ? (
          <Button size="sm" data-testid="probe-toolbar">
            New
          </Button>
        ) : undefined
      }
    >
      <CommandOverlayEmpty testId="probe-empty">
        <span>Nothing matches</span>
      </CommandOverlayEmpty>
      <CommandOverlayGroup heading="Group">
        <CommandOverlayRow
          value="live"
          testId="probe-row"
          onSelect={options.onSelect ?? (() => undefined)}
        >
          <CommandOverlayRowText label="Live row" />
        </CommandOverlayRow>
        <CommandOverlayRow
          value="dead"
          testId="probe-row"
          disabled
          onSelect={options.onSelect ?? (() => undefined)}
        >
          <CommandOverlayRowText label="Dead row" hint="Connect to a server first" />
        </CommandOverlayRow>
      </CommandOverlayGroup>
    </CommandOverlay>
  );
}

describe('the command overlay', () => {
  it('puts the caret in its own input on open', async () => {
    renderOverlay({});

    const input = await screen.findByTestId('probe-input');
    expect(document.activeElement).toBe(input);
  });

  it('keeps the caret in the input even when a toolbar button is the first tabbable node', async () => {
    // The reason `onOpenAutoFocus` is prevented at all: Radix's default would focus "New", and the
    // user's first keystroke would activate a button instead of searching.
    renderOverlay({ withToolbar: true });

    const input = await screen.findByTestId('probe-input');
    expect(screen.getByTestId('probe-toolbar')).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('renders a disabled row, with its reason, and refuses to act on it', async () => {
    const onSelect = vi.fn();
    renderOverlay({ onSelect });

    const rows = screen.getAllByTestId('probe-row');
    expect(rows).toHaveLength(2);
    const dead = rows[1] as HTMLElement;
    expect(dead.getAttribute('data-disabled')).toBe('true');
    expect(dead.textContent).toContain('Connect to a server first');

    await userEvent.click(dead);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
