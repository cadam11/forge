/**
 * Where every box and every edge goes. A pure function: same schema in, byte-identical geometry out.
 *
 * ── Why dagre, when the Angular file has a hand-rolled layout ───────────────────────────────────
 *
 * `erd-diagram.component.ts:869` is headed *"Hierarchical Layout (replaces dagre which has browser
 * compatibility issues)"*, and the file imports no dagre at all — `dagreConfig` is a config bag
 * whose values feed 100 lines of hand-written BFS ranking. `@dagrejs/dagre` was a dependency of the
 * Angular renderer and `angular.json` declared it under `allowedCommonJsDependencies`, so whatever
 * the incompatibility was, it was resolved by deleting the caller and keeping the dependency.
 *
 * The hand-rolled version has three problems this replaces rather than ports:
 *
 *  1. **`ranks.set(target, nodeRank + 1)` inside a BFS with re-enqueueing** and no cycle guard. A
 *     schema with an FK cycle — two tables referencing each other, which is legal and common with
 *     nullable columns — re-enqueues both forever, each pass one rank higher. `!queue.includes()`
 *     (an O(n) scan) is the only brake, and it does not stop the walk, it only stops duplicates in
 *     the queue at that instant.
 *  2. **No edge routing.** It computes `points` nowhere, so `updatePositions` always fell through to
 *     `createOrthogonalPath`, whose mid-point rule (`source.x + dx * 0.7`) draws lines straight
 *     through intervening boxes.
 *  3. **Rank crossing is not minimised** — nodes are placed in whatever order they were built, so a
 *     4-table diagram is fine and a 40-table one is a hairball.
 *
 * dagre solves all three (network-simplex ranking, order optimisation, per-edge point lists), it is
 * 40KB, it is framework-agnostic, and it is deterministic given a fixed insertion order — which this
 * module guarantees by sorting ids before inserting them. That last property is what
 * `erd-layout.spec.ts` asserts, and it is the difference between a diagram and a diagram that
 * reshuffles every time you press refresh.
 *
 * ── Geometry ────────────────────────────────────────────────────────────────────────────────────
 *
 * The constants come from `DEFAULT_CONFIG` (`erd-diagram.component.ts:79-99`): 180px wide, 20px
 * rows, 300px tall at most, 80/150/20 separation. Two deviations, both fixing overlap the original
 * shipped with:
 *
 *  - the header is 28px and rows start below it. Angular's header was 30px and its first field row
 *    was drawn at `-height/2 + 25`, so every node's first row sat 5px UNDER its own header bar.
 *  - `maxNodeHeight` clamped the box height and the field loop then drew every PK and FK anyway, so
 *    a table with 14 keys painted rows out through the bottom edge. Here the row count is what gets
 *    clamped, and the remainder becomes one "+N more" row (`erdNodeRows`).
 */

import dagre from '@dagrejs/dagre';

import type { ErdLink, ErdNode } from './erd-model';
import { erdLinks } from './erd-model';

export const NODE_WIDTH = 180;
export const HEADER_HEIGHT = 28;
export const ROW_HEIGHT = 20;
/** Vertical breathing room between the header and the first row, and after the last. */
export const ROW_PADDING = 4;
/** `DEFAULT_CONFIG.maxNodeHeight`. */
export const MAX_NODE_HEIGHT = 300;
export const NODE_SEPARATION = 80;
export const RANK_SEPARATION = 150;
export const EDGE_SEPARATION = 20;
/** Slack around the whole diagram, so a fitted view does not clip the outermost strokes. */
export const DIAGRAM_MARGIN = 40;

/** The most rows `MAX_NODE_HEIGHT` leaves room for. */
export const MAX_NODE_ROWS = Math.floor(
  (MAX_NODE_HEIGHT - HEADER_HEIGHT - ROW_PADDING * 2) / ROW_HEIGHT
);

/**
 * One line inside a node box.
 *
 * Only keys are listed, which is the Angular behaviour (`createInternalNodes` filtered to
 * `isPrimaryKey` and `relatedNodeId && !isPrimaryKey`) and the right one at this size: 180px of box
 * cannot hold 30 columns, and the columns that explain the *shape* of a schema are its keys. The
 * `'more'` row is new — a node that silently showed 4 of 22 columns read as a complete table.
 */
export type ErdRow =
  | {
      readonly kind: 'pk' | 'fk';
      readonly fieldId: string;
      readonly name: string;
      readonly type: string;
      readonly target?: string;
    }
  | { readonly kind: 'more'; readonly hidden: number };

