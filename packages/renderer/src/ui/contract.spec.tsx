import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Check, Database } from 'lucide-react';

import userEvent from '@testing-library/user-event';

import { Button } from './button';
import { Checkbox } from './checkbox';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from './context-menu';
import { CommandOverlay, CommandOverlayGroup, CommandOverlayRow } from './command-overlay';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Tooltip, TooltipProvider } from './tooltip';
import { EmptyState } from './empty-state';
import { Icon } from './icon';
import { Input } from './input';
import { Select, SelectItem } from './select';
import { Spinner } from './spinner';
import { Switch } from './switch';
import { Textarea } from './textarea';
import { Toolbar } from './toolbar';
import { Tree } from './tree';

/**
 * The four rules the task brief states for *every* primitive, asserted once across the set
 * rather than repeated in each component's own spec:
 *
 *   1. accepts and merges `className`
 *   2. passes `data-testid` through
 *   3. bakes no margins
 *   4. has a `:focus-visible` treatment if it is interactive
 *
 * A component added to `src/ui` without them will not fail its own spec — it will fail here,
 * because the marker class is one nothing else uses and a missing merge simply drops it.
 */

/** `ring-4` is on no primitive, so its presence proves the merge happened. */
const MARKER = 'ring-4';

/**
 * Each case names the element `className` and `data-testid` are contracted to land on. For a
 * form control that is the control, not the field wrapper — see the header of `field.tsx`.
 */
const CASES: readonly { name: string; render: () => ReactElement }[] = [
  {
    name: 'Button',
    render: () => (
      <Button className={MARKER} data-testid="subject">
        B
      </Button>
    ),
  },
  { name: 'Icon', render: () => <Icon icon={Check} className={MARKER} data-testid="subject" /> },
  { name: 'Spinner', render: () => <Spinner className={MARKER} data-testid="subject" /> },
  {
    name: 'Input',
    render: () => <Input label="L" name="n" className={MARKER} data-testid="subject" />,
  },
  {
    name: 'Textarea',
    render: () => <Textarea label="L" name="n" className={MARKER} data-testid="subject" />,
  },
  {
    name: 'Select',
    render: () => (
      <Select label="L" name="n" className={MARKER} data-testid="subject">
        <SelectItem value="a">A</SelectItem>
      </Select>
    ),
  },
  {
    name: 'Checkbox',
    render: () => <Checkbox label="L" name="n" className={MARKER} data-testid="subject" />,
  },
  {
    name: 'Switch',
    render: () => <Switch label="L" name="n" className={MARKER} data-testid="subject" />,
  },
  {
    name: 'EmptyState',
    render: () => <EmptyState title="T" icon={Database} className={MARKER} data-testid="subject" />,
  },
  {
    name: 'Toolbar',
    render: () => <Toolbar aria-label="T" className={MARKER} data-testid="subject" />,
  },
  {
    name: 'Tree',
    render: () => (
      <Tree
        aria-label="T"
        nodes={[{ id: 'a', label: 'A' }]}
        expandedIds={new Set()}
        onExpandedChange={vi.fn()}
        className={MARKER}
        data-testid="subject"
      />
    ),
  },
];

describe('every primitive merges className and passes data-testid through', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const { unmount } = render(testCase.render());

      const subject = screen.getByTestId('subject');
      // `svg.className` is an SVGAnimatedString, so read the attribute in both cases.
      expect(subject.getAttribute('class')).toContain(MARKER);
      unmount();
    });
  }
});

/**
 * Every module in this directory as source text. `import.meta.glob` with `?raw` rather than a
 * filesystem read: the bundle is compiled with no `@types/node` on purpose (see tsconfig.json),
 * so a spec cannot open a file, and Vite inlines these at transform time. Specs are excluded —
 * they are allowed to name whatever they are asserting about.
 */
const SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(
    import.meta.glob('./*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
  )
    .filter(([path]) => !path.includes('.spec.'))
    .map(([path, source]) => [path.replace('./', ''), String(source)])
);

/**
 * The compound and portalled primitives, which cannot be covered by the table above because
 * their styled element only exists once something is open. Their `className` merge is
 * otherwise unproven — the source scans below check for margins and colours, not for a merge.
 */
