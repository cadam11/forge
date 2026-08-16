/**
 * Cross-schema queries and a two-table JOIN, against the React renderer.
 *
 * Replaces `tests/e2e/cross-schema-query.spec.ts`, which asserted through `ag-grid-angular,
 * .ag-root-wrapper` and `window.getByText(/11 rows/i)` — a class-or-tag locator plus a page-wide text
 * search, both of which PLAN.md's Task 20 retires. The coverage itself survives because it is the only
 * NON-PUBLIC-SCHEMA coverage in the suite: everything else in this tier queries `public`, so
 * `app_meta.*` is the one place a schema-qualified name, a cross-schema JOIN and a non-default search
 * path are exercised at all.
 *
 * (The Task 11 brief calls the fixture schema `__mj`. It is `app_meta` — the rebrand renamed it, along
 * with the fixture files `app-meta-{schema,seed}.sql`. Same schema, same 11 + 24 rows, same reason for
 * existing.)
 *
 * What is new versus the Angular spec, and why it matters here rather than in `results-grid.spec.ts`:
 * the JOIN's projected columns come from two different tables, so the grid's headers are the SELECT
 * list's aliases rather than any one table's columns — which is the case a column-metadata bug would
 * break first.
 */

import { expect, test } from './fixtures';
import {
  connectFromSidebar,
  createPostgresProfile,
  ensureJoineryTestSeeded,
  executeQuery,
  gridColumnHeaders,
  gridColumnValues,
  gridRows,
  openQueryTab,
  resultsGrid,
  selectDatabase,
  typeSql,
  withJoineryReact,
} from '../helpers/joinery-actions-react';
import type { Page } from '@playwright/test';

const PROFILE = 'Test PG';

test.beforeAll(ensureJoineryTestSeeded);

async function readyEditor(window: Page) {
  await createPostgresProfile(window, PROFILE);
  await connectFromSidebar(window, PROFILE);
  await selectDatabase(window, 'joinery_test');
  return openQueryTab(window);
}

test.describe('Joinery (React) — cross-schema queries and JOINs', () => {
  test('app_meta.application returns the seeded 11 rows', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await typeSql(window, 'SELECT id, name FROM app_meta.application ORDER BY id');
      await executeQuery(window);

      await expect(resultsGrid(window)).toBeVisible();
      // The count comes from the pane's own readout rather than a page-wide text match, so "11 rows"
      // appearing anywhere else on screen cannot make this pass.
      await expect(window.getByTestId('results-row-count')).toHaveText('11');
      await expect(gridRows(window)).toHaveCount(11);
      expect(await gridColumnHeaders(window)).toEqual(['id', 'name']);

      // Spot-check a seeded row, addressed by column: this is what proves the rows came from our
      // fixture rather than from an arbitrary 11-row coincidence.
      expect(await gridColumnValues(window, 'name')).toContain('Knowledge Base');
    });
  });

  test('app_meta.entity JOIN app_meta.application returns the seeded 24 rows', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);
      await typeSql(
        window,
        'SELECT e.name AS entity, a.name AS application FROM app_meta.entity e ' +
          'JOIN app_meta.application a ON a.id = e.application_id ORDER BY e.id'
      );
      await executeQuery(window);

      await expect(resultsGrid(window)).toBeVisible();
      await expect(window.getByTestId('results-row-count')).toHaveText('24');
      // Both aliases reach the grid as headers — the JOIN's two source tables both contribute a
      // `name`, so this is also the assertion that the aliases, not the underlying names, are used.
      expect(await gridColumnHeaders(window)).toEqual(['entity', 'application']);

      const entities = await gridColumnValues(window, 'entity');
      const applications = await gridColumnValues(window, 'application');
      // One row that proves the JOIN populated from both sides.
      expect(entities).toContain('Audit Log');
      expect(applications.some(value => value !== '')).toBe(true);
      // 24 rows, 11 applications: the join is many-to-one, so the application column repeats.
      expect(new Set(applications).size).toBeLessThan(entities.length);
    });
  });

  test('a schema-qualified query and a public one share the tab’s grid', async () => {
    await withJoineryReact(async ({ window }) => {
      await readyEditor(window);

      await typeSql(window, 'SELECT id, name FROM app_meta.application ORDER BY id');
      await executeQuery(window);
      await expect(window.getByTestId('results-row-count')).toHaveText('11');

      // The second query replaces the first result in the same tab, and the grid re-columns itself —
      // the case that would break if `columnDefs` were memoised on anything but the result's columns.
      await typeSql(window, 'SELECT id, email FROM customers ORDER BY id');
      await executeQuery(window);
      await expect(window.getByTestId('results-row-count')).toHaveText('5');
      expect(await gridColumnHeaders(window)).toEqual(['id', 'email']);
    });
  });
});
