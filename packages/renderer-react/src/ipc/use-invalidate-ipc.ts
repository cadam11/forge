/**
 * The sanctioned way to invalidate cached bridge results — and, with the lint fence in
 * `eslint.config.js`, the only one outside `src/ipc/`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────
 *
 * `ipcKeys.<ns>.key(operation, …args)` is the lower-level door: it accepts any argument list, which
 * is right for invalidation (partial keys are the *point* — one reconnect should invalidate every
 * database beneath a connection) and wrong for reading, where `useIpcQuery` deliberately makes
 * `keyArgs` required and separate from the call arguments so a secret can never land in a cache key
 * (`use-ipc-call.ts` has the full argument). Nothing stops a call site from hand-rolling
 * `useQuery({ queryKey: ipcKeys.query.key('execute'), queryFn: … })` and losing that discipline
 * entirely.
 *
 * The nine ported stores were the evidence for deciding: they never need a query key at all. They
 * hold their own state and call `ipc()` directly, exactly as the Angular states called
 * `IpcService`. So `ipcKeys` has no legitimate consumer outside this directory *except*
 * invalidation, and once invalidation has a door of its own the fence costs nothing and closes the
 * hole for all of Tasks 8-19.
 *
 * Keys stay `[namespace, operation, ...keyArgs]`, and TanStack matches key prefixes, which is what
 * makes all three scopes below one mechanism.
 */

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ipcKeys } from './keys';
import type { IpcNamespace, IpcOperation } from './surface';

export interface IpcInvalidator {
  /** Everything cached for one namespace: "something under here changed, re-read it all." */
  namespace: (namespace: IpcNamespace) => Promise<void>;
  /**
   * One operation, optionally narrowed by the leading key arguments that identify a result.
   * `operation('explorer', 'getChildren', connectionId)` invalidates every cached path under one
   * connection; adding the database narrows it to that database.
   */
  operation: <N extends IpcNamespace>(
    namespace: N,
    operation: IpcOperation<N>,
    ...keyArgs: readonly unknown[]
  ) => Promise<void>;
}

export function useInvalidateIpc(): IpcInvalidator {
  const queryClient = useQueryClient();

  // Stable across renders so it can sit in an effect's or a mutation callback's dependency list.
  return useMemo(
    () => ({
      namespace: namespace => queryClient.invalidateQueries({ queryKey: ipcKeys[namespace].all }),
      operation: (namespace, operation, ...keyArgs) =>
        queryClient.invalidateQueries({
          queryKey: ipcKeys[namespace].key(operation, ...keyArgs),
        }),
    }),
    [queryClient]
  );
}
