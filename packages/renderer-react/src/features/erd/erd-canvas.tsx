/**
 * The diagram itself: JSX SVG, painted entirely from Layer 2 tokens.
 *
 * ── The theme, which is the point of this file ──────────────────────────────────────────────────
 *
 * The Angular diagram carried 26 hardcoded hex values (`plans/ui-overhaul/PROPOSAL.md` §1.6) and a
 * runtime luminance probe that read `--bg-primary` through `getComputedStyle`, guessed whether the
 * app was in light mode, and overrode SIX of the twelve colours if it thought so
 * (`erd-diagram.component.ts:647-691`). The other six — the PK amber wash `#fff3cd`, the FK blue
 * `#cce5ff`, the self-reference greens, the selection blue `#2196f3` — stayed at their dark-theme
 * values on the ivory canvas. There are **no colour values in this file at all**: every fill and
 * stroke is a Tailwind utility over a token, so `data-theme` alone decides both themes and the
 * "which theme is it?" question is never asked in JavaScript.
 *
 * Two of the ported colours could not survive that translation and are named here so their absence
 * is a decision rather than an oversight:
 *
 *  - **the blue FK treatment and the blue selection ring**. HOUSE-RULES §5 is "no blue anywhere",
 *    and the palette has none. FK is the accent (oxide), and so is selection — told apart by stroke
 *    weight rather than hue, which is also what makes the diagram legible to a colour-blind reader.
 *  - **the `#4CAF50` / `#e8f5e9` self-reference green**. Chartreuse is the only green in the palette
 *    and HOUSE-RULES §5 reserves it for verification, capped at two on screen. A self-reference is
 *    now told by its shape — dagre routes it as a loop — which is how every other ERD tool marks it.
 *
 * ── SVG, not innerHTML ─────────────────────────────────────────────────────────────────────────
 *
 * Every element below is JSX. `src/markdown/` remains the only `dangerouslySetInnerHTML` in the
 * renderer (`ban-rules.spec.ts` enforces it), and nothing here serialises or parses markup — the
 * Angular version built its SVG through `d3.select().append()`, which is a different mechanism but
 * the same amount of "the DOM is assembled from data".
 *
 * ── 200 tables ─────────────────────────────────────────────────────────────────────────────────
 *
 * Three things, and they compose: the transform is written imperatively so a pan costs no React work
 * (`use-erd-viewport.ts`), every node is a `memo` whose props are stable across a pan, and the node
 * list is culled to the viewport plus one viewport of margin. The Angular diagram did none of these —
 * it re-ran `getBBox()` per edge label per tick, which is a forced layout per edge per frame.
 */

import { memo, useCallback, useId, useMemo } from 'react';

import { cn } from '../../ui';
import {
  edgePath,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  ROW_PADDING,
  topRoundedRectPath,
  truncateLabel,
  type ErdLayout,
  type ErdLayoutEdge,
  type ErdLayoutNode,
  type ErdRow,
} from './erd-layout';
import { relatedNodeIds, type ErdNode } from './erd-model';
import { visibleEdges, visibleNodes } from './erd-viewport';
import { isDiagramBackground, type ErdViewport } from './use-erd-viewport';

/** How a node is painted. Selection and adjacency are the only two states the diagram has. */
type NodeState = 'plain' | 'related' | 'selected';

const NODE_STROKE: Record<NodeState, string> = {
  plain: 'fill-surface stroke-rule-strong stroke-1',
  related: 'fill-surface stroke-accent/60 [stroke-width:1.5]',
  selected: 'fill-surface stroke-accent stroke-2',
};

/**
 * Character budgets, from the box's own arithmetic: 180px wide, the name column starts at 30 and the
 * type column is right-aligned at 172. IBM Plex Mono at 10px is exactly 6px per character; Instrument
 * Sans at 11px averages ~5.5. So the type takes 72px, leaving 66 for the name.
 */
const NAME_BUDGET = 12;
const TYPE_BUDGET = 12;
const HEADER_BUDGET = 24;

/** Where the row block starts inside a node box. Below the header, unlike the original. */
const ROWS_TOP = HEADER_HEIGHT + ROW_PADDING;
const BADGE_X = 8;
const NAME_X = 30;

export interface ErdCanvasProps {
  readonly layout: ErdLayout;
  readonly viewport: ErdViewport;
  readonly selectedNodeId: string | null;
  /** `null` when the background was pressed. */
  readonly onSelect: (node: ErdNode | null) => void;
  /** Double-click, or Enter with the node focused. */
  readonly onOpen: (node: ErdNode) => void;
}

