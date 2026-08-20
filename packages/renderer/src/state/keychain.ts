/**
 * Whether the OS credential store is still usable this session (J-118).
 *
 * There is no zustand store here on purpose. The fact has exactly one owner — the main
 * process — and exactly one reader, the status bar, so the query cache IS the state: one
 * entry under `['credentials', 'getKeychainStatus']`, seeded by the invoke at mount and
 * re-read when main pushes the degradation edge. A second copy in a store would only be
 * something for the cache to disagree with.
 *
 * Both halves are needed because degradation has two arrival times. The startup vault read
 * can be refused before the window has finished loading, so no push would reach anyone —
 * that case is what the invoke answers. A save or a delete can fail later, with the app
 * already up — that case is the push.
 */

import { useCallback, useEffect } from 'react';

import { isIpcAvailable, useIpcEvent, useIpcQuery, useInvalidateIpc } from '../ipc';
import { diagnostics } from './diagnostics';

/**
 * `true` only when main has positively reported the keychain as unavailable.
 *
 * Every other state — still loading, no bridge at all (a plain browser tab), the call
 * failed — reads as `false`. The indicator this drives is an alarm, and an alarm that fires
 * on "don't know yet" is one users learn to ignore.
 *
 * Fail-open on the *display* is not the same as failing silently: a rejected invoke is
 * reported through `diagnostics` below, so it lands in the output panel rather than existing
 * only in the main-process log.
 */
export function useKeychainDegraded(): boolean {
  const status = useIpcQuery({
    namespace: 'credentials',
    operation: 'getKeychainStatus',
    enabled: isIpcAvailable(),
  });

  /**
   * The queries run under `retry: false` (`ipc/query-provider.tsx`), so a rejection here is
   * final: the handler is unregistered, or main is tearing down. The bar stays quiet either
   * way — that decision is above — but the error is reported rather than discarded.
   *
   * Keyed on the error's identity rather than on `isError`, so one failure is reported once
   * instead of once per render, and a later distinct failure is still reported.
   */
  useEffect(() => {
    if (status.error === null) return;
    diagnostics.warn(
      'could not read keychain availability; the indicator stays hidden',
      status.error
    );
  }, [status.error]);

  const invalidate = useInvalidateIpc();
  const reread = useCallback(() => {
    void invalidate.operation('credentials', 'getKeychainStatus');
  }, [invalidate]);

  // Re-read rather than write the pushed payload into the cache: main is the authority on
  // its own state, and one extra invoke on an edge that fires at most once a session is
  // cheaper than two code paths that can disagree about what "available" means.
  useIpcEvent('credentials', 'onKeychainStatusChanged', reread);

  return status.data?.available === false;
}
