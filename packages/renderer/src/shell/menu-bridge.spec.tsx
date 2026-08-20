/**
 * The native-menu bridge.
 *
 * The thing worth testing is not that one channel works — it is that **no channel is missing and
 * none is misrouted**. The Angular renderer had three channels wired to a router with no outlet and
 * nothing could tell; the type system covers the "missing" half (`MENU_COMMANDS` is a total map over
 * preload's own `menu` namespace), and this covers the routing half by emitting on every channel and
 * checking which command arrived.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { installJoineryMock, removeJoineryMock } from '../test/joinery-mock';
import { COMMAND_IDS, subscribeCommand, type CommandId } from '../commands';
import { MENU_CHANNELS, MENU_COMMANDS, MenuBridge } from './menu-bridge';

type MenuChannel = (typeof MENU_CHANNELS)[number];

/** A `menu` namespace whose every channel can be fired on demand. */
function installMenuBridge(): {
  readonly emit: (channel: MenuChannel) => void;
  readonly liveCount: () => number;
} {
  const listeners = new Map<MenuChannel, Set<() => void>>();
  const menu: Record<string, (callback: () => void) => () => void> = {};

  for (const channel of MENU_CHANNELS) {
    menu[channel] = (callback: () => void) => {
      const set = listeners.get(channel) ?? new Set();
      listeners.set(channel, set);
      set.add(callback);
      return () => set.delete(callback);
    };
  }

  installJoineryMock({ menu: menu as never });

  return {
    emit: channel => {
      for (const listener of [...(listeners.get(channel) ?? [])]) listener();
    },
    liveCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}

/** Records every command dispatched, in order. */
function recordCommands(): { readonly seen: CommandId[]; readonly stop: () => void } {
  const seen: CommandId[] = [];
  const teardowns = COMMAND_IDS.map(id =>
    subscribeCommand(id, () => {
      seen.push(id);
    })
  );
  return {
    seen,
    stop: () => {
      for (const teardown of teardowns) teardown();
    },
  };
}

/**
 * jsdom implements no `document.execCommand`, and the Edit ▸ Copy fallback calls it — so every test
 * in this file needs it present, not only the two that assert on it. Installed per test rather than
 * in `test/setup.ts` so the fake cannot quietly satisfy some other spec's copy path.
 */
let execCommand: ReturnType<typeof vi.fn>;

beforeEach(() => {
  execCommand = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
});

afterEach(() => {
  removeJoineryMock();
  Reflect.deleteProperty(document, 'execCommand');
  vi.restoreAllMocks();
});

describe('the native-menu bridge', () => {
  it('routes every channel to the command the registry names', () => {
    const bridge = installMenuBridge();
    const recorder = recordCommands();
    render(<MenuBridge />);

    for (const channel of MENU_CHANNELS) {
      bridge.emit(channel);
    }

    // One command per channel, in channel order, each the one `MENU_COMMANDS` declares.
    expect(recorder.seen).toEqual(MENU_CHANNELS.map(channel => MENU_COMMANDS[channel]));
    recorder.stop();
  });

  it('covers all 30 channels the preload bridge exposes', () => {
    // 31 at Task 24 — not the 34 that brief stated — cross-checked two ways: the `menu` block in
    // `packages/preload/src/index.ts`, and the 31 `menu.on*` subscriptions in the Angular
    // `menu.service.ts`. J-92 added `onOpenAiSetup` for the `AI Setup…` item, making it 32; J-104
    // removed `onServerProperties` and `onDatabaseProperties` with the dead Server / Database ▸
    // Properties items that sent them, making it 30. The type of `MENU_COMMANDS` is what keeps
    // this honest — it is a `Record` over `IpcEventName<'menu'>`, so a channel added to preload and
    // not routed here is a compile error, and this assertion is the count that goes with it.
    expect(MENU_CHANNELS).toHaveLength(30);
    expect(new Set(MENU_CHANNELS).size).toBe(30);
    expect(MENU_CHANNELS).toContain('onOpenAiSetup');
    // The two J-104 took out. Re-adding either without a subscriber is what this guards.
    expect(MENU_CHANNELS).not.toContain('onServerProperties');
    expect(MENU_CHANNELS).not.toContain('onDatabaseProperties');
  });

  it('names a registered command for every channel, with no duplicates but menu-copy', () => {
    const routed = MENU_CHANNELS.map(channel => MENU_COMMANDS[channel]);
    for (const commandId of routed) {
      expect(COMMAND_IDS).toContain(commandId);
    }
    // Every channel gets its own command: two menu items sharing one id would make the audit's
    // "which menu item did this?" question unanswerable again.
    expect(new Set(routed).size).toBe(routed.length);
  });

  it('subscribes once per channel and tears every subscription down', () => {
    const bridge = installMenuBridge();
    const view = render(<MenuBridge />);

    expect(bridge.liveCount()).toBe(MENU_CHANNELS.length);

    view.unmount();
    expect(bridge.liveCount()).toBe(0);
  });

  it('falls back to the platform copy when nothing claims Edit ▸ Copy', () => {
    const bridge = installMenuBridge();
    render(<MenuBridge />);

    bridge.emit('onCopy');

    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('does NOT fall back when a surface claims Edit ▸ Copy', () => {
    // The results grid's contract: it honours the user's TSV/CSV/JSON copy format, so the platform
    // copy must not also run and overwrite the clipboard with the plain selection.
    const bridge = installMenuBridge();
    const claim = subscribeCommand('menu-copy', () => true);
    render(<MenuBridge />);

    bridge.emit('onCopy');

    expect(execCommand).not.toHaveBeenCalled();
    claim();
  });

  it('is inert without a preload bridge rather than throwing', () => {
    // Browser mode. `useIpcEvent` guards this, but the bridge is the component most likely to be
    // rendered outside Electron by accident.
    removeJoineryMock();
    expect(() => render(<MenuBridge />)).not.toThrow();
  });
});
