/**
 * Pan, zoom and culling — as arithmetic, with no DOM in it.
 *
 * ── Why not d3-zoom, which the Angular diagram used ─────────────────────────────────────────────
 *
 * `erd-diagram.component.ts` built its SVG through `d3.select(...).append(...)`, so `d3.zoom()` was
 * the natural fit: both sides of the pairing are imperative. This diagram is JSX, and the two models
 * fight — d3 owns a `transform` attribute React also believes it owns. Wiring d3-zoom to a React
 * transform is possible (attach the behaviour, mirror `event.transform` into state) but it buys
 * nothing here and costs three things:
 *
 *  1. **`dblclick.zoom` is on by default**, and double-click is how this diagram opens an object tab.
 *     It would have to be disabled first thing.
 *  2. **jsdom.** d3-zoom reads `getScreenCTM`, `createSVGPoint` and pointer capture, none of which
 *     jsdom implements, so none of the zoom behaviour would be unit-testable — it would all move to
 *     Playwright. The functions below are ten lines each and tested directly.
 *  3. **The `d3` umbrella is ~280KB** and the Angular renderer imported all of it (`import * as d3`).
 *     Bringing d3-zoom over alone means new dependencies at versions the Angular tree does not pin.
 *
 * What d3-zoom would give that this does not: multi-touch pinch and its own tween machinery. A fixed
 * Electron window on a trackpad reports pinch as `wheel` with `ctrlKey`, which is handled here, and
 * the tweening is CSS.
 *
 * The transform is the standard SVG one — `translate(x, y) scale(k)` — so the inverse is a division
 * and nothing needs a matrix.
 */

import type { ErdLayout, ErdLayoutNode, Point } from './erd-layout';

