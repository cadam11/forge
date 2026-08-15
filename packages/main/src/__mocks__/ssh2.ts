/**
 * Test mock for the `ssh2` npm module.
 *
 * Aliased in vitest.config.ts so ALL test imports of `ssh2` (including
 * indirect imports via setup files) resolve here. This avoids the module-cache
 * race where setup.ts loads the real ssh2 before a spec's vi.mock can intercept.
 *
 * Tests can reach into `__mockSshClients` to drive lifecycle events (emit
 * 'close' / 'end' / 'error' on a tunnel that the manager has already opened).
 */

import { EventEmitter } from 'events';

export interface MockSshClient extends EventEmitter {
  connectConfig: Record<string, unknown> | null;
  ended: boolean;
  connect: (cfg: Record<string, unknown>) => void;
  end: () => void;
  forwardOut: () => void;
}

export const __mockSshClients: MockSshClient[] = [];

// When true (default), the mock fires 'ready' on the next tick after connect().
// Tests that exercise the establishment-failure path can flip this to false.
export const __mockSshState = {
  autoReady: true,
};

export const __resetMockSsh = (): void => {
  __mockSshClients.length = 0;
  __mockSshState.autoReady = true;
};

export class Client extends EventEmitter implements MockSshClient {
  connectConfig: Record<string, unknown> | null = null;
  ended = false;

  constructor() {
    super();
    __mockSshClients.push(this);
  }

  connect(cfg: Record<string, unknown>): void {
    this.connectConfig = cfg;
    if (__mockSshState.autoReady) {
      // Mimic real ssh2 by firing 'ready' on the next tick.
      setImmediate(() => this.emit('ready'));
    }
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    setImmediate(() => {
      this.emit('end');
      this.emit('close');
    });
  }

  forwardOut(): void {
    // Tests don't pipe traffic through tunnels; this is a no-op so calls
    // from the manager's local server don't blow up.
  }
}
