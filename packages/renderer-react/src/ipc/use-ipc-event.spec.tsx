import { StrictMode, useState } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '@joinery/shared';
import { useIpcEvent } from './use-ipc-event';
import {
  installJoineryMock,
  recordSubscription,
  removeJoineryMock,
  type RecordedSubscription,
} from '../test/joinery-mock';

function entry(message: string): LogEntry {
  return {
    id: message,
    timestamp: 1_755_000_000_000,
    level: 'info',
    tag: 'test',
    message,
    source: 'main',
  };
}

/** Mounts a component whose only job is to subscribe to `logs.onEntry`. */
function Subscriber({ onEntry }: { onEntry: (received: LogEntry) => void }) {
  useIpcEvent('logs', 'onEntry', onEntry);
  return null;
}

function installLogEntryChannel(): RecordedSubscription<LogEntry> {
  const channel = recordSubscription<LogEntry>();
  installJoineryMock({ logs: { onEntry: channel.subscribe } });
  return channel;
}

describe('useIpcEvent', () => {
  afterEach(() => {
    removeJoineryMock();
  });

  it('subscribes on mount and delivers payloads to the handler', () => {
    const channel = installLogEntryChannel();
    const handler = vi.fn();

    render(<Subscriber onEntry={handler} />);
    expect(channel.subscribeCount()).toBe(1);

    act(() => channel.emit(entry('first')));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ message: 'first' });
  });

  it('unsubscribes on unmount and stops delivering', () => {
    const channel = installLogEntryChannel();
    const handler = vi.fn();

    const { unmount } = render(<Subscriber onEntry={handler} />);
    unmount();

    expect(channel.unsubscribeCount()).toBe(1);
    expect(channel.liveCount()).toBe(0);

    act(() => channel.emit(entry('after unmount')));
    expect(handler).not.toHaveBeenCalled();
  });

  it('leaves exactly one live listener under StrictMode double-mounting', () => {
    const channel = installLogEntryChannel();
    const handler = vi.fn();

    render(
      <StrictMode>
        <Subscriber onEntry={handler} />
      </StrictMode>
    );

    // StrictMode mounts, tears down and remounts every effect in development. Both halves
    // must be observable, or this test would pass on a hook that never cleaned up.
    expect(channel.subscribeCount()).toBe(2);
    expect(channel.unsubscribeCount()).toBe(1);

    // The assertion that matters: the discarded first subscription is gone, so one emit
    // fires the handler once rather than twice.
    expect(channel.liveCount()).toBe(1);

    act(() => channel.emit(entry('once')));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes both StrictMode subscriptions by unmount', () => {
    const channel = installLogEntryChannel();

    const { unmount } = render(
      <StrictMode>
        <Subscriber onEntry={vi.fn()} />
      </StrictMode>
    );
    unmount();

    expect(channel.unsubscribeCount()).toBe(channel.subscribeCount());
    expect(channel.liveCount()).toBe(0);
  });

  it('does not resubscribe when only the handler identity changes', () => {
    const channel = installLogEntryChannel();
    const received: string[] = [];

    function Rerenderer() {
      const [count, setCount] = useState(0);
      // A fresh closure every render — the case that would thrash the subscription if the
      // hook listed the handler in its effect dependencies.
      useIpcEvent('logs', 'onEntry', () => received.push(`at-${count}`));
      return <button onClick={() => setCount(current => current + 1)}>bump</button>;
    }

    const { getByRole } = render(<Rerenderer />);
    act(() => getByRole('button').click());
    act(() => getByRole('button').click());

    expect(channel.subscribeCount()).toBe(1);
    expect(channel.liveCount()).toBe(1);

    // …and the *latest* closure is the one that runs, not the one captured at mount.
    act(() => channel.emit(entry('x')));
    expect(received).toEqual(['at-2']);
  });

  it('is inert, not fatal, when the bridge is absent', () => {
    removeJoineryMock();
    const handler = vi.fn();

    expect(() => render(<Subscriber onEntry={handler} />)).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('supports the payload-less menu commands', () => {
    const channel = recordSubscription<void>();
    installJoineryMock({ menu: { onNewQuery: channel.subscribe } });
    const handler = vi.fn();

    function MenuSubscriber() {
      useIpcEvent('menu', 'onNewQuery', handler);
      return null;
    }

    render(<MenuSubscriber />);
    act(() => channel.emit(undefined));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('types the namespace, the event name and the payload from the preload interface', () => {
    function TypeProbe() {
      // Payload types are inferred, not annotated: a wrong annotation is a compile error.
      useIpcEvent('logs', 'onEntry', received => expect(received.level).toBeDefined());
      useIpcEvent('theme', 'onChanged', theme => expect(theme === 'dark').toBeDefined());
      useIpcEvent('workspace', 'onFileChanged', event => expect(event.filePath).toBeDefined());

      // @ts-expect-error `connection` declares no event subscriptions
      useIpcEvent('connection', 'list', () => undefined);

      // @ts-expect-error `onProgress` belongs to `backup` and `restore`, not to `logs`
      useIpcEvent('logs', 'onProgress', () => undefined);

      // @ts-expect-error `getRecent` is a request/response member, not an event
      useIpcEvent('logs', 'getRecent', () => undefined);

      // @ts-expect-error a LogEntry payload is not a string
      useIpcEvent('logs', 'onEntry', (received: string) => received);

      return null;
    }

    // The five directives above are the test; rendering only proves the probe is real code.
    expect(TypeProbe).toBeTypeOf('function');
  });
});
