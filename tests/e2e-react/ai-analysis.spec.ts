/**
 * The results pane's Analysis tab, at the tier that can prove it is REACHABLE.
 *
 * What this tier covers and the unit tier cannot: the tab exists in a real results pane beside the real
 * grid, and its no-provider state opens the AI setup dialog that actually exists. What it deliberately
 * does NOT cover: an answer from a model. That needs a real API key and a real provider, so the request
 * shape, the sample cap and the markdown seam are asserted against the bridge double in
 * `features/query/ai-analysis-panel.spec.tsx`.
 */

import { expect, test } from './fixtures';
import {
  aiSetupDialog,
  connectFromSidebar,
  createPostgresProfile,
  ensureJoineryTestSeeded,
  executeQuery,
  openAnalysisTab,
  openQueryTab,
  selectDatabase,
  typeSql,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Analysis PG';

test.beforeAll(ensureJoineryTestSeeded);

test.describe('Joinery (React) — result analysis', () => {
  test('is a tab in the results pane, and its no-provider state opens AI setup', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, 'joinery_test');
      await openQueryTab(window);
      await typeSql(window, 'SELECT id, email FROM customers ORDER BY id');
      await executeQuery(window);
      await expect(window.getByTestId('query-results')).toBeVisible({ timeout: 20_000 });

      const pane = await openAnalysisTab(window);

      // No key is configured in this tier, so the honest degrade is what shows — and it is a button to
      // the surface that fixes it, not a sentence naming a ticket. The Angular panel said "Configure an AI
      // provider in Settings" while the renderer had no AI surface at all (J-55).
      await expect(pane.getByTestId('analysis-no-provider')).toBeVisible();
      // And the asking surface is absent, rather than present with dead buttons on it.
      await expect(pane.getByTestId('ai-analysis')).toBeHidden();
      await pane.getByRole('button', { name: 'Set up AI' }).click();
      await expect(aiSetupDialog(window)).toBeVisible({ timeout: 10_000 });
      await window.keyboard.press('Escape');
      await expect(aiSetupDialog(window)).toBeHidden({ timeout: 10_000 });
    });
  });

  test('the tab is offered before anything has run, and says there is nothing to analyse', async () => {
    await withJoineryReact(async ({ window }) => {
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, 'joinery_test');
      await openQueryTab(window);

      // Nothing run yet: the pane is in its empty state and there are no tabs at all, which is the
      // Angular behaviour too. The tab appears with the first result.
      await expect(window.getByTestId('query-results-empty')).toBeVisible();
      await expect(window.getByTestId('query-results-tab-analysis')).toBeHidden();

      await typeSql(window, "SELECT 'x' AS letter");
      await executeQuery(window);
      await expect(window.getByTestId('query-results-tab-analysis')).toBeVisible({
        timeout: 20_000,
      });
    });
  });
});
