/**
 * The status bar's keychain indicator (J-118).
 *
 * The bar is mounted for real rather than the hook being probed in isolation, because the
 * contract this ticket adds is a rendered one: `data-testid="status-keychain"` exists exactly
 * when the credential store has told the renderer it is degraded, and does not exist otherwise.
 * A hook test would pass with the indicator wired to nothing.
 *
 * The rest of the bar's bridge calls are deliberately unmocked. They fail into TanStack's error
 * state — a version that reads "Joinery", a Docker pip that reports the probe failed — which is
 * noise this file does not assert on and cannot be broken by.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KeychainStatus } from '@joinery/shared';

import { installJoineryMock, recordSubscription, removeJoineryMock } from '../test/joinery-mock';
import { setDiagnosticsSink } from '../state/diagnostics';
import { IpcQueryProvider } from '../ipc';
import { TooltipProvider } from '../ui';
import { StatusBar } from './status-bar';

const TROUBLESHOOTING_URL = 'https://usejoinery.com/troubleshooting/credentials-and-keychain/';

const teardowns: (() => void)[] = [];

/** Every developer-facing warning raised during a test, so nothing can be swallowed unnoticed. */
let warnings: { context: string; cause: unknown }[] = [];

/**
 * Installs the bridge with the keychain answering `status`, and hands back the push channel so
 * a test can degrade the app mid-session the way a failed save does.
 *
 * `status` may throw, which is how a rejected invoke is expressed here.
 */
function installBridge(status: () => KeychainStatus) {
  const pushes = recordSubscription<KeychainStatus>();
  const getKeychainStatus = vi.fn(() => Promise.resolve().then(status));
  const openExternal = vi.fn(() => Promise.resolve(undefined));

  teardowns.push(
    installJoineryMock({
      app: { getVersion: () => Promise.resolve('1.2.3'), openExternal },
      credentials: { getKeychainStatus, onKeychainStatusChanged: pushes.subscribe },
    })
  );

  return { pushes, getKeychainStatus, openExternal };
}

function mountBar(): void {
  render(
    <IpcQueryProvider>
      <TooltipProvider>
        <StatusBar />
      </TooltipProvider>
    </IpcQueryProvider>
  );
}

beforeEach(() => {
  warnings = [];
  teardowns.push(
    setDiagnosticsSink({
      error: () => undefined,
      warn: (context, cause) => warnings.push({ context, cause }),
    })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
});

describe('status bar keychain indicator', () => {
  it('renders nothing while the keychain is available', async () => {
    const { getKeychainStatus } = installBridge(() => ({ available: true }));

    mountBar();

    await waitFor(() => expect(getKeychainStatus).toHaveBeenCalled());
    // The positive control, and the reason it is a different query: waiting on the call proves
    // only that the request went out. `Joinery v1.2.3` is bridge data that has come back
    // through the same query layer and been COMMITTED, so by the time it is on screen a
    // resolved `{ available: true }` has been committed too. Without it, this case would
    // discriminate by timing rather than by construction.
    await screen.findByText('Joinery v1.2.3');
    expect(screen.queryByTestId('status-keychain')).toBeNull();
  });

  it('shows the indicator when main reports the keychain unavailable', async () => {
    installBridge(() => ({ available: false }));

    mountBar();

    const indicator = await screen.findByTestId('status-keychain');
    expect(indicator.textContent).toContain('Keychain unavailable');
    // The accessible name has to carry the consequence, not just the fault: the tooltip is
    // hover-only, and "Keychain unavailable" alone does not tell anyone their passwords are
    // about to vanish.
    expect(indicator.getAttribute('aria-label')).toContain(
      'passwords will not be saved this session'
    );
  });

  it('appears when the keychain fails mid-session, without a reload', async () => {
    let available = true;
    const { pushes, getKeychainStatus } = installBridge(() => ({ available }));

    mountBar();
    await waitFor(() => expect(getKeychainStatus).toHaveBeenCalled());
    // Same positive control as above: the bar has committed bridge data, so "no indicator" is
    // a statement about the committed render rather than about a race.
    await screen.findByText('Joinery v1.2.3');
    expect(screen.queryByTestId('status-keychain')).toBeNull();

    // What a failed save looks like from here: main flips, then pushes.
    available = false;
    pushes.emit({ available: false });

    await screen.findByTestId('status-keychain');
  });

  it('opens the troubleshooting page in the host browser when pressed', async () => {
    const { openExternal } = installBridge(() => ({ available: false }));

    mountBar();
    await userEvent.click(await screen.findByTestId('status-keychain'));

    expect(openExternal).toHaveBeenCalledWith(TROUBLESHOOTING_URL);
  });

  it('reports a rejected status read instead of showing an alarm for it', async () => {
    const failure = new Error('no handler registered for credentials:get-keychain-status');
    installBridge(() => {
      throw failure;
    });

    mountBar();

    // Fail open: an IPC hiccup is not evidence that the keychain refused, so the bar stays
    // quiet — but the failure has to exist somewhere the user's output panel can show it.
    await waitFor(() => expect(warnings).toHaveLength(1));
    expect(warnings[0]?.cause).toBe(failure);
    expect(screen.queryByTestId('status-keychain')).toBeNull();
  });

  it('stays hidden with no bridge at all — a plain browser is not a degraded keychain', async () => {
    removeJoineryMock();

    mountBar();

    await screen.findByTestId('status-bar');
    expect(screen.queryByTestId('status-keychain')).toBeNull();
  });
});
