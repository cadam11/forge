/**
 * Documentation shots — the AI assistant, and the dialog that turns it on.
 *
 * ── Why there is no transcript here ────────────────────────────────────────────────────────────
 *
 * No tier in this repo calls an LLM (`tests/helpers/react/chat.ts` states the rule), and a capture
 * tier is not the place to introduce the first one: a scripted stream would need a fake provider
 * wired into the main process — a change under `packages/`, which this task does not own — and a
 * documentation image of a *mocked* answer would be a picture of the mock's copy, which is exactly
 * the kind of thing `plans/docs-site/PROPOSAL.md` §5.2 forbids ("no page documents anything
 * unshipped"). So the assistant is documented in the state that is real without a key: a
 * conversation, with the conversation list open.
 *
 * The setup dialog is captured before any key is entered, which is also the honest frame — it is
 * what a reader sees when they follow the AI setup page, and there is no path here by which a
 * credential could reach a committed PNG.
 */

import { blurFocus, capture, expect, test, withDocsApp } from './fixtures';
import { HERO_THEMES, PAGE_THEMES } from './catalogue';
import {
  aiSetupDialog,
  chatPanel,
  chatTitle,
  createChatConversation,
  openAiSetup,
  openChatConversations,
  openChatPanel,
} from '../helpers/joinery-actions-react';

for (const theme of HERO_THEMES) {
  test.describe(`docs shots — AI assistant, ${theme}`, () => {
    test('a conversation with the list open', async () => {
      await withDocsApp(theme, async ({ window }) => {
        const panel = await openChatPanel(window);
        await createChatConversation(panel);
        await openChatConversations(panel);
        // One row, titled by the store rather than by this test, and dated "Today" — the only
        // clock-derived string in the shot, and stable for any run that does not straddle midnight
        // (`formatConversationDate` buckets by whole days).
        await expect(panel.getByTestId('chat-conversation')).toHaveCount(1);
        await expect(chatTitle(chatPanel(window))).toHaveText('New Chat');
        await blurFocus(window);

        await capture(
          panel,
          'hero-ai-assistant',
          theme,
          'The AI assistant panel with a conversation and the conversation list open'
        );
      });
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
        await blurFocus(window);
        await capture(dialog, 'ai-setup', theme, 'The AI setup dialog, provider list');
        // No key was entered, and none could have been: nothing in this test types into the dialog.
        await expect(aiSetupDialog(window)).toBeVisible();
      });
    });
  });
}
