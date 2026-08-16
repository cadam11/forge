/**
 * The AI assistant in the shipped app: the no-provider state, conversation CRUD across a restart, and
 * the panel/tab duality.
 *
 * **No LLM is involved and none is needed.** Everything this surface does apart from generating an
 * answer is main-process IPC — `chat:list-conversations`, `chat:create-conversation`,
 * `chat:rename-conversation`, `chat:delete-conversation`, all of them backed by one JSON file per
 * conversation in `<userData>/chat-history/` — so the round trips below are real, and the reload proves
 * they reached disk. The one thing that DOES need a provider is a reply, and the assertion about that is
 * that the app says so instead of pretending: the streaming path itself is covered against a scripted
 * bridge in `renderer-react/src/features/chat/*.spec.tsx` and, in the shipped bundle, by
 * `.superpowers/sdd/PLAN/task-17-perf.mjs`.
 *
 * No database either: chat does not need a connection, and the one place the two meet — the context line
 * that reads the focused query tab — is asserted for the case a test without one can prove, namely that
 * it says there is no context rather than implying one.
 */

import { expect, test } from './fixtures';
import {
  chatConversationRow,
  chatPanel,
  chatTab,
  chatTitle,
  closeChatPanel,
  createChatConversation,
  deleteChatConversation,
  openChatConversations,
  openChatPanel,
  openPalette,
  runPaletteCommand,
  renameChatConversation,
  waitForShell,
  withJoineryReact,
} from '../helpers/joinery-actions-react';

test.describe('Joinery — the AI assistant', () => {
  test('says no provider is configured, and refuses to send rather than pretending', async () => {
    await withJoineryReact(async ({ window }) => {
      const panel = await openChatPanel(window);

      // The honest empty state: what is missing, and why THIS build cannot fix it (there is no AI
      // settings surface in the React renderer yet — J-55).
      await expect(panel.getByTestId('chat-no-provider')).toContainText(
        'No AI provider configured'
      );
      await expect(panel.getByTestId('chat-no-provider')).toContainText('J-55');

      // Not a spinner and not a crash: the composer is present, states why, and cannot send.
      await expect(panel.getByTestId('chat-input')).toHaveAttribute(
        'placeholder',
        'Configure an AI provider to chat'
      );
      await panel.getByTestId('chat-input').fill('are you there?');
      await expect(panel.getByTestId('chat-send')).toBeDisabled();

      // With no provider there is nothing to pick, so the model picker is absent rather than empty.
      await expect(panel.getByTestId('chat-model-trigger')).toHaveCount(0);

      // And the context line does not claim a database, because no query tab is in front.
      await expect(panel.getByTestId('chat-context')).toContainText('No database context');
    });
  });

  test('creates, renames and deletes conversations, and they survive a restart', async () => {
    await withJoineryReact(async ({ window }) => {
      const panel = await openChatPanel(window);
      const list = await openChatConversations(panel);
      await expect(list.getByTestId('chat-conversations-empty')).toContainText(
        'No conversations yet'
      );

      // Create two, through the real IPC that writes chat-history/<id>.json.
      await createChatConversation(panel);
      await renameChatConversation(panel, 'New Chat', 'Index tuning');
      await createChatConversation(panel);
      await renameChatConversation(panel, 'New Chat', 'Vacuum questions');
      await expect(panel.getByTestId('chat-conversation')).toHaveCount(2);

      // Everything the renderer keeps in browser storage is wiped first, so what comes back after the
      // reload came from the main process's own store rather than from localStorage.
      await window.evaluate(() => window.localStorage.clear());
      await window.reload();
      await waitForShell(window);

      const reopened = await openChatPanel(window);
      const reopenedList = await openChatConversations(reopened);
      await expect(chatConversationRow(reopenedList, 'Index tuning')).toBeVisible();
      await expect(chatConversationRow(reopenedList, 'Vacuum questions')).toBeVisible();

      // Delete needs two clicks — see the helper. One is not enough, on purpose.
      await deleteChatConversation(reopenedList, 'Vacuum questions');
      await expect(reopened.getByTestId('chat-conversation')).toHaveCount(1);

      // And the delete reached disk too.
      await window.reload();
      await waitForShell(window);
      const afterDelete = await openChatConversations(await openChatPanel(window));
      await expect(afterDelete.getByTestId('chat-conversation')).toHaveCount(1);
      await expect(chatConversationRow(afterDelete, 'Index tuning')).toBeVisible();
    });
  });

  test('opens as a tab from the palette, and the tab keeps its own conversation', async () => {
    await withJoineryReact(async ({ window }) => {
      // Two conversations, made in the panel.
      const panel = await openChatPanel(window);
      await openChatConversations(panel);
      await createChatConversation(panel);
      await renameChatConversation(panel, 'New Chat', 'Panel conversation');
      await createChatConversation(panel);
      await renameChatConversation(panel, 'New Chat', 'Tab conversation');
      await expect(chatTitle(panel)).toHaveText('Tab conversation');

      // The panel's ⧉ carries the CURRENT conversation into a tab, and closes the panel behind it —
      // one conversation must not have two live instances writing it.
      await panel.getByTestId('chat-pop-out').click();
      await expect(chatTab(window)).toBeVisible();
      await expect(chatPanel(window)).toHaveCount(0);
      await expect(chatTitle(chatTab(window))).toHaveText('Tab conversation');

      // The tab STRIP is named after the conversation too, so two chat tabs are told apart there.
      await expect(
        window
          .locator('[data-testid^="workspace-tab-title-"]')
          .filter({ hasText: 'Tab conversation' })
      ).toHaveCount(1);

      // Re-open the panel and point it at the OTHER conversation. Both surfaces are now live.
      const reopened = await openChatPanel(window);
      const list = await openChatConversations(reopened);
      await chatConversationRow(list, 'Panel conversation')
        .getByTestId('chat-conversation-select')
        .click();
      await expect(chatTitle(reopened)).toHaveText('Panel conversation');

      // Isolation, in the shipped app: two instances, two conversations, neither one following the
      // other. This is `state/chat.spec.ts`'s pinned property, observed through the UI.
      await expect(chatTitle(chatTab(window))).toHaveText('Tab conversation');

      await closeChatPanel(window);
      await expect(chatTitle(chatTab(window))).toHaveText('Tab conversation');
    });
  });

  test('opens a fresh chat tab from the command palette', async () => {
    await withJoineryReact(async ({ window }) => {
      // `open-chat-tab` is new in Task 17: Angular could only reach the chat tab from the ⧉ button
      // inside the panel, so the palette had no way to open one.
      await openPalette(window);
      await runPaletteCommand(window, 'command:open-chat-tab');

      await expect(chatTab(window)).toBeVisible();
      // A fresh instance: no conversation selected, so it shows the no-provider state rather than a
      // transcript.
      await expect(chatTab(window).getByTestId('chat-no-provider')).toBeVisible();
    });
  });

  test('toggles the panel from the View menu, and the palette entry agrees with it', async () => {
    await withJoineryReact(async ({ app, window }) => {
      // ⇧⌘I arrives as a menu channel; Task 17's `ChatCommands` is what handles it now.
      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('menu:toggle-chat');
      });
      await expect(chatPanel(window)).toBeVisible();

      await openPalette(window);
      await runPaletteCommand(window, 'command:toggle-chat-panel');
      await expect(chatPanel(window)).toHaveCount(0);
    });
  });
});
