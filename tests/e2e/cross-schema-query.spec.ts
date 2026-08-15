/**
 * Cross-schema query E2E specs — covers the legacy 31-test audit's tests 22 + 23.
 *
 * These specs assert that queries against a non-`public` schema (`app_meta.*`)
 * execute and return the expected row counts from the minimal seeded schema
 * (see tests/fixtures/postgres/app-meta-{schema,seed}.sql), including a
 * two-table JOIN:
 *
 *   - 11 rows in app_meta.application
 *   - 24 rows in app_meta.entity (each linked to an application)
 *
 * The seed only exists once `ensureForgeTestSeeded` has run; the
 * test.beforeAll hook below makes that explicit even though several other
 * specs already do the same call.
 */

import { expect, test } from '@playwright/test';
import { withForge } from '../helpers/electron-app';
import {
  connectToTestPostgres,
  ensureForgeTestSeeded,
  executeQuery,
  openNewQueryTab,
  selectDatabase,
  typeInEditor,
} from '../helpers/forge-actions';

test.beforeAll(ensureForgeTestSeeded);

test.describe('Forge — cross-schema queries and JOINs', () => {
  test('app_meta.application returns the seeded 11 rows', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);
      await typeInEditor(window, 'SELECT id, name FROM app_meta.application ORDER BY id;');
      await executeQuery(window);

      // Result grid renders.
      await expect(window.locator('ag-grid-angular, .ag-root-wrapper').first()).toBeVisible({
        timeout: 15000,
      });
      // Forge's row-count badge is the most stable assertion target —
      // displays "N rows" / "N row" once the result lands.
      await expect(window.getByText(/11 rows/i).first()).toBeVisible({ timeout: 10000 });
      // Spot-check one of the seeded applications to confirm the data
      // came from our fixture, not an arbitrary 11-row coincidence.
      await expect(window.getByText('Knowledge Base').first()).toBeVisible({ timeout: 5000 });
    });
  });

  test('app_meta.entity JOIN app_meta.application returns the seeded 24 rows', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);
      await typeInEditor(
        window,
        'SELECT e.name AS entity, a.name AS application FROM app_meta.entity e JOIN app_meta.application a ON a.id = e.application_id ORDER BY e.id;'
      );
      await executeQuery(window);

      await expect(window.locator('ag-grid-angular, .ag-root-wrapper').first()).toBeVisible({
        timeout: 15000,
      });
      await expect(window.getByText(/24 rows/i).first()).toBeVisible({ timeout: 10000 });
      // Spot-check a row that proves the JOIN populated from both tables.
      await expect(window.getByText('Audit Log').first()).toBeVisible({ timeout: 5000 });
    });
  });
});
