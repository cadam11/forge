/**
 * One copy of `ag-grid-community`, and every community module registered on it.
 *
 * This is the regression guard for a failure that has no visible symptom. `nodeLinker: hoisted` gives
 * the repo root a single version of each package, and that slot belongs to the Angular renderer's
 * `ag-grid-community@35` — so this package's `@36` and the `@36` nested under `ag-grid-react` are two
 * physical modules, each with its own `ModuleRegistry`. `results-grid.tsx` registers
 * `AllCommunityModule` on one; the grid runs on the other; and AG Grid then reports RowSelection,
 * QuickFilter, ColumnFilter, CellStyle, NumberFilter, Tooltip and ColumnAutoSize as unregistered —
 * i.e. a grid with no sorting, no filtering, no checkboxes and no auto-size, whose only trace is a
 * console error nobody reads. Measured, not theorised: that is what this file printed before
 * `resolve.dedupe` (the app) and the `ag-grid-community` alias + inlined `ag-grid-react` (vitest)
 * existed.
 *
 * So the assertion is on the console, with the REAL grid mounted — this is the one spec that does not
 * double it. jsdom has no layout, so no rows render and nothing here asserts on cells; what is being
 * proven is that a real `createGrid` accepts every option this component passes.
 */

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import type { ResultSet } from '@joinery/shared';

import { TooltipProvider } from '../../ui';
import { ResultsGrid } from './results-grid';

const RESULT_SET: ResultSet = {
  columns: [
    { name: 'id', type: 'int', isPrimaryKey: true },
    { name: 'email', type: 'text' },
    { name: 'created_at', type: 'timestamp' },
    { name: 'active', type: 'boolean' },
  ],
  rows: [{ id: 1, email: 'a@example.com', created_at: '2026-08-16', active: true }],
};

const logged: string[] = [];
const spies: { restore: () => void }[] = [];

beforeEach(() => {
  logged.length = 0;
  for (const level of ['error', 'warn'] as const) {
    const spy = vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(argument => String(argument)).join(' '));
    });
    spies.push({ restore: () => spy.mockRestore() });
  }
});

afterEach(() => {
  while (spies.length > 0) spies.pop()?.restore();
});

describe('the AG Grid module registry', () => {
  it('is the same instance the grid uses, with every community module on it', () => {
    const { unmount } = render(
      <TooltipProvider>
        <ResultsGrid resultSet={RESULT_SET} tabId="tab-1" />
      </TooltipProvider>
    );

    // Error #200 is "you used a feature whose module is not registered". Any AG Grid diagnostic at
    // all is a failure here: the grid is being handed nothing exotic.
    expect(logged.filter(message => message.includes('AG Grid'))).toEqual([]);
    unmount();
  });

  it('registering twice is idempotent, so the module-scope call cannot double-register', () => {
    // `results-grid.tsx` registers on import. A second registration — a hot reload, a second lazy
    // chunk — must not throw, or the query tab would fail to mount on a reload.
    expect(() => ModuleRegistry.registerModules([AllCommunityModule])).not.toThrow();
    expect(logged.filter(message => message.includes('AG Grid'))).toEqual([]);
  });
});
