/**
 * Docking a panel **without a pointer** — the keyboard half of PLAN.md Task 23's "keyboard-operable
 * resize handles and docking".
 *
 * The resize handles got their keyboard half in Task 7 (`shell/resize-handle.tsx`, the ARIA window
 * splitter pattern). Docking did not: every arrangement Dockview offers — split a panel into a new
 * group left/right/above/below, move a panel into an existing group — was reachable only by
 * dragging a tab onto a drop zone, which is a pointer gesture with no keyboard equivalent and no
 * menu behind it. A user who cannot make a drag could open tabs but could never arrange them.
 *
 * This module is the *decision* half — which move is legal, and which group it targets — kept apart
 * from `panel-tab.tsx` so it can be unit-tested against a fake api and so the tab component stays a
 * renderer. Every function here has exactly one side effect, `api.moveTo(...)`, and says so by
 * returning whether it fired.
 *
 * ── Why `moveTo` and not `addGroup` + `moveGroupOrPanel` ──────────────────────────────────────
 *
 * `DockviewPanelApi.moveTo({ group, position })` (dockview-core 8.1.0,
 * `api/dockviewPanelApi.d.ts`) is the same call Dockview's own drop handler makes: `position` other
 * than `'center'` creates the new group relative to `group` and moves the panel into it;
 * `'center'` moves the panel into `group` itself. Reaching for `addGroup` first would be a second
 * mechanism for the arrangement Dockview already owns, and the empty group left behind by the move
 * would then be ours to clean up.
 *
 * ── The two refusals, and why they are refusals rather than no-ops ────────────────────────────
 *
 * 1. **Splitting the only panel in its group.** Dockview would happily create the new group, move
 *    the panel into it, and delete the group it just emptied — a full teardown and rebuild whose
 *    net effect on screen is nothing. Refusing lets the caller say so instead.
 * 2. **Moving past either end of the group list.** No wrap: a keyboard user pressing the same key
 *    repeatedly should stop at the edge, not cycle, or "which group am I in" stops being
 *    answerable without counting keystrokes.
 *
 * Both are reported to the caller rather than logged here, because the caller is the only thing
 * that knows whether the request came from a keystroke (announce nothing) or a menu item.
 */

/** Where a split puts the new group, relative to the panel's current one. */
export type SplitDirection = 'left' | 'right' | 'above' | 'below';

/**
 * `SplitDirection` in Dockview's vocabulary. Dockview's `Position` says `'top'`/`'bottom'` where
 * this app's menu says "above"/"below" (`copywriting.md`: describe the result, not the axis), so
 * the two names are mapped once here instead of at each call site.
 */
const SPLIT_POSITION: Record<SplitDirection, 'left' | 'right' | 'top' | 'bottom'> = {
  left: 'left',
  right: 'right',
  above: 'top',
  below: 'bottom',
};

/** How far `moveToAdjacentGroup` steps through `containerApi.groups`. */
export type GroupStep = -1 | 1;

/**
 * ── The three structural types below ──────────────────────────────────────────────────────────
 *
 * Deliberately NOT `DockviewPanelApi` / `DockviewApi` / `DockviewGroupPanel`. Those are classes
 * with dozens of members and live event emitters; a fake of one would be mostly lies, and this
 * module reads exactly four things: a group's identity, how many panels it holds, the workspace's
 * group order, and `moveTo`. Naming only those makes `panel-docking.spec.ts` honest and makes the
 * module's dependency on Dockview a four-line surface rather than a whole api.
 *
 * The real types satisfy these structurally, which is checked at the call site in `panel-tab.tsx`
 * — so if Dockview renames `groups` or `panels`, that file stops compiling.
 */

/** A Dockview group, as far as this module is concerned. */
export interface DockableGroup {
  readonly id: string;
  /** Only the LENGTH is read — see refusal 1. */
  readonly panels: readonly unknown[];
}

/** The arguments `moveTo` is called with here. A subset of Dockview's `DockviewGroupMoveParams`. */
export interface DockableMoveParams<TGroup extends DockableGroup = DockableGroup> {
  readonly group: TGroup;
  readonly position: 'left' | 'right' | 'top' | 'bottom' | 'center';
}

/**
 * The subset of `DockviewPanelApi` this module touches.
 *
 * Generic in the GROUP type, and that is load-bearing rather than decorative. `moveTo` both
 * receives a group and is handed one back, so a non-generic version would have to fix the parameter
 * at the structural `DockableGroup` — and a real `DockviewPanelApi.moveTo`, which demands a full
 * `DockviewGroupPanel`, would then not satisfy it in either variance direction. Threading the
 * caller's own group type through makes the real api assignable with no cast, and still lets the
 * spec instantiate it at a two-field fake.
 */
export interface DockablePanel<TGroup extends DockableGroup = DockableGroup> {
  readonly group: TGroup;
  moveTo(options: DockableMoveParams<TGroup>): void;
}

/** The subset of `DockviewApi` this module reads. */
export interface DockableWorkspace<TGroup extends DockableGroup = DockableGroup> {
  readonly groups: readonly TGroup[];
}

/**
 * Splits the panel into a NEW group on `direction` of the one it is in.
 *
 * Returns `false` — having done nothing — when the panel is the only one in its group; see refusal
 * 1 in the header.
 */
