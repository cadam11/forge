/**
 * `open-ai-setup`'s consumer, and — the other half of J-55 — the **one owner of `aiStore` hydration**.
 *
 * ── Why the hydration moved here ────────────────────────────────────────────────────────────
 *
 * Nothing hydrated `aiStore` until Task 17, when `ChatSurface` started calling `initialize()` on every
 * mount because it needed to know whether a provider existed. That made opening the assistant the thing
 * that switched auto-rename (`features/query/use-run-query.ts`) and query-assist (`editor/intellisense.ts`)
 * on for a user who already had keys — those two read `selectAutoRenameEnabled` / `selectQueryAssistEnabled`,
 * which answered from `DEFAULT_AI_SETTINGS` until something fetched. J-55's own note says the settings
 * surface should take it over, and this component is that surface's always-mounted half: it is in the
 * shell's non-visual mounts, so the fetch happens once at startup and every reader is correct from then
 * on whether or not the assistant is ever opened.
 *
 * The chat surface's call is deleted in the same commit, so `initialize()` has exactly one caller.
 *
 * Mounted by the shell rather than by the dialog for the usual reason: a handler whose job is to OPEN
 * the AI setup dialog cannot live inside it.
 */

import { useEffect, useState } from 'react';

import { useCommand } from '../../commands';
import { aiStore } from '../../state/ai';
import { AiSetupDialog } from './ai-setup-dialog';

export function AiSetupHost() {
  const [open, setOpen] = useState(false);

  // One fetch for the window's lifetime. `initialize()` reports its own failures and leaves the store
  // at its defaults, so there is nothing to catch here and nothing that blocks the shell.
  useEffect(() => {
    void aiStore.getState().initialize();
  }, []);

  useCommand('open-ai-setup', () => setOpen(true));

  if (!open) return null;
  return <AiSetupDialog onDismiss={() => setOpen(false)} />;
}