describe('the portalled primitives merge className too', () => {
  it('DialogContent', () => {
    render(
      <Dialog defaultOpen>
        <DialogContent className={MARKER} data-testid="subject">
          <DialogHeader>
            <DialogTitle>T</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );

    expect(screen.getByTestId('subject').className).toContain(MARKER);
  });

  it('CommandOverlay', () => {
    // Portalled and cmdk-backed: its surface only exists while it is open, so it belongs here rather
    // than in the table above. Added with Task 16, which is what put a search overlay in `src/ui`.
    render(
      <CommandOverlay
        open
        onOpenChange={vi.fn()}
        label="Overlay"
        placeholder="Type…"
        value=""
        onValueChange={vi.fn()}
        testIdPrefix="subject"
        className={MARKER}
      >
        <CommandOverlayGroup heading="Group">
          <CommandOverlayRow value="one" onSelect={vi.fn()} testId="subject-row">
            One
          </CommandOverlayRow>
        </CommandOverlayGroup>
      </CommandOverlay>
    );

    expect(screen.getByTestId('subject-overlay').className).toContain(MARKER);
    // The prefix reaches every part, which is the contract the three feature suites key on.
    expect(screen.getByTestId('subject-input')).toBeDefined();
    expect(screen.getByTestId('subject-list')).toBeDefined();
    expect(screen.getByTestId('subject-row')).toBeDefined();
  });

  it('DropdownMenuContent', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button data-testid="trigger">Open</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className={MARKER} data-testid="subject">
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    await userEvent.click(screen.getByTestId('trigger'));

    expect(screen.getByTestId('subject').className).toContain(MARKER);
  });

  it('ContextMenuContent', () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div data-testid="target">Target</div>
        </ContextMenuTrigger>
        <ContextMenuContent className={MARKER} data-testid="subject">
          <ContextMenuItem>Item</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );

    fireEvent.contextMenu(screen.getByTestId('target'));

    expect(screen.getByTestId('subject').className).toContain(MARKER);
  });

  it('PopoverContent', async () => {
    render(
      <Popover>
        <PopoverTrigger asChild>
          <Button data-testid="trigger">Open</Button>
        </PopoverTrigger>
        <PopoverContent className={MARKER} data-testid="subject" />
      </Popover>
    );

    await userEvent.click(screen.getByTestId('trigger'));

    expect(screen.getByTestId('subject').className).toContain(MARKER);
  });

  it('Tooltip content', async () => {
    render(
      <TooltipProvider>
        <Tooltip content="Tip" className={MARKER} data-testid="subject">
          <Button data-testid="trigger">Hover</Button>
        </Tooltip>
      </TooltipProvider>
    );

    await userEvent.tab();

    expect(screen.getByTestId('subject').className).toContain(MARKER);
  });

  it('TabsList, TabsTrigger and TabsContent', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList className={MARKER} data-testid="list">
          <TabsTrigger value="a" className={MARKER} data-testid="trigger">
            A
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a" className={MARKER} data-testid="panel">
          Panel
        </TabsContent>
      </Tabs>
    );

    for (const testId of ['list', 'trigger', 'panel']) {
      expect(screen.getByTestId(testId).className).toContain(MARKER);
    }
  });
});

describe('the source scan has something to scan', () => {
  it('found every primitive module', () => {
    // A glob that matched nothing would make all four scans below vacuous.
    expect(Object.keys(SOURCES)).toContain('tree.tsx');
    expect(Object.keys(SOURCES)).toContain('overlay.ts');
    expect(Object.keys(SOURCES).length).toBeGreaterThanOrEqual(18);
  });
});

