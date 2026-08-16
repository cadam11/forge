/**
 * The React half of pan and zoom: refs, listeners and one piece of arithmetic from
 * `erd-viewport.ts` per gesture.
 *
 * ── Why the transform is not a React prop ───────────────────────────────────────────────────────
 *
 * `transform` is written straight onto the content `<g>` with `setAttribute`, and it is deliberately
 * absent from that element's JSX. React only touches attributes it is given, so leaving it out is
 * what makes the imperative write safe rather than a fight — the alternative is a `setState` per
 * pointermove, which at 200 nodes is a reconcile per frame of a drag.
 *
 * What React DOES get is a throttled copy (`transform`), published only when the cull set could have
 * changed (`cullChanged`) or when a gesture ends. That is the value the zoom readout renders and the
 * value `visibleNodes` culls against, so the expensive consequences of a pan happen a handful of
 * times per gesture instead of sixty times a second.
 *
 * ── Why the wheel listener is attached by hand ──────────────────────────────────────────────────
 *
 * React registers `wheel` (along with `touchstart`/`touchmove`) as a **passive** listener on the root
 * container, so `preventDefault()` inside an `onWheel` prop does nothing and logs a console warning.
 * The default has to be prevented here: under Electron a ctrl+wheel is the page-zoom gesture, and a
 * plain wheel scrolls the dock panel. So the listener goes on the host element directly with
 * `{ passive: false }`.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { ErdLayout, ErdLayoutNode } from './erd-layout';
import {
  clampZoom,
  cullChanged,
  fitTransform,
  IDENTITY,
  panBy,
  transformToSvg,
  wheelZoomFactor,
  zoomAbout,
  ZOOM_STEP,
  type Size,
  type Transform,
} from './erd-viewport';

/** How long after the last wheel event the transform is published. One frame is too soon. */
const WHEEL_SETTLE_MS = 120;

export interface ErdViewport {
  /**
   * Goes on the element that owns the size and the gestures.
   *
   * A **callback ref**, not a ref object, and that is a bug fix rather than a style choice. This hook
   * is called by `erd-panel.tsx` and the ref is attached in `erd-canvas.tsx`, which the panel does not
   * render until the schema has resolved. With a ref object, every effect below ran once — while the
   * panel was still showing its spinner, with `hostRef.current === null` — took its early return, and
   * never re-ran, because its dependencies never changed again. Measured consequence: the
   * `ResizeObserver` was never installed (so the viewport stayed 0×0 and fit-on-load was a no-op) and
   * the wheel listener was never attached (so the diagram could not be zoomed with a trackpad at all).
   * Caught by the e2e tier, which is the only place a real wheel event exists.
   *
   * A callback ref puts the element in state, so the effects re-run the moment it arrives.
   */
  readonly hostRef: (node: HTMLDivElement | null) => void;
  /** Goes on the `<g>` that holds the diagram. Give it NO `transform` prop. */
  readonly contentRef: React.RefObject<SVGGElement | null>;
  /** The published transform: for the zoom readout and for culling, not for painting. */
  readonly transform: Transform;
  /** The host's measured size. `{0, 0}` until the `ResizeObserver` has reported. */
  readonly viewport: Size;
  readonly isPanning: boolean;
  readonly onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly fit: () => void;
  readonly reset: () => void;
  readonly centreOn: (node: ErdLayoutNode) => void;
}