/**
 * The rows one node shows: primary keys, then foreign keys, then a count of what did not fit.
 *
 * "What did not fit" counts every column the box does not name — the non-key columns as well as the
 * keys past `MAX_NODE_ROWS` — because that is the number a reader needs to know the box is partial.
 */
export function erdNodeRows(node: ErdNode): readonly ErdRow[] {
  const primaryKeys = node.fields.filter(field => field.isPrimaryKey);
  const foreignKeys = node.fields.filter(
    field => field.relatedNodeId !== undefined && !field.isPrimaryKey
  );

  const keys = [...primaryKeys, ...foreignKeys];

  // The "+N more" row costs a slot, so the slot has to be reserved whenever one will be pushed —
  // which is whenever ANY column goes unnamed, not only when the keys alone overflow. Reserving on
  // `keys.length > MAX_NODE_ROWS` alone put 14 rows in a 13-row box for a table with exactly
  // MAX_NODE_ROWS keys and one further column: the keys all fit, so no slot was kept, and then the
  // count row was pushed anyway and painted through the bottom edge.
  const willCount = keys.length > MAX_NODE_ROWS || node.fields.length > keys.length;
  const shown = keys.slice(0, MAX_NODE_ROWS - (willCount ? 1 : 0));
  const rows: ErdRow[] = shown.map(field => ({
    kind: field.isPrimaryKey ? 'pk' : 'fk',
    fieldId: field.id,
    name: field.name,
    type: field.type,
    ...(field.relatedNodeName === undefined ? {} : { target: field.relatedNodeName }),
  }));

  const hidden = node.fields.length - shown.length;
  if (hidden > 0) rows.push({ kind: 'more', hidden });

  // The invariant the reserved slot buys: never more rows than the box drawn by `erdNodeHeight` has.
  if (rows.length > MAX_NODE_ROWS) throw new Error(`erdNodeRows overflowed for ${node.id}`);
  return rows;
}

/** A node's box height, from its row count. At least one row tall, so an empty table is still a box. */
export function erdNodeHeight(rowCount: number): number {
  const rows = Math.max(1, Math.min(rowCount, MAX_NODE_ROWS));
  return HEADER_HEIGHT + ROW_PADDING * 2 + rows * ROW_HEIGHT;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A node with its box resolved: `x`/`y` are the TOP-LEFT corner, not dagre's centre. */
export interface ErdLayoutNode {
  readonly node: ErdNode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rows: readonly ErdRow[];
  readonly primaryKeyCount: number;
  readonly foreignKeyCount: number;
}

export interface ErdLayoutEdge {
  readonly link: ErdLink;
  /** dagre's routed polyline, in the same coordinate space as the nodes. Never fewer than 2 points. */
  readonly points: readonly Point[];
}

export interface ErdLayout {
  readonly nodes: readonly ErdLayoutNode[];
  readonly edges: readonly ErdLayoutEdge[];
  /** The diagram's own extent, margins included. What `fitTransform` fits. */
  readonly width: number;
  readonly height: number;
}

export const EMPTY_LAYOUT: ErdLayout = { nodes: [], edges: [], width: 0, height: 0 };

export interface ErdLayoutOptions {
  /** `'LR'` reads as "parents to the right", which is how the Angular default (`rankDir: 'LR'`) read. */
  readonly rankDir?: 'LR' | 'TB';
}

/**
 * Lay out a set of nodes.
 *
 * Determinism comes from three things and is asserted by the spec: nodes are inserted in id order,
 * edges in id order, and dagre's `ranker` is pinned to `network-simplex` (its default, stated so a
 * dagre upgrade that changed the default would be a visible diff rather than a reshuffled diagram).
 */
export function layoutErd(nodes: readonly ErdNode[], options: ErdLayoutOptions = {}): ErdLayout {
  if (nodes.length === 0) return EMPTY_LAYOUT;

  const links = erdLinks(nodes);
  const graph = new dagre.graphlib.Graph({ directed: true, multigraph: true });
  graph.setGraph({
    rankdir: options.rankDir ?? 'LR',
    nodesep: NODE_SEPARATION,
    ranksep: RANK_SEPARATION,
    edgesep: EDGE_SEPARATION,
    ranker: 'network-simplex',
    marginx: DIAGRAM_MARGIN,
    marginy: DIAGRAM_MARGIN,
  });
  // dagre reads an edge's label for its own `width`/`height` fields and throws on `undefined`.
  graph.setDefaultEdgeLabel(() => ({}));

  const rowsById = new Map<string, readonly ErdRow[]>();
  const sorted = [...nodes].sort((left, right) => compareIds(left.id, right.id));

  for (const node of sorted) {
    const rows = erdNodeRows(node);
    rowsById.set(node.id, rows);
    graph.setNode(node.id, { width: NODE_WIDTH, height: erdNodeHeight(rows.length) });
  }

  // `multigraph` + a name per edge: two FK columns in the same table pointing at the same parent are
  // two relationships, and an unnamed second `setEdge` would overwrite the first.
  const sortedLinks = [...links].sort((left, right) => compareIds(left.id, right.id));
  for (const link of sortedLinks) {
    graph.setEdge(link.sourceNodeId, link.targetNodeId, {}, link.id);
  }

  dagre.layout(graph);

  const byId = new Map(nodes.map(node => [node.id, node]));
  const layoutNodes: ErdLayoutNode[] = [];

  for (const id of graph.nodes()) {
    const node = byId.get(id);
    const placed = graph.node(id);
    // Neither can be missing — every id came from `nodes` — but dagre's types say `any`, so the
    // guard is what keeps this function honest rather than `!`-asserted.
    if (node === undefined || placed === undefined) continue;

    const rows = rowsById.get(id) ?? [];
    layoutNodes.push({
      node,
      x: placed.x - placed.width / 2,
      y: placed.y - placed.height / 2,
      width: placed.width,
      height: placed.height,
      rows,
      primaryKeyCount: node.fields.filter(field => field.isPrimaryKey).length,
      foreignKeyCount: node.fields.filter(
        field => field.relatedNodeId !== undefined && !field.isPrimaryKey
      ).length,
    });
  }

  const linksById = new Map(links.map(link => [link.id, link]));
  const layoutEdges: ErdLayoutEdge[] = [];

  for (const edge of graph.edges()) {
    const link = edge.name === undefined ? undefined : linksById.get(edge.name);
    const routed = graph.edge(edge);
    // `graph.edge` is typed `EdgeLabel`, an index signature, so `points` arrives as `any`. Rebuilding
    // each point through an explicitly typed parameter is what keeps this module free of `any`.
    const routedPoints: readonly Point[] = routed?.points ?? [];
    const points: readonly Point[] = routedPoints.map((point: Point) => ({
      x: point.x,
      y: point.y,
    }));
    if (link === undefined || points.length < 2) continue;
    layoutEdges.push({ link, points });
  }

  const label = graph.graph();
  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: label.width ?? 0,
    height: label.height ?? 0,
  };
}

