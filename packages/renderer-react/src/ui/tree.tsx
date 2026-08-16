/**
 * Virtualized, keyboard-navigable, context-menu-friendly tree.
 *
 * Designed against its actual consumer — the sidebar/explorer in Task 8 — rather than as a
 * generic widget, which is what fixes the four decisions that matter:
 *
 * 1. **Controlled, always.** Expansion and selection live in the Task 4 explorer store
 *    (`state/explorer.ts`, `state/explorer-folders.ts`) and are persisted by Task 5. A tree
 *    that owned that state would fork it, so `expandedIds` / `selectedId` are props and the
 *    only outputs are callbacks.
 * 2. **Lazy children are first-class.** `hasChildren` says a node is expandable; `children`
 *    being `undefined` says they have not been fetched. The two are separate because the
 *    explorer knows the first from server metadata long before it pays for the second.
 *    `loadingIds` puts a spinner in the twisty's place while a fetch is in flight.
 * 3. **Capability-gated actions are the caller's.** `renderContextMenu(node)` returns the
 *    menu content for one node, so which items exist is decided by the caller's capability
 *    checks (`state/capabilities.ts`), not by a prop matrix here. Returning `null` means the
 *    node has no menu.
 * 4. **Virtualized from row one.** A SQL Server instance with 400 databases produces a tree
 *    whose flattened length is five figures, and the Angular tree rendered all of it.
 *
 * ## Focus model
 *
 * `role="tree"` with a single tabstop on the scroll container and `aria-activedescendant`
 * pointing at the focused row — not a roving `tabIndex` on the rows. With virtualization the
 * focused row can be unmounted at any moment, and a roving tabstop on an unmounted element
 * drops focus to `<body>`. This is the pattern the ARIA authoring practices reserve for
 * exactly that case.
 *
 * The rows are flat `treeitem`s carrying `aria-level`, rather than nested `role="group"`
 * lists, for the same reason: the DOM only contains the ~24 rows in view, so a nesting
 * structure would be a lie about where a row sits.
 *
 * Focus and selection are deliberately separate. Arrow keys move focus; Enter, Space and a
 * click select. If a consumer wants selection-to-follow-focus it calls `onSelect` from
 * `onFocusChange` — the lever is there, and having the tree assume it would make every arrow
 * key press in the explorer a state write.
 *
 * ## Focus and reveal from outside
 *
 * Two things a virtualized tree cannot leave to its caller, because the row it is asked about
 * may not be in the DOM: taking keyboard focus, and scrolling a row into view. Both are on the
 * `TreeHandle` a `ref` receives (`focus()`, `scrollToId(id)`), and the second also happens on
 * its own whenever `selectedId` changes — "reveal in explorer" from a query tab, or a selection
 * restored from Task 5 persistence, would otherwise select a row 400 rows below the viewport
 * and show the user nothing. A row the user clicked is already in view, and the reveal aligns
 * `auto`, so the common case costs a scroll to the offset the tree is already at.
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { cn } from './cn';
import { ContextMenu, ContextMenuTrigger } from './context-menu';
import { Icon, type IconProps } from './icon';
import { Spinner } from './spinner';
import { diagnostics } from '../state/diagnostics';

/**
 * Hard cap on nesting. The deepest real path is server ▸ database ▸ schema ▸ table ▸ column
 * ▸ index = 6; 32 leaves room for folders without letting a cycle in the caller's data
 * flatten forever. Hitting it is reported, not silently truncated.
 */
const MAX_TREE_DEPTH = 32;

/** 24px. `text-sm` (12px) rows — the dense rung HOUSE-RULES §2 assigns to trees. */
const DEFAULT_ROW_HEIGHT = 24;

/** Left inset of a depth-0 row, and the extra inset per level. Both ladder rungs. */
const ROW_PADDING_PX = 8;
const INDENT_PER_LEVEL_PX = 12;

/**
 * Rows rendered outside the viewport. Twelve is two screenfuls of overscan at this row
 * height, which is what keeps a held-down arrow key from painting gaps.
 */
const OVERSCAN = 12;

/**
 * The rect the virtualizer assumes before it has measured its scroll element, so the first paint
 * fills the panel instead of showing one row and then reflowing.
 */
