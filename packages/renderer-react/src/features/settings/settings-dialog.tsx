/**
 * The settings panel. Replaces `shared/components/settings-panel/settings-panel.component.ts` (965).
 *
 * ── A dialog, not a right-hand drawer ───────────────────────────────────────────────────────
 *
 * The Angular original was a `position: fixed` panel sliding in from the right at `z-index: 10002`,
 * over its own hand-rolled scrim at `10001`, with a `@HostListener('document:keydown.escape')` and a
 * document-level ⌘, listener it added in `ngOnInit`. Everything in that sentence is something Radix
 * already owns and owns correctly: the scrim, the focus trap, the return of focus, Escape, the scroll
 * lock, and modality by hiding the rest of the document from assistive technology rather than by
 * setting `aria-modal` (`ui/dialog.tsx`, and `dialog.spec.tsx` pins the lot). The two z-indexes were
 * also the app's highest, competing with the toast layer for no reason.
 *
 * A drawer would additionally be the wrong shape for the content: four groups of controls that must be
 * switchable, which is a tab strip, and a 420px column is too narrow for a labelled field plus its
 * hint. `size="lg"` (736px) fits inside the 800px minimum window (`main/src/window.ts:53`).
 *
 * ── One owner of `open-settings` ────────────────────────────────────────────────────────────
 *
 * `COMMAND_CONSUMERS` names this file. Task 7's `shell-commands.tsx` held the wire while no panel
 * existed and its handler is deleted in the same commit that adds this one, so the command is never
 * handled twice — the arrangement Tasks 9, 12 and 13 used for their dialogs. This component is mounted
 * unconditionally by the shell and renders nothing until the store says it is open, which is what lets
 * it be the thing that opens itself.
 *
 * ── No save button, and no form ─────────────────────────────────────────────────────────────
 *
 * Every control writes through the settings store the moment it changes, and the store's `commit`
 * writes `[data-theme]`, mirrors the theme and persists to `AppState` in one place
 * (`state/settings.ts`). There is nothing to submit, so this is deliberately not a `react-hook-form`
 * surface: the forms scaffolding exists for dialogs with a submit and a validation pass, and a form
 * around live settings would add a draft nobody asked for. The one control that *does* keep a draft is
 * `NumberSetting`, and its header explains why a number field is the exception.
 */

import { useRef, useState } from 'react';

import { useCommand } from '../../commands';
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../ui';
import { settingsStore, useSettingsStore } from '../../state/settings';
import {
  AppearanceGroup,
  EditorGroup,
  GridGroup,
  QueryGroup,
  ResetToDefaults,
} from './settings-groups';
import { PendingDraftsProvider, usePendingDrafts } from './setting-controls';

/** The four groups, in the order the strip lists them. */
const GROUPS = ['appearance', 'editor', 'query', 'grid'] as const;

type SettingsGroupId = (typeof GROUPS)[number];

const GROUP_LABELS: Record<SettingsGroupId, string> = {
  appearance: 'Appearance',
  editor: 'Editor',
  query: 'Query',
  grid: 'Results grid',
};

export function SettingsDialog() {
  const isOpen = useSettingsStore(state => state.isOpen);
  const [group, setGroup] = useState<SettingsGroupId>('appearance');
  const firstTab = useRef<HTMLButtonElement | null>(null);
  const { registry, commitPendingDrafts } = usePendingDrafts();

  // Joinery ▸ Settings (⌘,). `open`, not `toggle`: the accelerator is handled by the native menu
  // (`main/src/menu.ts:21`), so pressing it a second time with the dialog up would close a dialog the
  // user is looking at — from a menu item that says "Settings…". Escape closes, visibly.
  useCommand('open-settings', () => settingsStore.getState().open());

  if (!isOpen) return null;

  return (
    <Dialog
      open
      onOpenChange={next => {
        if (next) return;
        // BEFORE the store closes and the fields unmount: a `NumberSetting` holding an uncommitted draft
        // loses it on Escape otherwise, because React hears blur at the root container and Escape detaches
        // the focused field first. Measured in the real app, and `settings-dialog.spec.tsx` pins all three
        // dismissal paths. Idempotent — an untouched field commits nothing.
        commitPendingDrafts();
        settingsStore.getState().close();
      }}
    >
      <DialogContent
        size="lg"
        data-testid="settings-dialog"
        // The group switcher, not the close button Radix would otherwise focus as the first tabbable
        // node — a keyboard user arriving here wants the four groups, and Escape is already the way out.
        onOpenAutoFocus={event => {
          event.preventDefault();
          firstTab.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Every setting here applies immediately, to windows and editors that are already open.
          </DialogDescription>
        </DialogHeader>

        {/* Every `NumberSetting` below registers its blur-time commit here, so the dismissal sweep
            above can flush the drafts while the fields are still mounted. */}
        <PendingDraftsProvider registry={registry}>
          {/* The strip sits OUTSIDE the scrolling body, so switching groups is reachable however far
            down a group the user has scrolled. */}
          <Tabs
            value={group}
            onValueChange={value => setGroup(value as SettingsGroupId)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="shrink-0 px-4">
              {GROUPS.map((id, index) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  ref={index === 0 ? firstTab : undefined}
                  data-testid={`settings-tab-${id}`}
                >
                  {GROUP_LABELS[id]}
                </TabsTrigger>
              ))}
            </TabsList>

            <DialogBody>
              <TabsContent value="appearance">
                <AppearanceGroup />
              </TabsContent>
              <TabsContent value="editor">
                <EditorGroup />
              </TabsContent>
              <TabsContent value="query">
                <QueryGroup />
              </TabsContent>
              <TabsContent value="grid">
                <GridGroup />
              </TabsContent>
            </DialogBody>
          </Tabs>
        </PendingDraftsProvider>

        <DialogActions className="justify-between">
          <ResetToDefaults />
          <span className="text-sm text-fg-muted">Esc closes.</span>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