describe('no primitive bakes a margin', () => {
  // Source-level, because a margin can hide in a variant map or a state branch that no single
  // render exercises. `overlay.ts` is the one documented exception: a menu separator's `-mx-1
  // my-1` is internal geometry — the rule's inset and the gap it needs — not spacing the caller
  // should own.
  const ALLOWED = new Set(['overlay.ts']);

  const MARGIN_UTILITY = /(?:^|["'\s])-?m[trblxyse]?-(?:\d|\[|\()/;

  it('holds across src/ui', () => {
    expect(filesMatching(MARGIN_UTILITY, ALLOWED)).toEqual([]);
  });

  it('finds the exception it is excusing', () => {
    // Guards the regex: a pattern that matched nothing would make the check above vacuous.
    expect(filesMatching(MARGIN_UTILITY)).toEqual(['overlay.ts']);
  });
});

describe('no primitive reaches outside the token system', () => {
  const HEX_COLOUR = /#[0-9a-f]{3,8}\b/i;
  // The `--color-*` namespace is closed, so a stock Tailwind family would not compile — but a
  // raw hex inside an arbitrary value would, and that is the hole this closes.
  const STOCK_FAMILY =
    /\b(?:bg|text|border|ring|stroke|fill|outline)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/;

  it('holds across src/ui', () => {
    expect(filesMatching(HEX_COLOUR)).toEqual([]);
    expect(filesMatching(STOCK_FAMILY)).toEqual([]);
  });
});

describe('no primitive needs a theme variant', () => {
  it('holds across src/ui', () => {
    // HOUSE-RULES §3: a `dark:` or `light:` in a component is a signal that a token is missing.
    expect(filesMatching(/(?:^|["'\s])(?:dark|light):[a-z[]/)).toEqual([]);
  });
});

describe('every interactive primitive has a :focus-visible treatment', () => {
  // HOUSE-RULES: focus styling is not optional, and the audit found four status-bar controls
  // with none. Listed by module rather than derived, because the shared class strings mean a
  // component can satisfy the rule through an import — `select.tsx` gets its ring from
  // `field.tsx`, both menus get theirs from `overlay.ts`.
  const OWNERS = [
    'button.tsx',
    'checkbox.tsx',
    'field.tsx',
    'overlay.ts',
    'switch.tsx',
    'tabs.tsx',
    'toaster.tsx',
    'tree.tsx',
  ];

  for (const file of OWNERS) {
    it(file, () => {
      expect(SOURCES[file]).toMatch(/focus-visible[:-]/);
    });
  }
});

describe('no primitive suppresses the outline it then tries to draw', () => {
  /**
   * The Tailwind v4 trap Task 23's keyboard walk found in `tree.tsx`, closed here so it cannot come
   * back anywhere in the set.
   *
   * `outline-hidden` compiles to `--tw-outline-style: none`, and every `outline-<width>` utility
   * compiles to `outline-style: var(--tw-outline-style)`. So `outline-hidden` and
   * `focus-visible:outline-2` on the same element produce a 2px outline drawn in style `none` —
   * nothing at all — and every source scan in this file, plus the `:focus-visible` scan above,
   * happily calls that a pass. Only `focus-visible:outline-solid` puts the style back.
   *
   * `--tw-outline-style` is registered `inherits: false`, so the trap is strictly SAME-ELEMENT —
   * which is why the unit scanned is one `cn(…)` argument list rather than a line or a file. Per
   * line would miss it (this codebase splits a `cn` across several), and per file would falsely
   * accuse `switch.tsx`, which puts `focus:outline-hidden` on its hidden `<input>` and the ring on
   * the track in a *different* `cn` — two elements, not this bug.
   */
  const SUPPRESSES = /outline-hidden/;
  const DRAWS = /focus-visible:outline-\d/;
  const RESTORES = /focus-visible:outline-solid/;

  /**
   * Every `cn(` argument list in `source`, as raw text.
   *
   * A paren counter rather than a regex, because the arguments contain parentheses of their own
   * (`h-(--tree-row-height)`, ternaries, nested calls) and a lazy `\(([^)]*)\)` would cut the list
   * off at the first one — silently shortening exactly the strings this check reads.
   */
  function cnCalls(source: string): string[] {
    const calls: string[] = [];
    // Bounded by the source length; a call that never closes ends the scan rather than looping.
    for (
      let start = source.indexOf('cn(');
      start !== -1;
      start = source.indexOf('cn(', start + 3)
    ) {
      let depth = 0;
      let end = start + 2;
      for (; end < source.length; end += 1) {
        if (source[end] === '(') depth += 1;
        else if (source[end] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth !== 0) break;
      calls.push(source.slice(start, end + 1));
    }
    return calls;
  }

  function offendingCalls(source: string): string[] {
    return cnCalls(source).filter(
      call => SUPPRESSES.test(call) && DRAWS.test(call) && !RESTORES.test(call)
    );
  }

  it('holds across src/ui', () => {
    const offenders = Object.entries(SOURCES).flatMap(([file, source]) =>
      offendingCalls(source).map(() => file)
    );
    expect(offenders).toEqual([]);
  });

  it('sees a multi-line cn as one element, and catches the combination inside it', () => {
    // Guards both halves: the paren walk must reach past a line break and past a nested paren, and
    // all three regexes must fire, or the check above is vacuous.
    const bad = `cn(\n  'h-(--x) outline-hidden',\n  'focus-visible:outline-2 focus-visible:outline-focus'\n)`;
    expect(offendingCalls(bad)).toHaveLength(1);
    expect(
      offendingCalls(bad.replace('outline-2', 'outline-2 focus-visible:outline-solid'))
    ).toEqual([]);
    // Two separate calls are two elements, and must not be conflated.
    expect(offendingCalls(`cn('outline-hidden')\ncn('focus-visible:outline-2')`)).toEqual([]);
  });
});

/** The modules whose source matches `pattern`, ignoring any listed as allowed. */
function filesMatching(pattern: RegExp, allowed: ReadonlySet<string> = new Set()): string[] {
  return Object.entries(SOURCES)
    .filter(([file, source]) => !allowed.has(file) && pattern.test(source))
    .map(([file]) => file)
    .sort();
}
