/**
 * The log store: de-duplication, the unseen-error badge, and the throttle.
 *
 * The throttle is the reason this file exists. PLAN.md §7.8 flags `logs.append` as an unthrottled
 * write — every forwarded entry is an IPC round trip ending in a file append on the main thread,
 * which is also the thread that paints the window. The guard has to hold under a burst, has to
 * *report* what it dropped rather than losing it silently, and must never suppress a local entry:
 * hiding a diagnostic from the person reading the diagnostics panel would be the wrong trade.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogEntry } from '@joinery/shared';
import { installJoineryMock, removeJoineryMock } from '../test/joinery-mock';
import { createLogStore, describeCause, installLogDiagnosticsSink, selectErrorCount } from './logs';
import { diagnostics } from './diagnostics';

let appended: LogEntry[] = [];
let revealed = 0;
let clock = 0;
const teardowns: (() => void)[] = [];

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: `main-${Math.random()}`,
    timestamp: 1,
    level: 'info',
    tag: 'main',
    message: 'hello',
    source: 'main',
    ...overrides,
  };
}

beforeEach(() => {
  appended = [];
  revealed = 0;
  clock = 0;
  teardowns.push(
    installJoineryMock({
      logs: {
        append: (value: LogEntry) => {
          appended.push(value);
          return Promise.resolve();
        },
        revealFile: () => {
          revealed += 1;
          return Promise.resolve('/tmp/joinery.log');
        },
      },
    })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
});

/** A store whose clock this test controls, so the throttle window needs no real time. */
const store = () => createLogStore({ now: () => clock });

describe('the log timeline', () => {
  it('de-duplicates by id, because a forwarded renderer entry streams back', () => {
    const logs = store();
    const shared = entry({ id: 'r-1' });

    logs.getState().push(shared);
    logs.getState().push(shared);

    expect(logs.getState().entries).toHaveLength(1);
  });

  it('caps the buffer', () => {
    const logs = store();
    for (let index = 0; index < 1_050; index += 1) {
      logs.getState().push(entry({ id: `e-${index}` }));
    }

    expect(logs.getState().entries).toHaveLength(1000);
    // The tail is what is kept — a log is read from the bottom.
    expect(logs.getState().entries.at(-1)?.id).toBe('e-1049');
  });

  it('counts unseen errors only while the panel is closed, and clears them on open', () => {
    const logs = store();

    logs.getState().push(entry({ id: 'e1', level: 'error' }));
    logs.getState().push(entry({ id: 'e2', level: 'error' }));
    logs.getState().push(entry({ id: 'i1', level: 'info' }));
    expect(logs.getState().unseenErrors).toBe(2);

    logs.getState().open();
    expect(logs.getState().unseenErrors).toBe(0);

    logs.getState().push(entry({ id: 'e3', level: 'error' }));
    expect(logs.getState().unseenErrors).toBe(0);
    expect(selectErrorCount(logs.getState())).toBe(3);
  });

  it('carries a focus request and reveals the file through the bridge', () => {
    const logs = store();

    logs.getState().open('e1');
    expect(logs.getState().focusedEntryId).toBe('e1');
    logs.getState().clearFocus();
    expect(logs.getState().focusedEntryId).toBeNull();

    logs.getState().revealFile();
    expect(revealed).toBe(1);
  });

  it('hydrates from the recent buffer without dropping live entries', () => {
    const logs = store();
    logs.getState().push(entry({ id: 'live-1' }));
    logs.getState().hydrate([entry({ id: 'buffered-1' })]);
    // Hydration replaces the buffer, then de-duplication keeps a re-arriving live entry once.
    logs.getState().push(entry({ id: 'live-1' }));

    expect(logs.getState().entries.map(e => e.id)).toEqual(['buffered-1', 'live-1']);
  });
});

describe('forwarding to the main process', () => {
  it('forwards a renderer entry and shows it locally', () => {
    const logs = store();
    const created = logs.getState().addLocal('error', 'renderer', 'boom', 'stack');

    expect(logs.getState().entries.map(e => e.id)).toEqual([created.id]);
    expect(appended.map(e => e.message)).toEqual(['boom']);
    expect(appended[0]?.source).toBe('renderer');
    expect(appended[0]?.detail).toBe('stack');
  });

  it('stops forwarding after the window budget, and still shows everything locally', () => {
    const logs = store();

    for (let index = 0; index < 60; index += 1) {
      logs.getState().addLocal('warn', 'renderer', `line ${index}`);
    }

    // The IPC channel is protected …
    expect(appended).toHaveLength(20);
    // … and the panel is not lied to.
    expect(logs.getState().entries).toHaveLength(60);
  });

  it('reports what it dropped on the next window rather than losing it silently', () => {
    const logs = store();
    for (let index = 0; index < 60; index += 1) {
      logs.getState().addLocal('warn', 'renderer', `line ${index}`);
    }
    expect(appended).toHaveLength(20);

    clock += 1_000;
    logs.getState().addLocal('info', 'renderer', 'after the burst');

    const summary = appended[20];
    expect(summary?.level).toBe('warn');
    expect(summary?.message).toContain('40');
    expect(summary?.message).toContain('not forwarded');
    expect(appended.at(-1)?.message).toBe('after the burst');
  });

  it('refills the budget each window', () => {
    const logs = store();
    for (let window = 0; window < 3; window += 1) {
      clock += 1_000;
      for (let index = 0; index < 5; index += 1) {
        logs.getState().addLocal('info', 'renderer', `w${window}-${index}`);
      }
    }

    // Five per window, three windows, and no summary entry because nothing was ever dropped.
    expect(appended).toHaveLength(15);
    expect(appended.some(e => e.message.includes('not forwarded'))).toBe(false);
  });

  it('does not touch the bridge in browser mode', () => {
    removeJoineryMock();
    const logs = store();

    expect(() => logs.getState().addLocal('error', 'renderer', 'boom')).not.toThrow();
    expect(logs.getState().entries).toHaveLength(1);
    logs.getState().revealFile();
  });
});

describe('the diagnostics sink', () => {
  it('routes every ported store’s catch block into the panel', () => {
    const logs = store();
    teardowns.push(installLogDiagnosticsSink(logs));

    diagnostics.error('failed to save tabs', new Error('nope'));
    diagnostics.warn('something odd', { detail: 1 });

    const [first, second] = logs.getState().entries;
    expect(first?.level).toBe('error');
    expect(first?.message).toBe('failed to save tabs');
    expect(first?.detail).toContain('nope');
    expect(second?.level).toBe('warn');
    expect(second?.detail).toContain('"detail": 1');
  });

  it('renders any cause, because a rejected IPC call can reject with anything', () => {
    expect(describeCause(undefined)).toBeUndefined();
    expect(describeCause(null)).toBeUndefined();
    expect(describeCause('plain')).toBe('plain');
    expect(describeCause(new Error('boom'))).toContain('boom');
    expect(describeCause({ a: 1 })).toBe('{\n  "a": 1\n}');

    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(describeCause(circular)).toBe('[object Object]');
  });
});
