/**
 * The AI assistant: the side panel, the chat tab, the conversation list.
 *
 * One surface, mounted twice (`renderer/src/features/chat/chat-surface.tsx`), so every helper
 * below takes the ROOT it should look inside: `chatPanel(window)` or `chatTab(window)`. That is not
 * tidiness — the panel and the tab hold independent store instances, and a helper that searched the
 * whole document would happily assert one tab's transcript against the other's, which is the exact
 * property `chat.spec.ts` exists to check.
 *
 * **No test in this tier calls an LLM.** The conversation CRUD, the transcript and the tool catalogue
 * are all main-process IPC (`chat:*`, backed by `<userData>/chat-history/*.json`), so everything here
 * is real except the model — and with no API key configured the surface's job is to say so, which is
 * itself one of the assertions.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import type { OpenRouterCostTier } from '@joinery/shared';
import { UI_TIMEOUT_MS, waitForShell } from './app';

/** The side panel, if it is open. */
export function chatPanel(window: Page): Locator {
  return window.getByTestId('chat-panel');
}

/** A chat tab's surface, if one is mounted. */
export function chatTab(window: Page): Locator {
  return window.getByTestId('chat-tab');
}

/** Opens the assistant from the status bar (the same wire ⇧⌘I uses) and waits for it. */
export async function openChatPanel(window: Page): Promise<Locator> {
  await window.getByTestId('status-chat-toggle').click();
  const panel = chatPanel(window);
  await expect(panel).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return panel;
}

/** Closes the assistant from its own header button. */
export async function closeChatPanel(window: Page): Promise<void> {
  await chatPanel(window).getByTestId('chat-panel-close').click();
  await expect(chatPanel(window)).toBeHidden({ timeout: UI_TIMEOUT_MS });
}

/**
 * Expands one surface's conversation list, and does nothing when it is already expanded.
 *
 * Idempotent on purpose rather than a plain click: `conversationsExpanded` lives in the store, so a
 * panel that was closed with its list open re-opens with it open — and a helper that toggled blindly
 * would collapse it and then wait for something it had just hidden.
 */
export async function openChatConversations(root: Locator): Promise<Locator> {
  const list = root.getByTestId('chat-conversations');
  if (!(await list.isVisible())) {
    await root.getByTestId('chat-conversations-toggle').click();
  }
  await expect(list).toBeVisible({ timeout: UI_TIMEOUT_MS });
  return list;
}

/** One conversation row, by the title it shows. */
export function chatConversationRow(root: Locator, title: string): Locator {
  return root.getByTestId('chat-conversation').filter({ hasText: title });
}

/** The title in a surface's header — which conversation that instance is looking at. */
export function chatTitle(root: Locator): Locator {
  return root.getByTestId('chat-title');
}

/** Creates a conversation through the header's + button and waits for the store to adopt it. */
export async function createChatConversation(root: Locator): Promise<void> {
  const before = await root.getByTestId('chat-conversation').count();
  await root.getByTestId('chat-new-conversation').click();
  // The list is only visible when expanded; when it is, the new row has to appear in it.
  if (await root.getByTestId('chat-conversations').isVisible()) {
    await expect(root.getByTestId('chat-conversation')).toHaveCount(before + 1, {
      timeout: UI_TIMEOUT_MS,
    });
  }
  await expect(chatTitle(root)).toHaveText('New Chat', { timeout: UI_TIMEOUT_MS });
}

/** Renames a conversation in its own row, the way the pencil does. */
export async function renameChatConversation(
  root: Locator,
  from: string,
  to: string
): Promise<void> {
  const row = chatConversationRow(root, from);
  await row.getByTestId('chat-conversation-rename').click();
  const input = root.getByTestId('chat-conversation-rename-input');
  await expect(input).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await input.fill(to);
  await input.press('Enter');
  await expect(chatConversationRow(root, to)).toBeVisible({ timeout: UI_TIMEOUT_MS });
}

/**
 * Deletes a conversation. TWO clicks, because the row arms before it destroys — a whole transcript has
 * no undo, and the second click is what an accidental first one never gets.
 */
export async function deleteChatConversation(root: Locator, title: string): Promise<void> {
  const row = chatConversationRow(root, title);
  await row.getByTestId('chat-conversation-delete').click();
  await row.getByTestId('chat-conversation-delete-confirm').click();
  await expect(chatConversationRow(root, title)).toHaveCount(0, { timeout: UI_TIMEOUT_MS });
}

/**
 * Marks one vendor as enabled and keyed, through the real `ai.setSettings` IPC, and reloads so the
 * stores hydrate from it.
 *
 * **The one place this tier seeds state instead of driving the UI, and it has to be.** Saving a key
 * through the AI setup dialog calls `ai.validateApiKey`, which asks the provider — over the network,
 * with a real credential this suite does not have and must not want. `apiKeyConfigured` is a plain
 * boolean in main-process `AppState` (`services/ai/ai-service.ts`), and it is the whole of what the
 * renderer gates on, so writing it is exactly the state a keyed user is in. Nothing is put in the
 * keychain, so nothing can be sent to a provider: any test that then tried to chat would fail, which
 * is the correct outcome.
 */
export async function seedAiProvider(window: Page, vendorId: string): Promise<void> {
  await window.evaluate(async id => {
    const bridge = (
      globalThis as unknown as {
        joinery: { ai: { setSettings: (partial: unknown) => Promise<unknown> } };
      }
    ).joinery;
    await bridge.ai.setSettings({
      enabled: true,
      vendorSettings: [{ vendorId: id, enabled: true, apiKeyConfigured: true, priority: 1 }],
    });
  }, vendorId);

  await window.reload();
  await waitForShell(window);
}

/** Pins a model in a chat surface's strip. Re-selecting the pinned one is how the app returns to Auto. */
export async function pinChatModel(root: Locator, modelName: string): Promise<void> {
  await root.getByTestId('chat-model-trigger').click();
  await root.page().getByTestId('chat-model-option').filter({ hasText: modelName }).click();
  await expect(root.getByTestId('chat-model-label')).toHaveText(modelName, {
    timeout: UI_TIMEOUT_MS,
  });
}

/** The auto-router cost-tier trigger, which is only in the strip beside a pinned auto-router. */
export function chatCostTier(root: Locator): Locator {
  return root.getByTestId('chat-cost-tier-trigger');
}

/**
 * Picks a routing band in the strip's cost-tier menu. The menu is portalled to the document, so the
 * rows are located from the page rather than from the surface root.
 */
export async function chooseChatCostTier(root: Locator, tier: OpenRouterCostTier): Promise<void> {
  await chatCostTier(root).click();
  await root.page().locator(`[data-testid="chat-cost-tier-option"][data-tier="${tier}"]`).click();
  await expect(root.page().getByTestId('chat-cost-tier-menu')).toBeHidden({
    timeout: UI_TIMEOUT_MS,
  });
}
