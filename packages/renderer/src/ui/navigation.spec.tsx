import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Copy, Play, Trash2 } from 'lucide-react';

import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Toolbar, ToolbarButton, ToolbarSeparator, ToolbarSpacer } from './toolbar';
import { Tooltip, TooltipProvider } from './tooltip';

/**
 * The three primitives whose whole value is a keyboard model Task 7 and Task 8 will lean on
 * without checking: a tab strip that arrows, a toolbar that costs one Tab press, and a popover
 * that dismisses. Radix supplies all three; these are the assertions that it still does.
 */

describe('Tabs', () => {
  function TabsHarness() {
    return (
      <Tabs defaultValue="results">
        <TabsList>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="stats" disabled>
            Statistics
          </TabsTrigger>
        </TabsList>
        <TabsContent value="results">2,104,882 rows</TabsContent>
        <TabsContent value="messages">Commands completed</TabsContent>
      </Tabs>
    );
  }

  it('shows only the active panel', () => {
    render(<TabsHarness />);

    expect(screen.getByText('2,104,882 rows')).toBeDefined();
    expect(screen.queryByText('Commands completed')).toBeNull();
  });

  it('moves between tabs with the arrow keys', async () => {
    render(<TabsHarness />);

    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe('Results');

    await userEvent.keyboard('{ArrowRight}');

    expect(document.activeElement?.textContent).toBe('Messages');
    expect(screen.getByText('Commands completed')).toBeDefined();
  });

  it('skips a disabled tab', async () => {
    render(<TabsHarness />);
    await userEvent.tab();

    await userEvent.keyboard('{ArrowRight}{ArrowRight}');

    expect(document.activeElement?.textContent).not.toBe('Statistics');
  });

  it('marks the active tab with the oxide underline rather than a filled affordance', () => {
    render(<TabsHarness />);

    // HOUSE-RULES §5 lists the active-tab indicator among oxide's jobs, so a tab strip spends
    // none of the surface's one-filled-oxide budget.
    const active = screen.getByRole('tab', { selected: true });
    expect(active.className).toContain('data-[state=active]:after:bg-accent');
    expect(active.className).not.toContain('bg-accent-strong');
  });

  it('gives every trigger a focus ring', () => {
    render(<TabsHarness />);

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('focus-visible:outline-focus');
    }
  });
});

describe('Toolbar', () => {
  function ToolbarHarness() {
    return (
      <Toolbar aria-label="Query actions">
        <ToolbarButton leadingIcon={Play}>Execute</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton leadingIcon={Copy} iconOnly aria-label="Copy SQL" />
        <ToolbarSpacer />
        <ToolbarButton leadingIcon={Trash2} iconOnly aria-label="Clear" disabled />
      </Toolbar>
    );
  }

  it('is one tabstop with arrow-key navigation inside it', async () => {
    render(
      <>
        <ToolbarHarness />
        <Button data-testid="after">After</Button>
      </>
    );

    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe('Execute');

    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Copy SQL');

    // One more Tab leaves the whole strip rather than stepping to the next button.
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByTestId('after'));
  });

  it('spends no oxide on its buttons', () => {
    render(<ToolbarHarness />);

    // Dense chrome: `ghost` is the default, because a toolbar is rarely the right place to
    // spend the surface's one filled affordance.
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).not.toContain('bg-accent-strong');
    }
  });

  it('aligns a trailing group with a spacer, not a margin', () => {
    render(<ToolbarHarness />);

    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.querySelector('.grow')).not.toBeNull();
    expect(toolbar.className).not.toMatch(/(?:^|\s)-?m[trblxy]?-/);
  });
});

describe('Popover', () => {
  function PopoverHarness() {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button data-testid="trigger">Row limit</Button>
        </PopoverTrigger>
        <PopoverContent data-testid="panel">
          <Button data-testid="inside">Apply</Button>
        </PopoverContent>
      </Popover>
    );
  }

  it('opens from its trigger and can hold focusable controls', async () => {
    render(<PopoverHarness />);

    await userEvent.click(screen.getByTestId('trigger'));

    expect(screen.getByTestId('inside')).toBeDefined();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<PopoverHarness />);
    await userEvent.click(screen.getByTestId('trigger'));

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByTestId('panel')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('trigger'));
  });

  it('leaves the workbench underneath usable — it is not a dialog', async () => {
    render(
      <>
        <PopoverHarness />
        <Button data-testid="outside">Outside</Button>
      </>
    );

    await userEvent.click(screen.getByTestId('trigger'));

    // A Dialog hides the rest of the document from assistive technology. A popover must not:
    // PLAN §2.9 reserves modality for transactional flows.
    expect(screen.getByTestId('outside').closest('[aria-hidden="true"]')).toBeNull();
  });
});

describe('Tooltip', () => {
  it('opens on keyboard focus, not only on hover', async () => {
    render(
      <TooltipProvider>
        <Tooltip content="Re-read the schema from the server.">
          <Button data-testid="trigger">Refresh</Button>
        </Tooltip>
      </TooltipProvider>
    );

    await userEvent.tab();

    expect(screen.getByRole('tooltip').textContent).toBe('Re-read the schema from the server.');
  });
});
