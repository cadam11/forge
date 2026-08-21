/**
 * Documentation shots — the AI assistant, and the dialog that turns it on.
 *
 * ── The transcript is seeded, and no LLM is involved at any point ──────────────────────────────
 *
 * No tier in this repo calls an LLM (`tests/helpers/react/chat.ts` states the rule), and this one
 * does not become the first. The first version of this shot drew the conclusion that the assistant
 * therefore had to be photographed in its resting state — and the resting state, with no API key on
 * a fresh `mkdtemp` profile, is the panel saying **"No AI provider configured"**. That shipped as the
 * hero image for `features/ai-assistant` and for the README: a hero of the feature switched off
 * (review M2).
 *
 * The way out is the one the perf tier already uses. `ChatService` loads
 * `<userData>/chat-history/*.json` in its constructor, and `electron-app.ts`'s `seedUserData` hook
 * exists to write into that directory before Electron starts. So the conversation below is a
 * FIXTURE, in the same sense the seeded `products` rows are a fixture: fixed text, fixed ids, fixed
 * timestamps, written to disk, rendered by the real transcript component. Nothing is mocked inside
 * the app, **no API key is ever written, and no request leaves the machine** — the test types nothing
 * into the composer and presses nothing that would send.
 *
 * Three properties make this honest rather than a staged screenshot, and each was checked in source:
 *
 *  - **The renderer does not gate reading on a provider.** `chat-transcript.tsx:162-166`: the
 *    no-provider empty state and the opening state "only compete with each other, and the transcript
 *    wins over both when there is one". So the seeded conversation renders through the ordinary path.
 *  - **The provider settings that ARE written contain no credential.** `seedAiProvider` sets
 *    `enabled` and `apiKeyConfigured: true` through the app's own IPC and writes no key. It is there
 *    so the composer stops advertising the setup step in a hero image, not to make anything callable.
 *  - **The content is what the shipped tool actually does.** The answer cites the fixture schema and
 *    shows SQL the seeded database really runs; it claims no capability the app does not have.
 *
 * The manifest says so too: the `surface` string names it as a seeded demo conversation, and that
 * string is what the page-integration task reads when it places the image.
 *
 * The setup dialog is captured before any key is entered, which is the honest frame — it is what a
 * reader sees when they follow the AI setup page, and there is no path here by which a credential
 * could reach a committed PNG.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  blurFocus,
  capture,
  expandToContent,
  expect,
  pinVersionChip,
  scrollToTop,
  test,
  withDocsApp,
} from './fixtures';
import { HERO_THEMES, PAGE_THEMES } from './catalogue';
import {
  aiSetupDialog,
  chatConversationRow,
  chatPanel,
  chatTitle,
  connectFromSidebar,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  openAiSetup,
  openChatPanel,
  openQueryTab,
  seedAiProvider,
  selectDatabase,
} from '../helpers/joinery-actions-react';

const PROFILE = 'Local Postgres';
const DATABASE = 'joinery_test';

const CONVERSATION_ID = 'docs-shot-demo';
const CONVERSATION_TITLE = 'Which tables have the most rows?';

test.beforeAll(ensureJoineryTestSeeded);

/**
 * The demo conversation, written into the launch's own user-data directory before Electron starts.
 *
 * Every value is fixed — ids, timestamps, prose — because a documentation image is defeated if its
 * text moves between captures. The timestamps are absolute UTC literals rather than offsets from
 * `Date.now()`, for the same reason `tests/fixtures/postgres/seed.sql` uses date literals: a
 * relative one re-renders differently tomorrow.
 */