export interface Transform {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

/** `DEFAULT_CONFIG.minZoom` / `maxZoom` (`erd-diagram.component.ts:92-93`). */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const IDENTITY: Transform = { x: 0, y: 0, k: 1 };

/** `zoomToFit`'s padding, in screen pixels (`erd-diagram.component.ts:308`). */
export const FIT_PADDING = 24;

/** One press of the zoom-in button: the Angular `scaleBy(1.2)` / `scaleBy(0.83)` pair. */
export const ZOOM_STEP = 1.2;

/**
 * NaN is the only value `Math.min`/`Math.max` cannot rescue — it propagates through both — and it
 * arrives from a `0 / 0` in `fitTransform`'s caller when a layout and a viewport are both empty. An
 * infinity clamps to the corresponding limit like any other out-of-range number.
 */
export function clampZoom(k: number): number {
  if (Number.isNaN(k)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

export function transformToSvg(transform: Transform): string {
  return `translate(${round(transform.x)}, ${round(transform.y)}) scale(${round(transform.k, 4)})`;
}

/**
 * Scale by `factor` while keeping `focal` — a point in the host element's own coordinates — pinned
 * to the same diagram content.
 *
 * The invariant, and the spec's first assertion: `screenToDiagram(zoomAbout(t, p, f), p)` equals
 * `screenToDiagram(t, p)`. Clamping is applied to the scale first and the translation derived from
 * the clamped value, so a zoom that hits the limit does not drift sideways — the bug you get from
 * clamping afterwards.
 */
export function zoomAbout(transform: Transform, focal: Point, factor: number): Transform {
  const k = clampZoom(transform.k * factor);
  const applied = k / transform.k;
  return {
    k,
    x: focal.x - (focal.x - transform.x) * applied,
    y: focal.y - (focal.y - transform.y) * applied,
  };
}

/** Move the content by a screen-space delta. Panning never changes the scale. */
export function panBy(transform: Transform, dx: number, dy: number): Transform {
  return { ...transform, x: transform.x + dx, y: transform.y + dy };
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The transform that centres the whole diagram in `viewport`.
 *
 * Simpler than the Angular `zoomToFit`, which walked every node to find the bounds because a force
 * simulation can put a node anywhere, including at a negative coordinate. dagre reports the extent it
 * produced and anchors it at the origin, so the bounds are `layout.width × layout.height` and the
 * only arithmetic left is the centring.
 *
 * Returns `IDENTITY` for an unmeasured viewport or an empty diagram — a fit against a zero-sized box
 * would be a division by zero, and the Angular code's answer to the same case was to return early.
 */
export function fitTransform(
  layout: Pick<ErdLayout, 'width' | 'height'>,
  viewport: Size,
  padding = FIT_PADDING
): Transform {
  if (viewport.width <= 0 || viewport.height <= 0) return IDENTITY;
  if (layout.width <= 0 || layout.height <= 0) return IDENTITY;

  const usable = {
    width: Math.max(1, viewport.width - padding * 2),
    height: Math.max(1, viewport.height - padding * 2),
  };
  const k = clampZoom(Math.min(usable.width / layout.width, usable.height / layout.height, 1));

  return {
    k,
    x: (viewport.width - layout.width * k) / 2,
    y: (viewport.height - layout.height * k) / 2,
  };
}

/** The transform that puts one node in the middle of the viewport at `k`. */
export function centreOnNode(node: ErdLayoutNode, viewport: Size, k: number): Transform {
  const scale = clampZoom(k);
  return {
    k: scale,
    x: viewport.width / 2 - (node.x + node.width / 2) * scale,
    y: viewport.height / 2 - (node.y + node.height / 2) * scale,
  };
}

/** Host-element coordinates → diagram coordinates. The inverse of `transformToSvg`. */
export function screenToDiagram(transform: Transform, point: Point): Point {
  return {
    x: (point.x - transform.x) / transform.k,
    y: (point.y - transform.y) / transform.k,
  };
}

/**
 * How much of the diagram is worth having in the DOM.
 *
 * ONE viewport of slack on every side, so a pan of less than a full screen never reveals an unmounted
 * node, and `CULL_EPSILON` below means the set is not even recomputed for small movements. At 200
 * tables — the size Task 23 measures — a fitted diagram is entirely on screen and this returns
 * everything; the case it exists for is a user zoomed in to read one corner, where it is the
 * difference between ~12 node subtrees in the DOM and 200.
 */
export function cullMargin(viewport: Size): Size {
  return { width: viewport.width, height: viewport.height };
}

/**
 * The nodes to render.
 *
 * **An unmeasured viewport renders everything.** A zero-sized host is either the first paint before
 * the `ResizeObserver` has fired or a jsdom test, and in both cases culling against nothing would
 * mount nothing — a blank diagram that is very hard to tell from a broken one.
 */
export function visibleNodes(
  nodes: readonly ErdLayoutNode[],
  transform: Transform,
  viewport: Size
): readonly ErdLayoutNode[] {
  if (viewport.width <= 0 || viewport.height <= 0) return nodes;

  const margin = cullMargin(viewport);
  const topLeft = screenToDiagram(transform, { x: -margin.width, y: -margin.height });
  const bottomRight = screenToDiagram(transform, {
    x: viewport.width + margin.width,
    y: viewport.height + margin.height,
  });

  return nodes.filter(
    node =>
      node.x + node.width >= topLeft.x &&
      node.x <= bottomRight.x &&
      node.y + node.height >= topLeft.y &&
      node.y <= bottomRight.y
  );
}

/** Edges whose source or target survived the cull, so no edge dangles from nothing. */
export function visibleEdges(
  edges: readonly ErdLayout['edges'][number][],
  visible: readonly ErdLayoutNode[]
): readonly ErdLayout['edges'][number][] {
  const ids = new Set(visible.map(node => node.node.id));
  return edges.filter(edge => ids.has(edge.link.sourceNodeId) || ids.has(edge.link.targetNodeId));
}

/**
 * Whether a transform has moved enough to be worth recomputing the cull for.
 *
 * The pan handler writes the new transform straight onto the SVG group and only publishes it to React
 * when this says so, which is what keeps a drag at one `setState` per *gesture* rather than per
 * pointer event. 64px and 5% are both well inside the one-viewport cull margin, so nothing can scroll
 * into view unrendered.
 */
export function cullChanged(previous: Transform, next: Transform): boolean {
  return (
    Math.abs(previous.x - next.x) >= CULL_EPSILON_PX ||
    Math.abs(previous.y - next.y) >= CULL_EPSILON_PX ||
    Math.abs(previous.k - next.k) / previous.k >= CULL_EPSILON_SCALE
  );
}

export const CULL_EPSILON_PX = 64;
export const CULL_EPSILON_SCALE = 0.05;

/**
 * A wheel event's zoom factor.
 *
 * `deltaY` is pixels on a trackpad and multiples of ~100 on a mouse wheel, and macOS reports a
 * trackpad pinch as `ctrlKey` + a small `deltaY`. One exponential curve handles all three; the
 * per-event clamp is what stops a single momentum-scroll frame (`deltaY` in the hundreds) from
 * jumping four octaves.
 */
export function wheelZoomFactor(deltaY: number, pinch: boolean): number {
  const sensitivity = pinch ? 0.01 : 0.002;
  const factor = Math.exp(-deltaY * sensitivity);
  return Math.min(2, Math.max(0.5, factor));
}

function round(value: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
