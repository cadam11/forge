/**
 * The guided tour, end to end in the real shell — which is the only place its targets exist.
 *
 * That is the point of covering it at this tier rather than only in jsdom: every step names a
 * `data-testid` and the unit spec proves the STRINGS appear in the shell's source, but only a real window
 * can prove the elements are on screen, laid out, and in the place the spotlight is drawn.
 */

import { expect, test } from './fixtures';
import {
  openPalette,
  paletteRowState,
  startTour,
  tourOverlay,
  tourStep,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

test.describe('Joinery (React) — the guided tour', () => {
  test('walks every step, spotlighting a real element each time', async () => {
    await withJoineryReact(async ({ window }) => {
      const overlay = await startTour(window);

      const [, total] = await tourStep(window);
      expect(total).toBeGreaterThan(1);

      const seen: string[] = [];
      for (let step = 1; step <= total; step += 1) {
        expect(await tourStep(window)).toEqual([step, total]);

        // The claim the unit tier cannot make: the step's target is really in the document, laid out,
        // and the spotlight has a non-zero box over it. The Angular overlay drew a 16×16 box at -8,-8 for
        // the whole tour because its rectangle was a plain field two `computed()`s could not track.
        await expect(overlay).toHaveAttribute('data-target-found', 'true');
        const spotlight = overlay.getByTestId('tour-spotlight');
        await expect(spotlight).toBeVisible();
        const box = await spotlight.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(16);
        expect(box?.height ?? 0).toBeGreaterThan(16);
        // Playwright's `boundingBox` is `{ x, y, width, height }` — there is no `left`/`top`.
        seen.push(`${box?.x ?? 0}x${box?.y ?? 0}`);

        const title = await overlay.getByRole('heading').first().textContent();
        expect((title ?? '').trim()).not.toBe('');

        await overlay.getByTestId('tour-next').click();
      }

      // It MOVED: at least two steps spotlit different places.
      expect(new Set(seen).size).toBeGreaterThan(1);

      // The last Next finished it, and the overlay is gone.
      await expect(tourOverlay(window)).toBeHidden();
    });
  });

  test('offers the second tour at the end, and runs it', async () => {
    await withJoineryReact(async ({ window }) => {
      const overlay = await startTour(window);
      const [, total] = await tourStep(window);
      for (let step = 1; step < total; step += 1) {
        await overlay.getByTestId('tour-next').click();
      }

      await expect(overlay.getByTestId('tour-next')).toHaveText('Done');
      // Both tours are reachable from one payload-free command, by chaining.
      await overlay.getByTestId('tour-next-tour').click();

      await expect(tourOverlay(window)).toBeVisible();
      expect((await tourStep(window))[0]).toBe(1);
      await expect(overlay).toHaveAttribute('data-target-found', 'true');
    });
  });

  test('goes back, and Escape ends it', async () => {
    await withJoineryReact(async ({ window }) => {
      const overlay = await startTour(window);
      // No Back on the first step: there is nowhere to go.
      await expect(overlay.getByTestId('tour-previous')).toBeHidden();

      await overlay.getByTestId('tour-next').click();
      expect((await tourStep(window))[0]).toBe(2);
      await overlay.getByTestId('tour-previous').click();
      expect((await tourStep(window))[0]).toBe(1);

      await window.keyboard.press('Escape');
      await expect(tourOverlay(window)).toBeHidden();
    });
  });

  test('the palette entry is live, which it was not before this task', async () => {
    await withJoineryReact(async ({ window }) => {
      await openPalette(window);
      // `palette.spec.ts` used this id as its example of a registered-but-unowned command, because it
      // was the one id with no precondition and no handler. It has a handler now.
      expect(await paletteRowState(window, 'command:start-tour')).toBe('ready');
      await window.keyboard.press('Escape');
    });
  });

  test('survives a resize mid-tour', async () => {
    await withJoineryReact(async ({ window }) => {
      const overlay = await startTour(window);
      const before = await overlay.getByTestId('tour-spotlight').boundingBox();

      await window.setViewportSize({ width: 1000, height: 700 });
      // The spotlight re-measures on resize rather than pointing at where the element used to be.
      await expect(overlay.getByTestId('tour-spotlight')).toBeVisible();
      const after = await overlay.getByTestId('tour-spotlight').boundingBox();
      expect(after?.height ?? 0).toBeGreaterThan(16);
      expect(after?.height).not.toBe(before?.height);
    });
  });
});
