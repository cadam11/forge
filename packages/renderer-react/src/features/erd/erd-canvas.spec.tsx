/**
 * The diagram's DOM: **the theme assertion first**, then what the SVG is made of and what it does when
 * you click it.
 *
 * The first `describe` is the one this task exists for. The Angular diagram set every colour as an SVG
 * presentation attribute from a hardcoded hex (`attr('fill', '#1e1e1e')` × 26), which is why it could
 * not follow a theme without a `getComputedStyle` probe and why the probe only got half of them. So the
 * assertion is structural rather than a spot-check of one colour: **inside the canvas, no element may
 * carry a `fill`, `stroke` or `style` attribute at all, and no hex may appear anywhere in the markup.**
 * Every colour is a token utility, which is what makes both themes free.
 */

import { useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ErdCanvas } from './erd-canvas';
import { layoutErd } from './erd-layout';
import type { ErdField, ErdNode } from './erd-model';
import { useErdViewport } from './use-erd-viewport';

function field(overrides: Partial<ErdField> & { name: string }): ErdField {
  return {
    id: overrides.name,
    type: 'integer',
    isPrimaryKey: false,
    allowsNull: true,
    autoIncrement: false,
    ...overrides,
  };
}

function table(id: string, fields: readonly ErdField[]): ErdNode {
  const dot = id.indexOf('.');
  return {
    id,
    name: id.slice(dot + 1),
    schemaName: id.slice(0, dot),
    fields: fields.map(f => ({ ...f, id: `${id}.${f.name}` })),
  };
}

/** The seeded PostgreSQL shape: order_items → orders → customers. */
const SEEDED: readonly ErdNode[] = [
  table('public.customers', [
    field({ name: 'id', isPrimaryKey: true, allowsNull: false }),
    field({ name: 'email', type: 'varchar(200)' }),
  ]),
  table('public.orders', [
    field({ name: 'id', isPrimaryKey: true, allowsNull: false }),
    field({
      name: 'customer_id',
      relatedNodeId: 'public.customers',
      relatedNodeName: 'customers',
      relatedFieldName: 'id',
    }),
    field({ name: 'status', type: 'varchar(20)' }),
  ]),
  table('public.order_items', [
    field({ name: 'id', isPrimaryKey: true, allowsNull: false }),
    field({
      name: 'order_id',
      relatedNodeId: 'public.orders',
      relatedNodeName: 'orders',
      relatedFieldName: 'id',
    }),
  ]),
];

interface HarnessProps {
  readonly nodes?: readonly ErdNode[];
  readonly initialSelection?: string | null;
  readonly onOpen?: (node: ErdNode) => void;
}

/**
 * The canvas with a real viewport behind it.
 *
 * `useErdViewport` is where the refs and the listeners live, and mounting the canvas without it would
 * be testing a component that cannot exist. jsdom reports every element as 0×0, so the viewport stays
 * unmeasured — which is exactly the "render everything, cull nothing" branch `erd-viewport.spec.ts`
 * pins, and what makes node counts here deterministic.
 */
function Harness({
  nodes = SEEDED,
  initialSelection = null,
  onOpen = () => undefined,
}: HarnessProps) {
  const layout = useMemo(() => layoutErd(nodes), [nodes]);
  const viewport = useErdViewport(layout);
  const [selectedNodeId, setSelected] = useState<string | null>(initialSelection);

  return (
    <ErdCanvas
      layout={layout}
      viewport={viewport}
      selectedNodeId={selectedNodeId}
      onSelect={node => setSelected(node?.id ?? null)}
      onOpen={onOpen}
    />
  );
}

const canvas = () => screen.getByTestId('erd-canvas');
const nodeShapes = () => screen.getAllByTestId('erd-node');
const nodeShape = (id: string) =>
  nodeShapes().find(element => element.getAttribute('data-erd-node-id') === id);

