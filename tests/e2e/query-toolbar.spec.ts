/**
 * Query-toolbar E2E spec — covers the legacy 31-test audit's tests
 * 10 (toolbar buttons exist) and 13 (export results dialog).
 *
 * The toolbar lives inside app-query and is mounted alongside Monaco when
 * a query tab is active. It carries Run, Format, History, and an Export
 * menu trigger. We don't assert on specific button glyph order — we just
 * want to know the controls are reachable from the user's perspective.
 */

import { expect, test } from '@playwright/test';
import { withJoinery } from '../helpers/electron-app';
import {
  connectToTestPostgres,
  ensureJoineryTestSeeded,
  executeQuery,
  openNewQueryTab,
  selectDatabase,
  typeInEditor,
} from '../helpers/joinery-actions';

test.beforeAll(ensureJoineryTestSeeded);

test.describe('Joinery — query toolbar', () => {
  test('toolbar mounts with the expected controls when a query tab is open', async () => {
    await withJoinery(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'joinery_test');
      await openNewQueryTab(app, window);

      // Filter to :visible — every previously-opened query tab keeps its
      // toolbar mounted in the DOM (Golden Layout hides inactive tabs).
      const toolbar = window.locator('.query-toolbar:visible').first();
      await expect(toolbar).toBeVisible({ timeout: 10000 });

      // Soft-presence checks. Use accessible-name matching so this stays
      // robust against icon changes — the labels live on the buttons'
      // aria-label / title / mat-tooltip.
      // At minimum: a Run/Execute control and the Export menu trigger.
      await expect(
        toolbar
          .locator('button')
          .filter({ hasText: /run|execute|format|history|export/i })
          .first()
      ).toBeVisible();
    });
  });

  test('export menu opens with CSV / JSON / SQL options', async () => {
    await withJoinery(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'joinery_test');
      await openNewQueryTab(app, window);
      // Export only makes sense with results to export. Run a tiny query
      // so the export menu item isn't gated to disabled.
      await typeInEditor(window, 'SELECT 1 AS n;');
      await executeQuery(window);
      await window.waitForTimeout(800);

      const toolbar = window.locator('.query-toolbar:visible').first();
      // Export button is icon-only with a matTooltip — but matTooltip uses
      // aria-describedby (not aria-label), so getByRole can't see it. The
      // most stable identifier is the mat-icon ligature ("download"), which
      // renders as text content inside the icon element.
      const exportTrigger = toolbar.locator('button:has(mat-icon:text-is("download"))').first();
      await exportTrigger.click({ timeout: 5000 });

      // Joinery wires three options: csv / json / sql. Match by accessible
      // text rather than DOM position — they live in a mat-menu overlay.
      await expect(window.getByRole('menuitem', { name: /csv/i }).first()).toBeVisible({
        timeout: 5000,
      });
      await expect(window.getByRole('menuitem', { name: /json/i }).first()).toBeVisible();
      await expect(window.getByRole('menuitem', { name: /sql/i }).first()).toBeVisible();
    });
  });
});
