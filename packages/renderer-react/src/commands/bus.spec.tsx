/**
 * Runtime behaviour of the command bus. The compile-time half — unknown id, wrong payload, missing
 * payload — is in `types.spec.ts`, because those cases cannot be expressed as a running assertion.
 */

import { StrictMode } from 'react';
import { render, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchCommand, handlerCount, subscribeCommand, useCommand } from './bus';
import { COMMAND_CONSUMERS, COMMAND_IDS } from './registry';

const teardowns: (() => void)[] = [];

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  // Nothing may leak between tests: the handler table is module state.
  for (const id of COMMAND_IDS) expect(handlerCount(id)).toBe(0);
});

describe('the registry', () => {
  it('names a consumer for every command', () => {
    // The Record type already enforces this at compile time; asserting it at runtime catches an
    // entry that exists but says nothing.
    for (const id of COMMAND_IDS) {
      expect(COMMAND_CONSUMERS[id].length).toBeGreaterThan(20);
    }
  });

  it('admits an audit-dead dispatch only once it has a consumer', () => {
    // PLAN.md 0.4 listed ten palette dispatches with no listener anywhere in the Angular app. Task 4
    // asserted the registry carried NONE of them, which was right while none had an owner.
    //
    // Task 7 changed that, and the change is the point rather than a regression: it wired the native
    // menu, and six of those ten are menu actions whose handler now exists (`toggle-sidebar`,
    // `refresh-explorer` and `open-settings` in the shell; `execute-query`, `format-sql` and
    // `cancel-query` naming Task 10's editor). Two more arrived under clearer ids —
    // `open-backup-dialog` / `open-restore-dialog`, PLAN.md 0.1's broken menu items, now reaching a
    // placeholder dialog — and `toggle-results` as `toggle-results-panel`.
    //
    // So the assertion moves from the LIST to the RULE, which is what actually made those dispatches
    // dead: an id may exist only alongside a named consumer. That is enforced at compile time by
    // `Record<CommandId, string>` and above at runtime; here it is checked specifically against the
    // ids the audit caught, because those are the ones a bulk port would resurrect without owners.
    const auditDead = [
      'toggle-sidebar',
      'toggle-results',
      'execute-query',
      'format-sql',
      'cancel-query',
      'refresh-explorer',
      'open-settings',
      'open-backup',
      'open-restore',
      'save-snippet',
    ];

    for (const id of COMMAND_IDS.filter(candidate => auditDead.includes(candidate))) {
      expect(COMMAND_CONSUMERS[id].length).toBeGreaterThan(20);
    }

    // `save-snippet` has no owner until Task 16 builds the snippet library, so it must still be
    // absent — the one member of the original list that this task did not earn.
    expect(COMMAND_IDS).not.toContain('save-snippet');
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