function seedDemoConversation(userDataDir: string): void {
  const asked = new Date(Date.UTC(2026, 4, 12, 9, 14)).toISOString();
  const answered = new Date(Date.UTC(2026, 4, 12, 9, 14, 6)).toISOString();

  const conversation = {
    id: CONVERSATION_ID,
    title: CONVERSATION_TITLE,
    createdAt: asked,
    updatedAt: answered,
    messages: [
      {
        id: 'docs-shot-demo-1',
        role: 'user',
        content: 'Which tables have the most rows?',
        timestamp: asked,
      },
      {
        id: 'docs-shot-demo-2',
        role: 'assistant',
        content: [
          'Four tables in `public`, and `order_items` is the largest — every line on an order writes a row there, so it grows fastest as orders accumulate.',
          '',
          '```sql',
          'SELECT relname AS table_name, n_live_tup AS rows',
          'FROM pg_stat_user_tables',
          "WHERE schemaname = 'public'",
          'ORDER BY n_live_tup DESC;',
          '```',
          '',
          '| table_name  | rows |',
          '| ----------- | ---- |',
          '| order_items | 15   |',
          '| products    | 10   |',
          '| orders      | 8    |',
          '| customers   | 5    |',
          '',
          'Those counts come from `pg_stat_user_tables`, so they are the planner’s estimates — run `ANALYZE` first if you need them exact.',
        ].join('\n'),
        timestamp: answered,
        toolCalls: [],
      },
    ],
  };

  const directory = join(userDataDir, 'chat-history');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${CONVERSATION_ID}.json`),
    `${JSON.stringify(conversation, null, 2)}\n`,
    'utf-8'
  );
}

for (const theme of HERO_THEMES) {
  test.describe(`docs shots — AI assistant, ${theme}`, () => {
    test('a seeded demo conversation', async () => {
      await withDocsApp(
        theme,
        async ({ window }) => {
          // ── Two things the panel needs before it is a picture of the feature ──────────────────
          //
          // Both were missing from the first version of this shot and both showed: the panel's
          // context line read "NO DATABASE CONTEXT — OPEN A QUERY TAB", and the composer's
          // placeholder read "Configure an AI provider to chat". A hero of the assistant should not
          // be a hero of two things not being set up.
          //
          // `seedAiProvider` writes SETTINGS, not a key — `enabled`, `apiKeyConfigured: true` — so
          // the composer stops advertising the setup step. No credential is stored and nothing is
          // ever sent: this test types nothing into the composer and presses nothing that would.
          // It reloads the renderer, which is why the version chip is re-pinned straight after (see
          // `pinVersionChip`; `capture()` asserts it, so forgetting fails rather than shipping).
          await seedAiProvider(window, 'google');
          await pinVersionChip(window);
          await expect(window.locator('html')).toHaveAttribute('data-theme', theme);

          // A live connection AND an open query tab, so the assistant's context line names the
          // database the seeded answer is about. A connection alone is not enough: the panel takes
          // its context from the ACTIVE TAB, so without one the line reads "NO DATABASE CONTEXT —
          // OPEN A QUERY TAB" across the top of the hero.
          await createPostgresProfile(window, PROFILE);
          await connectFromSidebar(window, PROFILE);
          await selectDatabase(window, DATABASE);
          await openQueryTab(window);
          await dismissToasts(window);

          const panel = await openChatPanel(window);

          // The seeded conversation is on disk but not selected — the panel opens on a new one — so
          // it is opened through the list, which is the path a user takes.
          await panel.getByTestId('chat-conversations-toggle').click();
          await chatConversationRow(panel, CONVERSATION_TITLE)
            .getByTestId('chat-conversation-select')
            .click();

          // Both messages painted, the title taken from the seeded file rather than from a default,
          // and the no-provider empty state absent. Those three together are what prove the
          // transcript rendered rather than one of the two empty states.
          await expect(panel.getByTestId('chat-message')).toHaveCount(2);
          await expect(chatTitle(chatPanel(window))).toHaveText(CONVERSATION_TITLE);
          await expect(panel.getByTestId('chat-no-provider')).toHaveCount(0);

          // The transcript follows new content to the bottom on mount. Pinning the scroll position
          // makes the frame the same every run rather than a function of how tall the answer laid
          // out at this width.
          await scrollToTop(panel.getByTestId('chat-transcript'));
          await blurFocus(window);

          await capture(
            panel,
            'hero-ai-assistant',
            theme,
            'The AI assistant panel showing a seeded demo conversation (fixture content, no LLM called)'
          );
        },
        { seedUserData: seedDemoConversation }
      );
    });
  });
}

for (const theme of PAGE_THEMES) {
  test.describe(`docs shots — AI setup, ${theme}`, () => {
    test('the provider list', async () => {
      await withDocsApp(theme, async ({ window }) => {
        // Through the palette, which is one of the dialog's three producers and the one a reader can
        // reach from anywhere.
        const dialog = await openAiSetup(window);
        await expect(dialog).toBeVisible();

        // The dialog's content is taller than the 800px window, so at any scroll position its bottom
        // edge cuts whatever is there — and it was cutting a toggle switch horizontally through its
        // middle, which reads as a rendering bug rather than as a scroll affordance (review m6).
        // Scrolling cannot fix that: the box is already at the top, there is simply more content
        // than frame. The height constraint is lifted for the capture instead, so the picture is the
        // whole dialog, header to footer.
        await expandToContent(dialog);
        await blurFocus(window);
        await capture(dialog, 'ai-setup', theme, 'The AI setup dialog, provider list');
        // No key was entered, and none could have been: nothing in this test types into the dialog.
        await expect(aiSetupDialog(window)).toBeVisible();
      });
    });
  });
}