describe('the theme — zero raw colour values in the diagram', () => {
  it('sets no fill, stroke or style attribute on any element', () => {
    render(<Harness />);

    const offenders = Array.from(canvas().querySelectorAll('[fill], [stroke], [style]')).map(
      element => element.tagName
    );

    expect(offenders).toEqual([]);
  });

  it('contains no hex colour anywhere in its markup', () => {
    render(<Harness />);
    // `#erd-arrow-…` marker references survive this: `r` is not a hex digit.
    expect(canvas().innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}(?![\w-])/);
  });

  it('paints the node box, header and rows from Layer 2 token utilities', () => {
    render(<Harness />);
    const orders = nodeShape('public.orders');

    expect(orders?.querySelector('rect')?.getAttribute('class')).toContain('fill-surface');
    expect(orders?.querySelector('path')?.getAttribute('class')).toContain('fill-chrome');

    const classes = Array.from(orders?.querySelectorAll('text') ?? []).map(
      element => element.getAttribute('class') ?? ''
    );
    // The header name, the PK badge, the FK badge — foreground, warning, accent. No blue, no hex.
    expect(classes.some(value => value.includes('fill-fg'))).toBe(true);
    expect(classes.some(value => value.includes('fill-warning'))).toBe(true);
    expect(classes.some(value => value.includes('fill-accent'))).toBe(true);
  });

  it('paints an edge and its arrowhead from tokens too — the legibility that has to survive both themes', () => {
    render(<Harness />);
    const edge = screen.getAllByTestId('erd-edge')[0];

    expect(edge?.getAttribute('class')).toContain('stroke-fg-subtle');
    const marker = canvas().querySelector('marker path');
    expect(marker?.getAttribute('class')).toContain('fill-fg-subtle');
  });

  it('uses no `dark:` or `light:` variant, which would mean a token is missing', () => {
    render(<Harness />);
    expect(canvas().innerHTML).not.toMatch(/\b(dark|light):/);
  });
});

describe('what the canvas renders', () => {
  it('draws one node per table', () => {
    render(<Harness />);

    expect(
      nodeShapes()
        .map(element => element.getAttribute('data-erd-node-id'))
        .sort()
    ).toEqual(['public.customers', 'public.order_items', 'public.orders']);
  });

  it('draws one edge per foreign key, naming both ends', () => {
    render(<Harness />);
    const edges = screen.getAllByTestId('erd-edge');

    expect(
      edges.map(
        element =>
          `${element.getAttribute('data-erd-edge-source')}→${element.getAttribute('data-erd-edge-target')}`
      )
    ).toEqual(
      expect.arrayContaining(['public.orders→public.customers', 'public.order_items→public.orders'])
    );
  });

  it('lists the keys, and says how many columns it did not show', () => {
    render(<Harness />);
    const orders = nodeShape('public.orders');
    const text = Array.from(orders?.querySelectorAll('text') ?? []).map(node => node.textContent);

    expect(text).toContain('id');
    expect(text).toContain('customer_id');
    // `status` is neither a PK nor an FK.
    expect(text).not.toContain('status');
    expect(text).toContain('+1 more');
  });

  it('names each node for a screen reader, with its key counts', () => {
    render(<Harness />);
    expect(nodeShape('public.orders')?.getAttribute('aria-label')).toBe(
      'public.orders, 1 primary keys, 1 foreign keys'
    );
  });

  it('carries the native tooltip the Angular diagram appended to every node', () => {
    render(<Harness />);
    expect(nodeShape('public.orders')?.querySelector('title')?.textContent).toContain(
      'public.orders'
    );
  });

  it('truncates a column name that cannot fit the box', () => {
    render(
      <Harness
        nodes={[
          table('dbo.wide', [field({ name: 'an_extremely_long_column_name', isPrimaryKey: true })]),
        ]}
      />
    );

    const text = Array.from(canvas().querySelectorAll('text')).map(node => node.textContent ?? '');
    expect(text.some(value => value.endsWith('…'))).toBe(true);
  });

  it('gives each canvas its own marker ids, so two ERD tabs cannot share an arrowhead', () => {
    const first = render(<Harness />);
    const second = render(<Harness />);

    const idOf = (container: HTMLElement) =>
      container.querySelector('marker')?.getAttribute('id') ?? '';

    expect(idOf(first.container)).not.toBe(idOf(second.container));
    expect(idOf(second.container)).not.toBe('');
  });
});