export function splitPanel<TGroup extends DockableGroup>(
  panel: DockablePanel<TGroup>,
  direction: SplitDirection
): boolean {
  if (panel.group.panels.length < 2) return false;

  panel.moveTo({ group: panel.group, position: SPLIT_POSITION[direction] });
  return true;
}

/**
 * Moves the panel into the group `step` places away in `workspace.groups`.
 *
 * `groups` is Dockview's own ordering of the grid's leaves, which is the order a Tab press walks the
 * tab strips in, so "next group" means the next one a keyboard user would reach.
 *
 * Returns `false` — having done nothing — when there is no such group; see refusal 2 in the header.
 */
export function moveToAdjacentGroup<TGroup extends DockableGroup>(
  panel: DockablePanel<TGroup>,
  workspace: DockableWorkspace<TGroup>,
  step: GroupStep
): boolean {
  const currentIndex = workspace.groups.findIndex(group => group.id === panel.group.id);
  // A panel whose group is not in the list is a Dockview invariant violation, not a state this
  // function is allowed to guess its way through.
  if (currentIndex < 0) return false;

  const target = workspace.groups[currentIndex + step];
  if (target === undefined) return false;

  panel.moveTo({ group: target, position: 'center' });
  return true;
}

/**
 * The keystroke → docking move mapping, as data.
 *
 * Read by `panel-tab.tsx`'s key handler and by the menu, so the accelerators shown next to the menu
 * items cannot drift from the keys that actually work — `panel-docking.spec.ts` asserts the two
 * agree. Option (Alt) rather than Command: Dockview already owns `ctrl+[`, `ctrl+]` and `F6` on the
 * document for tab NAVIGATION, and macOS reserves most of the Command+Arrow space.
 */
export interface DockingBinding {
  /** `KeyboardEvent.key`. */
  readonly key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
  readonly shiftKey: boolean;
  /** What the menu shows, in the notation `catalogue.ts` uses for accelerators. */
  readonly accelerator: string;
  /** The menu item's text. Sentence case, imperative, per `copywriting.md`. */
  readonly label: string;
  /** Suffix of the menu item's `data-testid`, under `workspace-tab-menu-move-`. */
  readonly testIdSuffix: string;
  readonly move: { kind: 'split'; direction: SplitDirection } | { kind: 'group'; step: GroupStep };
}

export const DOCKING_BINDINGS: readonly DockingBinding[] = [
  {
    key: 'ArrowLeft',
    shiftKey: false,
    accelerator: '⌥←',
    label: 'Split left',
    testIdSuffix: 'split-left',
    move: { kind: 'split', direction: 'left' },
  },
  {
    key: 'ArrowRight',
    shiftKey: false,
    accelerator: '⌥→',
    label: 'Split right',
    testIdSuffix: 'split-right',
    move: { kind: 'split', direction: 'right' },
  },
  {
    key: 'ArrowUp',
    shiftKey: false,
    accelerator: '⌥↑',
    label: 'Split above',
    testIdSuffix: 'split-above',
    move: { kind: 'split', direction: 'above' },
  },
  {
    key: 'ArrowDown',
    shiftKey: false,
    accelerator: '⌥↓',
    label: 'Split below',
    testIdSuffix: 'split-below',
    move: { kind: 'split', direction: 'below' },
  },
  {
    key: 'ArrowLeft',
    shiftKey: true,
    accelerator: '⌥⇧←',
    label: 'Move to previous group',
    testIdSuffix: 'previous-group',
    move: { kind: 'group', step: -1 },
  },
  {
    key: 'ArrowRight',
    shiftKey: true,
    accelerator: '⌥⇧→',
    label: 'Move to next group',
    testIdSuffix: 'next-group',
    move: { kind: 'group', step: 1 },
  },
];

/**
 * What to tell the user when a move refuses. One message per refusal in the header, so a keystroke
 * that does nothing always says why — a silent no-op is the failure mode a keyboard-only user has
 * no way to diagnose.
 */
export function refusalMessage(move: DockingBinding['move']): string {
  return move.kind === 'split'
    ? 'This tab is the only one in its group — open another tab first, or move this one.'
    : 'There is no group on that side.';
}

/**
 * The binding a keystroke selects, or `undefined` when the keystroke is not one of ours.
 *
 * `altKey` is required and `metaKey`/`ctrlKey` are required ABSENT: without the second half,
 * `⌥⌘→` — which macOS and Monaco both use — would also dock a panel.
 */
export function bindingFor(event: {
  readonly key: string;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}): DockingBinding | undefined {
  if (!event.altKey || event.metaKey || event.ctrlKey) return undefined;
  return DOCKING_BINDINGS.find(
    binding => binding.key === event.key && binding.shiftKey === event.shiftKey
  );
}

/**
 * Performs `move` against `panel`. Returns whether anything moved — see the two refusals.
 *
 * The one place the two move kinds are dispatched, so a caller (key handler, menu item) never has
 * to know which one it is holding.
 */
export function applyDockingMove<TGroup extends DockableGroup>(
  panel: DockablePanel<TGroup>,
  workspace: DockableWorkspace<TGroup>,
  move: DockingBinding['move']
): boolean {
  return move.kind === 'split'
    ? splitPanel(panel, move.direction)
    : moveToAdjacentGroup(panel, workspace, move.step);
}