export function ErdCanvas({ layout, viewport, selectedNodeId, onSelect, onOpen }: ErdCanvasProps) {
  /**
   * Destructured, and it has to be: `react-hooks/refs` reads `viewport.anything` inside a render as an
   * access to the refs the object carries and rejects it. Naming the members once at the top is both
   * what the rule wants and what makes the render body read as a component rather than as a handle.
   */
  const {
    hostRef,
    contentRef,
    transform,
    viewport: size,
    isPanning,
    onPointerDown: beginGesture,
    onPointerMove,
    onPointerUp,
  } = viewport;

  const markers = useId();
  const arrow = `erd-arrow-${markers}`;
  const arrowActive = `erd-arrow-active-${markers}`;

  const nodes = useMemo(
    () => visibleNodes(layout.nodes, transform, size),
    [layout.nodes, size, transform]
  );
  const edges = useMemo(() => visibleEdges(layout.edges, nodes), [layout.edges, nodes]);

  /** The immediate neighbours of the selection, which is the only highlight this diagram has. */
  const related = useMemo(() => {
    if (selectedNodeId === null) return new Set<string>();
    return new Set(
      relatedNodeIds(
        layout.nodes.map(placed => placed.node),
        selectedNodeId,
        1
      )
    );
  }, [layout.nodes, selectedNodeId]);

  /**
   * Deselect on a press into empty space, not on a click.
   *
   * Both are ports of `svg.on('click', …)` (`erd-diagram.component.ts:1025`), which fired at the end
   * of a background DRAG too because d3-zoom does not suppress the click — so "any background press
   * clears the selection" is the shipped behaviour, not a simplification of it. `pointerdown` rather
   * than `click` because a `div` with an `onClick` and no role is a `jsx-a11y` error, and this
   * element's job is a gesture surface, not a control. `isDiagramBackground` is shared with the pan
   * guard so the two can never disagree about what counts as background.
   */
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isDiagramBackground(event.target)) onSelect(null);
      beginGesture(event);
    },
    [beginGesture, onSelect]
  );

  const firstNodeId = nodes[0]?.node.id ?? null;

  return (
    <div
      ref={hostRef}
      data-testid="erd-canvas"
      data-erd-node-count={nodes.length}
      className={cn(
        'relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden bg-canvas',
        isPanning ? 'cursor-grabbing' : 'cursor-grab'
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg
        className="absolute inset-0 size-full"
        role="group"
        aria-label="Entity relationship diagram"
      >
        <defs>
          {/*
            `userSpaceOnUse`, unlike the Angular marker, which inherited the default
            `strokeWidth` units — so a highlighted 2px edge grew a 33% larger arrowhead than an
            ordinary 1.5px one. Both arrows are the same size here and both scale with the zoom.
          */}
          <marker
            id={arrow}
            viewBox="0 -5 10 10"
            refX={9}
            refY={0}
            markerWidth={9}
            markerHeight={9}
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M0,-4L8,0L0,4" className="fill-fg-subtle" />
          </marker>
          <marker
            id={arrowActive}
            viewBox="0 -5 10 10"
            refX={9}
            refY={0}
            markerWidth={9}
            markerHeight={9}
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M0,-4L8,0L0,4" className="fill-accent" />
          </marker>
        </defs>

        {/* NO `transform` prop — `use-erd-viewport.ts` owns that attribute. */}
        <g ref={contentRef}>
          {/* Edges first, so a box always covers the line that ends at it. */}
          <g data-testid="erd-edges">
            {edges.map(edge => {
              const highlighted =
                selectedNodeId !== null &&
                (edge.link.sourceNodeId === selectedNodeId ||
                  edge.link.targetNodeId === selectedNodeId);
              return (
                <ErdEdgeShape
                  key={edge.link.id}
                  edge={edge}
                  highlighted={highlighted}
                  marker={highlighted ? arrowActive : arrow}
                />
              );
            })}
          </g>

          {nodes.map(placed => (
            <ErdNodeShape
              key={placed.node.id}
              placed={placed}
              state={
                placed.node.id === selectedNodeId
                  ? 'selected'
                  : related.has(placed.node.id)
                    ? 'related'
                    : 'plain'
              }
              // A roving tabstop: one node is in the tab order, and it is the selected one. 200
              // tab stops in a diagram would make the rest of the tab strip unreachable.
              tabbable={placed.node.id === (selectedNodeId ?? firstNodeId)}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

interface ErdEdgeShapeProps {
  readonly edge: ErdLayoutEdge;
  readonly highlighted: boolean;
  readonly marker: string;
}

/**
 * One relationship.
 *
 * No label. The Angular diagram drew the FK column's name at the mid-point over a background rect it
 * sized by calling `getBBox()` on the text — per edge, on every simulation tick, which forces a
 * layout each time. The same information is on the source node's FK row, two centimetres away.
 */
const ErdEdgeShape = memo(function ErdEdgeShape({ edge, highlighted, marker }: ErdEdgeShapeProps) {
  return (
    <path
      data-testid="erd-edge"
      data-erd-edge-id={edge.link.id}
      data-erd-edge-source={edge.link.sourceNodeId}
      data-erd-edge-target={edge.link.targetNodeId}
      data-erd-edge-self={edge.link.isSelfReference ? 'true' : undefined}
      d={edgePath(edge.points)}
      markerEnd={`url(#${marker})`}
      className={cn(
        'fill-none',
        highlighted ? 'stroke-accent [stroke-width:2]' : 'stroke-fg-subtle [stroke-width:1.5]'
      )}
    />
  );
});

interface ErdNodeShapeProps {
  readonly placed: ErdLayoutNode;
  readonly state: NodeState;
  readonly tabbable: boolean;
  readonly onSelect: (node: ErdNode) => void;
  readonly onOpen: (node: ErdNode) => void;
}

/**
 * "1 primary key", "2 primary keys" — a screen reader reads the label verbatim, so the `s` is not
 * optional the way it is in a visual count.
 */
function keyCount(count: number, kind: 'primary' | 'foreign'): string {
  return `${count} ${kind} key${count === 1 ? '' : 's'}`;
}

/**
 * One table.
 *
 * `memo` is load-bearing rather than decorative: the parent re-renders on every published transform,
 * and every prop here is either the node's own layout (stable until the schema changes) or one of two
 * stable callbacks — so a pan reconciles the wrapper and skips all 200 subtrees.
 */
const ErdNodeShape = memo(function ErdNodeShape({
  placed,
  state,
  tabbable,
  onSelect,
  onOpen,
}: ErdNodeShapeProps) {
  const { node, width, height, rows } = placed;

  return (
    <g
      data-testid="erd-node"
      data-erd-node-id={node.id}
      data-erd-node-state={state}
      transform={`translate(${placed.x}, ${placed.y})`}
      role="button"
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={state === 'selected'}
      aria-label={`${node.schemaName === '' ? node.name : `${node.schemaName}.${node.name}`}, ${keyCount(placed.primaryKeyCount, 'primary')}, ${keyCount(placed.foreignKeyCount, 'foreign')}`}
      className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      onClick={() => onSelect(node)}
      onDoubleClick={() => onOpen(node)}
      onKeyDown={event => {
        if (event.key === 'Enter') onOpen(node);
        else if (event.key === ' ') onSelect(node);
        else return;
        event.preventDefault();
      }}
    >
      {/* Ported verbatim: the native tooltip the original appended to every node group. */}
      <title>{`${node.schemaName}.${node.name}\nPrimary keys: ${placed.primaryKeyCount}\nForeign keys: ${placed.foreignKeyCount}`}</title>

      <rect width={width} height={height} rx={4} className={NODE_STROKE[state]} />
      <path d={topRoundedRectPath(width, HEADER_HEIGHT, 4)} className="fill-chrome" />
      <text
        x={BADGE_X}
        y={HEADER_HEIGHT / 2}
        dominantBaseline="central"
        className="fill-fg text-sm font-medium"
      >
        {truncateLabel(node.name, HEADER_BUDGET)}
      </text>

      {rows.map((row, index) => (
        <ErdRowShape
          key={row.kind === 'more' ? 'more' : row.fieldId}
          row={row}
          width={width}
          top={ROWS_TOP + index * ROW_HEIGHT}
        />
      ))}
    </g>
  );
});

interface ErdRowShapeProps {
  readonly row: ErdRow;
  readonly width: number;
  readonly top: number;
}

function ErdRowShape({ row, width, top }: ErdRowShapeProps) {
  const middle = top + ROW_HEIGHT / 2;

  if (row.kind === 'more') {
    return (
      <text
        x={BADGE_X}
        y={middle}
        dominantBaseline="central"
        className="fill-fg-subtle font-mono text-2xs"
      >
        {`+${row.hidden} more`}
      </text>
    );
  }

  const isPrimary = row.kind === 'pk';
  return (
    <>
      <rect
        x={1}
        y={top}
        width={width - 2}
        height={ROW_HEIGHT}
        className={isPrimary ? 'fill-warning/12' : 'fill-accent/12'}
      />
      <text
        x={BADGE_X}
        y={middle}
        dominantBaseline="central"
        className={cn('font-mono text-2xs', isPrimary ? 'fill-warning' : 'fill-accent')}
      >
        {isPrimary ? 'PK' : 'FK'}
      </text>
      <text x={NAME_X} y={middle} dominantBaseline="central" className="fill-fg text-xs">
        {truncateLabel(row.name, NAME_BUDGET)}
      </text>
      <text
        x={width - BADGE_X}
        y={middle}
        textAnchor="end"
        dominantBaseline="central"
        className="fill-fg-muted font-mono text-2xs"
      >
        {truncateLabel(row.type, TYPE_BUDGET)}
      </text>
    </>
  );
}