describe('selection', () => {
  it('starts with every node plain when nothing is selected', () => {
    render(<Harness />);
    expect(
      nodeShapes().every(element => element.getAttribute('data-erd-node-state') === 'plain')
    ).toBe(true);
  });

  it('marks the selected node, and its immediate neighbours as related', () => {
    render(<Harness initialSelection="public.orders" />);

    expect(nodeShape('public.orders')?.getAttribute('data-erd-node-state')).toBe('selected');
    // Both directions: orders → customers and order_items → orders.
    expect(nodeShape('public.customers')?.getAttribute('data-erd-node-state')).toBe('related');
    expect(nodeShape('public.order_items')?.getAttribute('data-erd-node-state')).toBe('related');
  });

  it('leaves a node two hops away plain', () => {
    render(<Harness initialSelection="public.customers" />);
    expect(nodeShape('public.order_items')?.getAttribute('data-erd-node-state')).toBe('plain');
  });

  it('highlights only the edges that touch the selection', () => {
    render(<Harness initialSelection="public.customers" />);
    const classesFor = (id: string) =>
      screen
        .getAllByTestId('erd-edge')
        .find(element => element.getAttribute('data-erd-edge-id') === id)
        ?.getAttribute('class') ?? '';

    expect(classesFor('public.orders.customer_id')).toContain('stroke-accent');
    expect(classesFor('public.order_items.order_id')).toContain('stroke-fg-subtle');
  });

  it('selects a node on click', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const orders = nodeShape('public.orders');
    if (orders !== undefined) await user.click(orders);

    expect(nodeShape('public.orders')?.getAttribute('data-erd-node-state')).toBe('selected');
  });

  it('clears the selection on a press into empty space', async () => {
    const user = userEvent.setup();
    render(<Harness initialSelection="public.orders" />);

    const background = canvas().querySelector('svg');
    if (background !== null) await user.click(background);

    expect(
      nodeShapes().every(element => element.getAttribute('data-erd-node-state') === 'plain')
    ).toBe(true);
  });

  it('keeps the selection when the press was on a node', async () => {
    // The same handler runs for both; what tells them apart is the target.
    const user = userEvent.setup();
    render(<Harness initialSelection="public.orders" />);

    const customers = nodeShape('public.customers');
    if (customers !== undefined) await user.click(customers);

    expect(nodeShape('public.customers')?.getAttribute('data-erd-node-state')).toBe('selected');
  });

  it('puts exactly one node in the tab order, and it is the selected one', () => {
    render(<Harness initialSelection="public.orders" />);

    const tabbable = nodeShapes().filter(element => element.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]?.getAttribute('data-erd-node-id')).toBe('public.orders');
  });

  it('falls back to the first node when nothing is selected, so the diagram is reachable by keyboard', () => {
    render(<Harness />);
    expect(nodeShapes().filter(element => element.getAttribute('tabindex') === '0')).toHaveLength(
      1
    );
  });
});

describe('opening a table', () => {
  it('opens it on double-click', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);

    const orders = nodeShape('public.orders');
    if (orders !== undefined) await user.dblClick(orders);

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'public.orders' }));
  });

  it('opens it on Enter, which is the keyboard equivalent', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<Harness initialSelection="public.orders" onOpen={onOpen} />);

    const orders = nodeShape('public.orders');
    orders?.focus();
    await user.keyboard('{Enter}');

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'public.orders' }));
  });

  it('selects rather than opens on Space', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);

    const customers = nodeShape('public.customers');
    customers?.focus();
    await user.keyboard(' ');

    expect(onOpen).not.toHaveBeenCalled();
    expect(nodeShape('public.customers')?.getAttribute('data-erd-node-state')).toBe('selected');
  });
});