/**
 * Stable id ordering, independent of the user's locale.
 *
 * `Array.prototype.sort`'s default comparator stringifies and compares by UTF-16 code unit, which is
 * already locale-independent; `localeCompare` is what would NOT be. Spelled out because "why not
 * localeCompare" is the question a reader will have, and because sorting is the determinism
 * guarantee this module rests on.
 */
function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * A label clipped to a character budget, with an ellipsis when it was clipped.
 *
 * SVG has no `text-overflow`, and the alternatives are worse: `textLength` squashes glyphs, and
 * measuring with `getComputedTextLength` is a forced layout per label — 200 tables is a few thousand
 * of them. A character budget derived from the box width is approximate in the last few pixels and
 * costs nothing, which is the right trade for a diagram whose whole point is the shape rather than the
 * text. The ellipsis is one character and replaces the last one, so the result never exceeds the
 * budget.
 */
export function truncateLabel(text: string, budget: number): string {
  const characters = [...text];
  if (budget <= 0) return '';
  if (characters.length <= budget) return text;
  return `${characters.slice(0, budget - 1).join('')}…`;
}

/** An SVG path for a rectangle with only its TOP corners rounded — the node header bar. */
export function topRoundedRectPath(width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height);
  return [
    `M 0 ${height}`,
    `L 0 ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    `L ${width - r} 0`,
    `A ${r} ${r} 0 0 1 ${width} ${r}`,
    `L ${width} ${height}`,
    'Z',
  ].join(' ');
}

/** A polyline through dagre's routed points. Straight segments, as the Angular original drew them. */
export function edgePath(points: readonly Point[]): string {
  if (points.length < 2) return '';
  const [first, ...rest] = points;
  if (first === undefined) return '';
  return `M ${round(first.x)} ${round(first.y)}${rest
    .map(point => ` L ${round(point.x)} ${round(point.y)}`)
    .join('')}`;
}

/**
 * Two decimals. dagre's routing produces values like `264.54545454545456`, and an SVG `d` attribute
 * built from those is both unreadable in a diff and needlessly long in the DOM — 200 tables is a few
 * thousand of these numbers.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
