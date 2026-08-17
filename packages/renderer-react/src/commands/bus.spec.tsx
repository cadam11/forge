/**
 * Runtime behaviour of the command bus. The compile-time half — unknown id, wrong payload, missing
 * payload — is in `types.spec.ts`, because those cases cannot be expressed as a running assertion.
 */

import { StrictMode } from 'react';
import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSetupHost } from '../features/ai-setup';
import { BackupDialogs } from '../features/backup';
import { ChatCommands } from '../features/chat';
import { CommandPalette } from '../features/command-palette';
import { ConnectionDialogs } from '../features/connections';
import { DatabaseDialogs } from '../features/databases';
import { ObjectSearch } from '../features/object-search';
import { QueryCommands } from '../features/query/query-commands';
import { QueryHistoryHost } from '../features/query-history';
import { RestoreDialogs } from '../features/restore';
import { SettingsDialog } from '../features/settings';
import { ShortcutsDialog } from '../features/shortcuts-dialog';
import { SnippetLibrary } from '../features/snippet-library';
import { IpcQueryProvider } from '../ipc';
import { setDiagnosticsSink } from '../state/diagnostics';
import { ShellCommands } from '../shell/shell-commands';
import { StatusBar } from '../shell/status-bar';
import { TooltipProvider } from '../ui';
import { dispatchCommand, handlerCount, subscribeCommand, useCommand } from './bus';
import { COMMAND_CONSUMERS, COMMAND_IDS } from './registry';

const teardowns: (() => void)[] = [];

/** Every DEV warning `dispatchCommand` emitted during a test. See the unhandled-dispatch block. */
let warnings: string[] = [];

