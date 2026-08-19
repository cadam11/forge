/**
 * Keyboard docking: the move it picks, the moves it refuses, and the promise the menu makes.
 *
 * `panel-docking.ts` is the decision half of Task 23's "keyboard-operable docking"; this file is
 * why it is a separate module. Every assertion here is about a `moveTo` call that either happened
 * with particular arguments or did not happen at all, which is checkable against a fake and is not
 * checkable in jsdom against Dockview itself (a dock with no layout has no groups to move between).
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DOCKING_BINDINGS,
  applyDockingMove,
  bindingFor,
  moveToAdjacentGroup,
  refusalMessage,
  splitPanel,
  type DockableGroup,
  type DockableMoveParams,
  type DockableWorkspace,
} from './panel-docking';

/** A group with `count` panels in it. Only `id` and the panel COUNT are read. */
function group(id: string, count: number): DockableGroup {
  return { id, panels: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}` })) };
}

/** A panel sitting in `home`, with its `moveTo` spied on. */
function panelIn(home: DockableGroup) {
  return { group: home, moveTo: vi.fn<(options: DockableMoveParams) => void>() };
}

function workspaceOf(...groups: DockableGroup[]): DockableWorkspace {
  return { groups };
}

describe('splitPanel', () => {
  it('moves the panel into a new group on the named side of its own', () => {
    const home = group('g1', 2);
    const panel = panelIn(home);

    expect(splitPanel(panel, 'right')).toBe(true);
    expect(panel.moveTo).toHaveBeenCalledWith({ group: home, position: 'right' });
  });

  it('maps this app’s "above"/"below" onto Dockview’s "top"/"bottom"', () => {
    // The one place the two vocabularies meet. A silent mismatch here would dock every vertical
    // split on the wrong side, which no type would catch: both are string literals.
    const home = group('g1', 2);

    const above = panelIn(home);
    splitPanel(above, 'above');
    expect(above.moveTo).toHaveBeenCalledWith({ group: home, position: 'top' });

    const below = panelIn(home);
    splitPanel(below, 'below');
    expect(below.moveTo).toHaveBeenCalledWith({ group: home, position: 'bottom' });

    const left = panelIn(home);
    splitPanel(left, 'left');
    expect(left.moveTo).toHaveBeenCalledWith({ group: home, position: 'left' });
  });

  it('refuses, without moving anything, when the panel is alone in its group', () => {
    // Dockview would create the new group, move the panel, and delete the group it emptied — a
    // teardown whose net effect on screen is nothing. Refusal 1 in the module header.
    const panel = panelIn(group('g1', 1));

    expect(splitPanel(panel, 'right')).toBe(false);
    expect(panel.moveTo).not.toHaveBeenCalled();
  });
});

describe('moveToAdjacentGroup', () => {
  const first = group('g1', 1);
  const middle = group('g2', 1);
  const last = group('g3', 1);

  it('moves into the next group, centred rather than split', () => {
    const panel = panelIn(middle);

    expect(moveToAdjacentGroup(panel, workspaceOf(first, middle, last), 1)).toBe(true);
    expect(panel.moveTo).toHaveBeenCalledWith({ group: last, position: 'center' });
  });

  it('moves into the previous group', () => {
    const panel = panelIn(middle);

    expect(moveToAdjacentGroup(panel, workspaceOf(first, middle, last), -1)).toBe(true);
    expect(panel.moveTo).toHaveBeenCalledWith({ group: first, position: 'center' });
  });

  it('stops at both ends rather than wrapping', () => {
    // Refusal 2: a keyboard user pressing the same key repeatedly should reach an edge and stay
    // there. Wrapping would make "which group am I in" unanswerable without counting keystrokes.
    const atStart = panelIn(first);
    expect(moveToAdjacentGroup(atStart, workspaceOf(first, middle, last), -1)).toBe(false);
    expect(atStart.moveTo).not.toHaveBeenCalled();

    const atEnd = panelIn(last);
    expect(moveToAdjacentGroup(atEnd, workspaceOf(first, middle, last), 1)).toBe(false);
    expect(atEnd.moveTo).not.toHaveBeenCalled();
  });

  it('refuses when the panel’s group is not in the workspace at all', () => {
    // A Dockview invariant violation. Guessing (treating the missing index as 0) would move the
    // panel somewhere arbitrary; `findIndex` returning -1 is why this branch is explicit.
    const panel = panelIn(group('orphan', 1));

    expect(moveToAdjacentGroup(panel, workspaceOf(first, middle), 1)).toBe(false);
    expect(panel.moveTo).not.toHaveBeenCalled();
  });
});

describe('bindingFor', () => {
  const base = { altKey: true, shiftKey: false, metaKey: false, ctrlKey: false };

  it('selects the split for a plain Option+Arrow', () => {
    expect(bindingFor({ ...base, key: 'ArrowRight' })?.move).toEqual({
      kind: 'split',
      direction: 'right',
    });
  });

  it('selects the group move for Option+Shift+Arrow', () => {
    expect(bindingFor({ ...base, key: 'ArrowRight', shiftKey: true })?.move).toEqual({
      kind: 'group',
      step: 1,
    });
  });

  it('ignores an arrow with no Option held', () => {
    expect(bindingFor({ ...base, key: 'ArrowRight', altKey: false })).toBeUndefined();
  });

  it('ignores Option+Arrow with Command or Control also held', () => {
    // `⌥⌘→` is a macOS and Monaco keystroke. Requiring the two modifiers ABSENT — rather than just
    // requiring Option — is what keeps this component from stealing it.
    expect(bindingFor({ ...base, key: 'ArrowRight', metaKey: true })).toBeUndefined();
    expect(bindingFor({ ...base, key: 'ArrowRight', ctrlKey: true })).toBeUndefined();
  });

  it('ignores a key that is not an arrow', () => {
    expect(bindingFor({ ...base, key: 'Enter' })).toBeUndefined();
  });
});

describe('the binding table', () => {
  it('covers all four splits and both group steps, with no duplicate keystroke', () => {
    expect(DOCKING_BINDINGS).toHaveLength(6);

    const keystrokes = DOCKING_BINDINGS.map(b => `${b.shiftKey ? 'shift+' : ''}${b.key}`);
    expect(new Set(keystrokes).size).toBe(keystrokes.length);
  });

  it('gives every binding a label, an accelerator and a unique test id', () => {
    // The menu renders straight from this table, so an empty label or a colliding test id would
    // reach the UI. Asserted here rather than in the tab spec: the table is the contract.
    const suffixes = DOCKING_BINDINGS.map(b => b.testIdSuffix);
    expect(new Set(suffixes).size).toBe(suffixes.length);

    for (const binding of DOCKING_BINDINGS) {
      expect(binding.label.length, binding.testIdSuffix).toBeGreaterThan(3);
      expect(binding.accelerator, binding.testIdSuffix).toContain('⌥');
      expect(binding.accelerator.includes('⇧'), `${binding.testIdSuffix} shift`).toBe(
        binding.shiftKey
      );
    }
  });

  it('is reachable from a keystroke, every row of it', () => {
    // The link the menu's accelerators promise: pressing what the row shows selects that row.
    for (const binding of DOCKING_BINDINGS) {
      const selected = bindingFor({
        key: binding.key,
        altKey: true,
        shiftKey: binding.shiftKey,
        metaKey: false,
        ctrlKey: false,
      });
      expect(selected, binding.testIdSuffix).toBe(binding);
    }
  });
});

describe('applyDockingMove', () => {
  it('dispatches a split', () => {
    const home = group('g1', 2);
    const panel = panelIn(home);

    expect(applyDockingMove(panel, workspaceOf(home), { kind: 'split', direction: 'below' })).toBe(
      true
    );
    expect(panel.moveTo).toHaveBeenCalledWith({ group: home, position: 'bottom' });
  });

  it('dispatches a group move', () => {
    const first = group('g1', 1);
    const second = group('g2', 1);
    const panel = panelIn(first);

    expect(applyDockingMove(panel, workspaceOf(first, second), { kind: 'group', step: 1 })).toBe(
      true
    );
    expect(panel.moveTo).toHaveBeenCalledWith({ group: second, position: 'center' });
  });
});

describe('refusalMessage', () => {
  it('says something different for each refusal', () => {
    // A keyboard-only user gets no other signal that the keystroke was heard, so the two cases
    // must be distinguishable — a single "cannot move" would leave them guessing which.
    const split = refusalMessage({ kind: 'split', direction: 'right' });
    const grouped = refusalMessage({ kind: 'group', step: 1 });

    expect(split).not.toBe(grouped);
    expect(split.length).toBeGreaterThan(10);
    expect(grouped.length).toBeGreaterThan(10);
  });
});
