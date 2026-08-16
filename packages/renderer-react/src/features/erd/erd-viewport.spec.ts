/**
 * The pan/zoom arithmetic and the cull.
 *
 * These are the assertions d3-zoom would have made untestable outside a browser (see the header of
 * `erd-viewport.ts`), and the first one is the whole reason the module exists as arithmetic: zooming
 * about a point must not move the content under that point.
 */

import { describe, expect, it } from 'vitest';

import {
  centreOnNode,
  clampZoom,
  cullChanged,
  CULL_EPSILON_PX,
  fitTransform,
  IDENTITY,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  screenToDiagram,
  transformToSvg,
  visibleEdges,
  visibleNodes,
  wheelZoomFactor,
  zoomAbout,
  type Transform,
} from './erd-viewport';
import { layoutErd, type ErdLayoutEdge, type ErdLayoutNode } from './erd-layout';
import type { ErdNode } from './erd-model';

const VIEWPORT = { width: 800, height: 600 };

function node(id: string, x: number, y: number): ErdLayoutNode {
  return {
    node: { id, name: id, schemaName: 'dbo', fields: [] } satisfies ErdNode,
    x,
    y,
    width: 180,
    height: 80,
    rows: [],
    primaryKeyCount: 0,
    foreignKeyCount: 0,
  };
}

describe('clampZoom', () => {
  it('holds the scale inside the ported limits', () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it('answers 1 for a non-finite scale rather than poisoning every later transform', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM);
  });
});

