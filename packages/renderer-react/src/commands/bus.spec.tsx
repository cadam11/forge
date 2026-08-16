/**
 * Runtime behaviour of the command bus. The compile-time half — unknown id, wrong payload, missing
 * payload — is in `types.spec.ts`, because those cases cannot be expressed as a running assertion.
 */

import { StrictMode } from 'react';
import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionDialogs } from '../features/connections';
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
 * Mounts the shell's real command wiring — `ShellCommands` (the fourteen handlers Task 7 owns),
 * `StatusBar` (`cursor-position`) and `ConnectionDialogs` (Task 9's three). Not a stand-in list of
 * ids: the whole point of the ownership test below is that it fails when a subscription is deleted,
 * and only the real components can tell it. Every component `app-shell.tsx` mounts purely to
 * register handlers belongs here, and adding one to the shell without adding it here shows up as a
 * command that claims a shipped task and has no handler.
 *
 * `TooltipProvider` because the status bar's controls carry tooltips.
 */
function renderProductionWiring(): void {
  const { unmount } = render(
    <IpcQueryProvider>
      <TooltipProvider>
        <ShellCommands />
        <StatusBar />
        <ConnectionDialogs />
      </TooltipProvider>
    </IpcQueryProvider>
  );
  teardowns.push(unmount);
}

/** The task number a consumer string names, or null when it names nobody. */
function ownerTask(consumer: string): number | null {
  const match = /^Task (\d+)\b/.exec(consumer);
  return match?.[1] === undefined ? null : Number(match[1]);
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
    // `save-snippet` is the one member of PLAN.md 0.4's ten dead palette dispatches that Task 7 did
    // not earn an owner for — the snippet library is Task 16 — so it must still be absent entirely.
    // The other nine are covered by the ownership rule below, which is a stronger statement than the
    // list this used to be.
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
      // Task 7 IS this wiring, so "Task 7 shell" with no subscription is a false claim, not a
      // pending one — the only unhandled ids allowed are the ones a later task owns.
      return owner === null || owner === 7;
    });

    expect(dead).toEqual([]);
  });

  it('subscribes every command whose consumer says Task 7', () => {
    // The other direction, and the one that fails if a `useCommand` call is deleted: an id may only
    // claim Task 7 as its consumer while Task 7's wiring actually handles it.
    renderProductionWiring();

    const claimedByTask7 = COMMAND_IDS.filter(id => ownerTask(COMMAND_CONSUMERS[id]) === 7);
    const unsubscribed = claimedByTask7.filter(id => handlerCount(id) === 0);

    expect(unsubscribed).toEqual([]);
    // A count as well, so deleting a handler *and* its registry claim in one edit is still a failure
    // rather than a quietly smaller app: fourteen `useCommand` calls in `shell-commands.tsx`, plus
    // the status bar's caret readout, plus Task 9's three in `features/connections`.
    // `open-connection-dialog` moved from the first group to the third when the placeholder dialog
    // was replaced by the real editor, so the total went 16 → 18 rather than 16 → 19.
    expect(COMMAND_IDS.filter(id => handlerCount(id) > 0)).toHaveLength(18);
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
