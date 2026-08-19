/**
 * The plan tree as rendered: what a node shows, what severity it is given, and the two claims the
 * summary bar has to keep straight (estimated vs actual).
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TooltipProvider } from '../../ui';
import { ExecutionPlanView } from './execution-plan-view';
import type { PlanNode, PlanSummary } from './execution-plan';

function node(overrides: Partial<PlanNode> = {}): PlanNode {
  return { type: 'Seq Scan', costPercent: 0, extra: [], children: [], ...overrides };
}

function draw(
  root: PlanNode,
  summary: Partial<PlanSummary> = {},
  kind: 'estimated' | 'actual' = 'estimated'
) {
  return render(
    <TooltipProvider>
      <ExecutionPlanView
        root={root}
        summary={{ totalCost: 0, warnings: [], ...summary }}
        kind={kind}
      />
    </TooltipProvider>
  );
}

describe('ExecutionPlanView', () => {
  it('draws one flat row per node with its depth as data', () => {
    draw(
      node({
        type: 'Hash Join',
        children: [
          node({ type: 'Seq Scan' }),
          node({ type: 'Index Scan', children: [node({ type: 'Sort' })] }),
        ],
      })
    );

    const rows = screen.getAllByTestId('plan-node');
    expect(rows).toHaveLength(4);
    // Flat siblings, not nested elements — the indent is `data-depth` plus padding.
    expect(rows.map(row => row.getAttribute('data-depth'))).toEqual(['0', '1', '1', '2']);
    expect(
      rows.map(row => row.querySelector('[data-testid="plan-node-type"]')?.textContent)
    ).toEqual(['Hash Join', 'Seq Scan', 'Index Scan', 'Sort']);
  });

  it('grades each node, so severity is assertable without reading a class', () => {
    draw(
      node({
        type: 'Root',
        costPercent: 0,
        children: [
          node({ type: 'Big', cost: 90, costPercent: 90 }),
          node({ type: 'Middling', cost: 30, costPercent: 30 }),
          node({ type: 'Small', cost: 3, costPercent: 3 }),
        ],
      })
    );
    expect(
      screen.getAllByTestId('plan-node').map(row => row.getAttribute('data-severity'))
    ).toEqual(['neutral', 'expensive', 'moderate', 'cheap']);
  });

  it('shows estimated and actual rows as different figures', () => {
    // The point of an actual plan: an estimate that is an order out is only visible when both are on
    // screen at once.
    draw(node({ type: 'Index Scan', rows: 24, actualRows: 2400, executions: 26 }), {}, 'actual');
    expect(screen.queryByText('Est. rows')).not.toBeNull();
    expect(screen.queryByText('24')).not.toBeNull();
    expect(screen.queryByText('2,400')).not.toBeNull();
    expect(screen.queryByText('26')).not.toBeNull();
  });

  it('says which KIND of plan it is', () => {
    draw(node(), {}, 'actual');
    expect(screen.getByTestId('plan-kind').textContent).toBe('Actual plan');
  });

  it('says "estimated" when the statement was not run', () => {
    draw(node(), {}, 'estimated');
    expect(screen.getByTestId('plan-kind').textContent).toBe('Estimated plan');
  });

  it('renders the warnings above the tree', () => {
    draw(node(), { warnings: ['Sequential scan on orders (12000 rows)'] });
    expect(screen.getByTestId('plan-warnings').textContent).toContain('Sequential scan on orders');
  });

  it('omits the warning list entirely when there is nothing to warn about', () => {
    draw(node());
    expect(screen.queryByTestId('plan-warnings')).toBeNull();
  });

  it('renders a cost bar only for a node with a share of the cost', () => {
    draw(node({ type: 'Root', children: [node({ type: 'Child', cost: 5, costPercent: 40 })] }));
    expect(screen.getAllByTestId('plan-node-cost-bar')).toHaveLength(1);
  });

  it('shows a startup..total cost range when PostgreSQL gives one', () => {
    draw(node({ cost: 200, startupCost: 20, costPercent: 100 }));
    expect(screen.queryByText('20.00..200')).not.toBeNull();
  });

  it('states the depth once the indent is capped, so a deep node is still readable', () => {
    let deepest = node({ type: 'deepest' });
    for (let index = 0; index < 8; index += 1)
      deepest = node({ type: `n${index}`, children: [deepest] });
    draw(deepest);
    // Depth 7 and 8 are past the six-step cap.
    expect(screen.queryByText('depth 7')).not.toBeNull();
    expect(screen.queryByText('depth 8')).not.toBeNull();
    expect(screen.queryByText('depth 6')).toBeNull();
  });

  it('shows the access type and the object when the engine names them', () => {
    draw(node({ type: 'Table Scan', object: 'orders', accessType: 'ALL' }));
    expect(screen.getByTestId('plan-node-access').textContent).toBe('ALL');
    expect(screen.getByTestId('plan-node-object').textContent).toBe('orders');
  });
});
