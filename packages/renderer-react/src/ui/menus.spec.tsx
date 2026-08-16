import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Copy, Table2, Trash2 } from 'lucide-react';

import { Button } from './button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

/**
 * Arrow-key navigation is the reason both menus are Radix rather than hand-rolled, so it is
 * asserted with real key events. The Angular app's 70 `mat-menu` uses got this from Material;
 * losing it in the rewrite would be a silent accessibility regression that no visual test
 * would catch.
 *
 * Radix moves real DOM focus onto the highlighted item, so `document.activeElement` is the
 * observable. `data-highlighted` is styling, not the state of record.
 */

function activeLabel(): string {
  return document.activeElement?.textContent ?? '';
}

function DropdownHarness({ onSelect = vi.fn() }: { onSelect?: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-testid="trigger">Actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem icon={Table2} shortcut="⌘↵" onSelect={onSelect}>
          Select top 1000
        </DropdownMenuItem>
        <DropdownMenuItem icon={Copy}>Copy name</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={Trash2} disabled>
          Drop table
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe('DropdownMenu — keyboard', () => {
  it('opens from the keyboard and lands on the first item', async () => {
    render(<DropdownHarness />);

    screen.getByTestId('trigger').focus();
    await userEvent.keyboard('{Enter}');

    expect(screen.getByRole('menu')).toBeDefined();
    expect(activeLabel()).toContain('Select top 1000');
  });

  it('walks down with ArrowDown', async () => {
    render(<DropdownHarness />);
    await userEvent.click(screen.getByTestId('trigger'));

    await userEvent.keyboard('{ArrowDown}');
    expect(activeLabel()).toContain('Select top 1000');

    await userEvent.keyboard('{ArrowDown}');
    expect(activeLabel()).toContain('Copy name');
  });

  it('skips a disabled item and wraps to the top', async () => {
    render(<DropdownHarness />);
    await userEvent.click(screen.getByTestId('trigger'));

    // Two items are enabled; the third is disabled. Three presses from the closed state
    // therefore has to wrap rather than land on "Drop table".
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');

    expect(activeLabel()).not.toContain('Drop table');
    expect(activeLabel()).toContain('Select top 1000');
  });

  it('walks back up with ArrowUp', async () => {
    render(<DropdownHarness />);
    await userEvent.click(screen.getByTestId('trigger'));

    await userEvent.keyboard('{ArrowUp}');

    expect(activeLabel()).toContain('Copy name');
  });

  it('activates the highlighted item with Enter', async () => {
    const onSelect = vi.fn();
    render(<DropdownHarness onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId('trigger'));

    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<DropdownHarness />);
    await userEvent.click(screen.getByTestId('trigger'));

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('trigger'));
  });

  it('renders the shortcut in a <kbd>, not as part of the label text', async () => {
    render(<DropdownHarness />);
    await userEvent.click(screen.getByTestId('trigger'));

    const item = screen.getByRole('menuitem', { name: /Select top 1000/ });
    expect(item.querySelector('kbd')?.textContent).toBe('⌘↵');
  });
});

function ContextHarness({ onSelect = vi.fn() }: { onSelect?: () => void }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div data-testid="target">Right-click me</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onSelect}>Open in new tab</ContextMenuItem>
        <ContextMenuItem>Copy name</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled>Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

describe('ContextMenu — keyboard', () => {
  it('opens on a contextmenu event', () => {
    render(<ContextHarness />);

    fireEvent.contextMenu(screen.getByTestId('target'));

    expect(screen.getByRole('menu')).toBeDefined();
  });

  it('walks its items with the arrow keys', async () => {
    render(<ContextHarness />);
    fireEvent.contextMenu(screen.getByTestId('target'));

    await userEvent.keyboard('{ArrowDown}');
    expect(activeLabel()).toContain('Open in new tab');

    await userEvent.keyboard('{ArrowDown}');
    expect(activeLabel()).toContain('Copy name');

    await userEvent.keyboard('{ArrowUp}');
    expect(activeLabel()).toContain('Open in new tab');
  });

  it('skips the disabled item', async () => {
    render(<ContextHarness />);
    fireEvent.contextMenu(screen.getByTestId('target'));

    await userEvent.keyboard('{ArrowUp}');

    expect(activeLabel()).not.toContain('Delete');
    expect(activeLabel()).toContain('Copy name');
  });

  it('activates with Enter and closes on Escape', async () => {
    const onSelect = vi.fn();
    render(<ContextHarness onSelect={onSelect} />);
    fireEvent.contextMenu(screen.getByTestId('target'));

    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);

    fireEvent.contextMenu(screen.getByTestId('target'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('the two menus cannot drift', () => {
  it('styles both item sets from the same class string', async () => {
    render(
      <>
        <DropdownHarness />
        <ContextHarness />
      </>
    );

    await userEvent.click(screen.getByTestId('trigger'));
    const dropdownItem = screen.getByRole('menuitem', { name: /Copy name/ }).className;
    await userEvent.keyboard('{Escape}');

    fireEvent.contextMenu(screen.getByTestId('target'));
    const contextItem = screen.getByRole('menuitem', { name: /Copy name/ }).className;

    // Both come from MENU_ITEM_CLASSES in overlay.ts, which is the whole reason that file
    // exists — Radix's two Item components are unrelated types.
    expect(contextItem).toBe(dropdownItem);
  });
});
