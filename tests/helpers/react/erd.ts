/**
 * The ERD tab.
 *
 * The diagram is SVG, so nothing here is a `getByRole` or a `getByText`: every locator keys on the
 * `data-erd-*` attributes the canvas writes, which are the only stable handles on a `<g>` whose
 * position is a layout result.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { UI_TIMEOUT_MS } from './app';
import { openNodeMenu } from './explorer';

/** The ERD tab's panel. */
export function erdPanel(window: Page): Locator {
  return window.getByTestId('panel-erd');
}

/** The pan/zoom surface inside it. */
export function erdCanvas(window: Page): Locator {
  return window.getByTestId('erd-canvas');
}

/** Every table box currently in the DOM. Culled nodes are genuinely absent — that is the point. */
export function erdNodes(window: Page): Locator {
  return window.getByTestId('erd-node');
}

/** One table box, by its `schema.table` id. */
export function erdNode(window: Page, nodeId: string): Locator {
  return window.locator(`[data-testid="erd-node"][data-erd-node-id="${nodeId}"]`);
}

/** One FK edge, by the pair of tables it joins. */
export function erdEdge(window: Page, sourceNodeId: string, targetNodeId: string): Locator {
  return window.locator(
    `[data-testid="erd-edge"][data-erd-edge-source="${sourceNodeId}"][data-erd-edge-target="${targetNodeId}"]`
  );
}

/** The diagram's own transform, as the content group carries it. `null` before the first paint. */
export async function erdTransform(window: Page): Promise<string | null> {
  return erdCanvas(window).locator('svg > g').first().getAttribute('transform');
}

/** The zoom readout in the toolbar, e.g. `"120%"`. */
export async function erdZoomLevel(window: Page): Promise<string> {
  return (await erdPanel(window).getByTestId('erd-zoom-level').textContent()) ?? '';
}

/**
 * "Show Relationships" on a table node, and the wait for the diagram to have finished loading.
 *
 * The wait is on a NODE rather than on the canvas: the canvas mounts as soon as the schema resolves,
 * and a spec that asserted on it could pass against a diagram that had drawn nothing.
 */
export async function openRelationships(window: Page, tableLabel: string): Promise<Locator> {
  const menu = await openNodeMenu(window, tableLabel);
  await menu.getByTestId('sidebar-menu-relationships').click();
  await expect(erdPanel(window)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(erdNodes(window).first()).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return erdPanel(window);
}

/** The details rail, which opens when a table is selected. */
export function erdDetails(window: Page): Locator {
  return window.getByTestId('erd-details');
}
