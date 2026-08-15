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

/** The modules whose source matches `pattern`, ignoring any listed as allowed. */
function filesMatching(pattern: RegExp, allowed: ReadonlySet<string> = new Set()): string[] {
  return Object.entries(SOURCES)
    .filter(([file, source]) => !allowed.has(file) && pattern.test(source))
    .map(([file]) => file)
    .sort();
}