describe('zoomAbout', () => {
  it('keeps the point under the cursor pinned to the same content', () => {
    const focal = { x: 320, y: 210 };
    const before = screenToDiagram({ x: -40, y: 15, k: 1.3 }, focal);
    const after = screenToDiagram(zoomAbout({ x: -40, y: 15, k: 1.3 }, focal, 1.7), focal);

    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('keeps it pinned when the zoom hits the ceiling', () => {
    // The drift bug: clamping the scale after deriving the translation moves the content sideways.
    const focal = { x: 500, y: 100 };
    const start: Transform = { x: 12, y: -8, k: 3.9 };
    const before = screenToDiagram(start, focal);
    const zoomed = zoomAbout(start, focal, 4);

    expect(zoomed.k).toBe(MAX_ZOOM);
    expect(screenToDiagram(zoomed, focal).x).toBeCloseTo(before.x, 6);
    expect(screenToDiagram(zoomed, focal).y).toBeCloseTo(before.y, 6);
  });

  it('keeps it pinned at the floor too', () => {
    const focal = { x: 40, y: 400 };
    const start: Transform = { x: 100, y: 100, k: 0.11 };
    const before = screenToDiagram(start, focal);
    const zoomed = zoomAbout(start, focal, 0.1);

    expect(zoomed.k).toBe(MIN_ZOOM);
    expect(screenToDiagram(zoomed, focal).y).toBeCloseTo(before.y, 6);
  });
});

describe('panBy', () => {
  it('translates without touching the scale', () => {
    expect(panBy({ x: 10, y: 20, k: 2 }, -5, 7)).toEqual({ x: 5, y: 27, k: 2 });
  });
});

describe('fitTransform', () => {
  it('centres a small diagram at 1:1 rather than magnifying it', () => {
    const fitted = fitTransform({ width: 400, height: 300 }, VIEWPORT);
    expect(fitted.k).toBe(1);
    expect(fitted.x).toBe(200);
    expect(fitted.y).toBe(150);
  });

  it('scales a diagram wider than the viewport down to fit, padding included', () => {
    const fitted = fitTransform({ width: 2000, height: 400 }, VIEWPORT, 24);
    expect(fitted.k).toBeCloseTo((800 - 48) / 2000, 6);
    // Centred: the scaled content plus equal gutters fills the viewport.
    expect(fitted.x * 2 + 2000 * fitted.k).toBeCloseTo(800, 6);
  });

  it('is the identity for an unmeasured viewport, which is the first paint', () => {
    expect(fitTransform({ width: 900, height: 500 }, { width: 0, height: 0 })).toEqual(IDENTITY);
  });

  it('is the identity for an empty diagram', () => {
    expect(fitTransform({ width: 0, height: 0 }, VIEWPORT)).toEqual(IDENTITY);
  });

  it('fits the real seeded layout inside the viewport', () => {
    const layout = layoutErd([
      { id: 'dbo.a', name: 'a', schemaName: 'dbo', fields: [] },
      { id: 'dbo.b', name: 'b', schemaName: 'dbo', fields: [] },
    ]);
    const fitted = fitTransform(layout, VIEWPORT);

    expect(layout.width * fitted.k).toBeLessThanOrEqual(VIEWPORT.width);
    expect(layout.height * fitted.k).toBeLessThanOrEqual(VIEWPORT.height);
  });
});

describe('centreOnNode', () => {
  it('puts the node’s middle in the middle of the viewport', () => {
    const centred = centreOnNode(node('dbo.a', 1000, 500), VIEWPORT, 1.5);
    const middle = { x: (1000 + 90) * 1.5 + centred.x, y: (500 + 40) * 1.5 + centred.y };

    expect(middle.x).toBeCloseTo(400, 6);
    expect(middle.y).toBeCloseTo(300, 6);
  });
});

describe('transformToSvg', () => {
  it('emits the SVG transform in translate-then-scale order', () => {
    expect(transformToSvg({ x: 1.239, y: -2, k: 1.23456 })).toBe(
      'translate(1.24, -2) scale(1.2346)'
    );
  });
});

describe('visibleNodes', () => {
  it('renders everything when the host has not been measured', () => {
    const nodes = [node('a', 0, 0), node('b', 100_000, 0)];
    expect(visibleNodes(nodes, IDENTITY, { width: 0, height: 0 })).toHaveLength(2);
  });

  it('drops a node more than a viewport beyond the edge', () => {
    const nodes = [node('near', 0, 0), node('far', 4000, 0)];
    const visible = visibleNodes(nodes, IDENTITY, VIEWPORT);

    expect(visible.map(item => item.node.id)).toEqual(['near']);
  });

  it('keeps a node just off-screen, so a small pan reveals nothing unmounted', () => {
    const nodes = [node('justOff', 900, 0)];
    expect(visibleNodes(nodes, IDENTITY, VIEWPORT)).toHaveLength(1);
  });

  it('keeps a node that only partially overlaps the viewport', () => {
    const nodes = [node('straddling', -100, -40)];
    expect(visibleNodes(nodes, IDENTITY, VIEWPORT)).toHaveLength(1);
  });

  it('follows the transform: panning brings a far node in and pushes a near one out', () => {
    const nodes = [node('near', 0, 0), node('far', 4000, 0)];
    const panned = { x: -3900, y: 0, k: 1 };

    expect(visibleNodes(nodes, panned, VIEWPORT).map(item => item.node.id)).toEqual(['far']);
  });

  it('keeps everything at a zoomed-out scale', () => {
    const nodes = [node('a', 0, 0), node('b', 4000, 0)];
    expect(visibleNodes(nodes, { x: 0, y: 0, k: 0.15 }, VIEWPORT)).toHaveLength(2);
  });
});

describe('visibleEdges', () => {
  const edge = (source: string, target: string): ErdLayoutEdge => ({
    link: {
      id: `${source}.fk`,
      sourceNodeId: source,
      targetNodeId: target,
      sourceField: {
        id: `${source}.fk`,
        name: 'fk',
        type: 'int',
        isPrimaryKey: false,
        allowsNull: true,
        autoIncrement: false,
      },
      isSelfReference: false,
    },
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
  });

  it('keeps an edge with either endpoint on screen, so nothing dangles from nothing', () => {
    const visible = [node('a', 0, 0)];
    expect(visibleEdges([edge('a', 'z'), edge('y', 'a'), edge('y', 'z')], visible)).toHaveLength(2);
  });
});

describe('cullChanged', () => {
  it('ignores a pan smaller than the epsilon', () => {
    expect(cullChanged(IDENTITY, { x: CULL_EPSILON_PX - 1, y: 0, k: 1 })).toBe(false);
  });

  it('reports a pan at the epsilon', () => {
    expect(cullChanged(IDENTITY, { x: CULL_EPSILON_PX, y: 0, k: 1 })).toBe(true);
    expect(cullChanged(IDENTITY, { x: 0, y: -CULL_EPSILON_PX, k: 1 })).toBe(true);
  });

  it('reports a scale change as a proportion, so it fires at any zoom level', () => {
    expect(cullChanged({ x: 0, y: 0, k: 4 }, { x: 0, y: 0, k: 4.3 })).toBe(true);
    expect(cullChanged({ x: 0, y: 0, k: 0.2 }, { x: 0, y: 0, k: 0.203 })).toBe(false);
  });
});

describe('wheelZoomFactor', () => {
  it('zooms in on a negative delta and out on a positive one', () => {
    expect(wheelZoomFactor(-100, false)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, false)).toBeLessThan(1);
  });

  it('is more sensitive for a trackpad pinch, which reports small deltas', () => {
    expect(wheelZoomFactor(-10, true)).toBeGreaterThan(wheelZoomFactor(-10, false));
  });

  it('clamps a momentum frame so one event cannot jump several octaves', () => {
    expect(wheelZoomFactor(-5000, false)).toBe(2);
    expect(wheelZoomFactor(5000, true)).toBe(0.5);
  });

  it('is a no-op for a zero delta', () => {
    expect(wheelZoomFactor(0, false)).toBe(1);
  });
});