export function useErdViewport(layout: Pick<ErdLayout, 'width' | 'height'>): ErdViewport {
  /** The gesture surface, in state rather than a ref — see `ErdViewport.hostRef`. */
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const hostRef = useCallback((node: HTMLDivElement | null) => {
    setHost(node);
  }, []);

  /**
   * The content group stays a ref object, because nothing needs to REACT to its arrival: the layout
   * effect below runs after every commit and writes the transform onto whatever is there.
   */
  const contentRef = useRef<SVGGElement | null>(null);

  /** The live transform. The DOM follows this; React follows `published`. */
  const liveRef = useRef<Transform>(IDENTITY);
  const [published, setPublished] = useState<Transform>(IDENTITY);
  const publishedRef = useRef<Transform>(IDENTITY);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const publish = useCallback(() => {
    publishedRef.current = liveRef.current;
    setPublished(liveRef.current);
  }, []);

  /**
   * Write to the DOM, and publish only if it could matter. Every gesture funnels through here, which
   * is why there is exactly one place that knows the transform reaches the screen imperatively.
   */
  const apply = useCallback(
    (next: Transform) => {
      liveRef.current = next;
      contentRef.current?.setAttribute('transform', transformToSvg(next));
      if (cullChanged(publishedRef.current, next)) publish();
    },
    [publish]
  );

  // The initial transform, and any transform applied before the `<g>` existed. React never renders
  // the attribute, so this is the only thing that puts it there on the first paint.
  useLayoutEffect(() => {
    contentRef.current?.setAttribute('transform', transformToSvg(liveRef.current));
  });

  // ── Measurement ────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (host === null) return;

    const measure = (): void => {
      const { clientWidth, clientHeight } = host;
      setViewport(current =>
        // A ResizeObserver fires on mount and on every dock drag; re-rendering for a sub-pixel
        // change would refit nothing and cost a reconcile.
        Math.abs(current.width - clientWidth) < 1 && Math.abs(current.height - clientHeight) < 1
          ? current
          : { width: clientWidth, height: clientHeight }
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);

  // ── Fit on load ────────────────────────────────────────────────────────────────────────────────
  //
  // `fitOnLoad` in the Angular config ran inside `setupERD`, which reran when the schema changed. This
  // refits on a size change too, and **only until the user has moved the diagram themselves** —
  // `adjusted` is what makes that safe, and it earned its place: the details rail opens for the focus
  // table one commit after the schema resolves, taking 320px off the canvas, so a fit computed before
  // it appeared left the focus table clipped off the left edge. Visible in the Task 18 e2e screenshot.
  // Refitting unconditionally on every resize would instead throw away a user's pan whenever they
  // dragged a dock divider, which is why it stops at the first gesture.
  const adjusted = useRef(false);
  const fittedFor = useRef<unknown>(null);
  useEffect(() => {
    if (viewport.width <= 0 || viewport.height <= 0) return;
    const changedLayout = fittedFor.current !== layout;
    if (adjusted.current && !changedLayout) return;

    fittedFor.current = layout;
    // A new schema is a new diagram: it gets a fit whether or not the last one was adjusted.
    if (changedLayout) adjusted.current = false;
    apply(fitTransform(layout, viewport));
    publish();
  }, [apply, layout, publish, viewport]);

  // ── Wheel ──────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (host === null) return;

    let settle: number | undefined;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      adjusted.current = true;
      const box = host.getBoundingClientRect();
      const factor = wheelZoomFactor(event.deltaY, event.ctrlKey);
      apply(
        zoomAbout(
          liveRef.current,
          { x: event.clientX - box.left, y: event.clientY - box.top },
          factor
        )
      );

      // A wheel gesture has no end event. Publishing on a trailing timer is what makes the zoom
      // readout land on the exact final value rather than the last 5% step.
      if (settle !== undefined) window.clearTimeout(settle);
      settle = window.setTimeout(publish, WHEEL_SETTLE_MS);
    };

    host.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      host.removeEventListener('wheel', onWheel);
      if (settle !== undefined) window.clearTimeout(settle);
    };
  }, [apply, host, publish]);

  // ── Pan ────────────────────────────────────────────────────────────────────────────────────────
  const panFrom = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Left button only, and only on the background: a press that started on a node is that node's
    // click, and the middle/right buttons belong to the browser and the context menu.
    if (event.button !== 0) return;
    if (!isDiagramBackground(event.target)) return;

    panFrom.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const from = panFrom.current;
      if (from === null || from.pointerId !== event.pointerId) return;

      adjusted.current = true;
      apply(panBy(liveRef.current, event.clientX - from.x, event.clientY - from.y));
      panFrom.current = { ...from, x: event.clientX, y: event.clientY };
    },
    [apply]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (panFrom.current === null) return;
      panFrom.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setIsPanning(false);
      publish();
    },
    [publish]
  );

  // ── The toolbar's four ──────────────────────────────────────────────────────────────────────────
  const centre = useMemo(
    () => ({ x: viewport.width / 2, y: viewport.height / 2 }),
    [viewport.height, viewport.width]
  );

  const zoomIn = useCallback(() => {
    adjusted.current = true;
    apply(zoomAbout(liveRef.current, centre, ZOOM_STEP));
    publish();
  }, [apply, centre, publish]);

  const zoomOut = useCallback(() => {
    adjusted.current = true;
    apply(zoomAbout(liveRef.current, centre, 1 / ZOOM_STEP));
    publish();
  }, [apply, centre, publish]);

  // Fit deliberately does NOT mark the diagram adjusted: asking for the fitted view is asking for the
  // view that follows the panel's size, so a later resize may refit it again.
  const fit = useCallback(() => {
    adjusted.current = false;
    apply(fitTransform(layout, viewport));
    publish();
  }, [apply, layout, publish, viewport]);

  const reset = useCallback(() => {
    adjusted.current = true;
    apply(IDENTITY);
    publish();
  }, [apply, publish]);

  const centreOn = useCallback(
    (node: ErdLayoutNode) => {
      adjusted.current = true;
      const k = clampZoom(Math.max(liveRef.current.k, 1));
      apply({
        k,
        x: viewport.width / 2 - (node.x + node.width / 2) * k,
        y: viewport.height / 2 - (node.y + node.height / 2) * k,
      });
      publish();
    },
    [apply, publish, viewport.height, viewport.width]
  );

  return {
    hostRef,
    contentRef,
    transform: published,
    viewport,
    isPanning,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    zoomIn,
    zoomOut,
    fit,
    reset,
    centreOn,
  };
}

/**
 * Whether a press landed on the diagram's background rather than on a table box.
 *
 * Stated as "not inside a node" rather than as a list of the elements that count as background, and
 * that is the second bug the e2e tier caught: the first version tested `tagName === 'svg'`, which is
 * true for a press into empty space and false for the several other things Chromium can name as the
 * target of a press over an SVG — so a background drag silently did nothing. The intent was always
 * "a press that started on a node belongs to that node", so this asks exactly that.
 *
 * Asking the element rather than stopping propagation inside the node keeps the node component free of
 * viewport concerns.
 */
export function isDiagramBackground(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('[data-erd-node-id]') === null;
}