const INITIAL_VISIBLE_ROWS = 24;

export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconProps['icon'];
  /**
   * Whether the node can be expanded, known before its children are. Defaults to
   * `children !== undefined && children.length > 0`, which is right for a fully-loaded tree
   * and wrong for a lazy one — so lazy callers set it explicitly.
   */
  readonly hasChildren?: boolean;
  /** `undefined` = not fetched. `[]` = fetched and empty, which renders as expanded-and-bare. */
  readonly children?: readonly TreeNode[];
  /** Trailing metadata: a row count, a column type. Mono micro-text, right-aligned. */
  readonly meta?: string;
  readonly disabled?: boolean;
}

/** One visible row. Exported with `flattenTree` so the flattening is testable on its own. */
export interface TreeRow {
  readonly node: TreeNode;
  readonly depth: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
  /** The id of the row that owns this one, or `undefined` at the root. Drives ArrowLeft. */
  readonly parentId?: string;
}

function isExpandable(node: TreeNode): boolean {
  return node.hasChildren ?? (node.children !== undefined && node.children.length > 0);
}

/**
 * Depth-first flatten of the visible rows. Iterative with an explicit stack and an explicit
 * depth cap: recursion here would be bounded only by the caller's data, and the caller's data
 * comes from a database.
 */
export function flattenTree(
  nodes: readonly TreeNode[],
  expandedIds: ReadonlySet<string>
): readonly TreeRow[] {
  const rows: TreeRow[] = [];
  // Reversed so popping yields the caller's order.
  const stack: TreeRow[] = [...nodes].reverse().map(node => toRow(node, 0, expandedIds, undefined));
  let truncated = false;

  while (stack.length > 0) {
    const row = stack.pop();
    if (row === undefined) {
      break;
    }
    rows.push(row);
    if (!row.expanded || row.node.children === undefined) {
      continue;
    }
    if (row.depth + 1 >= MAX_TREE_DEPTH) {
      truncated = true;
      continue;
    }
    for (const child of [...row.node.children].reverse()) {
      stack.push(toRow(child, row.depth + 1, expandedIds, row.node.id));
    }
  }

  if (truncated) {
    diagnostics.warn(
      `tree flattening stopped at depth ${MAX_TREE_DEPTH}; deeper nodes are not rendered`,
      { rows: rows.length }
    );
  }
  return rows;
}

function toRow(
  node: TreeNode,
  depth: number,
  expandedIds: ReadonlySet<string>,
  parentId: string | undefined
): TreeRow {
  const expandable = isExpandable(node);
  return {
    node,
    depth,
    expandable,
    expanded: expandable && expandedIds.has(node.id),
    parentId,
  };
}

/**
 * The imperative surface, for the two things a caller cannot do to a virtualized tree from
 * props alone. Deliberately two methods: anything else a consumer needs belongs in props.
 */
export interface TreeHandle {
  /** Moves keyboard focus to the tree's single tabstop. */
  focus(): void;
  /**
   * Scrolls the row into view. A no-op with a diagnostic when the id is not a visible row —
   * an id inside a collapsed branch has no row to scroll to, so the caller must expand first.
   */
  scrollToId(id: string): void;
}

export interface TreeProps {
  readonly ref?: Ref<TreeHandle>;
  readonly nodes: readonly TreeNode[];
  readonly expandedIds: ReadonlySet<string>;
  readonly onExpandedChange: (id: string, expanded: boolean) => void;
  readonly selectedId?: string;
  readonly onSelect?: (node: TreeNode) => void;
  /** Enter or double-click. Opening a table's data tab, running a saved query. */
  readonly onActivate?: (node: TreeNode) => void;
  /** Fires when the keyboard focus moves. The hook for selection-to-follow-focus. */
  readonly onFocusChange?: (node: TreeNode) => void;
  /** Nodes whose children are being fetched. Replaces the twisty with a spinner. */
  readonly loadingIds?: ReadonlySet<string>;
  /** The context-menu content for one node, or `null` for nodes that have no menu. */
  readonly renderContextMenu?: (node: TreeNode) => ReactNode;
  readonly rowHeight?: number;
  /** Required: a tree with no accessible name is unusable, and there is no visible label. */
  readonly 'aria-label': string;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/**
 * Custom properties are outside React's `CSSProperties` surface. One cast, in one place,
 * rather than one per call site — and the values below are genuinely dynamic (a scroll
 * offset, a computed height), which is the case `general.md` allows a style attribute for.
 */
function cssVars(vars: Readonly<Record<string, string>>): CSSProperties {
  return vars as unknown as CSSProperties;
}

export function Tree({
  ref,
  nodes,
  expandedIds,
  onExpandedChange,
  selectedId,
  onSelect,
  onActivate,
  onFocusChange,
  loadingIds,
  renderContextMenu,
  rowHeight = DEFAULT_ROW_HEIGHT,
  'aria-label': ariaLabel,
  className,
  'data-testid': testId,
}: TreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => flattenTree(nodes, expandedIds), [nodes, expandedIds]);

