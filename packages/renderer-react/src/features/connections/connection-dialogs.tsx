/**
 * The consumer `COMMAND_CONSUMERS` names for the three connection commands, and the one place that
 * decides which of the two dialogs is on screen.
 *
 * ── What this takes over ────────────────────────────────────────────────────────────────────
 *
 *  - `open-connection-dialog` — File ▸ New Connection, the sidebar's `+`, the explorer empty
 *    state's CTA, the connection menu's "New Connection…", and ⌘N with nothing connected. Task 7
 *    parked a placeholder dialog on this wire (PLAN.md 0.1's first broken menu item); the
 *    placeholder is deleted in the same commit that adds this file, so the wire is never handled
 *    twice.
 *  - `open-connection-manager` — the sidebar connection menu's "Manage Connections…".
 *  - `edit-connection` — the sidebar's server context menu, carrying the connection id.
 *
 * `commands/bus.spec.tsx`'s ownership test is what forces all three: an id whose consumer names a
 * task with no live handler is only legal while that task has not shipped. Mounting this component
 * is how Task 9 stops being pending, which is also why it is added to that spec's
 * `renderProductionWiring`.
 *
 * ── Why one component owns both dialogs ─────────────────────────────────────────────────────
 *
 * The manager's only job is to launch the editor (PLAN.md §2.9), so the two are one flow with three
 * states, and the interesting state is the third: the editor opened *from* the manager, which must
 * hand control back when it closes. Angular stacked them — `MatDialog.open` from inside the open
 * manager — which leaves two scrims, two focus traps, and a manager the user has to dismiss twice.
 * Here the editor replaces the manager and `returnToManager` remembers the way back. One piece of
 * state, so "which dialog is up?" has exactly one answer and "both" is not expressible.
 *
 * ── Resolution happens at dispatch, not at render ────────────────────────────────────────────
 *
 * `edit-connection` carries an id; the editor's contract is a whole `ConnectionProfile`. The lookup
 * therefore happens in the command handler, which is also where a *missing* profile can be reported
 * — a context menu can outlive the profile it named (delete it in the manager, then pick the stale
 * item), and reporting that from inside `render` would be a toast fired as a side effect of
 * rendering. The profile is then a snapshot for the editor's lifetime, which is what `useForm`
 * already assumes: it reads `defaultValues` once, on mount.
 */

import { useState } from 'react';
import type { ConnectionProfile } from '@joinery/shared';

import { useCommand } from '../../commands';
import { connectionStore, selectProfileFor } from '../../state/connection';
import { notify } from '../../state/diagnostics';
import { ConnectionEditor } from './connection-editor';
import { ConnectionManager } from './connection-manager';

/**
 * Which dialog is up. `returnToManager` is the only piece of history kept, and it is kept because
 * the alternative — a boolean "the manager was open" alongside the view — would allow the state
 * "manager open AND editor open", which is the thing this shape rules out.
 */
type View =
  | { readonly kind: 'none' }
  | { readonly kind: 'manager' }
  | {
      readonly kind: 'editor';
      /** The profile being edited, or `undefined` for a create. */
      readonly profile?: ConnectionProfile;
      /**
       * Server and port to start a CREATE from — Task 19b's Docker panel, through
       * `connect-to-container`. Never set alongside `profile`: an existing profile already has both, and
       * the editor's `defaultValues` ignores the prefill when it is editing one.
       */
      readonly prefill?: { readonly server: string; readonly port: number };
      readonly returnToManager: boolean;
    };

const CLOSED: View = { kind: 'none' };

/** A remount key for a prefilled create. `'new'` when there is nothing prefilled. */
function prefillKey(
  prefill: { readonly server: string; readonly port: number } | undefined
): string {
  return prefill === undefined ? 'new' : `new:${prefill.server}:${prefill.port}`;
}

export function ConnectionDialogs() {
  const [view, setView] = useState<View>(CLOSED);

  /** The editor on an existing profile, or nothing at all when the id no longer resolves. */
  const openEditorOn = (profileId: string, returnToManager: boolean): void => {
    const profile = selectProfileFor(profileId)(connectionStore.getState());
    if (profile === null) {
      notify.error('That connection no longer exists.');
      return;
    }
    setView({ kind: 'editor', profile, returnToManager });
  };

  useCommand('open-connection-dialog', () => setView({ kind: 'editor', returnToManager: false }));
  useCommand('open-connection-manager', () => setView({ kind: 'manager' }));
  useCommand('edit-connection', ({ connectionId }) => openEditorOn(connectionId, false));
  useCommand('connect-to-container', ({ server, port }) =>
    setView({ kind: 'editor', prefill: { server, port }, returnToManager: false })
  );

  if (view.kind === 'none') return null;

  if (view.kind === 'manager') {
    return (
      <ConnectionManager
        onDismiss={() => setView(CLOSED)}
        onEdit={profileId => {
          if (profileId === null) {
            setView({ kind: 'editor', returnToManager: true });
            return;
          }
          openEditorOn(profileId, true);
        }}
      />
    );
  }

  const back = (): void => setView(view.returnToManager ? { kind: 'manager' } : CLOSED);

  return (
    <ConnectionEditor
      // Remounts when the target changes, so `useForm` re-reads `defaultValues` instead of keeping
      // the previous profile's — and the PREFILL is part of the target, or opening the editor for one
      // Docker container and then for another would show the first container's port.
      key={view.profile?.id ?? prefillKey(view.prefill)}
      profile={view.profile}
      prefill={view.prefill}
      onDismiss={back}
      onSaved={(_saved, connected) => {
        // A successful Connect has just opened a server node behind the dialog; dropping the user
        // back into the manager would cover it. A plain Save returns to wherever they came from.
        if (connected) {
          setView(CLOSED);
          return;
        }
        back();
      }}
    />
  );
}