beforeEach(() => {
  warnings = [];
  // Installed for the whole file, not just the warning tests: several tests below dispatch into an
  // empty table on purpose, and the default sink is the console.
  teardowns.push(
    setDiagnosticsSink({
      error: () => undefined,
      warn: (context, cause) => warnings.push(`${context} :: ${String(cause)}`),
    })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  // Nothing may leak between tests: the handler table is module state.
  for (const id of COMMAND_IDS) expect(handlerCount(id)).toBe(0);
});

/**
 * Mounts the app's real command wiring — `ShellCommands` (the eleven handlers Task 7 still owns after
 * Tasks 12, 13 and 15 took `open-backup-dialog`, `open-restore-dialog` and `open-settings` off their
 * placeholders, and Task 17 took `toggle-chat-panel`), `ChatCommands` (Task 17's two), `StatusBar` (`cursor-position`), `ConnectionDialogs` (Task 9's three), `QueryCommands`
 * (Task 10's twelve), `BackupDialogs` (Task 12's two), `RestoreDialogs` (Task 13's two),
 * `SettingsDialog` (Task 15's one) and Task 16's four overlays (`ObjectSearch`, `SnippetLibrary`,
 * `ShortcutsDialog` — and `CommandPalette`, which subscribes to nothing but is mounted so the
 * `open-*` commands it produces are proven to reach a consumer). Not a stand-in list of
 * ids: the whole point of the ownership test below is that it fails when a subscription is deleted, and
 * only the real components can tell it. Every component that is mounted purely to register handlers
 * belongs here, and adding one without adding it here shows up as a command that claims a shipped task
 * and has no handler.
 *
 * `QueryCommands` is mounted directly rather than through the query panel, and that is why it exists as
 * its own component: the panel is a Monaco host and Monaco cannot be instantiated in jsdom. Its props are
 * no-ops here — this test is about which ids are subscribed, and `query-commands.spec.tsx` is about what
 * the handlers do.
 *
 * `TooltipProvider` because the status bar's controls carry tooltips.
 */
function renderProductionWiring(): void {
  const noop = () => undefined;
  const { unmount } = render(
    <IpcQueryProvider>
      <TooltipProvider>
        <ShellCommands />
        <ChatCommands />
        <AiSetupHost />
        <QueryHistoryHost />
        <DatabaseDialogs />
        <StatusBar />
        <ConnectionDialogs />
        <BackupDialogs />
        <RestoreDialogs />
        <SettingsDialog />
        <CommandPalette />
        <ObjectSearch />
        <SnippetLibrary />
        <ShortcutsDialog />
        <QueryCommands
          isActive={() => true}
          onExecute={noop}
          onExecuteSelection={noop}
          onCancel={noop}
          onFormat={noop}
          onFind={noop}
          onReplace={noop}
          onToggleComment={noop}
          onSave={noop}
          onSaveAs={noop}
          onOpenFile={noop}
          onToggleResults={noop}
          onInsertSnippet={noop}
          onConvertSql={noop}
        />
      </TooltipProvider>
    </IpcQueryProvider>
  );
  teardowns.push(unmount);
}

/**
 * The tasks whose command wiring `renderProductionWiring` actually mounts. Both ownership tests read
 * it: one says "a shipped task with no handler is a false claim", the other says "a shipped task's
 * handler must be subscribed". Adding a task's component above without adding its number here makes
 * the second test vacuous for it, which is why they share one list.
 */
const SHIPPED_TASKS: readonly string[] = ['7', '9', '10', '12', '13', '15', '16', '17', '19a'];

/**
 * The task a consumer string names, or null when it names nobody.
 *
 * A **string**, and the optional letter is the reason: PLAN.md's Task 19 was split into a MUST half
 * (19a) and the rest, and the two halves ship separately — `19a` is mounted by the wiring below while
 * plain `19` is not. Parsing to a number would fold them together and make an unshipped 19 command
 * look like a false claim the moment 19a landed.
 */
function ownerTask(consumer: string): string | null {
  const match = /^Task (\d+[a-z]?)\b/.exec(consumer);
  return match?.[1] ?? null;
}

describe('the registry', () => {
  it('names a consumer for every command', () => {
    // The Record type already enforces this at compile time; asserting it at runtime catches an
    // entry that exists but says nothing.
    for (const id of COMMAND_IDS) {
      expect(COMMAND_CONSUMERS[id].length).toBeGreaterThan(20);
    }
  });

  it('has no id whose owner is unnamed', () => {
    // `save-snippet` was PLAN.md 0.4's tenth dead palette dispatch, and it is STILL absent — Task 16
    // built the snippet library without it, because "save the current query as a snippet" is a button
    // inside that surface rather than a message between two surfaces. A command would have been a
    // channel with one producer and one consumer in the same component (`palette-actions.ts` explains
    // why that shape is refused).
    expect(COMMAND_IDS).not.toContain('save-snippet');

    const unnamed = COMMAND_IDS.filter(id => ownerTask(COMMAND_CONSUMERS[id]) === null);
    expect(unnamed).toEqual([]);
  });
});

/**
 * The dead-command class of bug, made machine-checkable.
 *
 * PLAN.md 0.4's finding was not "the registry has bad entries" — it was that a dispatch with no
 * listener is indistinguishable from a working one, so ten palette items did nothing for months. The
 * compile-time `Record<CommandId, string>` forces a consumer to be *named*; nothing forced the name
 * to be *true*. These two tests are that missing half, and between them they leave exactly one legal
 * state for every id: a live handler, or a task number that has not shipped yet.
 */
describe('command ownership', () => {
  it('gives every command either a live handler or a named future task', () => {
    renderProductionWiring();

    const dead = COMMAND_IDS.filter(id => {
      if (handlerCount(id) > 0) return false;
      const owner = ownerTask(COMMAND_CONSUMERS[id]);
      // Tasks 7, 9, 10, 12 and 13 ARE this wiring, so one of those with no subscription is a false
      // claim rather than a pending one — the only unhandled ids allowed are the ones a later task owns.
      return owner === null || SHIPPED_TASKS.includes(owner);
    });

    expect(dead).toEqual([]);
  });

  it('subscribes every command whose consumer names a task that has shipped', () => {
    // The other direction, and the one that fails if a `useCommand` call is deleted: an id may only claim
    // a SHIPPED task as its consumer while that task's wiring actually handles it.
    renderProductionWiring();

    const claimed = COMMAND_IDS.filter(id =>
      SHIPPED_TASKS.includes(ownerTask(COMMAND_CONSUMERS[id]) ?? '')
    );
    const unsubscribed = claimed.filter(id => handlerCount(id) === 0);

    expect(unsubscribed).toEqual([]);
    // A count as well, so deleting a handler *and* its registry claim in one edit is still a failure
    // rather than a quietly smaller app: twelve `useCommand` calls in `shell-commands.tsx` (eleven,
    // plus Task 16's `reveal-explorer-node`), plus the status bar's caret readout, plus Task 9's three
    // in `features/connections`, plus Task 10's twelve, plus Task 12's two in `features/backup`, plus
    // Task 13's two in `features/restore`, plus Task 15's one in `features/settings`, plus Task 16's
    // three overlay takeovers (`open-object-search`, `open-snippets`, `show-shortcuts`), plus Task 17's
    // two in `features/chat` — `toggle-chat-panel`, which MOVED off the shell, and `open-chat-tab`,
    // which is new. Two ids are claimed by two owners at once and so count once: `open-query-file` (the
    // query editor when a query tab is active, the shell otherwise) and `cursor-position` (the status
    // bar consumes, the editor produces). 31 → 35 across Task 16 (four ids gained their FIRST handler,
    // none moved) → 36 across Task 17 (one new id, one moved owner) → 37 across Task 19a's
    // `AiSetupHost` (`open-ai-setup`, new) and `QueryHistoryHost`
    // (`open-query-history`, previously registered-but-unowned), plus `DatabaseDialogs`' three
    // (`create-database`, `create-database-on-server`, `rename-database`), plus the converter's three in
    // `QueryCommands` (`convert-sql-to-{mssql,postgresql,mysql}`) → 44.
    expect(COMMAND_IDS.filter(id => handlerCount(id) > 0)).toHaveLength(44);
  });
});

describe('dispatchCommand / subscribeCommand', () => {
  it('delivers the payload to every subscriber', () => {
    const first = vi.fn();
    const second = vi.fn();
    teardowns.push(subscribeCommand('insert-snippet', first));
    teardowns.push(subscribeCommand('insert-snippet', second));

    dispatchCommand('insert-snippet', { sql: 'select 1' });

    expect(first).toHaveBeenCalledWith({ sql: 'select 1' });
    expect(second).toHaveBeenCalledWith({ sql: 'select 1' });
  });

  it('returns false when nothing is subscribed', () => {
    expect(dispatchCommand('menu-copy')).toBe(false);
  });

  it('returns true only when a handler claims the command', () => {
    // The `menu-copy` protocol: the menu bridge falls back to document.execCommand when the answer
    // is false, which is what the Angular `cancelable` CustomEvent + preventDefault expressed.
    const declines = subscribeCommand('menu-copy', () => undefined);
    teardowns.push(declines);
    expect(dispatchCommand('menu-copy')).toBe(false);

    teardowns.push(subscribeCommand('menu-copy', () => true));
    expect(dispatchCommand('menu-copy')).toBe(true);
  });

  it('warns in DEV when a dispatch reaches nobody, naming the expected consumer', () => {
    // The other half of the dead-command guard. `false` is a return value only the menu bridge reads;
    // for the other thirty-five ids "nothing was subscribed" means the user's click went nowhere, and
    // this is the only place that can say so.
    expect(dispatchCommand('open-query-history')).toBe(false);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('open-query-history');
    expect(warnings[0]).toContain(COMMAND_CONSUMERS['open-query-history']);
  });

  it('says nothing about an unhandled dispatch outside DEV', () => {
    // The guard is `import.meta.env.DEV`, which Vite replaces with `false` in the production bundle
    // — so this branch is dead code in a shipped app rather than a suppressed log line. Stubbed here
    // because "no production noise" is a requirement, and a requirement nothing checks drifts.
    vi.stubEnv('DEV', false);
    try {
      expect(dispatchCommand('open-query-history')).toBe(false);
      expect(warnings).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('does not warn when a handler is subscribed but declines to claim', () => {
    // `menu-copy` returning false with a live subscriber is the protocol working, not a dead command.
    teardowns.push(subscribeCommand('menu-copy', () => undefined));

    expect(dispatchCommand('menu-copy')).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('runs every handler even after one has claimed', () => {
    const later = vi.fn();
    teardowns.push(subscribeCommand('menu-copy', () => true));
    teardowns.push(subscribeCommand('menu-copy', later));

    expect(dispatchCommand('menu-copy')).toBe(true);
    expect(later).toHaveBeenCalledOnce();
  });

  it('survives a handler that unsubscribes during dispatch', () => {
    const second = vi.fn();
    const unsubscribeSecond = subscribeCommand('show-shortcuts', second);
    teardowns.push(unsubscribeSecond);
    // A dialog that closes in response to its own command.
    teardowns.push(subscribeCommand('show-shortcuts', () => unsubscribeSecond()));

    expect(() => dispatchCommand('show-shortcuts')).not.toThrow();
    expect(second).toHaveBeenCalledOnce();
  });

  it('unsubscribing removes exactly one handler', () => {
    const unsubscribe = subscribeCommand('open-snippets', () => undefined);
    teardowns.push(subscribeCommand('open-snippets', () => undefined));
    expect(handlerCount('open-snippets')).toBe(2);

    unsubscribe();
    expect(handlerCount('open-snippets')).toBe(1);
  });

  it('calling a teardown twice does not unsubscribe a later subscriber', () => {
    // The bug: the first teardown removes the now-empty set from the table, a new subscriber
    // installs a fresh set under the same id, and the stale teardown firing again deletes THAT set
    // — silently unsubscribing somebody else. The identity check in `subscribeCommand` is what
    // stops it.
    const stale = subscribeCommand('open-snippets', () => undefined);
    stale();
    expect(handlerCount('open-snippets')).toBe(0);

    const survivor = vi.fn();
    teardowns.push(subscribeCommand('open-snippets', survivor));
    stale();

    expect(handlerCount('open-snippets')).toBe(1);
    dispatchCommand('open-snippets');
    expect(survivor).toHaveBeenCalledOnce();
  });
});

describe('useCommand', () => {
  it('subscribes on mount and tears down on unmount', () => {
    const handler = vi.fn();

    function Probe() {
      useCommand('open-object-search', handler);
      return null;
    }

    const { unmount } = render(<Probe />);
    expect(handlerCount('open-object-search')).toBe(1);

    act(() => void dispatchCommand('open-object-search'));
    expect(handler).toHaveBeenCalledOnce();

    unmount();
    expect(handlerCount('open-object-search')).toBe(0);
  });

  it('leaves exactly one live subscription after a StrictMode double mount', () => {
    // The bug this rules out: a torn-down effect that removed a *shared* listener rather than its
    // own would leave the command firing twice per dispatch.
    const handler = vi.fn();

    function Probe() {
      useCommand('open-snippets', handler);
      return null;
    }

    const { unmount } = render(
      <StrictMode>
        <Probe />
      </StrictMode>
    );
    teardowns.push(unmount);

    expect(handlerCount('open-snippets')).toBe(1);
    act(() => void dispatchCommand('open-snippets'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('uses the latest handler without resubscribing', () => {
    const calls: string[] = [];

    function Probe({ label }: { label: string }) {
      useCommand('cursor-position', payload => {
        calls.push(`${label}:${payload.line}`);
      });
      return null;
    }

    const { rerender, unmount } = render(<Probe label="first" />);
    // Testing Library's own cleanup runs after this file's afterEach, so the subscription has to be
    // torn down here for the "nothing leaked" check to mean anything.
    teardowns.push(unmount);
    rerender(<Probe label="second" />);

    expect(handlerCount('cursor-position')).toBe(1);
    act(() => void dispatchCommand('cursor-position', { line: 7, column: 3 }));
    expect(calls).toEqual(['second:7']);
  });
});