  // The focused row is tracked by id, not index: an expand/collapse elsewhere in the tree
  // renumbers every index below it, and focus must not jump when that happens.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIndex = rows.findIndex(row => row.node.id === focusedId);
  // Nothing focused yet, or the focused node disappeared (a collapse above it, a refresh):
  // fall back to the selected row, then to the first one. Never to "no row", so the first
  // arrow key press always has somewhere to start.
  const activeIndex =
    focusedIndex >= 0
      ? focusedIndex
      : Math.max(
          0,
          rows.findIndex(row => row.node.id === selectedId)
        );
  const activeRow = rows[activeIndex];

  // React Compiler is not enabled in this build (see vite.config.ts), so the memoization this
  // warns about is not happening either way, and the virtualizer's own functions are read fresh
  // on every render below. Left as a disable rather than silenced globally so it comes back if
  // the compiler is ever turned on.
  // eslint-disable-next-line react-hooks/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    initialRect: { width: 0, height: rowHeight * INITIAL_VISIBLE_ROWS },
  });

  const rowsById = useMemo(() => new Map(rows.map(row => [row.node.id, row])), [rows]);

  const scrollToId = useCallback(
    (id: string) => {
      const index = rows.findIndex(row => row.node.id === id);
      if (index < 0) {
        diagnostics.warn('tree cannot reveal a row that is not visible', { id });
        return;
      }
      virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    [rows, virtualizer]
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => scrollRef.current?.focus(),
      scrollToId,
    }),
    [scrollToId]
  );

  /**
   * Reveal-on-selection. The guard is the id already revealed, not a change in `selectedId`
   * alone: `rows` is a dependency (the row may only appear once its parent's children load),
   * so without it every expand/collapse anywhere in the tree would yank the viewport back to
   * the selection.
   */
  const revealedIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selectedId === undefined || selectedId === revealedIdRef.current) {
      return;
    }
    const index = rows.findIndex(row => row.node.id === selectedId);
    if (index < 0) {
      return;
    }
    revealedIdRef.current = selectedId;
    virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [rows, selectedId, virtualizer]);

  const moveFocusTo = useCallback(
    (index: number) => {
      const row = rows[index];
      if (row === undefined) {
        return;
      }
      setFocusedId(row.node.id);
      virtualizer.scrollToIndex(index, { align: 'auto' });
      onFocusChange?.(row.node);
    },
    [onFocusChange, rows, virtualizer]
  );

  /**
   * Pointer handling is delegated from the container rather than bound per row, which is both
   * cheaper (one listener, not one per visible row) and the only shape that keeps the rows free
   * of handlers — a `role="treeitem"` with its own `onClick` has to carry a keyboard listener
   * and a tabindex to satisfy jsx-a11y, and both are wrong here: the keyboard model and the
   * single tabstop belong to the container.
   */
  const rowFromEvent = useCallback(
    (event: MouseEvent<HTMLDivElement>): TreeRow | undefined => {
      const element = (event.target as Element | null)?.closest('[data-node-id]');
      const id = element?.getAttribute('data-node-id');
      if (id === null || id === undefined) {
        return undefined;
      }
      const row = rowsById.get(id);
      return row?.node.disabled === true ? undefined : row;
    },
    [rowsById]
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const row = rowFromEvent(event);
      if (row === undefined) {
        return;
      }
      setFocusedId(row.node.id);
      const target = event.target as Element | null;
      if (row.expandable && target !== null && target.closest(`[${TWISTY_ATTRIBUTE}]`) !== null) {
        onExpandedChange(row.node.id, !row.expanded);
        return;
      }
      onSelect?.(row.node);
    },
    [onExpandedChange, onSelect, rowFromEvent]
  );

  const handleDoubleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const row = rowFromEvent(event);
      if (row !== undefined) {
        onActivate?.(row.node);
      }
    },
    [onActivate, rowFromEvent]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (activeRow === undefined) {
        return;
      }
      const { node, expandable, expanded, parentId } = activeRow;
      /**
       * The pointer path drops disabled rows in `rowFromEvent`, and the keyboard path has to
       * agree or a focused disabled row can still be selected, activated and expanded. Focus
       * movement stays allowed — walking past a row is not acting on it, and a tree that
       * skipped disabled rows would hide them from a keyboard user entirely.
       */
      const actionable = node.disabled !== true;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveFocusTo(Math.min(activeIndex + 1, rows.length - 1));
          return;
        case 'ArrowUp':
          event.preventDefault();
          moveFocusTo(Math.max(activeIndex - 1, 0));
          return;
        case 'Home':
          event.preventDefault();
          moveFocusTo(0);
          return;
        case 'End':
          event.preventDefault();
          moveFocusTo(rows.length - 1);
          return;
        case 'ArrowRight':
          event.preventDefault();
          if (actionable && expandable && !expanded) {
            onExpandedChange(node.id, true);
            return;
          }
          // Already open: step into it. The next row IS the first child, because the row
          // list is a depth-first flatten.
          if (expanded) {
            moveFocusTo(activeIndex + 1);
          }
          return;
        case 'ArrowLeft':
          event.preventDefault();
          if (actionable && expanded) {
            onExpandedChange(node.id, false);
            return;
          }
          if (parentId !== undefined) {
            moveFocusTo(rows.findIndex(row => row.node.id === parentId));
          }
          return;
        case 'Enter':
          event.preventDefault();
          if (!actionable) {
            return;
          }
          onSelect?.(node);
          onActivate?.(node);
          return;
        case ' ':
          event.preventDefault();
          if (!actionable) {
            return;
          }
          onSelect?.(node);
          return;
        default:
          return;
      }
    },
    [activeIndex, activeRow, moveFocusTo, onActivate, onExpandedChange, onSelect, rows]
  );

  return (
    <div
      ref={scrollRef}
      role="tree"
      aria-label={ariaLabel}
      aria-multiselectable={false}
      tabIndex={0}
      aria-activedescendant={activeRow === undefined ? undefined : rowDomId(activeRow.node.id)}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      data-testid={testId}
      className={cn(
        'group/tree min-h-0 overflow-auto text-sm outline-hidden',
        // The tree owns one tabstop, so the ring belongs to the container. The focused row
        // marks itself with `group-focus-visible/tree:` below, which is what makes the
        // activedescendant visible — HOUSE-RULES: focus styling is not optional.
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
        className
      )}
    >
      <div
        role="presentation"
        className="relative h-(--tree-height) w-full"
        style={cssVars({ '--tree-height': `${virtualizer.getTotalSize()}px` })}
      >
        {virtualizer.getVirtualItems().map(item => {
          const row = rows[item.index];
          if (row === undefined) {
            return null;
          }
          const rowElement = (
            <TreeRowView
              key={row.node.id}
              row={row}
              start={item.start}
              height={rowHeight}
              selected={row.node.id === selectedId}
              focused={activeRow?.node.id === row.node.id}
              loading={loadingIds?.has(row.node.id) ?? false}
            />
          );
          const menu = renderContextMenu?.(row.node) ?? null;
          if (menu === null) {
            return rowElement;
          }
          return (
            // ContextMenu.Root renders no element of its own, so the row stays a direct
            // child of the sizer and the tree's ownership of its treeitems is intact.
            <ContextMenu key={row.node.id}>
              <ContextMenuTrigger asChild>{rowElement}</ContextMenuTrigger>
              {menu}
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}

/** Stable per-node DOM id, so `aria-activedescendant` has something to point at. */
function rowDomId(nodeId: string): string {
  return `tree-row-${nodeId}`;
}

/** Marks the twisty so the row's own click handler can tell a toggle from a select. */
const TWISTY_ATTRIBUTE = 'data-tree-twisty';

/**
 * Purely presentational — every interaction is delegated from the tree container.
 *
 * It extends the div's own props and spreads them, because `ContextMenuTrigger asChild` clones
 * this component and hands it the trigger's `ref` plus its pointer and `onContextMenu` handlers.
 * A row that swallowed them would render fine and never open a menu — which is exactly how this
 * was found.
 */
interface TreeRowViewProps extends ComponentPropsWithRef<'div'> {
  readonly row: TreeRow;
  readonly start: number;
  readonly height: number;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly loading: boolean;
}

function TreeRowView({
  row,
  start,
  height,
  selected,
  focused,
  loading,
  ...rest
}: TreeRowViewProps) {
  const { node, depth, expandable, expanded } = row;

  return (
    // `{...rest}` first, so this component's own identity and handlers cannot be clobbered by
    // whatever the context-menu trigger passes down.
    <div
      {...rest}
      id={rowDomId(node.id)}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={selected}
      aria-disabled={node.disabled === true ? true : undefined}
      data-testid="tree-row"
      data-node-id={node.id}
      className={cn(
        'absolute inset-x-0 top-0 flex h-(--tree-row-height) translate-y-(--tree-row-start)',
        'items-center gap-1 pr-2 pl-(--tree-row-indent) select-none',
        // Selection is the wash alone — the oxide selected-row wash HOUSE-RULES §5 lists among
        // oxide's jobs, so a selected row does not spend the surface's one filled-oxide budget.
        // The label stays at full strength either way: at `text-fg-muted` it measured 5.41:1 on
        // ivory `bg-surface` against 14.39:1 here, and a tree row is the densest prose in the app.
        'text-fg',
        selected ? 'bg-active' : 'hover:bg-hover',
        focused && 'group-focus-visible/tree:inset-ring group-focus-visible/tree:inset-ring-focus',
        node.disabled === true && 'opacity-50'
      )}
      style={cssVars({
        '--tree-row-height': `${height}px`,
        '--tree-row-start': `${start}px`,
        '--tree-row-indent': `${ROW_PADDING_PX + depth * INDENT_PER_LEVEL_PX}px`,
      })}
    >
      <TreeTwisty expandable={expandable} expanded={expanded} loading={loading} />
      {node.icon === undefined ? null : (
        <Icon icon={node.icon} size="sm" className="stroke-fg-subtle" />
      )}
      {/* min-w-0 + truncate on every tree row — flexbox-layout.md, and the reason a long
          schema name cannot push the metadata out of a 240px rail. */}
      <span data-testid="tree-row-label" className="min-w-0 grow truncate">
        {node.label}
      </span>
      {node.meta === undefined ? null : (
        // Muted, not subtle: subtle measured 3.39:1 on ivory `bg-surface` (task-6-gate.json),
        // and a row count is read. The hierarchy against the label comes from size and face.
        <span className="shrink-0 font-mono text-2xs text-fg-muted tabular-nums">{node.meta}</span>
      )}
    </div>
  );
}

/**
 * The expand affordance, or a spinner while children load, or a blank of the same width so
 * leaf labels line up with their expandable siblings.
 */
function TreeTwisty({
  expandable,
  expanded,
  loading,
}: {
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly loading: boolean;
}) {
  if (loading) {
    return <Spinner size="sm" className="size-3.5 shrink-0" data-testid="tree-row-loading" />;
  }
  if (!expandable) {
    return <span className="size-3.5 shrink-0" />;
  }
  // The marker attribute sits on a wrapper rather than the icon so the hit area is the
  // whole 14px box even when the glyph's strokes are not.
  return (
    <span
      {...{ [TWISTY_ATTRIBUTE]: '' }}
      data-testid="tree-row-twisty"
      className="flex size-3.5 shrink-0 items-center justify-center"
    >
      <Icon icon={expanded ? ChevronDown : ChevronRight} size="sm" className="stroke-fg-muted" />
    </span>
  );
}
